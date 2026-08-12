import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const storage = read("server/storage.ts");
const envExample = read(".env.example");
const productionEnvExample = read(".env.production.example");

assert.match(
  storage,
  /process\.env\.ADMIN_PASSWORD_SYNC_ON_STARTUP/,
  "Existing admin password replacement must require an explicit startup flag",
);
assert.match(
  storage,
  /if \(syncExistingAdminPassword\)[\s\S]*passwordHash: newHash/,
  "Password hash replacement must remain inside the explicit sync guard",
);
assert.match(
  storage,
  /startup sync is disabled[\s\S]*intentional one-time rotation/,
  "A mismatch must be reported without silently changing the credential",
);
assert.match(envExample, /ADMIN_PASSWORD_SYNC_ON_STARTUP=false/);
assert.match(productionEnvExample, /ADMIN_PASSWORD_SYNC_ON_STARTUP=false/);

console.log("admin-password-startup-sync.contract: PASS");
