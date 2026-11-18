import { build } from "esbuild";
await build({
  entryPoints: ["warroom/src/worker.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  outfile: "warroom/dist/worker.js",
});
