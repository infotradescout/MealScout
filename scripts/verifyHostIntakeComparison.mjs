import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const candidate='fded6a390d5233edc6ce91866340956c4d715091',base='aa3562bddef14b35bee5a67a3bae0ec8d5c3e212';
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'host-form-comparison-')),checkout=path.join(temp,'source');
const out=path.join(root,'test-results/recovery-isolated-report');fs.mkdirSync(out,{recursive:true});
const env=Object.fromEntries(['PATH','HOME','LANG','TZ','PLAYWRIGHT_BROWSERS_PATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));Object.assign(env,{CI:'true',NODE_OPTIONS:'--max-old-space-size=3072'});
const evidence={candidate,base,startedAt:new Date().toISOString(),result:'fail',steps:[],productionWrites:0};
function run(label,command,args,cwd=checkout,extra={},expected=0){console.log('HOST_COMPARISON_START '+label);const r=spawnSync(command,args,{cwd,env:{...env,...extra},encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024});const text=(r.stdout||'')+(r.stderr||'');fs.writeFileSync(path.join(out,label+'.log'),text);evidence.steps.push({label,exit:r.status,expected,at:new Date().toISOString()});console.log('HOST_COMPARISON_STEP '+JSON.stringify(evidence.steps.at(-1)));assert.equal(r.status,expected,text.slice(-2000));return text;}
try{
 run('clone','git',['clone','--no-hardlinks','--no-checkout',root,checkout],temp);run('fetch','git',['fetch','--no-tags','https://github.com/infotradescout/MealScout.git',candidate]);run('checkout','git',['checkout','--detach',candidate]);assert.equal(run('identity','git',['rev-parse','HEAD']).trim(),candidate);
 run('npm-ci','npm',['ci','--include=dev','--no-audit','--no-fund']);run('css-build','npm',['run','build:platform']);run('chromium',process.execPath,['node_modules/playwright/cli.js','install','chromium']);
 const page=path.join(checkout,'client/src/pages/host-location-partner.tsx'),test=path.join(checkout,'scripts/host-partner-confirmation.browser.mjs');const pageSource=fs.readFileSync(page),testSource=fs.readFileSync(test,'utf8');
 try{
  fs.writeFileSync(page,run('original-page','git',['show',base+':client/src/pages/host-location-partner.tsx']));
  const needle='// This detects the unchanged page\'s false-positive success without relying on new test IDs.';
  assert(testSource.includes(needle));
  fs.writeFileSync(test,testSource.replace(needle,needle+'\n        await page.waitForTimeout(500); console.log("BASELINE_FORM_DIAGNOSTIC "+JSON.stringify({scenario,calls,unexpectedWrites,payloads,errors,text:await page.locator("body").innerText()}));'));
  const result=run('original-browser-diagnostic',process.execPath,['scripts/host-partner-confirmation.browser.mjs'],checkout,{HOST_INTAKE_BROWSER_BASELINE:'1'},1);
  const line=result.split('\n').find(x=>x.startsWith('BASELINE_FORM_DIAGNOSTIC '));assert(line,'Missing baseline diagnostic');evidence.diagnostic=JSON.parse(line.slice('BASELINE_FORM_DIAGNOSTIC '.length));console.log(line);
  evidence.expectedAssertionObserved=/Malformed or failed response must not produce a receipt/.test(result);
  evidence.result='diagnosed';
 }finally{fs.writeFileSync(page,pageSource);fs.writeFileSync(test,testSource);}
 assert.equal(run('source-restored','git',['diff','--exit-code','HEAD','--']).trim(),'');assert.equal(run('clean-source','git',['status','--porcelain']).trim(),'');
}catch(error){evidence.error=String(error.stack||error);process.exitCode=1;}
finally{fs.rmSync(temp,{recursive:true,force:true});evidence.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'host-comparison.json'),JSON.stringify(evidence,null,2));fs.writeFileSync(path.join(out,'index.html'),'<meta name="robots" content="noindex"><h1>Host comparison diagnostic</h1><a href="host-comparison.json">Recorded result</a>');console.log('HOST_COMPARISON_SUMMARY '+JSON.stringify(evidence));}
