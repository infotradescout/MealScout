import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const root=process.cwd(),mode=String(process.env.MEAL_HOST_INTAKE_MODE||'');
assert(['validate','observe'].includes(mode));
const candidate=String(process.env.MEAL_HOST_INTAKE_SHA||'');assert.match(candidate,/^[a-f0-9]{40}$/);
const base='aa3562bddef14b35bee5a67a3bae0ec8d5c3e212';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'meal-host-intake-')),checkout=path.join(temp,'source');
const out=path.join(root,'test-results/recovery-isolated-report');fs.mkdirSync(out,{recursive:true});
const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','PLAYWRIGHT_BROWSERS_PATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{CI:'true',TZ:'UTC',NODE_ENV:'development',NODE_OPTIONS:'--max-old-space-size=3072'});
const report={mode,candidate,base,harness:process.env.RENDER_GIT_COMMIT,startedAt:new Date().toISOString(),result:'fail',steps:[],live:[],productionWrites:0,analyticsSubmissions:0};
function run(label,command,args,cwd=checkout,extra={},expected=0){
 console.log('HOST_INTAKE_START '+label);const r=spawnSync(command,args,{cwd,env:{...env,...extra},encoding:'utf8',timeout:900000,maxBuffer:64*1024*1024});
 const text=(r.stdout||'')+(r.stderr||'');fs.writeFileSync(path.join(out,label+'.log'),text);
 report.steps.push({label,exit:r.status,expected,at:new Date().toISOString(),error:r.error?.message||null});
 console.log('HOST_INTAKE_STEP '+JSON.stringify(report.steps.at(-1)));
 if(r.status!==expected)console.error(text.slice(-20000));assert.equal(r.status,expected,label);return text;
}
let browser;
try{
 for(const k of ['DATABASE_URL','TEST_DATABASE_URL','STRIPE_SECRET_KEY','SESSION_SECRET','BREVO_API_KEY','SENDGRID_API_KEY','SMTP_PASS'])assert(!process.env[k],'No inherited production credentials: '+k);
 run('clone','git',['clone','--no-hardlinks','--no-checkout',root,checkout],temp);
 run('fetch','git',['fetch','--no-tags','https://github.com/infotradescout/MealScout.git',candidate]);
 run('checkout','git',['checkout','--detach',candidate]);assert.equal(run('identity','git',['rev-parse','HEAD']).trim(),candidate);
 assert.equal(run('initial-clean','git',['status','--porcelain']).trim(),'');
 run('npm-ci','npm',['ci','--include=dev','--no-audit','--no-fund']);
 if(mode==='validate'){
  assert.deepEqual(run('bounded-diff','git',['diff','--name-only',base,candidate]).trim().split('\n').sort(),[
   'client/src/lib/hostPartnerSubmission.ts','client/src/pages/host-location-partner.tsx','scripts/acquisition-edge-routing.contract.test.mjs','scripts/host-partner-confirmation.browser.mjs','scripts/host-partner-confirmation.contract.test.mjs','server/services/hostPartnerLeadMagnet.ts'
  ]);
  const result=run('receipt-and-service',process.execPath,['--import','tsx','--test','--test-reporter=tap','scripts/host-partner-confirmation.contract.test.mjs']);
  assert.match(result,/^# fail 0\s*$/m);assert.match(result,/^# skipped 0\s*$/m);report.focusedPasses=Number(/^# pass (\d+)\s*$/m.exec(result)?.[1]);assert(report.focusedPasses>=24);
  const service=path.join(checkout,'server/services/hostPartnerLeadMagnet.ts'),fixed=fs.readFileSync(service);
  try{
   fs.writeFileSync(service,run('baseline-service','git',['show',base+':server/services/hostPartnerLeadMagnet.ts']));
   const negative=run('saved-email-failure-negative',process.execPath,['--import','tsx','--test','--test-name-pattern=saved request survives email failure','scripts/host-partner-confirmation.contract.test.mjs'],checkout,{},1);
   assert.match(negative,/PRIVATE_PROVIDER_DETAIL/);
  }finally{fs.writeFileSync(service,fixed);}
  run('restored-service','git',['diff','--exit-code','HEAD','--']);
  run('typecheck','npm',['run','check']);
  run('changed-lint',process.execPath,['node_modules/eslint/bin/eslint.js','client/src/lib/hostPartnerSubmission.ts','client/src/pages/host-location-partner.tsx','server/services/hostPartnerLeadMagnet.ts']);
  run('platform-build','npm',['run','build:platform']);
  run('registered-acquisition-contract',process.execPath,['--test','scripts/acquisition-edge-routing.contract.test.mjs']);
  for(const script of ['test:public-data-boundary','test:public-discovery-contract','test:public-restaurant-indexability','test:profile-action-policy'])run(script.replaceAll(':','-'),'npm',['run',script]);
  run('chromium',process.execPath,['node_modules/playwright/cli.js','install','chromium']);
  const browserOutput=run('actual-host-form-browser',process.execPath,['scripts/host-partner-confirmation.browser.mjs'],checkout,{HOST_INTAKE_BROWSER_OUTPUT:out});
  const parsed=JSON.parse(browserOutput.split('\n').find(s=>s.startsWith('HOST_INTAKE_BROWSER ')).slice('HOST_INTAKE_BROWSER '.length));
  assert.equal(parsed.passed,true);assert.equal(parsed.cases.length,30);report.browser=parsed;
  const page=path.join(checkout,'client/src/pages/host-location-partner.tsx'),fixedPage=fs.readFileSync(page);
  try{
   fs.writeFileSync(page,run('baseline-page','git',['show',base+':client/src/pages/host-location-partner.tsx']));
   const negative=run('malformed-success-negative',process.execPath,['scripts/host-partner-confirmation.browser.mjs'],checkout,{HOST_INTAKE_BROWSER_BASELINE:'1'},1);
   assert.match(negative,/Malformed or failed response must not produce a receipt/);
  }finally{fs.writeFileSync(page,fixedPage);}
  report.negativeControls=['Original service loses saved receipt on mail error','Original page claims success for HTML response'];
 }else{
  const origin='https://www.mealscout.us';
  async function version(){const r=await fetch(origin+'/api/version',{headers:{'user-agent':'mealscout-runtime-proof/host-intake-readonly','x-mealscout-qa':'1'},redirect:'error',signal:AbortSignal.timeout(20000)});const data=await r.json();assert.equal(r.status,200);assert.equal(data.version?.commit,candidate);return {status:r.status,commit:data.version.commit};}
  report.versionBefore=await version();run('chromium',process.execPath,['node_modules/playwright/cli.js','install','chromium']);
  const {chromium}=createRequire(path.join(checkout,'package.json'))('playwright');browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const scenario of ['html','email-unconfirmed','email-confirmed']){
   const context=await browser.newContext({viewport:{width:390,height:950},serviceWorkers:'block',extraHTTPHeaders:{'x-mealscout-qa':'1'}});const page=await context.newPage();page.setDefaultTimeout(15000);let intercepted=0,blockedWrites=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(req.method()!=='GET'&&req.method()!=='HEAD'){
    if(url.origin===origin&&url.pathname==='/api/public/host-partner-leads'){intercepted++;return route.fulfill({status:200,contentType:scenario==='html'?'text/html':'application/json',body:scenario==='html'?'<html>isolated invalid receipt</html>':JSON.stringify({ok:true,leadId:'local-intercepted-fixture',emailed:scenario==='email-confirmed'})});}
    blockedWrites++;return route.abort();}if(url.origin!==origin)return route.abort();return route.continue();});
   try{const response=await page.goto(origin+'/host-location-partner',{waitUntil:'domcontentloaded',timeout:30000});assert.equal(response.status(),200);await page.locator('#email').fill('fixture@example.invalid');await page.locator('#businessName').fill('Isolated receipt check');await page.getByRole('button',{name:'Request Host Partnership',exact:true}).click();
    if(scenario==='html'){await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('heading',{name:'Request received',exact:true}).count(),0);assert.equal(await page.locator('#email').inputValue(),'fixture@example.invalid');}
    else{await page.getByTestId('host-partner-receipt').waitFor();assert((await page.getByTestId('host-partner-receipt').innerText()).includes(scenario==='email-unconfirmed'?'email delivery was not confirmed':'submitted for email delivery'));assert.equal(await page.locator('a[href="/customer-signup?role=host"]').isVisible(),true);}
    assert.equal(intercepted,1);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    report.live.push({scenario,passed:true,interceptedRequest:intercepted,blockedWrites,backendSubmissionMade:false});
   }finally{await context.close();}
  }
  report.versionAfter=await version();
 }
 run('tracked-clean','git',['diff','--exit-code','HEAD','--']);assert.equal(run('final-clean','git',['status','--porcelain']).trim(),'');report.result='pass';
}catch(error){report.error=String(error.stack||error);console.error('HOST_INTAKE_FAILURE '+report.error);process.exitCode=1;}
finally{
 await browser?.close();fs.rmSync(temp,{recursive:true,force:true});report.ownedCheckoutRemoved=!fs.existsSync(temp);report.finishedAt=new Date().toISOString();
 report.boundary='Isolated persistence/mail fixtures and actual page behavior. Live mode intercepts form submissions locally and blocks other writes; it does not create or prove a real production lead, email delivery, host account, indexing or organic growth.';
 fs.writeFileSync(path.join(out,'host-intake-evidence.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nDisallow: /\n');fs.writeFileSync(path.join(out,'index.html'),'<meta name="robots" content="noindex,nofollow"><h1>Host intake confirmation checks</h1><a href="host-intake-evidence.json">Exact execution</a>');console.log('HOST_INTAKE_SUMMARY '+JSON.stringify(report));
}
