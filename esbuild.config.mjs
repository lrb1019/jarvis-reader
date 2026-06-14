import { builtinModules } from "node:module";
import { cp, mkdir, copyFile } from "node:fs/promises";
import process from "node:process";
import esbuild from "esbuild";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  banner: {
    js: "/* Generated from the Jarvis Reader TypeScript migration source. */",
  },
  bundle: true,
  entryPoints: ["src/main.ts"],
  external: ["obsidian", "electron", ...builtinModules],
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
