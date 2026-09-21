/** Read-only public production observations. Never authenticates, creates an
 * account/booking/PaymentIntent, cancels a payment, sends a message, or runs SQL.
 * Configuration presence and aggregate payment health are NOT provider acceptance.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'.qa-evidence/host-route-native');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function runParkingLiveReadonlyProbe(){
 assert.equal(process.env.MEALSCOUT_PARKING_READONLY_PROBE,'1');
 const source=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 assert.equal(source,process.env.RENDER_GIT_COMMIT);
 const expected=process.env.MEALSCOUT_PARKING_EXPECTED_LIVE_COMMIT||null;
 if(expected)assert.match(expected,/^[a-f0-9]{40}$/);
 const report={schemaVersion:1,kind:'public-readonly-production-observation',executorSource:source,probeSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),expectedCommit:expected,startedAt:new Date().toISOString(),observations:[],productionMutations:0,livePaymentAcceptance:false};
 const targets=[
  ['https://mealscout.onrender.com','/api/version','version'],
  ['https://www.mealscout.us','/api/version','version'],
  ['https://mealscout.onrender.com','/health/ready','ready'],
  ['https://mealscout.onrender.com','/api/payments/stripe-config','payments-config'],
  ['https://www.mealscout.us','/api/payments/stripe-config','payments-config'],
  ['https://mealscout.onrender.com','/health/payments','payment-health'],
  ['https://mealscout.onrender.com','/api/parking-pass','parking-list'],
  ['https://mealscout.onrender.com','/api/parking-pass/host-ids','parking-hosts'],
  ['https://mealscout.onrender.com','/api/hosts','protected-hosts'],
 ];
 for(const [origin,route,kind] of targets){
  const row={origin,route,kind,observedAt:new Date().toISOString()};
  try{
   const response=await fetch(origin+route,{method:'GET',redirect:'manual',headers:{Accept:'application/json','Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)});
   row.status=response.status;row.contentType=response.headers.get('content-type');
   const text=await response.text();row.responseSha256=sha(text);let body;try{body=JSON.parse(text);}catch{row.json=false;}
   if(body!==undefined){row.json=true;
    if(kind==='version'){const value=body.version||body;row.commit=value.commit||null;row.commitSource=value.commitSource||null;row.platform=value.platform||null;row.frontendAssetManifest=value.frontendAssetManifest??null;row.expectedCommitMatches=expected?row.commit===expected:null;}
    else if(kind==='payments-config'){const key=String(body.publishableKey||'');row.paymentsReady=body.paymentsReady===true;row.publishableKeyMode=key.startsWith('pk_live_')?'live':key.startsWith('pk_test_')?'test':key?'unknown':'missing';}
    else if(kind==='payment-health'){row.healthStatus=body.status;row.generatedAt=body.payments?.generatedAt||null;row.counts=body.payments?.counts||null;}
    else if(kind==='ready'){row.healthStatus=body.status;row.database=body.db;}
    else if(kind==='parking-list'||kind==='parking-hosts'){row.shape=Array.isArray(body)?'array':typeof body;row.count=Array.isArray(body)?body.length:null;}
    else if(kind==='protected-hosts')row.authenticationRequired=response.status===401||response.status===403;
   }
  }catch(error){row.error=String(error.message||error);}
  report.observations.push(row);console.log('PARKING_PUBLIC_OBSERVATION '+JSON.stringify(row));
 }
 const versions=report.observations.filter(x=>x.kind==='version');
 const ready=report.observations.find(x=>x.kind==='ready');
 report.exactRuntimeObserved=Boolean(expected)&&versions.length===2&&versions.every(x=>x.status===200&&x.expectedCommitMatches===true);
 report.databaseReady=ready?.status===200&&ready?.database==='ok';
 report.authenticationBoundary=report.observations.find(x=>x.kind==='protected-hosts')?.authenticationRequired===true;
 report.publicParkingAvailable=report.observations.filter(x=>x.kind==='parking-list'||x.kind==='parking-hosts').every(x=>x.status===200&&x.json===true);
 report.result=report.exactRuntimeObserved&&report.databaseReady&&report.authenticationBoundary&&report.publicParkingAvailable?'pass':'fail';
 report.finishedAt=new Date().toISOString();
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n');
 console.log('PARKING_LIVE_READONLY_RECEIPT '+JSON.stringify(report));process.exitCode=report.result==='pass'?0:1;return report;
}
