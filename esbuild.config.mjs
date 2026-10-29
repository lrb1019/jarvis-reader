import { builtinModules } from "node:module";
import { cp, mkdir, copyFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import process from "node:process";
import esbuild from "esbuild";

const production = process.argv[2] === "production";
const licenseNotice = ["LICENSE", "THIRD_PARTY_NOTICES.md"].map(path => readFileSync(path, "utf8")).join("\n\n");
if (licenseNotice.includes("*/")) throw new Error("License text cannot be embedded safely in the runtime comment.");

const context = await esbuild.context({
  banner: {
    js: `/*! Generated from src/. Jarvis Reader original code: MIT. Third-party terms follow.\n${licenseNotice}\n*/`,
  },
  bundle: true,
  define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") },
  entryPoints: ["src/main.ts"],
  external: [
    "obsidian",
    "electron",
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/autocomplete",
    "@codemirror/commands",
    ...builtinModules
  ],
  format: "cjs",
  logLevel: "info",
  outfile: "main.js",
  platform: "browser",
  sourcemap: production ? false : "inline",
  target: "es2022",
  treeShaking: true,
});



if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
  console.log(`Watching TypeScript sources; output: ./main.js`);
}
