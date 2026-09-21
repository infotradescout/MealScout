/** Existing hosted entry point. The native route suite is retained byte-for-byte
 * in parking-host-route-core.mjs; release checks add evidence, never waive it. */
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
const digest = p => createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
const source = git('rev-parse', 'HEAD');
assert.equal(source, process.env.RENDER_GIT_COMMIT);
assert.equal(process.env.MEALSCOUT_HOST_ROUTE_PROOF, '1');
assert.equal(git('status', '--porcelain'), '');
await import('./parking-host-route-core.mjs');
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
receipt.routeResult = receipt.result;
for (const p of ['scripts/qa/parking-host-route-core.mjs', 'scripts/qa/parking-host-route-native.mjs', 'scripts/qa/parking-host-release-checks.mjs']) receipt.files[p] = digest(p);
fs.writeFileSync(path.join(out, 'route-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
try {
  assert.equal(receipt.source, source);
  assert.equal(receipt.result, 'pass');
  assert.equal(receipt.passed, 20);
  assert.equal(receipt.failed, 0);
  assert.equal(receipt.finalSourceClean, true);
  if (process.env.MEALSCOUT_HOST_ROUTE_RELEASE_CHECKS === '1') {
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
  console.log('HOST_ROUTE_RELEASE_PROOF ' + JSON.stringify(receipt));
  process.exitCode = receipt.result === 'pass' ? 0 : 1;
}
