import { readFileSync, existsSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));
const versions = JSON.parse(read("versions.json"));
const errors = [];
for (const path of ["README.md", "LICENSE", "main.js", "styles.css", "THIRD_PARTY_NOTICES.md"]) {
  if (!existsSync(path)) errors.push(`Missing required project file: ${path}`);
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id) || manifest.id.includes("obsidian")) errors.push("Invalid community plugin ID.");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.version !== pkg.version || versions[manifest.version] !== manifest.minAppVersion) errors.push("Version metadata is inconsistent.");
if (!manifest.description || manifest.description.length > 250 || !manifest.description.endsWith(".")) errors.push("Description must be at most 250 characters and end with a period.");
const runtime = read("main.js");
if (/react(?:-dom)?\/cjs\/react(?:-dom)?\.development\.js/.test(runtime)) errors.push("Production runtime includes React development modules.");
for (const path of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  if (!runtime.includes(read(path))) errors.push(`Runtime is missing the current notice: ${path}`);
}
const unresolved = read("THIRD_PARTY_NOTICES.md").split(/^## /m).filter(section => section.includes("**Unresolved:")).map(section => section.split("\n")[0]);
for (const name of unresolved) errors.push(`Upstream licensing requires resolution: ${name}`);
if (errors.length) {
  console.error("Submission preparation checks failed:\n" + errors.map(error => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Local submission file checks passed. Host acceptance, release assets, public repository state and official review still require separate verification.");
}
