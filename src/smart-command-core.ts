export type SmartCommandSource = "template" | "skill";

export interface SmartCommand {
  id: string;
  label: string;
  description?: string;
  icon: string;
  prompt: string;
  enabled: boolean;
  scope: "selection" | "note" | "both";
  source?: SmartCommandSource;
  skillPath?: string;
}

export interface SmartCommandVariables {
  selection: string;
  content: string;
  book_title: string;
  chapter: string;
}

export type SkillFileReader = (path: string) => Promise<string | null>;

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;

/**
 * Replace template variables in a prompt string.
 * Supported: {{selection}}, {{content}}, {{book_title}}, {{chapter}}
 */
export function buildPromptFromTemplate(
  template: string,
  vars: SmartCommandVariables | Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

export function resolveSkillFilePath(configuredPath: string | undefined): string {
  const rawPath = (configuredPath || "").trim();
  if (!rawPath) {
    throw new Error("请先设置 Skill 目录。");
  }
  if (rawPath.startsWith("/") || rawPath.startsWith("~") || WINDOWS_ABSOLUTE_PATH.test(rawPath)) {
    throw new Error("Skill 目录必须使用知识库相对路径。");
  }

  const normalizedPath = rawPath
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/g, "");
  const pathSegments = normalizedPath.split("/");
  if (pathSegments.some((segment) => segment === "..")) {
    throw new Error("Skill 目录不能跳出当前知识库。");
  }
  if (!normalizedPath) {
    throw new Error("请先设置 Skill 目录。");
  }
  if (normalizedPath.endsWith("/SKILL.md") || normalizedPath === "SKILL.md") {
    return normalizedPath;
  }
  if (normalizedPath.toLowerCase().endsWith(".md")) {
    throw new Error("Skill 文件必须命名为 SKILL.md。");
  }
  return `${normalizedPath}/SKILL.md`;
}

function buildDefaultSkillTask(vars: SmartCommandVariables): string {
  const lines: string[] = [];
  if (vars.chapter) {
    lines.push(`章节：${vars.chapter}`);
  }
  lines.push(vars.selection || vars.content);
  return lines.join("\n").trim();
}

export async function prepareSmartCommandPrompt(
  command: SmartCommand,
  vars: SmartCommandVariables,
  readSkillFile: SkillFileReader
): Promise<string> {
  if (command.source !== "skill") {
    return buildPromptFromTemplate(command.prompt, vars);
  }

  const skillFilePath = resolveSkillFilePath(command.skillPath);
  let skillContent: string | null;
  try {
    skillContent = await readSkillFile(skillFilePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取 Skill 失败：${message}`);
  }
  if (skillContent === null) {
    throw new Error(`找不到 Skill 文件：${skillFilePath}`);
  }
  if (!skillContent.trim()) {
    throw new Error(`Skill 文件内容为空：${skillFilePath}`);
  }

  const taskTemplate = command.prompt.trim();
  const task = taskTemplate
    ? buildPromptFromTemplate(taskTemplate, vars)
    : buildDefaultSkillTask(vars);

  return [
    `读取并遵循：${skillFilePath}`,
    "",
    task,
  ].join("\n");
}
