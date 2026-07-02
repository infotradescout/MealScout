import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const serverIndex = path.resolve(repoRoot, "server", "index.ts");
const serverVite = path.resolve(repoRoot, "server", "vite.ts");
const distRoot = path.resolve(repoRoot, "dist");
const outDir = path.resolve(repoRoot, "dist", "server");

if (!existsSync(serverIndex) || !existsSync(serverVite)) {
  console.log(
    "[build:server] Skipping server build because server entry files are missing in this environment.",
  );
  process.exit(0);
}

try {
  // Use esbuild's programmatic API instead of spawning its CLI binary.
  // Spawning the binary directly is not portable: on some platforms
  // (e.g. Linux) esbuild's install step replaces bin/esbuild with the
  // native platform binary instead of a JS shim, and on others (Windows)
  // that same extensionless file can only be exec'd through `node`.
  // Importing the package lets esbuild's own internals resolve this
  // correctly, and avoids spawning a subprocess entirely.
  esbuild.buildSync({
    entryPoints: [serverIndex, serverVite],
    platform: "node",
    packages: "external",
    bundle: true,
    format: "esm",
    outdir: outDir,
  });

  // Backward-compatible entrypoint for environments still starting `node dist/index.js`.
  const compatEntry = path.resolve(distRoot, "index.js");
  writeFileSync(compatEntry, 'import "./server/index.js";\n', "utf8");
} catch (error) {
  console.error("[build:server] esbuild failed:", error);
  process.exit(1);
}
