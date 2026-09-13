import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { events, eventInterests } from "../shared/schema";
import { createModelTable } from "./support/auditDatabase";

test("all interest decisions share event capacity and terminal retries do not add seats", async () => {
  process.env.DATABASE_URL="postgresql://audit:audit@127.0.0.1:1/disposable_not_connected";
  const {createHostsEventsRepository}=await import("../server/storage/hostsEventsRepository");
  const pg=new PGlite();const database=drizzle(pg);
  try {
    for (const table of [events,eventInterests]) await pg.exec(createModelTable(table));
    await database.insert(events).values({id:"event",hostId:"host",date:new Date(),startTime:"12:00",endTime:"14:00",maxTrucks:1,hardCapEnabled:true});
    const repo=createHostsEventsRepository(database);
    await assert.rejects(repo.createEventInterest({eventId:"event",truckId:"bypass",status:"accepted"}),(error:any)=>error.status===400);
    const first=await repo.createEventInterest({eventId:"event",truckId:"a"});
    const second=await repo.createEventInterest({eventId:"event",truckId:"b"});
    const results=await Promise.allSettled([repo.updateEventInterestStatus(first.id,"accepted"),repo.updateEventInterestStatus(second.id,"accepted")]);
    assert.equal(results.filter((r)=>r.status==="fulfilled").length,1);
    const accepted=(await database.select().from(eventInterests)).filter((r)=>r.status==="accepted");
    assert.equal(accepted.length,1);
    assert.equal((await repo.updateEventInterestStatus(accepted[0].id,"accepted")).status,"accepted");
    await repo.updateEventInterestStatus(accepted[0].id,"declined");
    const other=accepted[0].id===first.id?second:first;
    assert.equal((await repo.updateEventInterestStatus(other.id,"accepted")).status,"accepted");
  } finally {await pg.close();}
});
