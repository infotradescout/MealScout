import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const isWindows = process.platform === "win32";
const locator = isWindows ? "where.exe" : "which";

function findCommand(command) {
  const result = spawnSync(locator, [command], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });

  if (result.status !== 0) {
    return null;
  }

  const firstLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine ?? null;
}

function printStatus(ok, label, detail) {
  const marker = ok ? "[ok]" : "[missing]";
  console.log(`${marker} ${label}${detail ? `: ${detail}` : ""}`);
}

const requiredCommands = ["node", "npm", "git"];
const requiredFiles = [
  "package.json",
  "README.md",
  "client/vite.config.ts",
  "server/index.ts",
  "shared/schema.ts",
];

console.log("MealScout repo doctor");
console.log(`repoRoot: ${repoRoot}`);

let hasFailures = false;

for (const command of requiredCommands) {
  const resolved = findCommand(command);
  const ok = resolved !== null;
  printStatus(ok, `command ${command}`, resolved ?? "not found on PATH");
  hasFailures ||= !ok;
}

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(repoRoot, relativePath);
  const ok = existsSync(absolutePath);
  printStatus(ok, `file ${relativePath}`);
  hasFailures ||= !ok;
}

console.log("");
console.log("Suggested baseline checks");
console.log("- npm run check");
console.log("- npm run build:client");
console.log("- npm run build:server");

if (hasFailures) {
  console.error("");
  console.error("Repo doctor found blocking issues.");
  process.exit(1);
}

console.log("");
console.log("Repo doctor passed.");
