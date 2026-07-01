import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function npmCliPath() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && existsSync(npmExecPath)) {
    return npmExecPath;
  }

  const fallback = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return existsSync(fallback) ? fallback : null;
}

function resolveCommand(command, args) {
  if (process.platform !== "win32") {
    return { command, args };
  }

  if (command === "npm") {
    const npmCli = npmCliPath();
    if (npmCli) {
      return { command: process.execPath, args: [npmCli, ...args] };
    }
  }

  if (command === "vite") {
    return {
      command: process.execPath,
      args: [path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"), ...args],
    };
  }

  return { command, args };
}

function run(command, args) {
  const resolved = resolveCommand(command, args);
  const result = spawnSync(resolved.command, resolved.args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`[platformBuild] repoRoot=${repoRoot}`);
run("vite", ["build"]);
run("npm", ["run", "build:server"]);
