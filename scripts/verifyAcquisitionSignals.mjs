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
fs.mkdirSync(output, { recursive: true });
const env = Object.fromEntries(['PATH','HOME','TMPDIR','LANG','TZ','CI'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { CI: 'true', NODE_ENV: 'development', NODE_OPTIONS: '--max-old-space-size=3072' });
const report = {
  candidate, base, startedAt: new Date().toISOString(), result: 'fail', steps: [], productionWrites: 0,
  inheritedEvidence: {
    deploy: 'dep-daoqhk60tbcc73ef7m5g', harness: '32251a653306cc596634b3eb4190088dfced207f', candidate,
    passed: ['exact initial source','unchanged discovery persistence and unrelated analytics routes','new request-signal/actual HTTP tests','actual service parsing','original-service negative control','full typecheck','changed-source lint','platform production build','existing discovery contract'],
    stoppedAt: 'Nonexistent test:critical-smoke script. No application assertion failed; final clean check had not run.'
  },
  scope: 'Remaining current public-discovery and action-policy contracts. Existing successful candidate execution is not relabeled as an overall passing prior run. No production database ingestion or audience claim.'
};
async function run(label, cmd, args, cwd = checkout) {
  console.log('MEAL_ACQUISITION_START ' + label);
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore','pipe','pipe'] });
  let out = '', err = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), 600000);
  child.stdout.on('data', chunk => { out += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { err += chunk; process.stderr.write(chunk); });
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }).finally(() => clearTimeout(timer));
  fs.writeFileSync(path.join(output, label + '.log'), out + err);
  const step = { label, exit, at: new Date().toISOString() }; report.steps.push(step); console.log('MEAL_ACQUISITION_STEP ' + JSON.stringify(step));
  assert.equal(exit, 0, label + ' failed'); return out.trim();
}
try {
  for (const key of Object.keys(process.env)) if (/DATABASE_URL|STRIPE.*(?:KEY|SECRET)|SESSION_SECRET|BREVO|SENDGRID|SMTP|RESEND|TWILIO|OPENAI_API_KEY/.test(key)) assert(!process.env[key], 'No inherited credentials: ' + key);
  await run('clone','git',['clone','--no-hardlinks','--no-checkout',outer,checkout],temp);
  await run('fetch','git',['fetch','--no-tags','https://github.com/infotradescout/MealScout.git',candidate]);
  await run('checkout','git',['checkout','--detach',candidate]);
  assert.equal(await run('identity','git',['rev-parse','HEAD']),candidate);
  assert.equal(await run('initial-clean','git',['status','--porcelain']),'');
  const packageJson = JSON.parse(fs.readFileSync(path.join(checkout,'package.json'),'utf8'));
  assert.equal(packageJson.scripts['test:critical-smoke'],undefined,'The documented prior failure must still be an absent command, not a hidden failed test');
  await run('npm-ci','npm',['ci','--include=dev','--no-audit','--no-fund']);
  for (const script of ['test:public-data-boundary','test:public-discovery-contract','test:public-restaurant-indexability','test:profile-action-policy']) {
    assert.equal(typeof packageJson.scripts[script],'string');
    await run(script.replaceAll(':','-'),'npm',['run',script]);
  }
  await run('tracked-clean','git',['diff','--exit-code','HEAD','--']);
  assert.equal(await run('final-clean','git',['status','--porcelain']),'');
  report.result='pass';
} catch(error) { report.error=String(error.stack||error); console.error('MEAL_ACQUISITION_FAILURE '+report.error); }
finally {
  report.finishedAt=new Date().toISOString(); fs.writeFileSync(path.join(output,'acquisition-remaining-evidence.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(output,'index.html'),'<meta name="robots" content="noindex,nofollow"><h1>MealScout acquisition remaining checks</h1><a href="acquisition-remaining-evidence.json">Execution receipt</a><p>Not search impressions, verified people or acquisition growth.</p>');
  fs.writeFileSync(path.join(output,'robots.txt'),'User-agent: *\nDisallow: /\n');
  console.log('MEAL_ACQUISITION_REMAINING_SUMMARY '+JSON.stringify(report)); fs.rmSync(temp,{recursive:true,force:true});
  if(report.result!=='pass')process.exitCode=1;
}
