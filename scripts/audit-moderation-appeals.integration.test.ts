import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { moderationCases, moderationResolutions, moderationAppeals } from "../shared/schema";
import { createModelTable } from "./support/auditDatabase";

test("only case participants can appeal and replay creates a single appeal", async () => {
  process.env.DATABASE_URL="postgresql://audit:audit@127.0.0.1:1/disposable_not_connected";
  const { createModerationService } = await import("../server/moderationService");
  const pg=new PGlite(); const database=drizzle(pg);
  try {
    for (const table of [moderationCases,moderationResolutions,moderationAppeals]) await pg.exec(createModelTable(table));
    await pg.exec("create table restaurants (id varchar primary key, owner_id varchar); create table restaurant_user_recommendations (id varchar primary key, user_id varchar);");
    await pg.exec("insert into restaurants values ('business','owner'); insert into restaurant_user_recommendations values ('recommendation','author');");
    const service=createModerationService(database);
    const fixture=async(id:string,eligible=true)=>{
      await database.insert(moderationCases).values({id,caseType:"recommendation_flag",flagId:"flag",reporterId:"reporter",status:"resolved",restaurantId:"business",recommendationId:"recommendation"});
      await database.insert(moderationResolutions).values({id,caseId:id,outcome:"valid",reasonCode:"genuine_violation",appealEligible:eligible});
    };
    await fixture("case");
    await assert.rejects(service.appealDecision("case","outsider","I disagree"),(error:any)=>error.status===403);
    assert.equal((await database.select().from(moderationCases).where(eq(moderationCases.id,"case")))[0].status,"resolved");
    const ids=await Promise.all([service.appealDecision("case","reporter","Review evidence"),service.appealDecision("case","reporter","Retry")]);
    assert.equal(ids[0],ids[1]);
    assert.equal((await database.select().from(moderationAppeals)).length,1);
    await assert.rejects(service.appealDecision("case","owner","Different appeal"),(error:any)=>error.status===409);
    for (const actor of ["owner","author"]) { await fixture(actor); assert.ok(await service.appealDecision(actor,actor,"Review evidence")); }
    await fixture("ineligible",false);
    await assert.rejects(service.appealDecision("ineligible","reporter","Review evidence"),(error:any)=>error.status===409);
  } finally { await pg.close(); }
});
