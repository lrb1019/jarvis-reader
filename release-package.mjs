import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { packageDictionary } from "./package-dictionary.mjs";

const requiredFiles = ["main.js", "manifest.json", "styles.css", "LICENSE", "THIRD_PARTY_NOTICES.md"];
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
const version = packageJson.version;

if (manifest.version !== version || versions[version] !== manifest.minAppVersion) {
  throw new Error("package.json、manifest.json 和 versions.json 的版本与最低 Obsidian 版本必须一致。");
}

for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error(`发布资源缺失：${file}`);
}
const runtime = readFileSync("main.js", "utf8");
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  if (!runtime.includes(readFileSync(file, "utf8"))) throw new Error(`main.js 未包含最新许可声明，请重新构建：${file}`);
}

const releaseFolder = "release";
const archive = join(releaseFolder, `jarvis-reader-${version}.zip`);
mkdirSync(releaseFolder, { recursive: true });
rmSync(archive, { force: true });

execFileSync("zip", ["-q", archive, ...requiredFiles], { stdio: "inherit" });

const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
for (const file of requiredFiles) {
  if (!entries.includes(file)) throw new Error(`ZIP 根目录缺失：${file}`);
}
if (entries.length !== requiredFiles.length) throw new Error("插件 ZIP 包含清单之外的文件。");

console.log(`已生成并校验发布包：${archive}`);
packageDictionary();
