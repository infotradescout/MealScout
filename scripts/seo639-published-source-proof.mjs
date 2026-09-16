/** Isolated cross-repository source verification only. Never merge this proof branch. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const candidate = 'e97db4c3901f41ce7f2457cf06494eff63dd6db2';
const baseline = 'a80272ee8642e9ce4793a592bd265cf6475bf2d0';
const files = [
  ['server/routes/profiles.ts', '178b004e2bdc1316cf7d45295c7b5f5cc50239c5'],
  ['server/publicExchangeListingHtml.ts', '85f34d52eb8cbcab71a105525ca6430fb41551eb'],
  ['shared/exchangeListingRules.ts', '75560052c2a5044431435eae76f54c3eb3e071fd'],
  ['scripts/tests/exchange-sitemap-canonical.test.cjs', '9239a9606fbd138354453b1745ca627964b510e9'],
];
const proof = { candidate, baseline, startedAt: new Date().toISOString(), launcher: process.env.VERCEL_GIT_COMMIT_SHA || null, node: process.version, completeFileBlobs: [], passed: false, scope: 'actual AST-extracted callback and canonical declarations; DB/exposure/HTTP/XML/module-loader fixtures', fullApplicationRun: false, productionChanged: false, mealScoutEdgeVerified: false };
const root = mkdtempSync(path.join(tmpdir(), 'seo639-published-'));
async function getFile(ref, filename, expectedBlob) {
  const response = await fetch(`https://raw.githubusercontent.com/infotradescout/tradescoutAI/${ref}/${filename}`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, filename);
  const buffer = Buffer.from(await response.arrayBuffer());
  assert.ok(buffer.length < 1048576, 'Bound source file size');
  const hash = createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
  assert.equal(hash, expectedBlob, `Exact Git blob: ${filename}`);
  return buffer;
}
function runTest(label) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'scripts/tests/exchange-sitemap-canonical.test.cjs'], { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, EXCHANGE_CANONICAL_SOURCE_ROOT: root } });
  assert.equal(result.error, undefined, result.error?.message);
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  console.log(`SEO639_${label}_BEGIN`);
  for (const line of output.split('\n')) console.log(line);
  console.log(`SEO639_${label}_END`);
  return { exitCode: result.status, tests: Number(output.match(/# tests (\d+)/)?.[1]), pass: Number(output.match(/# pass (\d+)/)?.[1]), fail: Number(output.match(/# fail (\d+)/)?.[1]), skipped: Number(output.match(/# skipped (\d+)/)?.[1]) };
}
try {
  await Promise.all(files.map(async ([filename, expected]) => {
    const bytes = await getFile(candidate, filename, expected);
    const destination = path.join(root, filename);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
    proof.completeFileBlobs.push({ filename, gitBlob: expected, bytes: bytes.length });
  }));
  writeFileSync(path.join(root, 'package.json'), '{"name":"seo639-isolated-source-proof","private":true}\n');
  const install = spawnSync('npm', ['install', '--prefix', root, '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', '--save-exact', 'typescript@5.8.3'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(install.error, undefined, install.error?.message);
  assert.equal(install.status, 0, 'Isolated exact-version TypeScript install');
  proof.typescript = createRequire(path.join(root, 'package.json'))('typescript').version;
  assert.equal(proof.typescript, '5.8.3');
  proof.candidateResult = runTest('CANDIDATE');
  assert.deepEqual(proof.candidateResult, { exitCode: 0, tests: 7, pass: 7, fail: 0, skipped: 0 });
  const oldFile = await getFile(baseline, 'server/routes/profiles.ts', '3bae8b2d5bcfe404c328ca499f8c76fa0272a2e8');
  writeFileSync(path.join(root, 'server/routes/profiles.ts'), oldFile);
  proof.baselineResult = runTest('BASELINE');
  assert.deepEqual(proof.baselineResult, { exitCode: 1, tests: 7, pass: 4, fail: 3, skipped: 0 });
  proof.passed = true;
} catch (error) {
  proof.error = String(error?.message || error).slice(0, 1400);
} finally {
  rmSync(root, { recursive: true, force: true });
  proof.finishedAt = new Date().toISOString();
  mkdirSync('proof-output', { recursive: true });
  writeFileSync('proof-output/evidence.json', JSON.stringify(proof, null, 2));
  writeFileSync('proof-output/index.html', '<!doctype html><meta name="robots" content="noindex,nofollow"><title>Isolated source verification</title><p>TradeScout focused source verification only. No production, full-application, Google-indexing or MealScout edge acceptance.</p>');
  console.log('SEO639_PUBLISHED_SOURCE_RESULT=' + JSON.stringify(proof));
  if (!proof.passed) process.exitCode = 1;
}
