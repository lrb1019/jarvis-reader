import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const requiredFiles = ["main.js", "manifest.json", "styles.css", "THIRD_PARTY_NOTICES.md"];
const dictionaryFolder = "dictionaries/ecdict";
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
const version = packageJson.version;

if (manifest.version !== version || !(version in versions)) {
  throw new Error("package.json、manifest.json 和 versions.json 的版本必须一致。");
}

for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error(`发布资源缺失：${file}`);
}
if (!existsSync(dictionaryFolder)) throw new Error(`发布资源缺失：${dictionaryFolder}`);

const releaseFolder = "release";
const archive = join(releaseFolder, `jarvis-reader-${version}.zip`);
mkdirSync(releaseFolder, { recursive: true });
rmSync(archive, { force: true });

execFileSync("zip", ["-qr", archive, ...requiredFiles, dictionaryFolder], { stdio: "inherit" });

const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
for (const file of requiredFiles) {
  if (!entries.includes(file)) throw new Error(`ZIP 根目录缺失：${file}`);
}
if (!entries.some((entry) => entry.startsWith(`${dictionaryFolder}/`))) {
  throw new Error(`ZIP 缺失词典目录：${dictionaryFolder}`);
}

console.log(`已生成并校验发布包：${archive}`);
