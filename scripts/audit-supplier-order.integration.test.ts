import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { suppliers, supplierProducts, supplierRequests, supplierRequestItems, supplierOrders, supplierOrderItems } from "../shared/schema";
import { acceptSupplierRequest, transitionSupplierOrder, updateSupplierDelivery, SupplierOrderError } from "../server/services/supplierOrderAuthority";
import { createModelTable } from "./support/auditDatabase";

test("supplier acceptance creates one priced order and enforces fulfillment authority", async () => {
  const pg = new PGlite();
  const database = drizzle(pg);
  try {
    for (const table of [suppliers, supplierProducts, supplierRequests, supplierRequestItems, supplierOrders, supplierOrderItems]) {
      await pg.exec(createModelTable(table));
    }
    await database.insert(suppliers).values({id:"supplier", userId:"seller", businessName:"Farm", onlinePaymentsEnabled:true});
    await database.insert(supplierProducts).values({id:"product",supplierId:"supplier",name:"Crate",priceCents:1200});
    const fixture = async (id: string, productId="product") => {
      await database.insert(supplierRequests).values({id,supplierId:"supplier",buyerUserId:"buyer",paymentPreference:"online"});
      await database.insert(supplierRequestItems).values({requestId:id,productId,quantity:2});
    };
    const input = { supplierId:"supplier", userId:"seller", haversineMiles:()=>0,
      computeFees:(gross:number)=>({platformBaseFeeCents:100,platformFeeCents:100,stripeFeeEstimateCents:0,
        msProcessingFeeCents:0,processingTotalCents:0,buyerProcessingFeeCents:0,sellerProcessingFeeCents:0,totalCents:gross+100}) };
    await fixture("request");
    const results = await Promise.allSettled([
      acceptSupplierRequest(database,{...input,requestId:"request"}),
      acceptSupplierRequest(database,{...input,requestId:"request"}),
    ]);
    assert.equal(results.filter((result)=>result.status==="fulfilled").length,1);
    const orders = await database.select().from(supplierOrders);
    assert.equal(orders.length,1);
    assert.equal(orders[0].subtotalCents,2400);
    assert.equal(orders[0].totalCents,2500);
    assert.equal(orders[0].buyerUserId,"buyer");
    const transition = (status:"submitted"|"ready"|"completed"|"cancelled")=>transitionSupplierOrder(database,{supplierId:"supplier",orderId:orders[0].id,status});
    await assert.rejects(transition("ready"),SupplierOrderError);
    await assert.rejects(transition("completed"),SupplierOrderError);
    await database.update(supplierOrders).set({paymentStatus:"paid"}).where(eq(supplierOrders.id,orders[0].id));
    await transition("ready");
    await assert.rejects(transition("cancelled"),SupplierOrderError);
    await transition("completed");
    await assert.rejects(transition("submitted"),SupplierOrderError);
    assert.equal((await transition("completed")).status,"completed");
    await fixture("invalid","missing-product");
    await assert.rejects(acceptSupplierRequest(database,{...input,requestId:"invalid"}),SupplierOrderError);
    assert.equal((await database.select().from(supplierOrders)).length,1);
    assert.equal((await database.select().from(supplierRequests).where(eq(supplierRequests.id,"invalid")))[0].status,"submitted");
    await fixture("offsite");
    await database.update(supplierRequests).set({paymentPreference:"offsite"}).where(eq(supplierRequests.id,"offsite"));
    const {order} = await acceptSupplierRequest(database,{...input,requestId:"offsite"});
    await transitionSupplierOrder(database,{supplierId:"supplier",orderId:order.id,status:"ready"});
    const completed = await transitionSupplierOrder(database,{supplierId:"supplier",orderId:order.id,status:"completed"});
    assert.equal(completed.paymentStatus,"offsite");
    await assert.rejects(transitionSupplierOrder(database,{supplierId:"outsider",orderId:order.id,status:"cancelled"}),SupplierOrderError);
    await fixture("delivery");
    await database.update(suppliers).set({offersDelivery:true}).where(eq(suppliers.id,"supplier"));
    await database.update(supplierRequests).set({requestedFulfillment:"delivery"}).where(eq(supplierRequests.id,"delivery"));
    const delivery=await acceptSupplierRequest(database,{...input,requestId:"delivery"});
    const updateDelivery=(deliveryStatus:"pending"|"accepted"|"out_for_delivery"|"delivered"|"cancelled")=>
      updateSupplierDelivery(database,{supplierId:"supplier",requestId:"delivery",deliveryStatus});
    await assert.rejects(updateDelivery("out_for_delivery"),SupplierOrderError);
    await assert.rejects(updateDelivery("delivered"),SupplierOrderError);
    await assert.rejects(updateSupplierDelivery(database,{supplierId:"supplier",requestId:"delivery",deliveryFeeCents:99}),SupplierOrderError);
    await database.update(supplierOrders).set({paymentStatus:"paid"}).where(eq(supplierOrders.id,delivery.order.id));
    await updateDelivery("out_for_delivery");
    await updateDelivery("delivered");
    assert.equal((await database.select().from(supplierOrders).where(eq(supplierOrders.id,delivery.order.id)))[0].status,"completed");
    await assert.rejects(updateDelivery("pending"),SupplierOrderError);
    await assert.rejects(updateDelivery("cancelled"),SupplierOrderError);
    assert.equal((await updateDelivery("delivered")).updated.deliveryStatus,"delivered");
  } finally { await pg.close(); }
});
