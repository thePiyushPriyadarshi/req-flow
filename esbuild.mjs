import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const watch = process.argv.includes("--watch");

mkdirSync("media", { recursive: true });
cpSync("webview/index.html", "media/index.html");
cpSync("webview/styles.css", "media/styles.css");

const extensionCtx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode"],
  platform: "node",
  format: "cjs",
  sourcemap: true,
  target: "node18",
});

const webviewCtx = await esbuild.context({
  entryPoints: ["webview/main.ts"],
  bundle: true,
  outfile: "media/main.js",
  platform: "browser",
  format: "iife",
  sourcemap: true,
  target: "es2022",
});

const envCtx = await esbuild.context({
  entryPoints: ["webview/env.ts"],
  bundle: true,
  outfile: "media/env.js",
  platform: "browser",
  format: "iife",
  sourcemap: true,
  target: "es2022",
});

if (watch) {
  await extensionCtx.watch();
  await webviewCtx.watch();
  await envCtx.watch();
  console.log("watching…");
} else {
  await extensionCtx.rebuild();
  await webviewCtx.rebuild();
  await envCtx.rebuild();
  await extensionCtx.dispose();
  await webviewCtx.dispose();
  await envCtx.dispose();
}
