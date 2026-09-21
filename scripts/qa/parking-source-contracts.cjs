/** Execute the existing Parking Pass feature/source contracts without changing
 * their assertions. These checks are additional evidence, not live flow tests.
 * Any failure is reported and fails this stage; no baseline failure is hidden.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const tsx = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs');
const files = [
  'parking-pass-google-api-capabilities.contract.test.ts',
  'mealscout-leaflet-removal.contract.test.ts',
  'parking-pass-weather.contract.test.ts',
  'parking-pass-gas-map-pins.contract.test.ts',
  'scout-parking-booking-bridge.contract.test.ts',
  'parking-pass-location-selection.contract.test.ts',
  'parking-pass-event-menu-handoff.contract.test.ts',
  'parking-pass-operational-map-ux.contract.test.ts',
  'parking-pass-gas-prices-per-spot.contract.test.ts',
  'mobileReadinessCheck.ts',
  'parking-pass-intelligence-layers.contract.test.ts',
  'parking-pass-foot-traffic-overlay.contract.test.ts',
  'parking-pass-foot-traffic-per-spot.contract.test.ts',
  'parking-pass-nearest-support-summary.contract.test.ts',
  'mealscout-public-booking-api-drift.contract.test.ts',
  'parking-pass-route-corridor.contract.test.ts',
  'parking-pass-listing-revenue.contract.test.ts',
  'booking-funnel-audit.contract.test.ts',
  'universal-profile-access.contract.test.ts',
  'owner-dashboard-type-aware-completion.contract.test.ts',
  'mealscout-parking-pass-decomposition-map.contract.test.ts',
  'mealscout-owner-dashboard-decomposition-map.contract.test.ts',
];
const env = { PATH: process.env.PATH || '', HOME: process.env.HOME || os.tmpdir(),
  TMPDIR: os.tmpdir(), NODE_ENV: 'test', CI: 'true' };
const results = [];
for (const file of files) {
  const relative = 'scripts/' + file;
  assert.ok(fs.readFileSync(path.join(root, relative), 'utf8').includes('client/src/pages/parking-pass-content.tsx'), `${relative}: preserve workspace coverage`);
  const result = spawnSync(process.execPath, [tsx, relative], {
    cwd: root, env, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const row = { file: relative, status: result.status === 0 ? 'pass' : 'fail',
    code: result.status, error: result.error?.message,
    ...(result.status === 0 ? {} : { output: output.slice(-4500) }) };
  results.push(row);
  console.log('QA PARKING CONTRACT ' + JSON.stringify(row));
}
const report = { scope: 'Existing source/feature contracts; no live bookings or payments',
  pass: results.filter(r => r.status === 'pass').length,
  fail: results.filter(r => r.status === 'fail').length, results };
if (process.env.QA_EVIDENCE_DIR) {
  fs.mkdirSync(process.env.QA_EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.QA_EVIDENCE_DIR, 'parking-source-contracts.json'), JSON.stringify(report, null, 2));
}
console.log('QA PARKING CONTRACT SUMMARY ' + JSON.stringify(report));
if (report.fail) process.exitCode = 1;
