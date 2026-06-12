import { builtinModules } from "node:module";
import { mkdir, copyFile } from "node:fs/promises";
import process from "node:process";
import esbuild from "esbuild";

const production = process.argv[2] === "production";
const outputDirectory = "build/migration";

const context = await esbuild.context({
  banner: {
    js: "/* Generated from the Jarvis Reader TypeScript migration source. */",
  },
  bundle: true,
  entryPoints: ["src/main.ts"],
  external: ["obsidian", "electron", ...builtinModules],
  format: "cjs",
  logLevel: "info",
  outfile: `${outputDirectory}/main.js`,
  platform: "browser",
  sourcemap: production ? false : "inline",
  target: "es2022",
  treeShaking: true,
});

await mkdir(outputDirectory, { recursive: true });
await copyFile("manifest.json", `${outputDirectory}/manifest.json`);

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
  console.log(`Watching TypeScript sources; output: ${outputDirectory}`);
}
