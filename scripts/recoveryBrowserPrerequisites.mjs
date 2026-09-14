import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

assert.equal(process.env.MEALSCOUT_ISOLATED_RECOVERY_PROOF, "1");
assert.ok(!process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS, "Prerequisites must run without a validation override");
const tooling = process.argv[2];
assert.ok(tooling, "An owned tooling directory is required");
const require = createRequire(import.meta.url);
const core = dirname(require.resolve("playwright-core/package.json"));
const { registry } = require(join(core, "lib/server/registry/index.js"));
const report = { canonicalValidation: {}, actualGlesDlopen: false, adaptSystemCacheCheck: false };
for (const name of ["chromium", "chromium-headless-shell", "firefox", "webkit"]) {
  const executable = registry.findExecutable(name);
  assert.ok(executable?._validateHostRequirements, `Canonical prerequisite owner missing: ${name}`);
  try {
    // Run the real checker directly, including ldd on the complete browser set.
    // Do not reuse Playwright's previously cached validation marker.
    await executable._validateHostRequirements("javascript");
    report.canonicalValidation[name] = "pass";
  } catch (error) {
    if (name !== "webkit") throw error;
    const message = String(error.message || error);
    assert.match(message, /Missing libraries:/);
    const missing = message.split("\n")
      .map(line => line.replaceAll("║", "").trim())
      .filter(line => /^lib\S+$/.test(line));
    assert.deepEqual(missing, ["libGLESv2.so.2"], "Only the observed system-cache false positive may use actual loader proof");
    report.canonicalValidation.webkit = "all ldd checks pass; libGLESv2 absent from system cache";
    report.adaptSystemCacheCheck = true;
  }
}

// Playwright checks dlopen libraries using /sbin/ldconfig -p, which ignores our
// owned LD_LIBRARY_PATH. Check the actual loader and required GLES symbol instead.
const source = join(tooling, "gles-loader-proof.c");
const binary = join(tooling, "gles-loader-proof");
writeFileSync(source, `#include <dlfcn.h>
#include <stdio.h>
int main(void) {
  void *library = dlopen("libGLESv2.so.2", RTLD_NOW | RTLD_LOCAL);
  if (!library) { fprintf(stderr, "%s\\n", dlerror()); return 1; }
  if (!dlsym(library, "glGetString")) { fprintf(stderr, "%s\\n", dlerror()); return 2; }
  dlclose(library);
  puts("Actual GLES loader and glGetString symbol: PASS");
  return 0;
}
`);
execFileSync("gcc", [source, "-o", binary, "-ldl"], { stdio: "inherit" });
execFileSync(binary, [], { stdio: "inherit" });
report.actualGlesDlopen = true;
writeFileSync(join(tooling, "browser-prerequisites.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`RECOVERY_BROWSER_PREREQUISITES ${JSON.stringify(report)}`);
