/** A bounded QA executor for this explicitly authorized PR preview only.
 * Never boots a production server, reads a DB URL, or forwards provider secrets.
 * Outside this exact branch + preview combination it is a no-op.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const branch = 'codex/ui-ux-front-end-overhaul-20260915';
if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== branch) {
  console.log('QA preview executor skipped: not the authorized preview branch.');
  process.exit(0);
}
const root = path.resolve(__dirname, '../..');
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'mealscout-qa-'));
const env = { PATH: process.env.PATH || '', HOME: process.env.HOME || os.tmpdir(),
  TMPDIR: os.tmpdir(), CI: 'true', QA_EVIDENCE_DIR: evidence,
  PLAYWRIGHT_BROWSERS_PATH: path.join(os.tmpdir(), 'mealscout-qa-browsers'),
  NODE_ENV: 'test' };
const stages = [];
function execute(name, args, timeout = 120000) {
  console.log(`QA START ${name}`);
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd: root, env, timeout, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  fs.writeFileSync(path.join(evidence, `${name}.log`), output);
  const stage = { name, status: result.status === 0 ? 'pass' : 'fail', code: result.status,
    error: result.error?.message, elapsedMs: Date.now() - started };
  stages.push(stage);
  console.log(output.slice(-18000));
  console.log('QA STAGE ' + JSON.stringify(stage));
  return stage.status === 'pass';
}
execute('fixture-safety', ['scripts/qa/test-world.test.cjs']);
execute('refinement', ['scripts/mealscout-ui-refinement.test.cjs']);
execute('checkout-state', ['scripts/mealscout-checkout-state.test.cjs']);
execute('order-status-state', ['scripts/mealscout-order-status-state.test.cjs']);
execute('owner-kitchen-state', ['scripts/mealscout-owner-orders-state.test.cjs']);
execute('full-typecheck', [require.resolve('typescript/bin/tsc'), '--noEmit'], 180000);
execute('database-menu-actors', [path.join(path.dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs'), 'scripts/menu-creation-lisa.integration.test.ts'], 120000);
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
if (execute('install-chromium', [cli, 'install', '--only-shell', 'chromium'], 180000)) {
  execute('full-frontend-journeys', ['scripts/qa/full-frontend-journeys.cjs'], 300000);
  execute('checkout-browser', ['scripts/mealscout-checkout-browser.test.cjs'], 120000);
  execute('parking-payment-browser', ['scripts/mealscout-parking-payment.browser.test.cjs'], 120000);
}
console.log('QA EXECUTION SUMMARY ' + JSON.stringify({ sha: process.env.VERCEL_GIT_COMMIT_SHA, stages,
  isolation: 'fresh synthetic records; no DB/provider credentials forwarded; all browser APIs intercepted; external requests blocked' }));
if (stages.some((stage) => stage.status === 'fail')) process.exitCode = 1;
