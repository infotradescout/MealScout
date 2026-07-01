import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const isWindows = process.platform === "win32";

function npmCliPath() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && existsSync(npmExecPath)) {
    return npmExecPath;
  }

  const fallback = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return existsSync(fallback) ? fallback : null;
}

function commandForPlatform(cmd, args) {
  if (!isWindows) {
    return { command: cmd, args };
  }

  if (cmd === "npm") {
    const npmCli = npmCliPath();
    if (npmCli) {
      return { command: process.execPath, args: [npmCli, ...args] };
    }
  }

  return { command: cmd, args };
}

function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const resolved = commandForPlatform(cmd, args);
    const child = spawn(resolved.command, resolved.args, {
      stdio: "inherit",
      shell: false,
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const steps = [
    { name: "Typecheck", cmd: "npm", args: ["run", "check"] },
    { name: "Mobile readiness", cmd: "npm", args: ["run", "check:mobile-readiness"] },
    {
      name: "Store readiness (strict metadata)",
      cmd: "npm",
      args: ["run", "check:store-readiness"],
      env: { STRICT_STORE_METADATA: "true" },
    },
    {
      name: "Native web asset build and sync",
      cmd: "npm",
      args: ["run", "cap:prepare"],
    },
    {
      name: "Mobile deep-link smoke (with server)",
      cmd: "npm",
      args: ["run", "smoke:mobile-deeplinks:with-server"],
    },
  ];

  for (const step of steps) {
    console.log(`\n[release-readiness] ${step.name}`);
    const code = await run(step.cmd, step.args, step.env);
    if (code !== 0) {
      console.error(`\n[release-readiness] FAILED: ${step.name} (exit ${code})`);
      process.exit(code);
    }
  }

  console.log("\n[release-readiness] All checks passed.");
}

main().catch((err) => {
  console.error("[release-readiness] Unhandled error:", err);
  process.exit(1);
});
