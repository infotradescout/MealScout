import { spawnSync } from "node:child_process";

function runStep(name: string, cmd: string, args: string[]) {
  console.log(`\n[readiness] ${name}`);
  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", [cmd, ...args].join(" ")], {
          stdio: "inherit",
          shell: false,
          env: process.env,
        })
      : spawnSync(cmd, args, {
          stdio: "inherit",
          shell: false,
          env: process.env,
        });
  return result.status ?? 1;
}

function main() {
  const steps: Array<{ name: string; cmd: string; args: string[]; optional?: boolean }> = [
    { name: "typecheck", cmd: "npm", args: ["run", "-s", "check"] },
    {
      name: "listing revenue contract",
      cmd: "node",
      args: [
        "--import",
        "tsx",
        "scripts/parking-pass-listing-revenue.contract.test.ts",
      ],
    },
    {
      name: "public listing feed",
      cmd: "node",
      args: ["--import", "tsx", "scripts/smokeParkingPassPublicFeed.ts"],
    },
    { name: "datekeys", cmd: "npm", args: ["run", "-s", "test:parking-pass-datekeys"] },
    { name: "webhook audit", cmd: "npm", args: ["run", "-s", "audit:parking-pass-webhooks"] },
    { name: "demand funnel audit", cmd: "npm", args: ["run", "-s", "audit:demand-funnel"] },
    { name: "booking concurrency (optional)", cmd: "npm", args: ["run", "-s", "test:parking-pass-concurrency"], optional: true },
    { name: "webhook replay (optional)", cmd: "npm", args: ["run", "-s", "test:parking-pass-webhook-replay"], optional: true },
  ];

  let failed = false;
  for (const step of steps) {
    const code = runStep(step.name, step.cmd, step.args);
    if (code !== 0) {
      if (step.optional) {
        console.warn(`[readiness] optional step failed: ${step.name}`);
      } else {
        console.error(`[readiness] required step failed: ${step.name}`);
        failed = true;
        break;
      }
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log("\n[readiness] PASS");
}

main();
