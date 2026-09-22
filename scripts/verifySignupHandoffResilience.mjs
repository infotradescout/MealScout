import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const candidate='63e9b0d39f24ea97d39c123e63d9970b01a54e68';
const verifiedRuntime='a5980feb967c1470fd065fda97b6075b94253e10';
const base='161a161a4dd876630fee487ec0cd88f6aa418e5f';
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'meal-signup-resilience-')),checkout=path.join(temp,'source');
const output=path.join(root,'test-results/recovery-isolated-report');fs.mkdirSync(output,{recursive:true});
const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','PLAYWRIGHT_BROWSERS_PATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));Object.assign(env,{CI:'true',TZ:'UTC',NODE_ENV:'development',NODE_OPTIONS:'--max-old-space-size=3072'});
const report={candidate,verifiedRuntime,base,harness:process.env.RENDER_GIT_COMMIT,startedAt:new Date().toISOString(),result:'fail',steps:[],productionWrites:0,priorRuntimeGateDeploy:'dep-dapfbd7f3r2c73cici2g',scope:'Correct production-environment browser fixture; application runtime must match prior passing typecheck/lint/build/contracts exactly. Earlier overall failure remains a failure. No real account, email or host publication.'};
function run(label,command,args,cwd=checkout,extra={},expected=0){
 console.log('SIGNUP_HANDOFF_START '+label);
 const r=spawnSync(command,args,{cwd,env:{...env,...extra},encoding:'utf8',timeout:900000,maxBuffer:96*1024*1024});
 const text=(r.stdout||'')+(r.stderr||'');fs.writeFileSync(path.join(output,label+'.log'),text);
 report.steps.push({label,exit:r.status,expected,at:new Date().toISOString(),error:r.error?.message||null});console.log('SIGNUP_HANDOFF_STEP '+JSON.stringify(report.steps.at(-1)));
 if(r.status!==expected)console.error(text.slice(-18000));assert.equal(r.status,expected,label);return r.stdout||'';
}
try {
 for(const k of ['DATABASE_URL','TEST_DATABASE_URL','STRIPE_SECRET_KEY','SESSION_SECRET','BREVO_API_KEY','SENDGRID_API_KEY','SMTP_PASS'])assert(!process.env[k],'No production credentials: '+k);
 run('clone','git',['clone','--no-hardlinks','--no-checkout',root,checkout],temp);
 run('fetch','git',['fetch','--no-tags','https://github.com/infotradescout/MealScout.git',candidate]);
 run('checkout','git',['checkout','--detach',candidate]);assert.equal(run('identity','git',['rev-parse','HEAD']).trim(),candidate);
 assert.equal(run('initial-clean','git',['status','--porcelain']).trim(),'');
 assert.deepEqual(run('test-only-delta','git',['diff','--name-only',verifiedRuntime,candidate]).trim().split('\n'),['scripts/signup-handoff-resilience.browser.mjs']);
 const priorBrowser=run('previous-fixture','git',['show',verifiedRuntime+':scripts/signup-handoff-resilience.browser.mjs']);
 const expectedBrowser=priorBrowser.replace("define:{'process.env.NODE_ENV':'\"production\"'}", "define:{'process.env.NODE_ENV':'\"production\"','import.meta.env':JSON.stringify({DEV:false,PROD:true,MODE:'production',BASE_URL:'/'})}");
 assert.notEqual(expectedBrowser,priorBrowser);
 assert.equal(fs.readFileSync(path.join(checkout,'scripts/signup-handoff-resilience.browser.mjs'),'utf8'),expectedBrowser);
 run('npm-ci','npm',['ci','--include=dev','--no-audit','--no-fund']);
 run('preserved-authority','node',['--test','scripts/signup-handoff-resilience.contract.test.mjs']);
 run('browser-assets-build','npm',['run','build:platform']);
 run('chromium','node',['node_modules/playwright/cli.js','install','chromium']);
 const positive=run('actual-signup-browser','node',['scripts/signup-handoff-resilience.browser.mjs']);
 const line=positive.split('\n').find(l=>l.startsWith('SIGNUP_HANDOFF_BROWSER '));assert(line);
 report.browser=JSON.parse(line.slice('SIGNUP_HANDOFF_BROWSER '.length));assert.equal(report.browser.passed,true);assert.equal(report.browser.cases.length,32);
 for(const [name,file,suite,expectedMessage] of [
  ['old-cleanup-negative','client/src/pages/customer-signup.tsx','storage','successful signup must reach verification despite blocked storage'],
  ['old-guest-redirect-negative','client/src/pages/host-signup.tsx','auth','pending auth must not redirect the host to signup'],
 ]) {
  const full=path.join(checkout,file),fixed=fs.readFileSync(full);
  try {
   fs.writeFileSync(full,run(name+'-source','git',['show',base+':'+file]));
   const result=run(name,'node',['scripts/signup-handoff-resilience.browser.mjs'],checkout,{MEAL_HANDOFF_SUITE:suite},1);
   assert(result.includes(expectedMessage),'Original source must fail the intended assertion');
  } finally {fs.writeFileSync(full,fixed);}
 }
 run('restored-source','git',['diff','--exit-code','HEAD','--']);assert.equal(run('final-clean','git',['status','--porcelain']).trim(),'');report.result='pass';
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally {
 fs.rmSync(temp,{recursive:true,force:true});report.ownedCheckoutRemoved=!fs.existsSync(temp);report.finishedAt=new Date().toISOString();
 fs.writeFileSync(path.join(output,'signup-handoff-evidence.json'),JSON.stringify(report,null,2));
 fs.writeFileSync(path.join(output,'index.html'),'<meta name="robots" content="noindex,nofollow"><h1>Signup handoff verification</h1><a href="signup-handoff-evidence.json">Executed result</a>');fs.writeFileSync(path.join(output,'robots.txt'),'User-agent: *\nDisallow: /\n');
 console.log('SIGNUP_HANDOFF_SUMMARY '+JSON.stringify(report));
}
