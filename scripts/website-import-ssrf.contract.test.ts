import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isBlockedIp } from "../server/utils/websiteProfileImport.ts";

for (const address of [
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "192.168.1.10",
  "::1",
  "fc00::1",
]) {
  assert.equal(isBlockedIp(address), true, `${address} must be blocked`);
}
assert.equal(isBlockedIp("1.1.1.1"), false);

const source = readFileSync("server/utils/websiteProfileImport.ts", "utf8");
for (const required of [
  "const records = await resolvePublicHostname(parsed.hostname)",
  "hostname: address",
  "servername: parsed.protocol === \"https:\" ? parsed.hostname : undefined",
  "Host: parsed.host",
  "redirects === MAX_REDIRECTS",
  "byteLength > MAX_RESPONSE_BYTES",
]) {
  assert(source.includes(required), `Missing pinned-fetch guard: ${required}`);
}
assert(
  !source.includes("fetch(parsed.toString()"),
  "Website import must connect to a validated IP rather than resolving the hostname a second time inside fetch().",
);

console.log("website import SSRF contract passed");
