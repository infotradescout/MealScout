import { spawn } from "node:child_process";

function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
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
