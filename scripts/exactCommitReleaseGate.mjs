#!/usr/bin/env node
/**
 * Actions-free exact-commit release gate for MealScout.
 *
 * Proves a proposed tree at an exact git SHA with a clean install, typecheck,
 * relevant contracts, and build. GitHub Actions is not used and is not accepted
 * as release evidence.
 *
 * Usage:
 *   EXPECTED_SHA=<full-sha> GATE_PROFILE=pr-328 npm run gate:exact-commit
 *
 * Env:
 *   EXPECTED_SHA       If set, HEAD must equal this SHA (required for release evidence).
 *   GATE_PROFILE       default | pr-328 | core (default: default)
 *   GATE_REQUIRE_CLEAN If 1/true, refuse a clean worktree (no unstaged/untracked noise).
 *   GATE_SKIP_INSTALL  If 1/true, skip npm ci (not valid for independent hosted proof).
 *   GATE_HOST_LABEL    Optional label recorded in evidence (e.g. render-oneoff, cursor-cloud).
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const isWindows = process.platform === "win32";

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

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

function git(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    throw new Error(`git ${args.join(" ")} failed: ${err || `exit ${result.status}`}`);
  }
  return (result.stdout || "").trim();
}

function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const resolved = commandForPlatform(cmd, args);
    const startedAt = new Date().toISOString();
    const child = spawn(resolved.command, resolved.args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => {
      resolve({
        exitCode: code ?? 1,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    });
  });
}

function profileSteps(profile) {
  const install = {
    name: "Clean install (npm ci)",
    cmd: "npm",
    args: ["ci", "--include=dev"],
  };
  const check = { name: "Typecheck", cmd: "npm", args: ["run", "check"] };
  const doctor = { name: "Repo doctor", cmd: "npm", args: ["run", "doctor"] };
  const build = { name: "Build", cmd: "npm", args: ["run", "build"] };

  const pr328Contracts = [
    {
      name: "Action API public-read projection contract",
      cmd: "npm",
      args: ["run", "test:action-api-public-read-projection"],
    },
    {
      name: "Action API write containment contract",
      cmd: "npm",
      args: ["run", "test:action-api-containment"],
    },
    {
      name: "Action availability contract",
      cmd: "npm",
      args: ["run", "test:action-availability"],
    },
    {
      name: "Handoff spine contract",
      cmd: "node",
      args: ["scripts/mealscout-handoff-spine.contract.test.ts"],
      env: {},
      // Prefer tsx import path used elsewhere when .ts is invoked via node --import
      useTsxImport: true,
    },
  ];

  const coreContracts = [
    {
      name: "Action availability contract",
      cmd: "npm",
      args: ["run", "test:action-availability"],
    },
    {
      name: "Post-merge safety contract",
      cmd: "npm",
      args: ["run", "test:post-merge-safety"],
    },
    {
      name: "Public data boundary contract",
      cmd: "npm",
      args: ["run", "test:public-data-boundary"],
    },
    {
      name: "Consumer entity foundation contract",
      cmd: "npm",
      args: ["run", "test:consumer-entity-foundation"],
    },
  ];

  if (profile === "pr-328") {
    return [install, check, doctor, ...pr328Contracts, build];
  }
  if (profile === "core") {
    return [install, check, doctor, ...coreContracts, build];
  }
  // default: release step-1 gate — install, typecheck, doctor, core contracts, build
  return [install, check, doctor, ...coreContracts, build];
}

function normalizeStep(step) {
  if (!step.useTsxImport) {
    return step;
  }
  return {
    ...step,
    cmd: "node",
    args: ["--import", "tsx", "scripts/mealscout-handoff-spine.contract.test.ts"],
  };
}

async function main() {
  const profile = String(process.env.GATE_PROFILE || "default").trim().toLowerCase() || "default";
  const expectedSha = String(process.env.EXPECTED_SHA || "").trim().toLowerCase();
  const requireClean = isTruthy(process.env.GATE_REQUIRE_CLEAN);
  const skipInstall = isTruthy(process.env.GATE_SKIP_INSTALL);
  const hostLabel =
    String(process.env.GATE_HOST_LABEL || "").trim() ||
    `${os.hostname()}|${process.platform}|${os.arch()}`;

  const headSha = git(["rev-parse", "HEAD"]).toLowerCase();
  const shortSha = git(["rev-parse", "--short=12", "HEAD"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const statusPorcelain = git(["status", "--porcelain"]);
  const dirty = statusPorcelain.length > 0;

  const evidence = {
    schema: "mealscout.exact_commit_release_gate.v1",
    actionsFree: true,
    githubActionsAccepted: false,
    profile,
    recordedAt: new Date().toISOString(),
    hostLabel,
    git: {
      headSha,
      shortSha,
      branch,
      expectedSha: expectedSha || null,
      dirty,
      statusPorcelain: dirty ? statusPorcelain.split(/\r?\n/).filter(Boolean) : [],
    },
    steps: [],
    verdict: "PENDING",
  };

  console.log(`[exact-commit-gate] profile=${profile}`);
  console.log(`[exact-commit-gate] HEAD=${headSha} branch=${branch}`);
  console.log(`[exact-commit-gate] host=${hostLabel}`);
  console.log(`[exact-commit-gate] GitHub Actions is not used and is not release evidence.`);

  if (expectedSha && expectedSha !== headSha) {
    evidence.verdict = "FAIL";
    evidence.failure = `EXPECTED_SHA mismatch: expected ${expectedSha}, got ${headSha}`;
    writeEvidence(evidence);
    console.error(`\n[exact-commit-gate] FAILED: ${evidence.failure}`);
    process.exit(1);
  }

  if (!expectedSha) {
    console.warn(
      "[exact-commit-gate] WARNING: EXPECTED_SHA unset — result is not valid independent release evidence until re-run with EXPECTED_SHA pinned.",
    );
  }

  if (requireClean && dirty) {
    evidence.verdict = "FAIL";
    evidence.failure = "GATE_REQUIRE_CLEAN set but worktree is dirty";
    writeEvidence(evidence);
    console.error(`\n[exact-commit-gate] FAILED: ${evidence.failure}`);
    process.exit(1);
  }

  let steps = profileSteps(profile).map(normalizeStep);
  if (skipInstall) {
    console.warn("[exact-commit-gate] WARNING: GATE_SKIP_INSTALL set — not valid for hosted independent proof.");
    steps = steps.filter((step) => step.name !== "Clean install (npm ci)");
  }

  for (const step of steps) {
    console.log(`\n[exact-commit-gate] ${step.name}`);
    const result = await run(step.cmd, step.args, step.env || {});
    evidence.steps.push({
      name: step.name,
      command: [step.cmd, ...step.args].join(" "),
      exitCode: result.exitCode,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      ok: result.exitCode === 0,
    });
    if (result.exitCode !== 0) {
      evidence.verdict = "FAIL";
      evidence.failure = `${step.name} exited ${result.exitCode}`;
      writeEvidence(evidence);
      console.error(`\n[exact-commit-gate] FAILED: ${evidence.failure}`);
      process.exit(result.exitCode);
    }
  }

  const independentProof =
    Boolean(expectedSha) && expectedSha === headSha && !skipInstall && (!requireClean || !dirty);

  evidence.verdict = independentProof ? "PASS" : "PASS_LOCAL_UNPINNED";
  evidence.independentReleaseEvidence = independentProof;
  const outPath = writeEvidence(evidence);

  console.log(`\n[exact-commit-gate] ${evidence.verdict}`);
  console.log(`[exact-commit-gate] exact SHA: ${headSha}`);
  console.log(`[exact-commit-gate] evidence: ${outPath}`);
  if (!independentProof) {
    console.log(
      "[exact-commit-gate] Re-run with EXPECTED_SHA=<full-sha> (and without GATE_SKIP_INSTALL) for independent release evidence.",
    );
  }
}

function writeEvidence(evidence) {
  const dir = path.join(repoRoot, "artifacts", "exact-commit-gate");
  mkdirSync(dir, { recursive: true });
  const shaPart = (evidence.git?.headSha || "unknown").slice(0, 12);
  const profilePart = evidence.profile || "default";
  const outPath = path.join(dir, `${shaPart}-${profilePart}.json`);
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  // Stable latest pointer for operators / hosts that scrape one path.
  const latestPath = path.join(dir, `latest-${profilePart}.json`);
  writeFileSync(latestPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return outPath;
}

main().catch((err) => {
  console.error("[exact-commit-gate] Unhandled error:", err);
  process.exit(1);
});
