// Executes the real modal's recovery branch with a navigation sink. No browser,
// Stripe or HTTP substitutes are presented as full end-to-end evidence.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'../..'),file='client/src/components/booking-payment-modal.tsx';
const source=fs.readFileSync(path.join(root,file),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length,0);const branches=[];
function visit(n){if(ts.isIfStatement(n)&&n.expression.getText(ast)==='data?.bookingRecovery === true')branches.push(n.getText(ast));ts.forEachChild(n,visit);}visit(ast);assert.equal(branches.length,1);
const compiled=ts.transpileModule('function recover(data,truckId){'+branches[0]+'; return "ordinary";} globalThis.run=recover;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
let count=0;
function test(name,fn){fn();count++;console.log('PASS recovered navigation: '+name);}
function invoke(data){const destinations=[],scope={URLSearchParams,window:{location:{assign:href=>destinations.push(href)}}};vm.runInNewContext(compiled,scope);const value=scope.run(data,'qa-truck');return{destinations,value};}
for(const outcome of ['confirmed','pending','credited'])test(outcome+' uses existing status page and excludes secrets',()=>{const r=invoke({bookingRecovery:true,paymentIntentId:'pi_existing',bookingStartDate:'2030-01-03',outcome,clientSecret:'not-in-url',redirect:'https://example.invalid'});assert.equal(r.destinations.length,1);const url=new URL(r.destinations[0],'http://localhost');assert.equal(url.pathname,'/parking-pass');assert.equal(url.searchParams.get('payment_intent'),'pi_existing');assert.equal(url.searchParams.get('truckId'),'qa-truck');assert.equal(url.searchParams.get('date'),'2030-01-03');assert.equal(url.searchParams.get('booking'),'success');assert.ok(!url.href.includes('secret'));assert.ok(!url.href.includes('example.invalid'));});
for(const paymentIntentId of [null,'','https://example.invalid'])test('invalid recovered reference stays in recovery: '+paymentIntentId,()=>assert.throws(()=>invoke({bookingRecovery:true,paymentIntentId})));
test('malformed date is not propagated',()=>{const r=invoke({bookingRecovery:true,paymentIntentId:'pi_existing',bookingStartDate:'not-a-date'});assert.equal(new URL(r.destinations[0],'http://localhost').searchParams.has('date'),false);});
test('ordinary setup still reaches existing payment handling',()=>{const r=invoke({paymentIntentId:'pi_existing',clientSecret:'qa'});assert.equal(r.value,'ordinary');assert.equal(r.destinations.length,0);});
console.log('PASS '+count+' recovered booking navigation checks.');
