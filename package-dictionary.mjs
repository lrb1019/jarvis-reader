import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { DICTIONARY_SHARDS, DICTIONARY_SOURCE, parseDictionaryManifest, parseDictionaryShard } from "./src/dictionary-package.ts";

export function packageDictionary() {
  const files = {};
  for (const name of DICTIONARY_SHARDS) {
    const data = readFileSync(`dictionaries/ecdict/${name}`);
    parseDictionaryShard(data.toString("utf8"), name);
    files[name] = { bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  }
  const identity = createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 12);
  const manifest = { format: "jarvis-reader-ecdict-v1", version: `ecdict-${identity}`, source: DICTIONARY_SOURCE, license: "MIT", files };
  const text = JSON.stringify(manifest, null, 2);
  parseDictionaryManifest(text);
  mkdirSync("release", { recursive: true });
  const archive = resolve(`release/jarvis-reader-${manifest.version}.zip`);
  const folder = mkdtempSync(join(tmpdir(), "jarvis-dictionary-"));
  try {
    for (const name of DICTIONARY_SHARDS) copyFileSync(`dictionaries/ecdict/${name}`, join(folder, name));
    copyFileSync("dictionaries/ECDICT-LICENSE", join(folder, "LICENSE"));
    writeFileSync(join(folder, "dictionary.json"), text);
    rmSync(archive, { force: true });
    execFileSync("zip", ["-q", archive, "dictionary.json", "LICENSE", ...DICTIONARY_SHARDS], { cwd: folder });
    execFileSync("unzip", ["-tq", archive]);
    const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
    const expected = ["dictionary.json", "LICENSE", ...DICTIONARY_SHARDS];
    if (entries.length !== expected.length || expected.some(name => !entries.includes(name))) throw new Error("词典包文件清单不匹配。");
    writeFileSync(`${archive}.sha256`, `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  ${archive.split("/").pop()}\n`);
  } finally { rmSync(folder, { recursive: true, force: true }); }
  console.log(`已生成并校验独立词典包：${archive}`);
  return archive;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) packageDictionary();
