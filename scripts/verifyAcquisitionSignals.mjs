import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const expected='d64ef420f537b78e00fc93c8d8aa1baba84a976f';
const diagnostic='qa-acquisition-387-20260921';
const base='https://www.mealscout.us';
const output=path.resolve('test-results/recovery-isolated-report');
fs.mkdirSync(output,{recursive:true});
const report={expected,diagnostic,startedAt:new Date().toISOString(),result:'fail',diagnosticWritesAttempted:0,customerMutations:0,verifiedPeople:null};
const headers={'accept':'application/json','user-agent':'mealscout-acquisition-proof/1.0','x-mealscout-qa':'1'};
async function version(){
 const response=await fetch(base+'/api/version',{headers,signal:AbortSignal.timeout(15000),redirect:'error'});
 const body=await response.json();assert.equal(response.status,200);assert.equal(body.version?.commit,expected);
 return {status:response.status,commit:body.version.commit,platform:body.version.platform};
}
try{
 report.before=await version();
 const ready=await fetch(base+'/health/ready',{headers,signal:AbortSignal.timeout(15000),redirect:'error'});
 const readyBody=await ready.json();assert.equal(ready.status,200);assert.equal(readyBody.db,'ok');report.databaseReady=true;
 if(process.env.MEALSCOUT_ACQUISITION_QA_WRITE==='1'){
  report.diagnosticWritesAttempted=1;console.log('MEAL_ACQUISITION_QA_ATTEMPT '+JSON.stringify({diagnostic,expected}));
  const response=await fetch(base+'/api/analytics/shell',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({type:'public_profile_not_found_viewed',profile_id:diagnostic,profile_type:'truck',path:'/__qa/acquisition-387'}),signal:AbortSignal.timeout(15000),redirect:'error'});
  report.ingestionStatus=response.status;report.ingestion=await response.json();assert.equal(response.status,202);assert.equal(report.ingestion.ok,true);
 }
 report.after=await version();report.result='pass';
}catch(error){report.error=String(error.stack||error);}
finally{
 report.finishedAt=new Date().toISOString();report.boundary='Only release identity, database readiness and an explicitly marked QA quality-report write. Independent database read must confirm classification. Not a real profile failure, visitor, conversion or organic reach.';
 fs.writeFileSync(path.join(output,'acquisition-production.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(output,'robots.txt'),'User-agent: *\nDisallow: /\n');fs.writeFileSync(path.join(output,'index.html'),'<meta name="robots" content="noindex,nofollow"><a href="acquisition-production.json">Release observation</a>');
 console.log('MEAL_ACQUISITION_PRODUCTION '+JSON.stringify(report));if(report.result!=='pass')process.exitCode=1;
}
