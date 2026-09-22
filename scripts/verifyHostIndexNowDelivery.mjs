import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const candidate='105923e48c71f768c8306b5fdfbe942c42027e96';
const base='dea2e5911b1411a348f37a936a6b363d699377b5';
const mode=String(process.env.MEAL_HOST_INDEXNOW_MODE||'');
assert(['validate','observe'].includes(mode));
const expected=mode==='validate'?base:String(process.env.MEAL_HOST_INDEXNOW_EXPECTED||'');
assert.match(expected,/^[a-f0-9]{40}$/);
const writeApproved=mode==='observe'&&process.env.MEAL_HOST_INDEXNOW_SUBMIT_ONCE==='1';
const out=path.resolve('test-results/recovery-isolated-report');
const report={candidate,base,expected,mode,startedAt:new Date().toISOString(),result:'fail',steps:[],publicChecks:[],providerAttempts:0,customerMutations:0,analyticsEventSubmissions:0,indexingConfirmed:false};
let temp,checkout;
const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{CI:'true',TZ:'UTC',NODE_ENV:'development',NODE_OPTIONS:'--max-old-space-size=3072'});
function run(label,command,args,cwd=checkout,want=0){
 console.log('HOST_INDEXNOW_START '+label);
 const result=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:900000,maxBuffer:64*1024*1024});
 const text=(result.stdout||'')+(result.stderr||'');
 const step={label,exit:result.status,expected:want,at:new Date().toISOString()};report.steps.push(step);
 console.log('HOST_INDEXNOW_STEP '+JSON.stringify(step));
 if(result.status!==want)console.error(text.slice(-16000));
 assert.equal(result.status,want,label+': '+(result.error||'see output'));return text;
}
const origin='https://www.mealscout.us';
const headers={'user-agent':'mealscout-runtime-proof/indexnow-host-delivery','x-mealscout-qa':'1'};
async function get(url,agent){
 const response=await fetch(url,{headers:{...headers,...(agent?{'user-agent':agent+' mealscout-runtime-proof/indexnow-host-delivery'}:{})},redirect:'error',signal:AbortSignal.timeout(20000)});
 assert(Number(response.headers.get('content-length')||0)<2000000,'Public probe size exceeded');
 const text=await response.text();assert(text.length<2000000,'Public probe size exceeded');return {response,text};
}
async function version(){const {response,text}=await get(origin+'/api/version');const value=JSON.parse(text);assert.equal(response.status,200);assert.equal(value.version?.commit,expected);return {status:response.status,commit:value.version.commit,platform:value.version.platform};}
try{
 for(const name of ['DATABASE_URL','TEST_DATABASE_URL','STRIPE_SECRET_KEY','SESSION_SECRET','BREVO_API_KEY','SENDGRID_API_KEY','SMTP_PASS'])assert(!process.env[name],'No production/provider credentials: '+name);
 if(mode==='validate'){
  temp=fs.mkdtempSync(path.join(os.tmpdir(),'meal-indexnow-hosts-'));checkout=path.join(temp,'source');
  run('clone','git',['clone','--no-hardlinks','--no-checkout',process.cwd(),checkout],temp);
  run('fetch','git',['fetch','--no-tags','https://github.com/infotradescout/MealScout.git',candidate]);
  run('checkout','git',['checkout','--detach',candidate]);
  assert.equal(run('head','git',['rev-parse','HEAD']).trim(),candidate);
  assert.equal(run('initial-clean','git',['status','--porcelain']).trim(),'');
  assert.deepEqual(run('file-scope','git',['diff','--name-only',base,candidate]).trim().split('\n').sort(),['scripts/acquisition-edge-routing.contract.test.mjs','scripts/indexnow-scheduler.contract.test.mjs','server/bootstrap/registerSchedulers.ts']);
  const filename=path.join(checkout,'server/bootstrap/registerSchedulers.ts');
  const fixed=fs.readFileSync(filename,'utf8');
  const previous=run('base-scheduler','git',['show',base+':server/bootstrap/registerSchedulers.ts']);
  const anchor='          `${baseUrl}/for-events`,\n';
  assert.equal(previous.split(anchor).length,2);
  assert.equal(fixed,previous.replace(anchor,anchor+'          `${baseUrl}/for-hosts`,\n          `${baseUrl}/host-location-partner`,\n'),'Only the two approved URLs may change in the scheduler');
  const oldContract=run('base-edge-contract','git',['show',base+':scripts/acquisition-edge-routing.contract.test.mjs']);
  assert.equal(fs.readFileSync(path.join(checkout,'scripts/acquisition-edge-routing.contract.test.mjs'),'utf8'),oldContract+'\n// Exercise the actual daily callback with isolated imports and provider responses.\nawait import("./indexnow-scheduler.contract.test.mjs");\n');
  run('npm-ci','npm',['ci','--include=dev','--no-audit','--no-fund']);
  const positive=run('routing-and-real-scheduler','node',['--test','--test-reporter=tap','scripts/acquisition-edge-routing.contract.test.mjs']);
  assert.match(positive,/^# pass 17\s*$/m);assert.match(positive,/^# fail 0\s*$/m);
  try{fs.writeFileSync(filename,previous);const negative=run('original-scheduler-negative-control','node',['--test','--test-reporter=tap','scripts/indexnow-scheduler.contract.test.mjs'],checkout,1);assert.match(negative,/Host pages must reach the actual scheduled payload/);assert.match(negative,/^# fail 1\s*$/m);assert.match(negative,/^# pass 6\s*$/m);}finally{fs.writeFileSync(filename,fixed);}
  run('source-restored','git',['diff','--exit-code','HEAD','--']);
  run('typecheck','npm',['run','check']);
  run('platform-build','npm',['run','build:platform']);
  for(const script of ['test:discovery-observatory','test:public-data-boundary','test:public-discovery-contract','test:public-restaurant-indexability','test:profile-action-policy'])run(script.replaceAll(':','-'),'npm',['run',script]);
  assert.equal(run('final-clean','git',['status','--porcelain']).trim(),'');
  report.candidatePassed=true;
 }
 report.versionBefore=await version();
 const robots=await get(origin+'/robots.txt');assert.equal(robots.response.status,200);
 const keyLocation=/^IndexNow:\s*(https:\/\/\S+)\s*$/mi.exec(robots.text)?.[1];assert(keyLocation,'No published verification location');
 const keyUrl=new URL(keyLocation);assert.equal(keyUrl.origin,origin);assert.equal(keyUrl.search,'');assert.equal(keyUrl.hash,'');
 const key=/^\/([A-Za-z0-9-]{8,128})\.txt$/.exec(keyUrl.pathname)?.[1];assert(key,'Invalid public verification filename');
 for(const agent of ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)','Mozilla/5.0 (compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot)']){
  const verification=await get(keyLocation,agent);assert.equal(verification.response.status,200);assert.match(verification.response.headers.get('content-type')||'',/^text\/plain/i);assert.equal(verification.text.trim(),key);
  report.publicChecks.push({kind:'verification-file',agent:agent.includes('bingbot')?'bingbot':'OAI-SearchBot',status:200,keyMatches:true});
  for(const pathname of ['/for-hosts','/host-location-partner']){
   const {response,text}=await get(origin+pathname,agent);assert.equal(response.status,200);assert.match(response.headers.get('content-type')||'',/text\/html/);
   assert(!/noindex/i.test(response.headers.get('x-robots-tag')||''));
   const tags=[...text.matchAll(/<link\b[^>]*>/gi)].map(match=>match[0]);
   const canonicals=tags.filter(tag=>/\brel=["']canonical["']/i.test(tag)).map(tag=>/\bhref=["']([^"']+)["']/i.exec(tag)?.[1]);
   assert.deepEqual(canonicals,[origin+pathname]);assert.match(text,/<h1\b/i);
   assert(!/<meta\b[^>]*\bname=["']robots["'][^>]*\bcontent=["'][^"']*noindex/i.test(text));
   report.publicChecks.push({kind:'public-host-page',path:pathname,agent:agent.includes('bingbot')?'bingbot':'OAI-SearchBot',status:200,canonical:canonicals[0],hasH1:true});
  }
 }
 if(writeApproved){
  const urls=['/for-hosts','/host-location-partner'].map(p=>origin+p);
  report.providerAttempts=1;console.log('HOST_INDEXNOW_SUBMISSION_ATTEMPT '+JSON.stringify({urls,at:new Date().toISOString(),retry:false}));
  const response=await fetch('https://api.indexnow.org/indexnow',{method:'POST',headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({host:keyUrl.hostname,key,keyLocation,urlList:urls}),redirect:'error',signal:AbortSignal.timeout(20000)});
  const body=(await response.text()).replaceAll(key,'[public-verification-key]').slice(0,600);
  report.provider={status:response.status,received:[200,202].includes(response.status),keyValidationPending:response.status===202,urls,body};
  assert([200,202].includes(response.status),'IndexNow still rejects the verified public-host submission');
 }
 report.versionAfter=await version();report.result='pass';
}catch(error){report.error=String(error.stack||error);if(report.providerAttempts&&!report.provider)report.providerDelivery='uncertain-do-not-automatically-retry';process.exitCode=1;}
finally{
 if(temp)fs.rmSync(temp,{recursive:true,force:true});report.finishedAt=new Date().toISOString();
 report.boundary='The scheduled callback is executed only with isolated dependencies. Live checks are marked diagnostic HTTP reads; an explicitly selected final mode may make one real two-URL IndexNow notification. Provider receipt is not indexing, Google inclusion, LLM citation, traffic growth or proof that the next scheduled run executed.';
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'host-indexnow-delivery.json'),JSON.stringify(report,null,2));
 fs.writeFileSync(path.join(out,'index.html'),'<meta name="robots" content="noindex,nofollow"><h1>Host search-notification delivery</h1><a href="host-indexnow-delivery.json">Execution record</a>');
 fs.writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nDisallow: /\n');
 console.log('HOST_INDEXNOW_SUMMARY '+JSON.stringify(report));
}
