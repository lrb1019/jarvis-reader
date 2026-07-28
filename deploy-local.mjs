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
const sourceBundle = join(projectRoot, "main.js");

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

if (!existsSync(sourceBundle)) {
  throw new Error("缺少 main.js，请先运行 npm run verify");
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

const pendingBundle = join(runtimePluginDirectory, ".main.pending.js");
const runtimeBundle = join(runtimePluginDirectory, "main.js");

try {
  copyFileSync(sourceBundle, pendingBundle);
  renameSync(pendingBundle, runtimeBundle);
} finally {
  if (existsSync(pendingBundle)) {
    unlinkSync(pendingBundle);
  }
}

console.log(`已部署 main.js 到本地验收目录：${runtimePluginDirectory}`);
