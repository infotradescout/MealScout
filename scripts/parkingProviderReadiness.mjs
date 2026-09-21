/** Deployment-time Stripe evidence. Live credentials permit GET requests only.
 * Sandbox writes are restricted to an unconfirmed PaymentIntent, its identical
 * idempotent replay, retrieval and cancellation. No confirmation/capture/refund,
 * customer mutation, payment method or real-money transaction is performed.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Stripe from 'stripe';
const digest=value=>createHash('sha256').update(String(value)).digest('hex');
const mode=key=>/^(sk|rk)_test_/.test(key)?'test':/^(sk|rk)_live_/.test(key)?'live':'unknown';
const allowedHosts=new Set(['mealscout.onrender.com','mealscout.us','www.mealscout.us']);
export async function inspectParkingProvider({environment=process.env,fetchImpl=fetch,createProvider=key=>new Stripe(key,{timeout:10000,maxNetworkRetries:0}),nonce=randomUUID()}={}){
 const source=String(environment.RENDER_GIT_COMMIT||'');assert.match(source,/^[a-f0-9]{40}$/);
 const report={schemaVersion:1,source,kind:'provider-connectivity-and-unconfirmed-sandbox-probe',startedAt:new Date().toISOString(),liveMutationCalls:0,customerPaymentAcceptance:false};
 const liveKey=String(environment.STRIPE_SECRET_KEY||'').trim();
 const sandboxCandidates=[environment.STRIPE_TEST_SECRET_KEY,environment.STRIPE_SANDBOX_SECRET_KEY,liveKey].map(x=>String(x||'').trim());
 const testKey=sandboxCandidates.find(key=>mode(key)==='test')||'';
 report.config={primaryCredentialPresent:Boolean(liveKey),primaryCredentialMode:liveKey?mode(liveKey):'missing',sandboxCredentialPresent:Boolean(testKey),webhookSecretPresent:Boolean(String(environment.STRIPE_WEBHOOK_SECRET||'').trim())};
 const read=async(route,key)=>{const response=await fetchImpl('https://api.stripe.com'+route,{method:'GET',headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok)throw Object.assign(Error('Provider read unavailable'),{status:response.status});return response.json();};
 if(liveKey&&mode(liveKey)!=='unknown'){
  try{const account=await read('/v1/account',liveKey);assert.match(String(account.id||''),/^acct_/);report.primary={authenticated:true,credentialMode:mode(liveKey),accountFingerprint:digest(account.id),chargesEnabled:account.charges_enabled===true,payoutsEnabled:account.payouts_enabled===true};}
  catch(error){report.primary={authenticated:false,httpStatus:Number.isInteger(error.status)?error.status:null,error:'Provider authentication/account read could not be verified'};}
  try{const page=await read('/v1/webhook_endpoints?limit=100',liveKey);assert.ok(Array.isArray(page.data));const matches=page.data.filter(endpoint=>{try{const url=new URL(endpoint.url);return url.protocol==='https:'&&allowedHosts.has(url.hostname)&&url.pathname==='/api/stripe/webhook';}catch{return false;}});report.webhookConfiguration={completePage:page.has_more===false,matchingEndpoints:matches.length,enabledMatchingEndpoints:matches.filter(e=>e.status==='enabled').length,paymentSuccessConfigured:matches.some(e=>e.status==='enabled'&&(e.enabled_events?.includes('*')||e.enabled_events?.includes('payment_intent.succeeded'))),remoteDeliveryProven:false};}
  catch(error){report.webhookConfiguration={verified:false,httpStatus:Number.isInteger(error.status)?error.status:null,remoteDeliveryProven:false};}
 }else report.primary={authenticated:false,reason:liveKey?'unsupported_credential_format':'not_configured'};
 if(testKey){
  // Never substitute the primary LIVE key for absent sandbox credentials.
  assert.equal(mode(testKey),'test');
  const provider=createProvider(testKey),key='mealscout-sandbox-probe:'+digest(source+':'+nonce);
  const input={amount:2500,currency:'usd',payment_method_types:['card'],metadata:{purpose:'mealscout_unconfirmed_provider_probe',source,probeReference:digest(key)}};
  const sandbox={credentialMode:'test',createRequests:0,confirmed:false,captured:false,result:'running'};report.sandbox=sandbox;let id;
  try{
   sandbox.createRequests++;const first=await provider.paymentIntents.create(input,{idempotencyKey:key});id=first.id;
   assert.equal(first.livemode,false);assert.equal(first.status,'requires_payment_method');assert.equal(first.amount,2500);assert.equal(first.currency,'usd');
   sandbox.createRequests++;const replay=await provider.paymentIntents.create(input,{idempotencyKey:key});assert.equal(replay.id,id);assert.equal(replay.livemode,false);
   const retrieved=await provider.paymentIntents.retrieve(id);assert.equal(retrieved.id,id);assert.equal(retrieved.livemode,false);assert.equal(retrieved.amount_received,0);assert.equal(retrieved.amount_capturable,0);assert.equal(retrieved.metadata.probeReference,input.metadata.probeReference);
   const cancelled=await provider.paymentIntents.cancel(id,{cancellation_reason:'abandoned'},{idempotencyKey:key+':cancel'});assert.equal(cancelled.id,id);assert.equal(cancelled.livemode,false);assert.equal(cancelled.status,'canceled');
   const final=await provider.paymentIntents.retrieve(id);assert.equal(final.status,'canceled');assert.equal(final.amount_received,0);
   sandbox.result='pass';sandbox.sameIntentOnReplay=true;sandbox.distinctIntentIds=1;sandbox.intentId=id;sandbox.finalStatus=final.status;sandbox.amountReceived=0;
  }catch(error){sandbox.result='fail';sandbox.error='Sandbox contract assertion or provider request failed';sandbox.httpStatus=Number.isInteger(error.statusCode)?error.statusCode:null;
   if(id){try{const existing=await provider.paymentIntents.retrieve(id);if(existing.livemode===false&&existing.status==='requires_payment_method'){await provider.paymentIntents.cancel(id,{cancellation_reason:'abandoned'},{idempotencyKey:key+':cancel'});sandbox.cleanup='unconfirmed_sandbox_intent_cancelled';}else sandbox.cleanup=existing.status==='canceled'?'already_cancelled':'manual_sandbox_review_required';}catch{sandbox.cleanup='unverified';}}
   else sandbox.cleanup='no_confirmed_intent_identity';
  }
 }else report.sandbox={result:'not_run',reason:'No sandbox credential is available. A live credential is never used for synthetic payment writes.'};
 report.result=report.primary.authenticated&&report.sandbox.result==='pass'&&report.webhookConfiguration?.paymentSuccessConfigured===true?'pass':report.primary.authenticated?'partial':'unavailable';
 report.scope='Live API authentication and endpoint configuration are read-only. Sandbox proof, when available, covers provider transport/idempotency without charging. This does not prove real customer checkout, settlement or remote webhook delivery.';
 report.finishedAt=new Date().toISOString();return report;
}
