import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const candidate = '4b19b7b02ac13deb039546ae56590a2c5f807405';
const base = '65e66d7a911b1b59af5612c11b0077672e28aa46';
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'meal-retained-taint-'));
const checkout = path.join(temp,'source'), tools = path.join(temp,'tools');
const output = path.join(root,'test-results/recovery-isolated-report');
const env = Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','PLAYWRIGHT_BROWSERS_PATH'].filter(key => process.env[key]).map(key => [key,process.env[key]]));
Object.assign(env,{CI:'true',TZ:'UTC',NODE_ENV:'development',NODE_OPTIONS:'--max-old-space-size=3072'});
const report = {candidate,base,harness:process.env.RENDER_GIT_COMMIT,startedAt:new Date().toISOString(),result:'fail',steps:[],productionWrites:0,scope:'Retained-history SQL admission and registered report HTTP behavior on isolated PostgreSQL-engine fixtures. No raw retention change, production login, lifetime-person or organic-growth proof.'};
function run(label,command,args,cwd=checkout,extra={},expected=0) {
  console.log('MEAL_RETAINED_START '+label);
  const result=spawnSync(command,args,{cwd,env:{...env,...extra},encoding:'utf8',timeout:900000,maxBuffer:96*1024*1024});
  const text=(result.stdout||'')+(result.stderr||'');
  report.steps.push({label,exit:result.status,expected,at:new Date().toISOString(),error:result.error?.message||null});
  console.log('MEAL_RETAINED_STEP '+JSON.stringify(report.steps.at(-1)));
  if(result.status!==expected)console.error(text.slice(-16000));
  assert.equal(result.status,expected,label);return text;
}
try {
  for(const key of ['DATABASE_URL','TEST_DATABASE_URL','STRIPE_SECRET_KEY','BREVO_API_KEY','SMTP_PASS','SESSION_SECRET'])assert(!process.env[key],'No production credentials: '+key);
  run('clone','git',['clone','--no-hardlinks','--no-checkout',root,checkout],temp);
  run('fetch','git',['fetch','--no-tags','https://github.com/infotradescout/MealScout.git',candidate]);
  run('checkout','git',['checkout','--detach',candidate]);
  assert.equal(run('identity','git',['rev-parse','HEAD']).trim(),candidate);
  assert.equal(run('initial-clean','git',['status','--porcelain']).trim(),'');
  assert.deepEqual(run('bounded-diff','git',['diff','--name-only',base,candidate]).trim().split('\n').sort(),['scripts/traffic-quality-dashboard.test.mjs','server/services/acquisitionQuality.ts']);
  run('npm-ci','npm',['ci','--include=dev','--no-audit','--no-fund']);
  fs.mkdirSync(tools);fs.writeFileSync(path.join(tools,'package.json'),'{"private":true,"type":"module"}');
  run('disposable-sql-tool','npm',['install','--no-audit','--no-fund','--save-exact','@electric-sql/pglite@0.5.4'],tools);
  const extra={MEAL_QUALITY_PGLITE_MODULE:pathToFileURL(createRequire(path.join(tools,'package.json')).resolve('@electric-sql/pglite')).href};
  const positive=run('report-http-and-retained-sql',process.execPath,['--import','tsx','--test','--test-reporter=tap','scripts/traffic-quality-dashboard.test.mjs'],checkout,extra);
  assert.match(positive,/^# pass 27\s*$/m);assert.match(positive,/^# fail 0\s*$/m);assert.match(positive,/^# skipped 0\s*$/m);
  const file=path.join(checkout,'server/services/acquisitionQuality.ts'),fixed=fs.readFileSync(file);
  const baseline=run('baseline-report','git',['show',base+':server/services/acquisitionQuality.ts']);
  try {
    fs.writeFileSync(file,baseline);
    const negative=run('baseline-negative-control',process.execPath,['--import','tsx','--test','--test-reporter=tap','--test-name-pattern=retained-taint admission','scripts/traffic-quality-dashboard.test.mjs'],checkout,extra,1);
    assert.match(negative,/retained-taint admission/);
    assert.match(negative,/ERR_ASSERTION/);
    report.negativeControl='Unmodified baseline rejects the expected exclusion assertions; positive candidate passes all 27 cases.';
  } finally {fs.writeFileSync(file,fixed);}
  run('restored-source','git',['diff','--exit-code','HEAD','--']);
  run('typecheck','npm',['run','check']);
  run('changed-lint',process.execPath,['node_modules/eslint/bin/eslint.js','server/services/acquisitionQuality.ts']);
  run('platform-build','npm',['run','build:platform']);
  for(const script of ['test:discovery-observatory','test:public-data-boundary','test:public-discovery-contract','test:public-restaurant-indexability','test:profile-action-policy'])run(script.replaceAll(':','-'),'npm',['run',script]);
  run('tracked-source-clean','git',['diff','--exit-code','HEAD','--']);
  assert.equal(run('final-clean','git',['status','--porcelain']).trim(),'');
  report.result='pass';
} catch(error) {report.error=String(error.stack||error);process.exitCode=1;}
finally {
  fs.rmSync(temp,{recursive:true,force:true});report.ownedCheckoutRemoved=!fs.existsSync(temp);
  report.finishedAt=new Date().toISOString();fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'retained-taint-evidence.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(output,'index.html'),'<meta name="robots" content="noindex,nofollow"><h1>Retained-journey exclusion verification</h1><a href="retained-taint-evidence.json">Exact result</a>');
  fs.writeFileSync(path.join(output,'robots.txt'),'User-agent: *\nDisallow: /\n');
  console.log('MEAL_RETAINED_SUMMARY '+JSON.stringify(report));
}
