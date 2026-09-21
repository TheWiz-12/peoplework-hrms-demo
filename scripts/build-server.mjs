import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

await mkdir("build-server", { recursive: true });
await build({
  entryPoints: ["server/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: "build-server/main.js",
});
// app.ts loads this schema at runtime through import.meta.url.
await cp("server/schema.sql", "build-server/schema.sql");
