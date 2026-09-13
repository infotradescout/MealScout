import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { suppliers, supplierOrders, supplierRequests } from "../shared/schema";
import { transitionSupplierOrder } from "../server/services/supplierOrderAuthority";
import { createModelTable } from "./support/auditDatabase";

test("supplier payment handler blocks cancellation races and reuses one provider intent", async () => {
  process.env.DATABASE_URL="postgresql://audit:audit@127.0.0.1:1/disposable_not_connected";
  process.env.NODE_ENV="production";
  const {registerSupplierPaymentRoutes}=await import("../server/routes/suppliers/paymentsRoutes");
  const pg=new PGlite();const database=drizzle(pg);
  let newIntents=0;
  const byKey=new Map<string,any>();const byId=new Map<string,any>();
  let pause: (()=>Promise<void>)|undefined;
  const provider:any={paymentIntents:{
    create:async(params:any,options:any)=>{
      assert.ok(options.idempotencyKey);
      if(pause) await pause();
      if(byKey.has(options.idempotencyKey))return byKey.get(options.idempotencyKey);
      const intent={...params,id:`pi_mock_${++newIntents}`,client_secret:"mock-only-secret",status:"requires_payment_method"};
      byKey.set(options.idempotencyKey,intent);byId.set(intent.id,intent);return intent;
    },
    retrieve:async(id:string)=>{assert.ok(byId.has(id));return byId.get(id);},
    cancel:async(id:string)=>{assert.notEqual(byId.get(id).status,"canceled","already-cancelled intents cannot be cancelled again");byId.get(id).status="canceled";},
  }};
  const getHandler=(connection:any=database)=>{
    let handler:any;
    registerSupplierPaymentRoutes({post:(_path:string,...handlers:any[])=>{handler=handlers.at(-1);}} as any,{
      database:connection,stripe:provider,computeAchCheaperThresholdCents:()=>50000,
      computeOnPlatformPaymentFees:(gross:number)=>({platformBaseFeeCents:100,platformFeeCents:100,stripeFeeEstimateCents:0,
        msProcessingFeeCents:0,processingTotalCents:0,buyerProcessingFeeCents:0,sellerProcessingFeeCents:0,totalCents:gross+100}),
    });return handler;
  };
  const call=async(handler:any,id:string,body:any={},userId="buyer")=>{
    let status=200;let payload:any;
    const response={status:(code:number)=>{status=code;return response;},json:(body:any)=>{payload=body;return response;}};
    await handler({params:{orderId:id},user:{id:userId,userType:"customer"},body},response);
    return {status,payload};
  };
  const fixture=async(id:string,status="submitted")=>database.insert(supplierOrders).values({
    id,supplierId:"supplier",buyerUserId:"buyer",status,paymentMethod:"stripe",paymentStatus:"unpaid",
    subtotalCents:1000,totalCents:1100,stripeChargeAmountCents:1100,stripeTransferAmountCents:1000,stripeApplicationFeeCents:100,
  });
  try {
    for(const table of [suppliers,supplierOrders,supplierRequests])await pg.exec(createModelTable(table));
    await database.insert(suppliers).values({id:"supplier",userId:"seller",businessName:"Farm",onlinePaymentsEnabled:true,
      stripeConnectAccountId:"acct_mock",stripeChargesEnabled:true,stripePayoutsEnabled:true});
    const handler=getHandler();
    for(const status of ["cancelled","completed"]){await fixture(status,status);assert.equal((await call(handler,status)).status,409);}
    assert.equal(newIntents,0);
    await fixture("normal");
    assert.equal((await call(handler,"normal",{},"outsider")).status,403);
    for(const promoCode of ["TEST1","FREE100"])assert.equal((await call(handler,"normal",{promoCode})).status,403);
    assert.equal(newIntents,0);
    const concurrent=await Promise.all([call(handler,"normal"),call(handler,"normal")]);
    assert.equal(concurrent[0].status,200);assert.equal(concurrent[1].status,200);
    assert.equal(concurrent[0].payload.paymentIntentId,concurrent[1].payload.paymentIntentId);assert.equal(newIntents,1);
    await fixture("race");
    let started!:()=>void;let release!:()=>void;
    const providerStarted=new Promise<void>((resolve)=>{started=resolve;});
    const gate=new Promise<void>((resolve)=>{release=resolve;});
    pause=async()=>{started();await gate;};
    const payment=call(handler,"race");await providerStarted;
    const cancel=transitionSupplierOrder(database,{orderId:"race",supplierId:"supplier",status:"cancelled"});
    const rejected=assert.rejects(cancel);release();assert.equal((await payment).status,200);await rejected;pause=undefined;
    assert.equal((await database.select().from(supplierOrders).where(eq(supplierOrders.id,"race")))[0].status,"submitted");
    await fixture("lost");let rejectCommit=true;
    const failCommit={transaction:(work:any)=>database.transaction(async(tx:any)=>{
      const value=await work(tx);if(rejectCommit){rejectCommit=false;throw new Error("simulated commit failure");}return value;
    })};
    const failingHandler=getHandler(failCommit);const before=newIntents;
    assert.equal((await call(failingHandler,"lost")).status,500);
    assert.equal((await database.select().from(supplierOrders).where(eq(supplierOrders.id,"lost")))[0].stripePaymentIntentId,null);
    assert.equal((await call(failingHandler,"lost")).status,200);assert.equal(newIntents,before+1);
    await fixture("switch");
    const original=await call(handler,"switch",{paymentMethod:"card"});
    const beforeSwitch=newIntents;rejectCommit=true;
    assert.equal((await call(failingHandler,"switch",{paymentMethod:"ach"})).status,500);
    assert.equal(byId.get(original.payload.paymentIntentId).status,"canceled");
    const retried=await call(failingHandler,"switch",{paymentMethod:"ach"});
    assert.equal(retried.status,200);assert.equal(newIntents,beforeSwitch+1);
    byId.get(retried.payload.paymentIntentId).status="succeeded";
    assert.equal((await call(handler,"switch",{paymentMethod:"card"})).status,409);
    assert.equal(newIntents,beforeSwitch+1);
  } finally {await pg.close();}
});
