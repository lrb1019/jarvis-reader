import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const runtimeArtifacts = ["main.js", "styles.css"];

function readRuntimePluginDirectory() {
  try {
    return execFileSync(
      "git",
      ["config", "--local", "--get", "jarvis.runtimePluginDir"],
      { cwd: projectRoot, encoding: "utf8" },
    ).trim();
  } catch {
    throw new Error(
      "未配置本地运行插件目录。请先设置 git config --local jarvis.runtimePluginDir <实际 vault 插件目录>",
    );
  }
}

function readManifest(root) {
  const path = join(root, "manifest.json");
  if (!existsSync(path)) {
    throw new Error(`目标目录缺少 manifest.json：${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

for (const artifact of runtimeArtifacts) {
  if (!existsSync(join(projectRoot, artifact))) {
    throw new Error(`缺少 ${artifact}，请先运行 npm run verify`);
  }
}

const runtimePluginDirectory = resolve(readRuntimePluginDirectory());
if (runtimePluginDirectory === resolve(projectRoot)) {
  throw new Error("本地运行插件目录不能与源码仓库相同");
}

const sourceManifest = readManifest(projectRoot);
const runtimeManifest = readManifest(runtimePluginDirectory);
if (
  sourceManifest.id !== "jarvis-reader"
  || runtimeManifest.id !== sourceManifest.id
) {
  throw new Error(
    `插件身份不匹配：源码=${sourceManifest.id || "缺失"}，目标=${runtimeManifest.id || "缺失"}`,
  );
}

const pendingArtifacts = runtimeArtifacts.map((artifact) => ({
  source: join(projectRoot, artifact),
  pending: join(runtimePluginDirectory, `.${artifact}.pending`),
  destination: join(runtimePluginDirectory, artifact),
}));

try {
  for (const artifact of pendingArtifacts) {
    copyFileSync(artifact.source, artifact.pending);
  }
  for (const artifact of pendingArtifacts) {
    renameSync(artifact.pending, artifact.destination);
  }
} finally {
  for (const artifact of pendingArtifacts) {
    if (existsSync(artifact.pending)) {
      unlinkSync(artifact.pending);
    }
  }
}

console.log(`已部署 ${runtimeArtifacts.join("、")} 到本地验收目录：${runtimePluginDirectory}`);
