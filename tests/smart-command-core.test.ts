import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareSmartCommandPrompt,
  resolveSkillFilePath,
  type SmartCommand,
  type SmartCommandVariables,
} from "../src/smart-command-core.ts";

const variables: SmartCommandVariables = {
  selection: "《测试书》原文：一段选中的内容",
  content: "一条读书感想",
  book_title: "测试书",
  chapter: "第一章",
};

function createCommand(overrides: Partial<SmartCommand> = {}): SmartCommand {
  return {
    id: "smart-test",
    label: "测试指令",
    icon: "bot",
    prompt: "",
    enabled: true,
    scope: "both",
    source: "skill",
    skillPath: "09 Books/skill/fable",
    ...overrides,
  };
}

test("resolves a Skill directory to its SKILL.md file", () => {
  assert.equal(
    resolveSkillFilePath("09 Books/skill/fable"),
    "09 Books/skill/fable/SKILL.md",
  );
  assert.equal(
    resolveSkillFilePath("./09 Books/skill/fable/SKILL.md"),
    "09 Books/skill/fable/SKILL.md",
  );
});

test("rejects absolute paths and paths outside the vault", () => {
  assert.throws(
    () => resolveSkillFilePath("/Users/a1/fable"),
    /知识库相对路径/,
  );
  assert.throws(
    () => resolveSkillFilePath("../fable"),
    /不能跳出当前知识库/,
  );
  assert.throws(
    () => resolveSkillFilePath("09 Books/skill/fable.md"),
    /必须命名为 SKILL\.md/,
  );
});

test("keeps existing template commands backward compatible", async () => {
  const prompt = await prepareSmartCommandPrompt(
    createCommand({
      source: "template",
      prompt: "{{book_title}}：{{selection}}",
    }),
    variables,
    async () => {
      throw new Error("template commands must not read a Skill file");
    },
  );

  assert.equal(prompt, "测试书：《测试书》原文：一段选中的内容");
});

test("validates the latest Skill but sends only its path on every invocation", async () => {
  const contents = ["第一版 Skill", "第二版 Skill"];
  let readCount = 0;
  const readSkill = async (path: string) => {
    assert.equal(path, "09 Books/skill/fable/SKILL.md");
    return contents[readCount++] || null;
  };
  const command = createCommand({ prompt: "补充任务：{{content}}" });

  const firstPrompt = await prepareSmartCommandPrompt(command, variables, readSkill);
  const secondPrompt = await prepareSmartCommandPrompt(command, variables, readSkill);

  assert.doesNotMatch(firstPrompt, /第一版 Skill/);
  assert.doesNotMatch(secondPrompt, /第二版 Skill/);
  assert.doesNotMatch(secondPrompt, /第一版 Skill/);
  assert.match(
    secondPrompt,
    /读取并遵循：09 Books\/skill\/fable\/SKILL\.md/,
  );
  assert.doesNotMatch(secondPrompt, /TASK START|TASK END|知识库相对路径/);
  assert.match(secondPrompt, /补充任务：一条读书感想/);
  assert.equal(readCount, 2);
});

test("uses reading context when a Skill has no supplemental task", async () => {
  const prompt = await prepareSmartCommandPrompt(
    createCommand(),
    variables,
    async () => "# Fable Skill",
  );

  assert.doesNotMatch(prompt, /# Fable Skill/);
  assert.match(prompt, /09 Books\/skill\/fable\/SKILL\.md/);
  assert.doesNotMatch(prompt, /书名：测试书/);
  assert.match(prompt, /章节：第一章/);
  assert.match(prompt, /《测试书》原文：一段选中的内容/);
});

test("stops before sending when the Skill file is missing, empty, or unreadable", async () => {
  await assert.rejects(
    prepareSmartCommandPrompt(createCommand(), variables, async () => null),
    /找不到 Skill 文件/,
  );
  await assert.rejects(
    prepareSmartCommandPrompt(createCommand(), variables, async () => " \n "),
    /Skill 文件内容为空/,
  );
  await assert.rejects(
    prepareSmartCommandPrompt(createCommand(), variables, async () => {
      throw new Error("permission denied");
    }),
    /读取 Skill 失败：permission denied/,
  );
});
