import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const clientDist = path.resolve(repoRoot, "client", "dist");
const serverPublicDist = path.resolve(repoRoot, "dist", "public");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function syncClientBuildToServerPublic() {
  if (!fs.existsSync(clientDist)) {
    console.error(
      `[platformBuild] Missing client build output at ${clientDist}`,
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(serverPublicDist), { recursive: true });
  fs.rmSync(serverPublicDist, { recursive: true, force: true });
  fs.cpSync(clientDist, serverPublicDist, { recursive: true });
  console.log(
    `[platformBuild] Synced client build ${clientDist} -> ${serverPublicDist}`,
  );
}

console.log(`[platformBuild] repoRoot=${repoRoot}`);
run("npm", ["run", "build:client"]);
syncClientBuildToServerPublic();
run("npm", ["run", "build:server"]);
