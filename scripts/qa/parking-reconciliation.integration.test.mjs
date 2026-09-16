// Actual recovery service, middleware, Express HTTP, schema and SQL. Provider
// reads and the downstream booking action are fixtures; no live Stripe or listings.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import express from 'express';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { is, SQL } from 'drizzle-orm';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
for(const key of Object.keys(process.env)) assert.ok(!/DATABASE_URL|STRIPE.*KEY|BREVO.*KEY/i.test(key),'Provider credentials forbidden');
const pg=new PGlite(); globalThis.__qaRecoveryDb=drizzle(pg);
const entry="export * from './server/services/parkingBookingRecovery'; export * from './server/middleware/durableIdempotency'; export {eventBookings} from './shared/schema';";
const built=await build({stdin:{contents:entry,resolveDir:root,sourcefile:'qa-reconciliation-entry.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,
  alias:{'@shared':path.join(root,'shared')},plugins:[{name:'isolated-db',setup(b){
    b.onResolve({filter:/(?:^|\/)db$/},args=>path.resolve(args.resolveDir,args.path+'.ts')===path.join(root,'server/db.ts')?{path:'db',namespace:'qa'}:undefined);
    b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export const db = globalThis.__qaRecoveryDb;',loader:'js'}));
  }}]});
const mod=new Module(path.join(root,'scripts/qa/.reconciliation-test.cjs'));mod.filename=path.join(root,'scripts/qa/.reconciliation-test.cjs');mod.paths=Module._nodeModulePaths(root);mod._compile(built.outputFiles[0].text,mod.filename);
const {recordParkingBookingHolds,reconcileParkingBooking,requireDurableIdempotencyKey,parkingBookingProviderKey,eventBookings}=mod.exports;
await pg.exec(fs.readFileSync(path.join(root,'migrations/058_idempotency_keys.sql'),'utf8'));
const cfg=getTableConfig(eventBookings),dialect=new PgDialect(),quote=s=>'"'+s.replaceAll('"','""')+'"';
const columns=cfg.columns.map(c=>quote(c.name)+' '+c.getSQLType()+(c.primary?' PRIMARY KEY':'')+(c.notNull?' NOT NULL':'')+(c.default===undefined?'':' DEFAULT '+(is(c.default,SQL)?dialect.sqlToQuery(c.default).sql:typeof c.default==='string'?"'"+c.default.replaceAll("'","''")+"'":String(c.default))));
await pg.exec('CREATE TABLE '+quote(cfg.name)+' ('+columns.join(',')+')');
const database=globalThis.__qaRecoveryDb, route='/api/parking-pass/qa-pass/book', body={slotTypes:['lunch'],truckId:'qa-truck'};
const hash=createHash('sha256').update(route+'|'+JSON.stringify(body)).digest('hex');
let key,checkpoint,intent,allowed=true,paymentAllowed=true,executions=0,expectedExecutions=0,downstreamError=false,providerCalls=[],searchResults,providerError=false,onRetrieve=async()=>{};
const provider={retrieve:async id=>{providerCalls.push(['retrieve',id]);if(providerError)throw new Error('QA provider read unavailable');assert.equal(id,intent.id);await onRetrieve();return structuredClone(intent);},
  search:async args=>{providerCalls.push(['search',args.query]);if(providerError)throw new Error('QA provider read unavailable');return searchResults||{has_more:false,data:[structuredClone(intent)]};}};
async function seed(){
  key=randomUUID();allowed=true;paymentAllowed=true;executions=0;expectedExecutions=0;downstreamError=false;providerCalls=[];searchResults=undefined;providerError=false;onRetrieve=async()=>{};
  await pg.exec('DELETE FROM idempotency_keys; DELETE FROM event_bookings;');
  await pg.query("INSERT INTO idempotency_keys(scope,identity_key,idem_key,request_hash,state,locked_until,expires_at) VALUES ($1,'qa-owner',$2,$3,'processing',now()-interval '2 minutes',now()+interval '23 hours')",['parking_pass_booking:'+route,key,hash]);
  const hold={id:'qa-hold',eventId:'qa-pass',hostId:'qa-host',truckId:'qa-truck',hostPriceCents:1500,platformFeeCents:1000,totalCents:2500,slotType:'lunch'};
  const seed={userId:'qa-owner',route,passId:'qa-pass',truckId:'qa-truck',hostId:'qa-host',bookingStartDate:'2030-01-03',slotTypes:'lunch',destination:null,holds:[hold],
    setup:{totalCents:2500,hostPaymentsReady:false,breakdown:{hostPrice:1500,platformFee:1000,creditsApplied:0,promoDiscount:0}}};
  await database.transaction(async tx=>{await tx.insert(eventBookings).values({...hold,status:'pending',stripePaymentStatus:'pending',stripePaymentIntentId:'pi_qa_existing',createdAt:new Date()});await recordParkingBookingHolds(tx,key,seed);});
  checkpoint=(await pg.query('SELECT response_body FROM idempotency_keys WHERE idem_key=$1',[key])).rows[0].response_body;
  intent={id:'pi_qa_existing',amount:2500,currency:'usd',status:'requires_payment_method',client_secret:'qa-only-secret',transfer_data:null,application_fee_amount:null,
    metadata:{bookingRequestKey:parkingBookingProviderKey('qa-owner',route,key),userId:'qa-owner',truckId:'qa-truck',passId:'qa-pass',hostId:'qa-host',slotTypes:'lunch',bookingDays:'1',bookingStartDate:'2030-01-03',totalCents:'2500',hostPriceCents:'1500',platformFeeCents:'1000',creditAppliedCents:'0',bookingPromoDiscountCents:'0',bookingPromoCode:''}};
}
const servers=[],origins=[];
for(let worker=0;worker<2;worker++){
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={id:req.get('x-qa-actor')||'qa-owner'};next();});
  app.post(route,requireDurableIdempotencyKey({scope:'parking_pass_booking',authorizeReplay:async()=>allowed,
    reconcile:(req,saved)=>reconcileParkingBooking(req,saved,provider,async()=>paymentAllowed)}),async (_req,res)=>{executions++;if(downstreamError)await pg.query('UPDATE idempotency_keys SET response_body=$1::jsonb WHERE idem_key=$2',[JSON.stringify(checkpoint),key]);res.status(500).json({message:'QA interrupted operation'});});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));servers.push(server);origins.push('http://127.0.0.1:'+server.address().port);
}
async function request(worker=0,input=body){const response=await fetch(origins[worker]+route,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};}
const results=[];
async function test(name,fn){await seed();try{await fn();assert.equal(executions,expectedExecutions,'Recovery must never re-run the booking handler');results.push({name,status:'pass'});}catch(error){results.push({name,status:'fail',error:error.message});}console.log('QA RECONCILIATION '+JSON.stringify(results.at(-1)));}
const row=async()=> (await pg.query('SELECT * FROM idempotency_keys WHERE idem_key=$1',[key])).rows[0];
const unchangedHold=async()=> (await pg.query('SELECT status,stripe_payment_status,total_cents FROM event_bookings')).rows;
try {
  await test('linked unpaid intent reconstructs original checkout without creating a hold or payment',async()=>{const before=await unchangedHold();const r=await request();assert.equal(r.status,200);assert.equal(r.body.paymentIntentId,intent.id);assert.equal(r.body.clientSecret,intent.client_secret);assert.equal(r.body.totalCents,2500);assert.deepEqual(await unchangedHold(),before);assert.equal((await row()).state,'completed');assert.equal(providerCalls.filter(c=>c[0]==='search').length,0);});
  await test('missing intent linkage is repaired only from an exact positive provider match',async()=>{await pg.exec('UPDATE event_bookings SET stripe_payment_intent_id=NULL');const r=await request();assert.equal(r.status,200);assert.equal((await pg.query('SELECT stripe_payment_intent_id FROM event_bookings')).rows[0].stripe_payment_intent_id,intent.id);assert.deepEqual(providerCalls.map(c=>c[0]),['search','retrieve']);});
  await test('reconstructed response is durable and replays on a second middleware instance',async()=>{const first=await request();const n=providerCalls.length;assert.equal(first.status,200);assert.deepEqual(await request(1),first);assert.equal(providerCalls.length,n);});
  await test('simultaneous reconciliation never re-enters the booking operation',async()=>{const replies=await Promise.all([request(),request(1)]);assert.ok(replies.some(r=>r.status===200));assert.ok(replies.every(r=>[200,409].includes(r.status)));assert.equal((await row()).state,'completed');});
  for(const status of ['succeeded','processing','requires_capture']) await test('already '+status+' payment returns status navigation, never a payment secret',async()=>{intent.status=status;const r=await request();assert.equal(r.status,200);assert.equal(r.body.bookingRecovery,true);assert.equal(r.body.outcome,'pending');assert.equal(r.body.paymentIntentId,intent.id);assert.ok(!('clientSecret' in r.body));assert.equal((await pg.query('SELECT status FROM event_bookings')).rows[0].status,'pending');});
  await test('confirmed holds remain confirmed, without confirming them again',async()=>{intent.status='succeeded';await pg.exec("UPDATE event_bookings SET status='confirmed',stripe_payment_status='succeeded'");const r=await request();assert.equal(r.body.outcome,'confirmed');assert.equal(r.body.bookingRecovery,true);assert.ok(!('clientSecret' in r.body));});
  await test('credited holds remain credited rather than becoming reservations',async()=>{intent.status='succeeded';await pg.exec("UPDATE event_bookings SET status='cancelled',refund_status='credit'");const r=await request();assert.equal(r.body.outcome,'credited');assert.ok(!('clientSecret' in r.body));});
  await test('fresh permission denial prevents all provider reads and receipt exposure',async()=>{allowed=false;assert.equal((await request()).status,403);assert.equal(providerCalls.length,0);assert.equal((await row()).state,'processing');});
  await test('current insurance or role eligibility can prevent unpaid checkout recovery',async()=>{paymentAllowed=false;assert.equal((await request()).status,409);assert.equal((await row()).state,'processing');});
  await test('expired active hold cannot be presented as payable',async()=>{await pg.exec("UPDATE event_bookings SET created_at=now()-interval '2 hours'");assert.equal((await request()).status,409);});
  await test('deleted holds are not recreated',async()=>{await pg.exec('DELETE FROM event_bookings');assert.equal((await request()).status,409);assert.equal(providerCalls.length,0);assert.equal((await pg.query('SELECT count(*)::int AS n FROM event_bookings')).rows[0].n,0);});
  await test('cancelled holds are not revived for an unpaid intent',async()=>{await pg.exec("UPDATE event_bookings SET status='cancelled'");assert.equal((await request()).status,409);assert.equal((await pg.query('SELECT status FROM event_bookings')).rows[0].status,'cancelled');});
  await test('active original worker is not interrupted by reconciliation',async()=>{await pg.exec("UPDATE idempotency_keys SET locked_until=now()+interval '1 minute'");const r=await request();assert.equal(r.body.code,'request_in_progress');assert.equal(providerCalls.length,0);});
  await test('expired receipt remains unresolved without provider reads',async()=>{await pg.exec("UPDATE idempotency_keys SET expires_at=now()-interval '1 minute'");assert.equal((await request()).status,409);assert.equal(providerCalls.length,0);});
  await test('older requests without a linked checkpoint are never guessed from nearby bookings',async()=>{await pg.exec('UPDATE idempotency_keys SET response_body=NULL');assert.equal((await request()).status,409);assert.equal(providerCalls.length,0);});
  await test('changed input under the same key is rejected before recovery',async()=>{assert.equal((await request(0,{...body,slotTypes:['dinner']})).body.code,'idempotency_key_reuse_mismatch');assert.equal(providerCalls.length,0);});
  for(const found of [{has_more:false,data:[]},{has_more:true,data:[]},{has_more:false,data:[{id:'pi_one'},{id:'pi_two'}]}]) await test('absent or ambiguous provider search is not permission to create: '+JSON.stringify(found),async()=>{await pg.exec('UPDATE event_bookings SET stripe_payment_intent_id=NULL');searchResults=found;assert.equal((await request()).status,409);assert.equal((await row()).state,'processing');assert.equal(providerCalls.filter(c=>c[0]==='retrieve').length,0);});
  for(const [field,value] of [['amount',2501],['currency','eur'],['status','canceled'],['status','requires_action']]) await test('provider '+field+' mismatch or unsupported state stays unresolved: '+value,async()=>{intent[field]=value;assert.equal((await request()).status,409);});
  for(const field of ['bookingRequestKey','userId','truckId','passId','hostId','bookingDays','slotTypes','totalCents','creditAppliedCents','bookingPromoDiscountCents','bookingPromoCode']) await test('provider metadata '+field+' must match the saved request',async()=>{intent.metadata[field]='different';assert.equal((await request()).status,409);});
  await test('provider read failure preserves the recovery checkpoint',async()=>{providerError=true;const r=await request();assert.equal(r.status,503);assert.equal((await row()).response_body.kind,'parking_booking_holds_v1');});
  await test('changed hold price is rejected, not silently repriced',async()=>{await pg.exec('UPDATE event_bookings SET total_cents=9999');assert.equal((await request()).status,409);assert.equal(providerCalls.length,0);});
  await test('checkpoint contains no payment secret',async()=>{assert.ok(!JSON.stringify(checkpoint).includes('client_secret'));assert.ok(!JSON.stringify(checkpoint).includes('clientSecret'));});
  await test('failed request checkpoint rolls back inserted holds in the same transaction',async()=>{await pg.exec('DELETE FROM idempotency_keys; DELETE FROM event_bookings');await assert.rejects(database.transaction(async tx=>{await tx.insert(eventBookings).values(checkpoint.holds[0]);await recordParkingBookingHolds(tx,key,checkpoint);}));assert.equal((await pg.query('SELECT count(*)::int AS n FROM event_bookings')).rows[0].n,0);});

  await test('post-hold server error preserves checkpoint and retry recovers without reexecution',async()=>{
    await pg.exec('DELETE FROM idempotency_keys');downstreamError=true;expectedExecutions=1;
    const first=await request();assert.equal(first.status,500);assert.equal((await row()).state,'processing');assert.equal((await row()).response_body.kind,'parking_booking_holds_v1');
    const retry=await request(1);assert.equal(retry.status,200);assert.equal(retry.body.paymentIntentId,intent.id);assert.equal(executions,1);
  });
  await test('malformed checkpoint stays unresolved without provider access',async()=>{await pg.exec("UPDATE idempotency_keys SET response_body='{}'::jsonb");assert.equal((await request()).status,409);assert.equal(providerCalls.length,0);});
  await test('hold mutation during a provider lookup is caught by the locked reread',async()=>{onRetrieve=()=>pg.exec("UPDATE event_bookings SET total_cents=9999");assert.equal((await request()).status,409);assert.equal((await row()).state,'processing');});
  await test('revoked access during paid reconciliation prevents response disclosure',async()=>{intent.status='succeeded';onRetrieve=async()=>{allowed=false;};const r=await request();assert.equal(r.status,403);assert.ok(!r.body.paymentIntentId);assert.equal((await row()).state,'processing');});
  await test('incorrect provider destination stays unresolved',async()=>{intent.transfer_data={destination:'acct_other'};assert.equal((await request()).status,409);});
  await test('existing checkpoint cannot be overwritten by another hold set',async()=>{await assert.rejects(database.transaction(tx=>recordParkingBookingHolds(tx,key,checkpoint)));assert.deepEqual((await row()).response_body,checkpoint);});
  await test('failed reconstructed receipt persistence preserves evidence for the same retry',async()=>{
    await pg.exec("CREATE FUNCTION qa_reject_receipt() RETURNS trigger AS $qa$ BEGIN IF NEW.state = 'completed' THEN RAISE EXCEPTION 'QA storage failure'; END IF; RETURN NEW; END $qa$ LANGUAGE plpgsql; CREATE TRIGGER qa_receipt_failure BEFORE UPDATE ON idempotency_keys FOR EACH ROW EXECUTE FUNCTION qa_reject_receipt();");
    try {assert.equal((await request()).status,503);assert.equal((await row()).state,'processing');assert.equal((await row()).response_body.kind,'parking_booking_holds_v1');}
    finally {await pg.exec('DROP TRIGGER qa_receipt_failure ON idempotency_keys; DROP FUNCTION qa_reject_receipt();');}
    const r=await request(1);assert.equal(r.status,200);assert.equal(r.body.paymentIntentId,intent.id);
  });
} finally {await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));await pg.close();delete globalThis.__qaRecoveryDb;}
const report={scope:'Real recovery middleware/service/schema/SQL; synthetic provider reads/auth and hold setup. No live Stripe or full booking handler.',pass:results.filter(r=>r.status==='pass').length,fail:results.filter(r=>r.status==='fail').length,results};
if(process.env.QA_EVIDENCE_DIR){fs.mkdirSync(process.env.QA_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.QA_EVIDENCE_DIR,'parking-reconciliation.json'),JSON.stringify(report,null,2));}
console.log('QA RECONCILIATION SUMMARY '+JSON.stringify(report));if(report.fail)process.exitCode=1;
