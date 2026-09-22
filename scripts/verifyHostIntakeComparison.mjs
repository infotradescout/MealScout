import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const candidate='60cde2ed4012e6e5cce02f402d631718ca9ce591',verified='fded6a390d5233edc6ce91866340956c4d715091',base='aa3562bddef14b35bee5a67a3bae0ec8d5c3e212';
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'host-form-comparison-')),checkout=path.join(temp,'source');
const out=path.join(root,'test-results/recovery-isolated-report');fs.mkdirSync(out,{recursive:true});
const env=Object.fromEntries(['PATH','HOME','LANG','TZ','PLAYWRIGHT_BROWSERS_PATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));Object.assign(env,{CI:'true',NODE_OPTIONS:'--max-old-space-size=3072'});
const evidence={candidate,verifiedRuntime:verified,base,startedAt:new Date().toISOString(),result:'fail',steps:[],productionWrites:0,priorGateDeploy:'dep-dapej8v40ujc739efv4g'};
function run(label,command,args,cwd=checkout,extra={},expected=0){console.log('HOST_COMPARISON_START '+label);const r=spawnSync(command,args,{cwd,env:{...env,...extra},encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024});const text=(r.stdout||'')+(r.stderr||'');fs.writeFileSync(path.join(out,label+'.log'),text);evidence.steps.push({label,exit:r.status,expected,at:new Date().toISOString()});console.log('HOST_COMPARISON_STEP '+JSON.stringify(evidence.steps.at(-1)));assert.equal(r.status,expected,text.slice(-2000));return text;}
try{
 for(const k of ['DATABASE_URL','TEST_DATABASE_URL','STRIPE_SECRET_KEY','SESSION_SECRET','BREVO_API_KEY','SENDGRID_API_KEY','SMTP_PASS'])assert(!process.env[k],'No inherited production credentials');
 run('clone','git',['clone','--no-hardlinks','--no-checkout',root,checkout],temp);run('fetch','git',['fetch','--no-tags','https://github.com/infotradescout/MealScout.git',candidate]);run('checkout','git',['checkout','--detach',candidate]);assert.equal(run('identity','git',['rev-parse','HEAD']).trim(),candidate);
 assert.equal(run('test-only-diff','git',['diff','--name-only',verified,candidate]).trim(),'scripts/host-partner-confirmation.browser.mjs');
 const testPath='scripts/host-partner-confirmation.browser.mjs';
 const prior=run('prior-browser-test','git',['show',verified+':'+testPath]);
 assert.equal(prior.replace("document.body.innerText.includes('Request received')","document.body.textContent.includes('Request received')"),fs.readFileSync(path.join(checkout,testPath),'utf8'));
 run('npm-ci','npm',['ci','--include=dev','--no-audit','--no-fund']);run('css-build','npm',['run','build:platform']);run('chromium',process.execPath,['node_modules/playwright/cli.js','install','chromium']);
 const positive=run('all-browser-cases',process.execPath,[testPath],checkout,{HOST_INTAKE_BROWSER_OUTPUT:out});
 const parsed=JSON.parse(positive.split('\n').find(x=>x.startsWith('HOST_INTAKE_BROWSER ')).slice('HOST_INTAKE_BROWSER '.length));assert.equal(parsed.passed,true);assert.equal(parsed.cases.length,30);evidence.browserCases=parsed.cases.length;
 const page=path.join(checkout,'client/src/pages/host-location-partner.tsx'),pageSource=fs.readFileSync(page);
 try{
  fs.writeFileSync(page,run('original-page','git',['show',base+':client/src/pages/host-location-partner.tsx']));
  const negative=run('original-browser-negative',process.execPath,[testPath],checkout,{HOST_INTAKE_BROWSER_BASELINE:'1'},1);
  assert.match(negative,/Malformed or failed response must not produce a receipt/);evidence.originalFalseSuccessDetected=true;
 }finally{fs.writeFileSync(page,pageSource);}
 assert.equal(run('source-restored','git',['diff','--exit-code','HEAD','--']).trim(),'');assert.equal(run('clean-source','git',['status','--porcelain']).trim(),'');evidence.result='pass';
}catch(error){evidence.error=String(error.stack||error);process.exitCode=1;}
finally{fs.rmSync(temp,{recursive:true,force:true});evidence.finishedAt=new Date().toISOString();evidence.ownedCheckoutRemoved=!fs.existsSync(temp);evidence.boundary='Only the CSS-independent test wait changed. Prior24 receipt/service cases, typecheck/lint/build and acquisition/public-boundary contracts remain bound to byte-identical runtime. Initial overall FAIL and diagnostic-only run remain unchanged; this exact continuation completes browser positive/negative and final source checks. No production writes.';fs.writeFileSync(path.join(out,'host-comparison.json'),JSON.stringify(evidence,null,2));fs.writeFileSync(path.join(out,'index.html'),'<meta name="robots" content="noindex"><h1>Host comparison continuation</h1><a href="host-comparison.json">Recorded result</a>');console.log('HOST_COMPARISON_SUMMARY '+JSON.stringify(evidence));}
