import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const candidate = 'b0aa4bc90afb31adba6a8928cfcfb20910af763a';
const base = '8a852919fed69fc9ab743d19d2f1de3a3b1ee36d';
const outer = process.cwd();
const output = path.resolve('test-results/recovery-isolated-report');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mealscout-acquisition-'));
const checkout = path.join(temp, 'candidate');
const baseline = path.join(temp, 'baseline');
fs.mkdirSync(output, { recursive: true });
const env = Object.fromEntries(['PATH','HOME','TMPDIR','LANG','TZ','CI'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { CI: 'true', NODE_ENV: 'development', NODE_OPTIONS: '--max-old-space-size=3072' });
const report = { candidate, base, startedAt: new Date().toISOString(), result: 'fail', steps: [], productionWrites: 0, scope: 'Server source labels and quality-record construction; actual loopback Express requests with an injected record sink, not production database ingestion, unique people, or organic growth.' };
async function run(label, cmd, args, cwd = checkout, expected = 0) {
  console.log('MEAL_ACQUISITION_START ' + label);
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore','pipe','pipe'] });
  let out = '', err = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), 600000);
  child.stdout.on('data', chunk => { out += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { err += chunk; process.stderr.write(chunk); });
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
  fs.writeFileSync(path.join(output, label + '.log'), out + err);
  const step = { label, exit, expected, at: new Date().toISOString() }; report.steps.push(step); console.log('MEAL_ACQUISITION_STEP ' + JSON.stringify(step));
  assert.equal(exit, expected, label + ' failed'); return out.trim();
}
const sourceControl = `import assert from 'node:assert/strict';
const m = await import('./server/services/discoveryObservatory.ts');
const cases = [
  [{query:{utm_source:'google'},get:()=>''},'google'],
  [{query:{},get:()=> 'https://www.google.com.attacker.invalid/'},'unknown'],
  [{query:{},get:()=> 'https://attacker.invalid/?u=https://chatgpt.com/'},'unknown'],
  [{query:{},get:()=> 'https://maps.google.com/'},'google_maps']
];
const results = cases.map(([request, expected])=>({expected,actual:m.deriveDiscoverySource(request)}));
console.log('MEAL_SOURCE_CASES '+JSON.stringify(results));
assert(results.every(row=>row.actual===row.expected),'Referrer/alias behavior is incorrect');`;
try {
  for (const key of Object.keys(process.env)) if (/DATABASE_URL|STRIPE.*(?:KEY|SECRET)|SESSION_SECRET|BREVO|SENDGRID|SMTP|RESEND|TWILIO|OPENAI_API_KEY/.test(key)) assert(!process.env[key], 'No inherited credentials: ' + key);
  await run('clone','git',['clone','--no-hardlinks','--no-checkout',outer,checkout],temp);
  await run('fetch','git',['fetch','--no-tags','https://github.com/infotradescout/MealScout.git',candidate]);
  await run('checkout','git',['checkout','--detach',candidate]);
  assert.equal(await run('identity','git',['rev-parse','HEAD']),candidate);
  assert.equal(await run('initial-clean','git',['status','--porcelain']),'');
  const changed = (await run('bounded-files','git',['diff','--name-only',base,candidate])).split('\n').sort();
  assert.deepEqual(changed,['scripts/discovery-request-signals.test.ts','server/routes/analyticsRoutes.ts','server/routes/publicProfileQualityRoute.ts','server/services/discoveryObservatory.ts','server/services/discoveryRequestSignals.ts']);
  const beforeService = await run('base-discovery','git',['show',base+':server/services/discoveryObservatory.ts']);
  const afterService = fs.readFileSync(path.join(checkout,'server/services/discoveryObservatory.ts'),'utf8').trim();
  const marker = 'function deterministicObservatoryId';
  assert.equal(afterService.slice(afterService.indexOf(marker)),beforeService.slice(beforeService.indexOf(marker)), 'Persistence, experiments, outcomes and legacy adapter must be byte-identical');
  const beforeRoutes = await run('base-routes','git',['show',base+':server/routes/analyticsRoutes.ts']);
  const afterRoutes = fs.readFileSync(path.join(checkout,'server/routes/analyticsRoutes.ts'),'utf8').trim();
  const routeMarker = '  app.get("/api/search/trending"';
  assert.equal(afterRoutes.slice(afterRoutes.indexOf(routeMarker)),beforeRoutes.slice(beforeRoutes.indexOf(routeMarker)), 'Other routes must be byte-identical');
  assert.match(afterRoutes,/registerPublicProfileQualityRoute\(app, async \(record\) => \{\s*await db\.insert\(requestLogs\)\.values\(record\);/);
  await run('npm-ci','npm',['ci','--include=dev','--no-audit','--no-fund']);
  await run('request-signal-tests',process.execPath,['--import','tsx','--test','scripts/discovery-request-signals.test.ts']);
  await run('actual-service-source',process.execPath,['--import','tsx','--input-type=module','-e',sourceControl]);
  await run('baseline-clone','git',['clone','--no-hardlinks','--no-checkout',checkout,baseline],temp);
  await run('baseline-checkout','git',['checkout','--detach',base],baseline);
  fs.symlinkSync(path.join(checkout,'node_modules'),path.join(baseline,'node_modules'),'dir');
  await run('original-source-negative',process.execPath,['--import','tsx','--input-type=module','-e',sourceControl],baseline,1);
  await run('typecheck','npm',['run','check']);
  await run('changed-source-lint',process.execPath,['node_modules/eslint/bin/eslint.js',...changed]);
  await run('platform-build','npm',['run','build:platform']);
  await run('existing-discovery-contract','npm',['run','test:discovery-observatory']);
  await run('critical-smoke','npm',['run','test:critical-smoke']);
  await run('tracked-clean','git',['diff','--exit-code','HEAD','--']);
  assert.equal(await run('final-clean','git',['status','--porcelain']),'');
  report.result='pass';
} catch(error) { report.error=String(error.stack||error); console.error('MEAL_ACQUISITION_FAILURE '+report.error); }
finally {
  report.finishedAt=new Date().toISOString(); fs.writeFileSync(path.join(output,'acquisition-evidence.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(output,'index.html'),'<meta name="robots" content="noindex,nofollow"><h1>MealScout acquisition signal checks</h1><a href="acquisition-evidence.json">Execution receipt</a><p>Not search impressions, verified people or acquisition growth.</p>');
  fs.writeFileSync(path.join(output,'robots.txt'),'User-agent: *\nDisallow: /\n');
  console.log('MEAL_ACQUISITION_SUMMARY '+JSON.stringify(report)); fs.rmSync(temp,{recursive:true,force:true});
  if(report.result!=='pass')process.exitCode=1;
}
