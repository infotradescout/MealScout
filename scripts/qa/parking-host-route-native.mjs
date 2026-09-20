/** Source-bound, disposable native PostgreSQL proof of the registered host booking
 * route. Auth/ownership and provider transport are explicit fixtures. Route,
 * eligibility, capacity SQL, durable middleware, recovery and migrations are real.
 * No live account, database or provider credentials are accepted.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fork, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, is, SQL } from 'drizzle-orm';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { build } from 'esbuild';
import express from 'express';
const file = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(file), '../..');
const read = p => fs.readFileSync(p, 'utf8');
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const git = (...a) => execFileSync('git', a, {cwd: root, encoding: 'utf8'}).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout=15000) { const start=Date.now(); while(Date.now()-start<timeout) {const result=await fn();if(result)return result;await sleep(30);}throw Error(label+' timed out'); }
const safeEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|HOME|TMPDIR|TMP|TEMP|LANG|LC_ALL|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)$/.test(k)));
async function freePort() { const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p; }
function setRuntime(pool, schema) {
 const db=drizzle(pool);globalThis.__hostRouteDb=db;
 const one=async (t,id) => (await db.select().from(t).where(eq(t.id,id)).limit(1))[0];
 const methods={getRestaurant:id=>one(schema.restaurants,id),getHost:id=>one(schema.hosts,id),getEvent:id=>one(schema.events,id),getUser:id=>one(schema.users,id),
  getRestaurantsByOwner:id=>db.select().from(schema.restaurants).where(eq(schema.restaurants.ownerId,id)),
  verifyRestaurantOwnership:async(truck,user,cap)=>(await pool.query('SELECT 1 FROM qa_authority WHERE truck_id=$1 AND user_id=$2 AND capability=$3 AND allowed',[truck,user,cap])).rowCount===1};
 globalThis.__hostRouteStorage=new Proxy(methods,{get(t,k){if(k in t)return t[k];return()=>{throw Error('Unexpected fixture storage call '+String(k));};}});
 return db;
}
async function workerMain() {
 assert.equal(process.env.MEALSCOUT_HOST_ROUTE_PROOF,'1');
 const config=JSON.parse(read(process.env.MEALSCOUT_HOST_ROUTE_CONFIG));
 assert.equal(new URL(config.url).hostname,'127.0.0.1');assert.equal(new URL(config.provider).hostname,'127.0.0.1');
 const pool=new pg.Pool({connectionString:config.url,max:4,application_name:'mealscout-host-route-worker-'+process.pid});
 const schema=createRequire(import.meta.url)(config.schema);setRuntime(pool,schema);
 const call=async(op,body)=>{const r=await fetch(config.provider+'/'+op,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Synthetic provider '+r.status);return r.json();};
 globalThis.__hostRouteStripe=class {constructor(){this.paymentIntents={create:(data,options)=>call('create',{data,key:options?.idempotencyKey}),retrieve:id=>call('retrieve',{id}),search:query=>call('search',query),cancel:id=>call('cancel',{id})};}};
 process.env.STRIPE_SECRET_KEY='sk_test_mealscout_isolated_fixture';
 const {registerHostRoutes}=createRequire(import.meta.url)(config.bundle);
 const app=express();app.use(express.json());
 app.use(async(req,res,next)=>{try{const id=req.get('X-QA-User');req.user=id?await globalThis.__hostRouteStorage.getUser(id):null;next();}catch(e){next(e);}});
 registerHostRoutes(app);
 assert.ok(app._router.stack.some(l=>l.route?.path==='/api/parking-pass/:passId/book'&&l.route.methods.post));
 const server=app.listen(0,'127.0.0.1',()=>process.send({ready:true,pid:process.pid,port:server.address().port}));
 const stop=()=>{server.closeAllConnections();server.close(async()=>{await pool.end();process.exit(0);});};
 process.on('SIGTERM',stop);process.on('disconnect',stop);
}
if(process.argv.includes('--worker')) {await workerMain();} else {await main();}
async function main() {
 process.chdir(root);assert.equal(process.env.MEALSCOUT_HOST_ROUTE_PROOF,'1');assert.equal(process.getuid?.()===0,false,'Owned PostgreSQL must run non-root');
 for(const [k,v] of Object.entries(process.env))if(/DATABASE_URL|^PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SSLMODE)$|STRIPE.*(?:KEY|SECRET)|BREVO|SENDGRID|SMTP|RESEND|TWILIO|OPENAI_API_KEY|ANTHROPIC_API_KEY|SESSION_SECRET|OWNER_PASSWORD/.test(k))assert.ok(!v,'Forbidden ambient configuration: '+k);
 for(const d of [root,path.join(root,'client'),path.join(root,'server')])assert.ok(!fs.readdirSync(d).some(n=>/^\.env(?:\.|$)/.test(n)&&!(d===root&&['.env.example','.env.production.example'].includes(n))),'No loadable env files');
 const source=git('rev-parse','HEAD');assert.equal(source,process.env.RENDER_GIT_COMMIT);assert.equal(git('status','--porcelain'),'');
 const out=path.join(root,'.qa-evidence/host-route-native');fs.mkdirSync(out,{recursive:true});
 const owned=fs.mkdtempSync(path.join(os.tmpdir(),'mealscout-host-route-'));
 const bin=process.env.MEALSCOUT_NATIVE_PG_BIN;assert.ok(bin&&path.isAbsolute(bin));
 const report={schemaVersion:1,source,tree:git('rev-parse','HEAD^{tree}'),startedAt:new Date().toISOString(),result:'running',scope:'Actual registered POST /api/parking-pass/:passId/book, native PostgreSQL, four independent OS workers. Authentication and exact manageParkingPass grants are database-backed fixtures; external provider transport is a loopback fixture. Model-derived relevant tables, not complete production migration-chain or live Stripe acceptance.',cases:[],workers:[],files:{},cleanup:{}};
 let pool,db,schema,provider,pgStarted=false;const workers=[],providerSockets=new Set();let pauseCreate=false;
 const log=x=>console.log('HOST_ROUTE_PROOF '+JSON.stringify(x));
 async function test(name,fn){const start=Date.now();try{const evidence=await fn();report.cases.push({name,result:'pass',elapsedMs:Date.now()-start,...(evidence?{evidence}:{})});}catch(e){report.cases.push({name,result:'fail',error:e.stack||String(e),elapsedMs:Date.now()-start});}log(report.cases.at(-1));}
 async function stop(w){if(w.child.exitCode===null&&w.child.signalCode===null){w.child.kill('SIGTERM');await until(()=>w.child.exitCode!==null||w.child.signalCode!==null,'worker stop');}}
 try {
  const port=await freePort(),data=path.join(owned,'data');
  execFileSync(path.join(bin,'initdb'),['-D',data,'-A','trust','-U','qa_owner','--no-locale','-E','UTF8'],{stdio:'pipe'});
  execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(owned,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${owned} -c timezone=UTC -c max_connections=40`,'-w','start'],{stdio:'pipe'});pgStarted=true;
  const url=`postgresql://qa_owner@127.0.0.1:${port}/mealscout_host_route_test`;
  const admin=new pg.Client({connectionString:url.replace('/mealscout_host_route_test','/postgres')});await admin.connect();await admin.query('CREATE DATABASE mealscout_host_route_test');await admin.end();
  pool=new pg.Pool({connectionString:url,max:8,application_name:'mealscout-host-route-coordinator'});
  report.database={port,listen:'127.0.0.1',version:(await pool.query('select version() v')).rows[0].v};
  const schemaFile=path.join(out,'schema.cjs'),bundle=path.join(out,'route.cjs');
  await build({entryPoints:[path.join(root,'shared/schema.ts')],outfile:schemaFile,bundle:true,platform:'node',format:'cjs',packages:'external',alias:{'@shared':path.join(root,'shared')}});
  schema=createRequire(import.meta.url)(schemaFile);db=setRuntime(pool,schema);
  const quote=s=>'"'+s.replaceAll('"','""')+'"',dialect=new PgDialect(),enums=new Set();
  report.tables=[];
  for(const name of ['users','restaurants','hosts','eventSeries','events','eventBookings','parkingPassBlackoutDates']) {
   assert.ok(schema[name],'Expected model table '+name);const config=getTableConfig(schema[name]);
   for(const c of config.columns)if(c.enum?.enumName&&!enums.has(c.enum.enumName)){await pool.query('CREATE TYPE '+quote(c.enum.enumName)+' AS ENUM ('+c.enum.enumValues.map(v=>"'"+v.replaceAll("'","''")+"'").join(',')+')');enums.add(c.enum.enumName);}
   const defs=config.columns.map(c=>{let s=quote(c.name)+' '+c.getSQLType();if(c.primary)s+=' PRIMARY KEY';if(c.notNull)s+=' NOT NULL';if(c.default!==undefined){const d=c.default;s+=' DEFAULT '+(is(d,SQL)?dialect.sqlToQuery(d).sql:typeof d==='string'?"'"+d.replaceAll("'","''")+"'":typeof d==='object'?"'"+JSON.stringify(d).replaceAll("'","''")+"'":String(d));}return s;});
   if(name==='eventBookings')defs.push('CONSTRAINT uq_bookings_event_truck UNIQUE(event_id,truck_id)');
   await pool.query('CREATE TABLE '+quote(config.name)+'('+defs.join(',')+')');report.tables.push({model:name,table:config.name,columns:config.columns.map(c=>c.name)});
  }
  await pool.query('CREATE TABLE qa_authority(truck_id text,user_id text,capability text,allowed boolean,PRIMARY KEY(truck_id,user_id,capability));CREATE TABLE qa_provider_intents(id text PRIMARY KEY,request_key text UNIQUE NOT NULL,payload jsonb NOT NULL);CREATE TABLE qa_provider_calls(id bigserial PRIMARY KEY,operation text NOT NULL,request_key text);CREATE TABLE rate_limit_counters(scope text,identity_key text,window_start bigint,count integer,updated_at timestamptz,PRIMARY KEY(scope,identity_key,window_start));');
  const stubSources={
   db:'export const db=new Proxy({}, {get(_t,k){const d=globalThis.__hostRouteDb,v=d[k];return typeof v==="function"?v.bind(d):v;}});',
   storage:'export const storage=new Proxy({}, {get(_t,k){return globalThis.__hostRouteStorage[k];}});',
   unifiedAuth:'export const isAuthenticated=(req,res,next)=>req.user?next():res.status(401).json({message:"Synthetic authentication required"});',
   stripe:'export default globalThis.__hostRouteStripe;',
   emailService:'export const emailService=new Proxy({}, {get(){return()=>{throw Error("External email forbidden");};}});',
   imageUpload:'export const upload=new Proxy({}, {get(){return()=>((_req,_res,next)=>next());}});export const uploadToCloudinary=()=>{throw Error("External upload forbidden");};export const isCloudinaryConfigured=()=>false;',
   profileRoutes:'export const registerHostProfileRoutes=()=>{};',
   eventsRoutes:'export const registerHostParkingPassRoutes=()=>{};',
   auditLogger:'export const logAudit=()=>{throw Error("Unexpected audit side effect");};',
   hostEarningsService:'export const getHostEarningsSummary=()=>{throw Error("Unexpected earnings side effect");};'
  };
  const overrides=new Set();
  const result=await build({stdin:{contents:'export {registerHostRoutes} from "./server/routes/hostRoutes";export {runMigrationFile} from "./scripts/runSqlMigration";',resolveDir:root,loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external',metafile:true,define:{'import.meta.url':JSON.stringify(pathToFileURL(path.join(root,'scripts/runSqlMigration.ts')).href)},alias:{'@shared':path.join(root,'shared')},plugins:[{name:'explicit-boundary-fixtures',setup(b){b.onResolve({filter:/.*/},a=>{const key=a.path==='stripe'?'stripe':a.path.startsWith('.')?path.basename(a.path).replace(/\.[jt]s$/,''):null;if(key&&Object.hasOwn(stubSources,key)){overrides.add(a.path);return{path:key,namespace:'fixture'};}});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubSources[a.path],loader:'js'}));}}]});
  report.fixtureOverrides=[...overrides].sort();
  for(const p of Object.keys(result.metafile.inputs)){if(p.startsWith('fixture:'))continue;const absolute=path.resolve(root,p);if(fs.existsSync(absolute))report.files[path.relative(root,absolute).replaceAll('\\','/')]=sha(absolute);}
  for(const p of ['scripts/qa/parking-host-route-native.mjs','migrations/058_idempotency_keys.sql','migrations/142_parking_pass_active_booking_uniqueness.sql'])report.files[p]=sha(path.join(root,p));
  for(const p of ['server/routes/hostRoutes.ts','server/services/parkingPassTruckEligibility.ts','server/middleware/durableIdempotency.ts','server/services/parkingBookingRecovery.ts','server/services/parkingPassVirtual.ts'])assert.ok(report.files[p],'Actual application module required: '+p);
  const api=createRequire(import.meta.url)(bundle);
  await api.runMigrationFile(path.join(root,'migrations/058_idempotency_keys.sql'),{quiet:true});await api.runMigrationFile(path.join(root,'migrations/142_parking_pass_active_booking_uniqueness.sql'),{quiet:true});
  const providerApp=express();providerApp.use(express.json());providerApp.post('/:op',async(req,res)=>{try{const {op}=req.params,{data,key,id,query}=req.body;await pool.query('INSERT INTO qa_provider_calls(operation,request_key) VALUES($1,$2)',[op,key||id||query||null]);let payload;
   if(op==='create'){assert.ok(key);const pid='pi_qa_'+randomUUID();const intent={...data,id:pid,status:'requires_payment_method',client_secret:pid+'_secret_fixture',amount_received:0,amount_capturable:0};await pool.query('INSERT INTO qa_provider_intents(id,request_key,payload) VALUES($1,$2,$3) ON CONFLICT(request_key) DO NOTHING',[pid,key,JSON.stringify(intent)]);payload=(await pool.query('SELECT payload FROM qa_provider_intents WHERE request_key=$1',[key])).rows[0].payload;if(pauseCreate)return;}
   else if(op==='retrieve')payload=(await pool.query('SELECT payload FROM qa_provider_intents WHERE id=$1',[id])).rows[0]?.payload;
   else if(op==='search'){const all=(await pool.query('SELECT payload FROM qa_provider_intents')).rows.map(r=>r.payload);payload={data:all.filter(p=>String(query).includes(p.metadata.bookingRequestKey)),has_more:false};}
   else if(op==='cancel'){payload=(await pool.query("UPDATE qa_provider_intents SET payload=jsonb_set(payload,'{status}','\"canceled\"') WHERE id=$1 RETURNING payload",[id])).rows[0]?.payload;}
   else throw Error('Unexpected provider operation');res.json(payload||{});
  }catch(e){console.error(e);res.status(500).json({error:e.message});}});
  provider=await new Promise(r=>{const s=providerApp.listen(0,'127.0.0.1',()=>r(s));});provider.on('connection',s=>{providerSockets.add(s);s.on('close',()=>providerSockets.delete(s));});report.providerPort=provider.address().port;
  const configPath=path.join(owned,'config.json');fs.writeFileSync(configPath,JSON.stringify({url,provider:'http://127.0.0.1:'+provider.address().port,schema:schemaFile,bundle}),{mode:0o600});
  async function startWorker(){const child=fork(file,['--worker'],{cwd:root,env:{...safeEnv(),NODE_ENV:'production',TZ:'UTC',DOTENV_CONFIG_PATH:path.join(owned,'empty.env'),MEALSCOUT_HOST_ROUTE_PROOF:'1',MEALSCOUT_HOST_ROUTE_CONFIG:configPath},execArgv:[],silent:true});const w={child,logs:[],ready:null};workers.push(w);child.stdout.on('data',d=>w.logs.push(String(d)));child.stderr.on('data',d=>w.logs.push(String(d)));child.on('message',m=>{if(m.ready)w.ready=m;});await until(()=>{if(child.exitCode!==null)throw Error(w.logs.join(''));return w.ready;},'route worker readiness');report.workers.push(w.ready);return w;}
  fs.writeFileSync(path.join(owned,'empty.env'),'');for(let i=0;i<4;i++)await startWorker();
  async function seed(table,values){const payload={...values};for(const [k,c] of Object.entries(table)){if(!c?.notNull||c.default!==undefined||c.defaultFn||Object.hasOwn(payload,k))continue;payload[k]=c.primary?randomUUID():c.dataType==='date'?new Date():c.dataType==='number'?0:c.dataType==='boolean'?false:c.dataType==='json'?{}:c.enumValues?.[0]||'qa_fixture';}return (await db.insert(table).values(payload).returning())[0];}
  const host=await seed(schema.hosts,{id:randomUUID(),userId:randomUUID(),name:'QA route host',city:'Chicago',state:'IL'});
  const baseDay=new Date(Date.now()+14*86400000);baseDay.setUTCHours(0,0,0,0);let day=0;
  async function event(extra={},date){return seed(schema.events,{id:randomUUID(),hostId:host.id,name:'QA native route',date:date||new Date(baseDay.getTime()+(day++)*86400000),eventType:'parking_pass',status:'open',requiresPayment:true,maxTrucks:1,hardCapEnabled:true,startTime:'06:00',endTime:'23:59',dailyPriceCents:1500,weeklyPriceCents:10000,lunchPriceCents:1500,...extra});}
  async function actor(extra={}){const user=await seed(schema.users,{id:randomUUID(),email:'qa-'+randomUUID()+'@example.invalid',emailVerified:true,userType:'food_truck',...extra.user});const truck=await seed(schema.restaurants,{id:randomUUID(),ownerId:user.id,name:'QA route truck',isFoodTruck:true,businessType:'food_truck',insuranceVerified:true,insuranceExpiresAt:new Date(Date.now()+365*86400000),...extra.truck});await pool.query('INSERT INTO qa_authority VALUES($1,$2,$3,$4)',[truck.id,user.id,'manageParkingPass',extra.authorized!==false]);return{user,truck};}
  async function request(w,a,e,key=randomUUID(),extra={}){const r=await fetch('http://127.0.0.1:'+w.ready.port+'/api/parking-pass/'+e.id+'/book',{method:'POST',headers:{'Content-Type':'application/json','X-QA-User':a.user.id,'Idempotency-Key':key},body:JSON.stringify({truckId:a.truck.id,slotType:'daily',...extra}),signal:AbortSignal.timeout(25000)});return{status:r.status,body:await r.json()};}
  const count=async(sql,args=[])=>(await pool.query(sql,args)).rows[0].n;
  const effects=()=>count('SELECT count(*)::int n FROM qa_provider_intents');
  const active=e=>count("SELECT count(*)::int n FROM event_bookings WHERE event_id=$1 AND status IN ('pending','confirmed')",[e.id]);
  const history=async(id)=>(await pool.query('SELECT row_to_json(b) row FROM event_bookings b WHERE id=$1',[id])).rows[0]?.row;
  await test('four distinct OS processes register the actual booking route',async()=>{assert.equal(new Set(report.workers.map(w=>w.pid)).size,4);assert.ok(report.workers.every(w=>w.pid!==process.pid));return{pids:report.workers.map(w=>w.pid)};});
  await test('sixteen distinct trucks contend for one actual-route slot',async()=>{const e=await event(),actors=await Promise.all(Array.from({length:16},()=>actor())),before=await effects();const replies=await Promise.all(actors.map((a,i)=>request(workers[i%4],a,e)));assert.equal(replies.filter(r=>r.status===200).length,1,JSON.stringify(replies));assert.ok(replies.every(r=>[200,400,409].includes(r.status)));assert.equal(await active(e),1);assert.equal(await effects()-before,1);return{requests:16,statuses:replies.map(r=>r.status),activeBookings:1,providerOperations:1};});
  await test('capacity three admits exactly three different trucks',async()=>{const e=await event({maxTrucks:3}),actors=await Promise.all(Array.from({length:12},()=>actor())),before=await effects();const replies=await Promise.all(actors.map((a,i)=>request(workers[i%4],a,e)));assert.equal(replies.filter(r=>r.status===200).length,3,JSON.stringify(replies));assert.equal(await active(e),3);assert.equal(await effects()-before,3);return{requests:12,activeBookings:3,providerOperations:3};});
  await test('concurrent same-reference retries and process restart do not repeat operations',async()=>{const a=await actor(),e=await event(),key=randomUUID(),before=await effects();const replies=await Promise.all(Array.from({length:8},(_,i)=>request(workers[i%4],a,e,key)));assert.ok(replies.some(r=>r.status===200),JSON.stringify(replies));assert.ok(replies.every(r=>r.status===200||(r.status===409&&r.body.code==='request_in_progress')),JSON.stringify(replies));assert.equal(await active(e),1);assert.equal(await effects()-before,1);const first=replies.find(r=>r.status===200);await stop(workers[0]);workers[0]=await startWorker();const replay=await request(workers[0],a,e,key);assert.deepEqual(replay,first);assert.equal(await effects()-before,1);return{requests:9,activeBookings:1,providerOperations:1,restartedPid:workers[0].ready.pid};});
  for(const [name,config,status,code] of [['unverified email',{user:{emailVerified:false}},409,'truck_verification_required'],['unverified insurance',{truck:{insuranceVerified:false}},409,'truck_verification_required'],['expired insurance',{truck:{insuranceExpiresAt:new Date(Date.now()-86400000)}},409,'truck_verification_required'],['non-truck business',{truck:{isFoodTruck:false,businessType:'restaurant'}},403,null],['missing manageParkingPass capability',{authorized:false},403,null]])await test(name+' creates neither hold nor provider operation',async()=>{const a=await actor(config),e=await event(),before=await effects();const replies=await Promise.all(workers.slice(0,4).map(w=>request(w,a,e)));assert.ok(replies.every(r=>r.status===status&&(!code||r.body.code===code)),JSON.stringify(replies));assert.equal(await active(e),0);assert.equal(await effects(),before);return{statuses:replies.map(r=>r.status),activeBookings:0,providerOperations:0};});
  await test('revoked authority blocks cached response across another process',async()=>{const a=await actor(),e=await event(),key=randomUUID();const first=await request(workers[1],a,e,key);assert.equal(first.status,200,JSON.stringify(first));const before=await effects();await pool.query('UPDATE qa_authority SET allowed=false WHERE truck_id=$1',[a.truck.id]);const replay=await request(workers[2],a,e,key);assert.equal(replay.status,403);assert.equal(replay.body.code,'booking_replay_forbidden');assert.equal(await effects(),before);return{status:replay.status,additionalOperations:0};});
  await test('cancelled booking history survives a successful rebooking',async()=>{const a=await actor(),e=await event();const old=await seed(schema.eventBookings,{id:randomUUID(),eventId:e.id,truckId:a.truck.id,hostId:host.id,hostPriceCents:1500,platformFeeCents:1000,totalCents:2500,status:'cancelled',stripePaymentStatus:'cancelled',cancellationReason:'qa retained terminal history',cancelledAt:new Date()});const before=await history(old.id);const r=await request(workers[2],a,e);assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(await history(old.id),before);assert.equal(await active(e),1);return{terminalRowPreserved:true,activeBookings:1};});
  await test('actual route does not cancel an old paid pending hold on another date',async()=>{const a=await actor(),past=await event(),next=await event();const old=await seed(schema.eventBookings,{id:randomUUID(),eventId:past.id,truckId:a.truck.id,hostId:host.id,hostPriceCents:1500,platformFeeCents:1000,totalCents:2500,status:'pending',stripePaymentStatus:'succeeded',stripePaymentIntentId:'pi_qa_paid_existing',paidAt:new Date(Date.now()-15*60000),createdAt:new Date(Date.now()-20*60000)});const before=await history(old.id);const r=await request(workers[3],a,next);assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(await history(old.id),before,'Paid booking history/state changed by the actual route');return{paidHoldUnchanged:true};});
  await test('a full second date rolls back all multi-day holds and makes no provider call',async()=>{const a=await actor(),other=await actor(),first=await event(),second=await event();await seed(schema.eventBookings,{id:randomUUID(),eventId:second.id,truckId:other.truck.id,hostId:host.id,hostPriceCents:1500,platformFeeCents:1000,totalCents:2500,status:'confirmed'});const before=await effects();const r=await request(workers[1],a,first,randomUUID(),{slotType:'weekly',selectedDates:[first.date.toISOString().slice(0,10),second.date.toISOString().slice(0,10)]});assert.equal(r.status,400,JSON.stringify(r));assert.equal(await active(first),0);assert.equal(await active(second),1);assert.equal(await effects(),before);return{status:400,firstDateHolds:0,existingSecondDateHolds:1,providerOperations:0};});
  await test('death after provider operation recovers through another process without another create',async()=>{const a=await actor(),e=await event(),key=randomUUID(),before=await effects();pauseCreate=true;const failed=request(workers[0],a,e,key).catch(()=>null);await until(async()=>await effects()===before+1,'provider operation committed');workers[0].child.kill('SIGKILL');await until(()=>workers[0].child.signalCode!==null,'killed worker');pauseCreate=false;for(const s of providerSockets)s.destroy();await failed;await pool.query("UPDATE idempotency_keys SET locked_until=now()-interval '1 second' WHERE idem_key=$1",[key]);const callsBefore=await count("SELECT count(*)::int n FROM qa_provider_calls WHERE operation='create'");const recovered=await request(workers[2],a,e,key);assert.equal(recovered.status,200,JSON.stringify(recovered));assert.ok(recovered.body.paymentIntentId);assert.equal(await effects()-before,1);assert.equal(await count("SELECT count(*)::int n FROM qa_provider_calls WHERE operation='create'"),callsBefore);assert.equal(await active(e),1);return{status:200,providerOperations:1,additionalCreateCalls:0,activeBookings:1};});
  report.result=report.cases.every(c=>c.result==='pass')?'pass':'fail';
 } catch(e){report.result='fail';report.harnessFailure=e.stack||String(e);} finally {
  for(const w of workers){try{await stop(w);}catch(e){report.cleanup.workerFailure=String(e);}fs.writeFileSync(path.join(out,'worker-'+w.child.pid+'.log'),w.logs.join(''));}
  if(provider){for(const s of providerSockets)s.destroy();await new Promise(r=>provider.close(r));}
  if(pool)await pool.end();
  if(pgStarted){try{execFileSync(path.join(bin,'pg_ctl'),['-D',path.join(owned,'data'),'-m','immediate','-w','stop'],{stdio:'pipe'});report.cleanup.postgresStopped=true;}catch(e){report.cleanup.postgresStopFailure=String(e);}}
  if(fs.existsSync(path.join(owned,'postgres.log')))fs.copyFileSync(path.join(owned,'postgres.log'),path.join(out,'postgres.log'));
  if(!report.cleanup.postgresStopFailure&&!report.cleanup.workerFailure){fs.rmSync(owned,{recursive:true,force:true});report.cleanup.ownedDirectoryRemoved=true;}
  report.finalSourceClean=git('rev-parse','HEAD')===source&&git('status','--porcelain')==='';if(!report.finalSourceClean||report.cleanup.postgresStopFailure||report.cleanup.workerFailure)report.result='fail';
  report.finishedAt=new Date().toISOString();report.passed=report.cases.filter(c=>c.result==='pass').length;report.failed=report.cases.filter(c=>c.result==='fail').length;
  fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(report,null,2)+'\n');log({receipt:report});
  process.exitCode=report.result==='pass'?0:1;
 }
}
