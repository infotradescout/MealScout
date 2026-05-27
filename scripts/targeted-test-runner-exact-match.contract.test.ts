import { spawnSync } from "node:child_process";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function runTarget(target: string) {
  const result = spawnSync("npm", ["run", "test", "--", target], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout || ""}\n${result.stderr || ""}`,
  };
}

function runningLines(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[test-runner] running scripts/"));
}

function includesRun(output: string, scriptName: string) {
  return runningLines(output).some((line) => line.includes(scriptName));
}

const contractResult = runTarget("owner-profile-completion-reconciliation");
assert(
  contractResult.status === 0,
  `contract target should pass, got status ${contractResult.status}`,
);
const contractRuns = runningLines(contractResult.output);
assert(contractRuns.length === 1, `contract target should run exactly one script`);
assert(
  includesRun(
    contractResult.output,
    "owner-profile-completion-reconciliation.contract.test.ts",
  ),
  "contract target should run contract test script",
);
assert(
  !includesRun(
    contractResult.output,
    "owner-profile-completion-reconciliation-runtime.test.ts",
  ),
  "contract target should not run runtime test script",
);

const runtimeResult = runTarget("owner-profile-completion-reconciliation-runtime");
assert(
  runtimeResult.status === 0,
  `runtime target should pass, got status ${runtimeResult.status}`,
);
const runtimeRuns = runningLines(runtimeResult.output);
assert(runtimeRuns.length === 1, `runtime target should run exactly one script`);
assert(
  includesRun(
    runtimeResult.output,
    "owner-profile-completion-reconciliation-runtime.test.ts",
  ),
  "runtime target should run runtime test script",
);
assert(
  !includesRun(
    runtimeResult.output,
    "owner-profile-completion-reconciliation.contract.test.ts",
  ),
  "runtime target should not run contract test script",
);

console.log("targeted-test-runner-exact-match.contract: PASS");
