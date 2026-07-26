import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const managedFiles = [
  ["项目管理/00 项目总览.md", "项目管理/00 项目总览.md"],
  ["项目管理/01 项目规则.md", "项目管理/01 项目规则.md"],
  ["项目管理/02 后续想法.md", "项目管理/02 后续想法.md"],
  ["项目管理/03 改动日志.md", "项目管理/03 改动日志.md"],
  ["项目管理/04 接续说明.md", "项目管理/04 接续说明.md"],
  ["项目管理/05 审查流程.md", "项目管理/05 审查流程.md"],
  ["项目管理/06 发布与同步流程.md", "项目管理/06 发布与同步流程.md"],
  ["AGENTS.md", "AGENTS.md"],
];
const secretPatterns = [
  /ghp_[A-Za-z0-9]+/,
  /github_pat_[A-Za-z0-9_]+/,
  /https:\/\/[^/\s:@]+:[^@\s]+@github\.com/,
];

function readManagementDirectory() {
  try {
    return execFileSync(
      "git",
      ["config", "--local", "--get", "jarvis.managementDir"],
      { cwd: projectRoot, encoding: "utf8" },
    ).trim();
  } catch {
    throw new Error(
      "未配置管理文档目录。请先设置 git config --local jarvis.managementDir <目录>",
    );
  }
}

const sourceRoot = readManagementDirectory();
if (!sourceRoot || !existsSync(sourceRoot)) {
  throw new Error(`管理项目目录不存在：${sourceRoot || "未设置"}`);
}

for (const [sourceName, destinationName] of managedFiles) {
  const sourcePath = join(sourceRoot, sourceName);
  const destinationPath = join(projectRoot, destinationName);

  if (!existsSync(sourcePath)) {
    throw new Error(`缺少管理文件：${sourceName}`);
  }

  const content = readFileSync(sourcePath, "utf8");
  if (secretPatterns.some((pattern) => pattern.test(content))) {
    throw new Error(`检测到疑似凭据，已停止同步：${sourceName}`);
  }

  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
}

console.log(`已同步 ${managedFiles.length} 份项目管理文件`);
