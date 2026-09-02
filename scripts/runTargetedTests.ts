import { existsSync, readdirSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

const repoRoot = process.cwd();
const scriptsDir = path.join(repoRoot, "scripts");

const defaultScript = "scripts/testEventSpotBookingPaymentContract.ts";

function listScriptFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) continue;
    if (entry.isFile() && /\.(ts|mts|cts|js|mjs|cjs)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function normalizePattern(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\.test$/, "")
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-");
}

function normalizeScriptName(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-");
}

function hasWildcard(pattern: string): boolean {
  return pattern.includes("*");
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexSource = `^${escaped.replace(/\\\*/g, ".*")}$`;
  return new RegExp(regexSource, "i");
}

function buildAliases(file: string): string[] {
  const name = path.basename(file).toLowerCase();
  const withoutExt = name.replace(/\.(ts|mts|cts|js|mjs|cjs)$/i, "");
  const normalized = normalizeScriptName(withoutExt);
  const aliases = new Set<string>([normalized]);

  if (normalized.endsWith("-test")) {
    aliases.add(normalized.slice(0, -"-test".length));
  }
  if (normalized.endsWith("-contract-test")) {
    aliases.add(normalized.slice(0, -"-contract-test".length));
  }

  return Array.from(aliases).filter(Boolean);
}

function runScript(scriptPath: string): number {
  const rel = path.relative(repoRoot, scriptPath).replace(/\\/g, "/");
  console.log(`[test-runner] running ${rel}`);
  const result = spawnSync(process.execPath, ["--import", "tsx", rel], {
    stdio: "inherit",
    cwd: repoRoot,
    env: { ...process.env },
    shell: process.platform === "win32",
  });
  return result.status ?? 1;
}

function main() {
  const rawArgs = process.argv.slice(2).filter(Boolean);
  if (rawArgs.length === 0) {
    const full = path.join(repoRoot, defaultScript);
    if (!existsSync(full)) {
      console.error(`[test-runner] default test script missing: ${defaultScript}`);
      process.exit(1);
    }
    process.exit(runScript(full));
  }

  if (!existsSync(scriptsDir)) {
    console.error("[test-runner] scripts directory not found");
    process.exit(1);
  }

  const patterns = rawArgs.map(normalizePattern).filter(Boolean);
  const candidates = listScriptFiles(scriptsDir);
  const matched = candidates.filter((file) => {
    const aliases = buildAliases(file);
    const normalizedName = aliases[0];
    return patterns.some((pattern) => {
      if (hasWildcard(pattern)) {
        const regex = wildcardToRegex(pattern);
        return aliases.some((alias) => regex.test(alias));
      }
      return aliases.includes(pattern);
    });
  });

  if (matched.length === 0) {
    console.error(
      `[test-runner] no matching test scripts found for pattern(s): ${rawArgs.join(", ")}`,
    );
    console.error("[test-runner] this is now a hard failure to prevent false-positive passes.");
    process.exit(1);
  }

  let hasFailure = false;
  for (const file of matched) {
    const code = runScript(file);
    if (code !== 0) {
      hasFailure = true;
    }
  }

  process.exit(hasFailure ? 1 : 0);
}

main();
