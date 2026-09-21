/** Existing hosted entry point. Native, compatibility and read-only production
 * modes have distinct receipts; a read-only observation is not a native gate. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, '.qa-evidence/host-route-native');
const receiptPath = path.join(out, 'receipt.json');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = data => createHash('sha256').update(data).digest('hex');
const digest = p => hash(fs.readFileSync(path.join(root, p)));
const source = git('rev-parse', 'HEAD');
assert.equal(source, process.env.RENDER_GIT_COMMIT);
assert.equal(process.env.MEALSCOUT_HOST_ROUTE_PROOF, '1');
assert.equal(git('status', '--porcelain'), '');
if (process.env.MEALSCOUT_PARKING_READONLY_PROBE === '1') {
  const { runParkingLiveReadonlyProbe } = await import('./parking-live-readonly-probe.mjs');
  await runParkingLiveReadonlyProbe();
} else if (process.env.MEALSCOUT_PARKING_COMPATIBILITY_PROOF === '1') {
  const { runCompatibilityCutoverProof } = await import('./parking-compatibility-cutover.mjs');
  await runCompatibilityCutoverProof();
} else {
await import('./parking-host-route-core.mjs');
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
receipt.routeResult = receipt.result;
for (const p of ['scripts/qa/parking-host-route-core.mjs', 'scripts/qa/parking-host-route-native.mjs', 'scripts/qa/parking-host-release-checks.mjs', 'scripts/qa/parking-host-native-tooling.mjs']) receipt.files[p] = digest(p);
fs.writeFileSync(path.join(out, 'route-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
try {
  assert.equal(receipt.source, source);
  assert.equal(receipt.result, 'pass');
  assert.equal(receipt.passed, 20);
  assert.equal(receipt.failed, 0);
  assert.equal(receipt.finalSourceClean, true);
  if (process.env.MEALSCOUT_HOST_ROUTE_RELEASE_CHECKS === '1') {
    const { prepareNativeExtensions } = await import('./parking-host-native-tooling.mjs');
    receipt.nativeTooling = prepareNativeExtensions({ root, out });
    const { runReleaseChecks } = await import('./parking-host-release-checks.mjs');
    receipt.releaseChecks = await runReleaseChecks({ root, out, source });
    if (!receipt.releaseChecks.passed) receipt.result = 'fail';
  } else {
    receipt.releaseChecks = { result: 'not_run', passed: false, reason: 'Explicit release-check mode was not requested' };
  }
} catch (error) {
  receipt.result = 'fail';
  receipt.releaseCheckFailure = String(error.stack || error);
} finally {
  receipt.finalSourceClean = git('rev-parse', 'HEAD') === source && git('status', '--porcelain') === '';
  if (!receipt.finalSourceClean) receipt.result = 'fail';
  receipt.productionChanged = false;
  receipt.liveProviderAcceptance = false;
  receipt.releaseFinishedAt = new Date().toISOString();
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  const summary = JSON.parse(JSON.stringify(receipt)); delete summary.tables;
  if (summary.releaseChecks?.migrations?.files) {
    const files = summary.releaseChecks.migrations.files;
    summary.releaseChecks.migrations.filesManifest = { count: Object.keys(files).length, sha256: hash(JSON.stringify(files)) };
    delete summary.releaseChecks.migrations.files;
  }
  for (const step of summary.releaseChecks?.steps || []) if (step.failureTail) step.failureTail = step.failureTail.slice(-2200);
  summary.rawReceiptSha256 = hash(fs.readFileSync(receiptPath));
  console.log('HOST_ROUTE_RELEASE_PROOF ' + JSON.stringify(summary));
  process.exitCode = receipt.result === 'pass' ? 0 : 1;
}
}
