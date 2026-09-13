import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

test("analytics reconcile independent facts across summaries, dates and exports", async () => {
  process.env.DATABASE_URL = "postgresql://audit:audit@127.0.0.1:1/disposable_not_connected";
  const { createAnalyticsRepository } = await import("../server/storage/analyticsRepository");
  const pg = new PGlite();
  try {
    await pg.exec(`
      create table deals(id varchar primary key, restaurant_id varchar, title varchar);
      create table deal_views(id varchar primary key, deal_id varchar, viewed_at timestamp);
      create table deal_claims(id varchar primary key, deal_id varchar, claimed_at timestamp, used_at timestamp, is_used boolean, order_amount numeric);
      insert into deals values ('d1','owner','Sauces'), ('d2','owner','No views'), ('d3','other','Other business');
      insert into deal_views values ('v1','d1','2026-09-01'),('v2','d1','2026-09-01'),('v3','d1','2026-09-02'),('v4','d1','2026-08-01');
      insert into deal_claims values
      ('c1','d1','2026-08-20','2026-09-02',true,20),
      ('c2','d1','2026-09-01','2026-09-03',true,10),
      ('c3','d2','2026-09-01','2026-09-03',true,5),
      ('c4','d1','2026-08-01','2026-08-01',true,100),
      ('c5','d3','2026-09-01','2026-09-01',true,999),
      ('c6','d1','2026-09-01',null,false,999);
    `);
    const repo = createAnalyticsRepository(drizzle(pg));
    const range={start:new Date('2026-09-01T00:00:00Z'),end:new Date('2026-09-04T00:00:00Z')};
    const summary=await repo.getRestaurantAnalyticsSummary('owner',range);
    assert.equal(Number(summary.totalViews),3);
    assert.equal(Number(summary.totalClaims),3);
    assert.equal(Number(summary.totalRevenue),35);
    assert.equal(summary.topDeals.find((d:any)=>d.dealId==='d1').revenue,30);
    const days=await repo.getRestaurantAnalyticsTimeseries('owner',range,'day');
    assert.deepEqual(days,[
      {date:'2026-09-01',views:2,claims:0,revenue:0},
      {date:'2026-09-02',views:1,claims:1,revenue:20},
      {date:'2026-09-03',views:0,claims:2,revenue:15},
    ]);
    const exported=await repo.getRestaurantAnalyticsExport('owner',range);
    assert.equal(exported.reduce((n:number,r:any)=>n+r.revenue,0),35);
    assert.equal(exported.reduce((n:number,r:any)=>n+r.views,0),3);
    assert.ok(exported.some((r:any)=>r.dealTitle==='No views' && r.revenue===5));
    assert.deepEqual(await repo.getRestaurantAnalyticsSummary('missing',range),{
      totalViews:0,totalClaims:0,totalRevenue:0,conversionRate:0,topDeals:[],
    });
  } finally { await pg.close(); }
});
