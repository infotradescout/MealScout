/** Compatibility deployment proof; uses the existing owned Render executor.
 * Application bytes are not transformed. A derived TEST harness retains the
 * pre-142 constraint and explicitly expects data-preserving rebooking denial.
 * This is not a migration142 pass, production drain, or live provider receipt.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'.qa-evidence/host-route-native');
const hash=value=>createHash('sha256').update(value).digest('hex');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const target='102f054bd7a8be68ea63758f527fe0c078a7fce4';
const verified='9e53e0d9c36abdc659e0a5ca11b70ab36e1c7da6';
const productionParent='c10700e38d158f9b7378925a7cf3951b20fae9e1';
const coreHash='edcba7d94ea34a64ad5878546d9b41e667031ae4e53ea510faf9eb03612459e9';
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|HOME|TMPDIR|TMP|TEMP|LANG|LC_ALL|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|http_proxy|https_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)$/.test(k)));
export async function runCompatibilityCutoverProof(){
 assert.equal(process.env.MEALSCOUT_HOST_ROUTE_PROOF,'1');
 assert.equal(process.env.MEALSCOUT_PARKING_COMPATIBILITY_PROOF,'1');
 assert.equal(git(root,'rev-parse','HEAD'),process.env.RENDER_GIT_COMMIT);
 assert.equal(git(root,'status','--porcelain'),'');
 for(const [k,v] of Object.entries(process.env))if(/DATABASE_URL|STRIPE.*(?:KEY|SECRET)|SESSION_SECRET|OWNER_PASSWORD/.test(k))assert.ok(!v,'No ambient credentials: '+k);
 fs.mkdirSync(out,{recursive:true});
 const owned=fs.mkdtempSync(path.join(os.tmpdir(),'mealscout-compatibility-'));
 const clone=path.join(owned,'source');
 const receipt={schemaVersion:1,result:'running',executorSource:process.env.RENDER_GIT_COMMIT,source:target,verifiedApplicationSource:verified,productionMigrationSource:productionParent,startedAt:new Date().toISOString(),steps:[],productionChanged:false,liveProviderAcceptance:false,scope:'Actual host-route compatibility with the pre-142 all-history constraint. Auth/storage/provider fixtures remain explicit. Only the test harness changes its schema setup and rebooking expectation; application bytes must match the verified release.'};
 const run=(name,command,args,cwd=clone,env={})=>{const result=spawnSync(command,args,{cwd,env:{...safeEnv,...env},encoding:'utf8',timeout:600000,maxBuffer:20*1024*1024});const text=(result.stdout||'')+(result.stderr||'');const step={name,exitCode:result.status,signal:result.signal,logSha256:hash(text)};receipt.steps.push(step);fs.writeFileSync(path.join(out,'compatibility-'+name+'.log'),text);console.log('PARKING_COMPATIBILITY_STEP '+JSON.stringify(step));if(result.status!==0)throw Error(name+' failed: '+text.slice(-2000));return text;};
 try{
  for(const ref of [target,verified,productionParent])run('fetch-'+ref.slice(0,8),'git',['fetch','--no-tags','--depth=1','https://github.com/infotradescout/MealScout.git',ref],root);
  run('owned-clone','git',['clone','--no-hardlinks',root,clone],root);
  run('checkout','git',['checkout','--detach',target]);
  assert.equal(git(clone,'diff',verified,target,'--','client','server','shared','package.json','package-lock.json','scripts/buildServer.mjs','scripts/platformBuild.mjs','vercel.json'),'','Application/config must equal verified candidate');
  assert.equal(git(clone,'diff',productionParent,target,'--','migrations'),'','Compatibility deployment must not change production migrations');
  assert.equal(fs.existsSync(path.join(clone,'migrations/142_parking_pass_active_booking_uniqueness.sql')),false);
  receipt.applicationUnchanged=true;receipt.migrationsUnchanged=true;receipt.tree=git(clone,'rev-parse','HEAD^{tree}');
  run('canonical-npm-ci','npm',['ci','--include=dev','--no-audit','--no-fund']);
  const corePath=path.join(clone,'scripts/qa/parking-host-route-core.mjs');
  let core=fs.readFileSync(corePath,'utf8');assert.equal(hash(core),coreHash);
  const edits=[];
  const replace=(name,before,after)=>{assert.equal(core.split(before).length,2,'Unique test adapter anchor: '+name);core=core.replace(before,after);edits.push({name,beforeSha256:hash(before),afterSha256:hash(after)});};
  replace('retain-old-guard',"await api.runMigrationFile(path.join(root,'migrations/142_parking_pass_active_booking_uniqueness.sql'),{quiet:true});","assert.equal((await pool.query(\"SELECT count(*)::int n FROM pg_constraint WHERE conrelid='event_bookings'::regclass AND conname='uq_bookings_event_truck' AND contype='u'\")).rows[0].n,1);");
  replace('manifest-existing-migration',"'migrations/142_parking_pass_active_booking_uniqueness.sql'","'migrations/016_add_stripe_payments.sql'");
  const previousCase=core.split('\n').find(line=>line.includes("await test('cancelled booking history survives a successful rebooking'"));
  assert.ok(previousCase);
  const replacementCase="  await test('pre142 rebooking is denied without losing history or issuing payment',async()=>{const a=await actor(),e=await event();const old=await seed(schema.eventBookings,{id:randomUUID(),eventId:e.id,truckId:a.truck.id,hostId:host.id,hostPriceCents:1500,platformFeeCents:1000,totalCents:2500,status:'cancelled',stripePaymentStatus:'cancelled',cancellationReason:'qa retained terminal history',cancelledAt:new Date()});const before=await history(old.id),operations=await effects(),calls=await creates();const r=await request(workers[2],a,e);assert.equal(r.status,409,JSON.stringify(r));assert.deepEqual(await history(old.id),before);assert.equal(await active(e),0);assert.equal(await effects(),operations);assert.equal(await creates(),calls);return{terminalRowPreserved:true,activeBookings:0,providerOperations:0,status:409,temporaryCompatibilityLimitation:true};});";
  replace('assert-safe-pre142-limitation',previousCase,replacementCase);
  const derived=path.join(clone,'scripts/qa/.parking-compatibility-core.mjs');
  // This is a generated test artifact in an owned clone, never application code.
  fs.appendFileSync(path.join(clone,'.git/info/exclude'),'\n/scripts/qa/.parking-compatibility-core.mjs\n');
  fs.writeFileSync(derived,core);
  receipt.testAdapter={canonicalCoreSha256:coreHash,derivedCoreSha256:hash(core),edits};
  run('actual-route-pre142',process.execPath,[derived],clone,{MEALSCOUT_HOST_ROUTE_PROOF:'1',MEALSCOUT_NATIVE_PG_BIN:process.env.MEALSCOUT_NATIVE_PG_BIN,RENDER_GIT_COMMIT:target});
  const route=JSON.parse(fs.readFileSync(path.join(clone,'.qa-evidence/host-route-native/receipt.json'),'utf8'));
  assert.equal(route.source,target);assert.equal(route.result,'pass');assert.equal(route.passed,20);assert.equal(route.failed,0);assert.equal(route.finalSourceClean,true);
  delete route.tables;receipt.route=route;
  assert.ok(route.cases.some(c=>c.name==='pre142 rebooking is denied without losing history or issuing payment'&&c.evidence?.providerOperations===0));
  receipt.finalSourceClean=git(clone,'status','--porcelain')===''&&git(root,'status','--porcelain')==='';assert.equal(receipt.finalSourceClean,true);
  receipt.result='pass';
 }catch(error){receipt.result='fail';receipt.error=String(error.stack||error);}
 finally{
  fs.rmSync(owned,{recursive:true,force:true});receipt.ownedCloneRemoved=true;receipt.finishedAt=new Date().toISOString();
  fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log('PARKING_COMPATIBILITY_RECEIPT '+JSON.stringify(receipt));process.exitCode=receipt.result==='pass'?0:1;
 }
 return receipt;
}
