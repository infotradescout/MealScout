// Actual request/storage helper with in-memory browser adapters; no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../client/src/lib/parking-booking-request.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const scope={userId:'qa-user',truckId:'qa-truck',passId:'qa-pass'};
const body=()=>({truckId:scope.truckId,slotTypes:['lunch'],selectedDates:['2026-10-01'],applyCreditsCents:123,promoCode:'QA'});
function setup(){
  const rows=new Map();let ids=0;
  const store={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
  const context={exports:{},window:{sessionStorage:store},crypto:{randomUUID:()=>`qa-${++ids}`},Date,URLSearchParams,Uint8Array};
  vm.runInNewContext(code,context);
  return {api:context.exports,context,store,rows};
}
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS parking request: '+name);}
test('empty storage does not invent a request',()=>{const {api}=setup();assert.equal(api.loadParkingBookingRequest(scope),null);});
test('input and identity are persisted before use',()=>{const {api,rows}=setup();const request=api.prepareParkingBookingRequest(scope,body());assert.equal(rows.size,1);assert.deepEqual(JSON.parse([...rows.values()][0]),JSON.parse(JSON.stringify(request)));});
test('changed UI inputs cannot replace an unresolved request',()=>{const {api}=setup();const a=api.prepareParkingBookingRequest(scope,body());const b=api.prepareParkingBookingRequest(scope,{...body(),promoCode:'CHANGED'});assert.equal(b.requestId,a.requestId);assert.equal(b.body.promoCode,'QA');});
test('caller mutation cannot change saved input',()=>{const {api}=setup();const input=body();api.prepareParkingBookingRequest(scope,input);input.slotTypes.push('dinner');assert.deepEqual(Array.from(api.loadParkingBookingRequest(scope).body.slotTypes),['lunch']);});
for(const field of ['userId','truckId','passId'])test('storage identity isolates '+field,()=>{const {api}=setup();api.prepareParkingBookingRequest(scope,body());assert.equal(api.loadParkingBookingRequest({...scope,[field]:'other'}),null);});
test('stale acknowledgement cannot erase a newer identity',()=>{const {api}=setup();const request=api.prepareParkingBookingRequest(scope,body());api.clearParkingBookingRequest(scope,'wrong-id');assert.equal(api.loadParkingBookingRequest(scope).requestId,request.requestId);});
test('matching acknowledgement clears only that request',()=>{const {api}=setup();const request=api.prepareParkingBookingRequest(scope,body());api.clearParkingBookingRequest(scope,request.requestId);assert.equal(api.loadParkingBookingRequest(scope),null);});
for(const age of [23*60*60*1000,24*60*60*1000,-1000])test('unsafe replay age is refused: '+age,()=>{const {api}=setup();const request=api.prepareParkingBookingRequest(scope,body());assert.throws(()=>api.assertParkingBookingReplayAge(request,request.createdAt+age),/too old/);});
test('recent replay is allowed',()=>{const {api}=setup();const request=api.prepareParkingBookingRequest(scope,body());assert.doesNotThrow(()=>api.assertParkingBookingReplayAge(request,request.createdAt+1000));});
test('expired preparation never rotates into a fresh identity',()=>{const {api,rows}=setup();api.prepareParkingBookingRequest(scope,body());const key=[...rows.keys()][0];const value=JSON.parse(rows.get(key));value.createdAt=Date.now()-24*60*60*1000;rows.set(key,JSON.stringify(value));assert.throws(()=>api.prepareParkingBookingRequest(scope,body()),/too old/);assert.equal(JSON.parse(rows.get(key)).requestId,value.requestId);});
test('corrupt saved JSON blocks new preparation',()=>{const {api,rows}=setup();api.prepareParkingBookingRequest(scope,body());rows.set([...rows.keys()][0],'{');assert.throws(()=>api.prepareParkingBookingRequest(scope,body()),/unreadable/);});
test('identity mismatch blocks a tampered receipt',()=>{const {api}=setup();const row=api.prepareParkingBookingRequest(scope,body());assert.throws(()=>api.validateParkingBookingRequest({...row,userId:'other'},scope),/could not be read/);});
for(const field of ['clientSecret','payment_intent_client_secret'])test('payment secrets are not accepted in stored inputs: '+field,()=>{const {api}=setup();assert.throws(()=>api.prepareParkingBookingRequest(scope,{...body(),[field]:'not-a-real-secret'}),/invalid/);});
test('storage read denial is explicit',()=>{const {api,store}=setup();store.getItem=()=>{throw new Error('blocked');};assert.throws(()=>api.prepareParkingBookingRequest(scope,body()),/storage is unavailable/);});
test('storage quota denial blocks preparation',()=>{const {api,store}=setup();store.setItem=()=>{throw new Error('quota');};assert.throws(()=>api.prepareParkingBookingRequest(scope,body()),/storage is unavailable/);});
test('silent storage write failure is detected',()=>{const {api,store}=setup();store.setItem=()=>{};assert.throws(()=>api.prepareParkingBookingRequest(scope,body()),/storage is unavailable/);});
test('window storage getter failure does not escape as an unexplained crash',()=>{const {api,context}=setup();Object.defineProperty(context.window,'sessionStorage',{get(){throw new Error('denied');}});assert.throws(()=>api.loadParkingBookingRequest(scope),/storage is unavailable/);});
test('non-secure browser UUID fallback uses cryptographic random bytes',()=>{const {api,context}=setup();context.crypto={getRandomValues:value=>value.fill(10)};const request=api.prepareParkingBookingRequest(scope,body());assert.equal(request.requestId,'0a'.repeat(16));});
test('empty account cannot create a request',()=>{const {api}=setup();assert.throws(()=>api.prepareParkingBookingRequest({...scope,userId:''},body()),/Sign in/);});
console.log(`PASS ${passed} Parking Pass request storage/policy tests.`);
