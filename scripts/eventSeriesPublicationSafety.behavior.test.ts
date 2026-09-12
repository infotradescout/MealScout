import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

// Execute the actual service with an in-memory query boundary. No database,
// environment credentials, or provider adapters are loaded by this test.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../server/services/eventSeriesPublicationService.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const names = ["eventBookings", "events", "eventSeries", "eventSeriesPublicationChildren", "eventSeriesPublicationOperations", "hosts", "users"];
  const tables: Record<string, any> = {};
  const rows: Record<string, any[]> = Object.fromEntries(names.map(name => [name, []]));
  for (const name of names) tables[name] = new Proxy({ name }, {
    get: (target, key) => key === "name" ? target.name : { table: name, key },
  });
  let transactionDepth = 0;
  let writes = 0;
  let beforeRead: ((table: string, locked: boolean) => void) | undefined;
  const db: any = {
    transaction: async (callback: any) => {
      transactionDepth++;
      try { return await callback(db); } finally { transactionDepth--; }
    },
    execute: async () => ({ rows: [] }),
    select: () => {
      let table = "";
      let predicate = (_row: any) => true;
      let locked = false;
      const query: any = {
        from: (value: any) => { table = value.name; return query; },
        where: (value: any) => { predicate = value; return query; },
        limit: () => query,
        orderBy: () => query,
        for: () => { assert.ok(transactionDepth > 0); locked = true; return query; },
        then: (resolve: any, reject: any) => Promise.resolve().then(() => {
          beforeRead?.(table, locked);
          return rows[table].filter(predicate).map(row => ({ ...row }));
        }).then(resolve, reject),
      };
      return query;
    },
    update: (table: any) => ({ set: (values: any) => ({ where: async (predicate: any) => {
      for (const row of rows[table.name].filter(predicate)) {
        if (["converged", "failed"].includes(row.status) && values.status && row.status !== values.status) {
          throw new Error("terminal event series publication cannot be reopened");
        }
        writes++;
        Object.assign(row, values);
      }
    } }) }),
    insert: () => { throw new Error("Unexpected publication insert"); },
  };
  const exports: any = {};
  const imports: Record<string, any> = {
    "@shared/schema": tables,
    "../db": { db },
    "drizzle-orm": {
      eq: (field: any, value: any) => (row: any) => row[field.key] === value,
      inArray: (field: any, values: any[]) => (row: any) => values.includes(row[field.key]),
      and: (...predicates: any[]) => (row: any) => predicates.every(predicate => predicate(row)),
      asc: (field: any) => field,
      sql: () => ({}),
    },
    "./dateKeys": {},
    "./openCallSeries": {},
    "./persistedServiceTimeZoneRules": {},
  };
  new Function("require", "exports", compiled)((name: string) => imports[name] ?? require(name), exports);
  return { service: exports, rows, db, writes: () => writes, onRead: (hook: typeof beforeRead) => { beforeRead = hook; } };
}

{
  const f = fixture();
  f.rows.eventSeries.push({ id: "paid-series", hostId: "host", seriesType: "parking_pass", status: "draft" });
  f.rows.hosts.push({ id: "host", userId: "owner" });
  f.rows.users.push({ id: "owner", isDisabled: false });
  await assert.rejects(f.service.prepareEventSeriesPublication({
    seriesId: "paid-series", actorUserId: "owner", requestId: "paid-request-1",
  }), (error: any) => error.code === "parking_pass_publication_requires_paid_workflow" && error.statusCode === 409);
  assert.equal(f.writes(), 0, "Paid publication must fail before any parent, child, or barrier write");
}

for (const terminal of ["converged", "failed"]) {
  const f = fixture();
  f.rows.eventSeries.push({ id: "series", seriesType: "open_call" });
  const parent = { id: "operation", seriesId: "series", status: "processing" };
  f.rows.eventSeriesPublicationOperations.push(parent);
  // Model another worker finishing before this caller acquires its parent lock.
  f.onRead((table, locked) => {
    if (table === "eventSeriesPublicationOperations" && locked && parent.status === "processing") {
      parent.status = terminal;
    }
  });
  const result = await f.service.resumeEventSeriesPublication({ operationId: "operation" });
  assert.equal(result.operation.status, terminal);
  assert.equal(f.writes(), 0, "A completed operation must not be reopened");
}

{
  const f = fixture();
  f.rows.eventSeries.push({ id: "series", seriesType: "open_call" });
  const first = { id: "first", seriesId: "series", status: "processing", recoveryClaimedBy: "worker" };
  f.rows.eventSeriesPublicationOperations.push(first, { id: "second", seriesId: "series", status: "converged" });
  f.db.execute = async () => ({ rows: [{ id: "first" }, { id: "second" }] });
  let injected = false;
  f.onRead(table => {
    if (table === "eventSeriesPublicationOperations" && !injected) {
      injected = true;
      first.status = "converged";
      throw new Error("Connection lost after another worker completed");
    }
  });
  const result = await f.service.reconcileEventSeriesPublications({ workerId: "worker" });
  assert.equal(first.status, "converged");
  assert.equal(result.examined, 2);
  assert.equal(result.converged, 1, "Recovery must continue to the next claimed operation");
  assert.equal(f.writes(), 0, "Failure handling must not downgrade a terminal operation");
}

{
  const f = fixture();
  f.rows.eventSeries.push({ id: "paid-series", seriesType: "parking_pass" });
  f.rows.eventSeriesPublicationOperations.push({ id: "old-operation", seriesId: "paid-series", status: "processing" });
  f.rows.eventSeriesPublicationChildren.push({ id: "unsafe-child", operationId: "old-operation", eventType: "event", requiresPayment: false });
  await assert.rejects(f.service.resumeEventSeriesPublication({ operationId: "old-operation" }),
    (error: any) => error.code === "parking_pass_publication_requires_paid_workflow");
  assert.equal(f.writes(), 0, "Legacy frozen free children for a paid series must remain unpublished");
}

console.log("Event series publication safety behavior checks passed");
