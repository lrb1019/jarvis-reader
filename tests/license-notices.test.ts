import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve("scripts/generate-third-party-notices.mjs");
function fixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "jarvis-license-test-"));
  try {
    for (const path of ["licenses/reviewed-packages.json", "licenses/SPDX-ISC.txt", "licenses/nodejs-v7-path.txt", "dictionaries/ECDICT-LICENSE", "node_modules/react-reader/package.json", "node_modules/react-reader/LICENSE"]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      copyFileSync(path, join(root, path));
    }
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/react-reader": { version: "0.20.4" } } }));
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function generate(root: string, args: string[] = []) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
}

test("reviewed distribution retains conflicting declarations and both complete license texts", () => fixture(root => {
  assert.equal(generate(root).status, 0);
  const notice = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
  assert.ok(notice.includes(readFileSync("node_modules/react-reader/LICENSE", "utf8").trimEnd()));
  assert.ok(notice.includes(readFileSync("licenses/SPDX-ISC.txt", "utf8").trimEnd()));
  assert.match(notice, /Gerhard Sletten/);
  assert.match(notice, /Do not claim an upstream OR\/dual-license choice/);
  assert.equal(generate(root, ["--check"]).status, 0);
}));

test("changed package attribution reopens the distribution review", () => fixture(root => {
  const path = join(root, "node_modules/react-reader/package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8")); pkg.author = "Changed author";
  writeFileSync(path, JSON.stringify(pkg));
  const result = generate(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /review no longer matches package metadata/);
}));

test("changed supplied license cannot silently reuse a completed review", () => fixture(root => {
  writeFileSync(join(root, "node_modules/react-reader/LICENSE"), "Different terms");
  const result = generate(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Supplied license changed/);
}));

test("stale third-party notices fail the publication consistency check", () => fixture(root => {
  assert.equal(generate(root).status, 0);
  writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "Stale notice");
  const result = generate(root, ["--check"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /notices are stale/);
}));
