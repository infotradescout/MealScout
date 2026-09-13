import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

type PackageRecord = {
  version?: string;
};

type Lockfile = {
  lockfileVersion?: number;
  packages?: Record<string, PackageRecord>;
};

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const lockfile = JSON.parse(
  readFileSync("package-lock.json", "utf8"),
) as Lockfile;

const alternateLockfiles = [
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

function versionTuple(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  assert.ok(match, `Expected a semantic version, received ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function versionAtLeast(version: string, minimum: string): boolean {
  const actual = versionTuple(version);
  const floor = versionTuple(minimum);

  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== floor[index]) {
      return actual[index] > floor[index];
    }
  }

  return true;
}

test("npm is the repository's only package manager", () => {
  assert.match(packageJson.packageManager, /^npm@10\./);
  assert.ok(existsSync("package-lock.json"), "package-lock.json must exist");
  assert.equal(lockfile.lockfileVersion, 3);

  for (const lockfileName of alternateLockfiles) {
    assert.equal(
      existsSync(lockfileName),
      false,
      `${lockfileName} must not compete with package-lock.json`,
    );
  }
});

test("security-sensitive transitive dependencies remain patched", () => {
  assert.equal(packageJson.overrides?.browserslist, "4.28.7");
  assert.equal(packageJson.overrides?.["postcss-selector-parser"], "6.1.4");

  const packages = lockfile.packages ?? {};
  const browserslist = packages["node_modules/browserslist"]?.version;
  assert.ok(browserslist, "browserslist must be present in package-lock.json");
  assert.ok(versionAtLeast(browserslist, "4.28.7"));

  const selectorParserEntries = Object.entries(packages).filter(([path]) =>
    path.endsWith("node_modules/postcss-selector-parser"),
  );
  assert.ok(selectorParserEntries.length > 0);

  for (const [path, metadata] of selectorParserEntries) {
    assert.ok(metadata.version, `${path} must have a locked version`);
    assert.ok(
      versionAtLeast(metadata.version, "6.1.3"),
      `${path} is locked to vulnerable ${metadata.version}`,
    );
  }
});

test("package scripts use the installed TypeScript loader without npx", () => {
  for (const [name, command] of Object.entries<string>(packageJson.scripts ?? {})) {
    assert.doesNotMatch(command, /(^|\s)npx(?:\s|$)/, `${name} must not invoke npx`);
    assert.doesNotMatch(
      command,
      /(^|&&\s*|;\s*)tsx\s/,
      `${name} must use node --import tsx`,
    );
  }

  const targetedRunner = readFileSync("scripts/runTargetedTests.ts", "utf8");
  assert.doesNotMatch(targetedRunner, /spawnSync\(["']npx["']/);
});
