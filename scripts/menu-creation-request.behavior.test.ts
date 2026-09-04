import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertMenuCreationReceipt,
  confirmMenuCreationAttempt,
  prepareMenuCreationAttempt,
} from "../client/src/lib/menu-creation-request";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}
const input = { restaurantId: randomUUID(), name: "The owner's original menu", serviceType: "all" };

test("failed or lost responses retain the same request across a new helper invocation", async () => {
  const storage = memoryStorage();
  const first = await prepareMenuCreationAttempt("owner", input, storage);
  const retried = await prepareMenuCreationAttempt("owner", { ...input }, storage);
  assert.equal(first.requestId, retried.requestId);
  assert.equal(storage.values.size, 1);
  assert.doesNotMatch([...storage.values.values()].join(""), /original menu/);
  assert.equal(retried.input.name, input.name);
});

test("an uncertain A, changed B, and retried A retain both original identities", async () => {
  const storage = memoryStorage();
  const first = await prepareMenuCreationAttempt("owner", input, storage);
  const second = await prepareMenuCreationAttempt("owner", { ...input, name: "Changed menu" }, storage);
  const retried = await prepareMenuCreationAttempt("owner", input, storage);
  assert.notEqual(first.requestId, second.requestId);
  assert.equal(retried.requestId, first.requestId);
  assert.equal(storage.values.size, 2);
  confirmMenuCreationAttempt(first, storage);
  assert.equal(storage.values.size, 1);
  assert.equal((await prepareMenuCreationAttempt("owner", { ...input, name: "Changed menu" }, storage)).requestId, second.requestId);
});

test("confirmation clears only that exact request and permits an intentional new menu", async () => {
  const storage = memoryStorage();
  const first = await prepareMenuCreationAttempt("owner", input, storage);
  confirmMenuCreationAttempt({ ...first, requestId: randomUUID() }, storage);
  assert.equal(storage.values.size, 1);
  confirmMenuCreationAttempt(first, storage);
  assert.equal(storage.values.size, 0);
  assert.notEqual((await prepareMenuCreationAttempt("owner", input, storage)).requestId, first.requestId);
});

test("pending request identity is scoped to both actor and business", async () => {
  const storage = memoryStorage();
  const first = await prepareMenuCreationAttempt("owner", input, storage);
  const otherActor = await prepareMenuCreationAttempt("other-owner", input, storage);
  const otherBusiness = await prepareMenuCreationAttempt("owner", { ...input, restaurantId: randomUUID() }, storage);
  assert.equal(new Set([first.requestId, otherActor.requestId, otherBusiness.requestId]).size, 3);
});

test("concurrent preparation shares one nonce and snapshots the submitted inputs", async () => {
  const storage = memoryStorage();
  const draft = { ...input };
  const attempts = await Promise.all(Array.from({ length: 6 }, () => prepareMenuCreationAttempt("owner", draft, storage)));
  draft.name = "Edited after submission";
  assert.equal(new Set(attempts.map((attempt) => attempt.requestId)).size, 1);
  assert.equal(attempts[0].input.name, input.name);
});

test("unavailable durable browser storage fails before submission", async () => {
  const unavailable = { getItem: () => null, setItem: () => { throw new Error("storage unavailable"); } };
  await assert.rejects(prepareMenuCreationAttempt("owner", input, unavailable), /storage unavailable/);
});

test("only an exact recorded receipt confirms completion", async () => {
  const attempt = await prepareMenuCreationAttempt("owner", input, memoryStorage());
  const receipt = { menu: { id: attempt.requestId, restaurantId: input.restaurantId }, lisaRecord: { id: attempt.requestId, status: "recorded" } };
  assert.doesNotThrow(() => assertMenuCreationReceipt(receipt, attempt));
  for (const invalid of [null, { menu: receipt.menu }, { ...receipt, lisaRecord: { ...receipt.lisaRecord, status: "pending" } }, { ...receipt, menu: { ...receipt.menu, id: randomUUID() } }, { ...receipt, menu: { ...receipt.menu, restaurantId: randomUUID() } }]) {
    assert.throws(() => assertMenuCreationReceipt(invalid, attempt), /could not be confirmed/);
  }
});

test("live route and browser consumer use the same atomic owner with existing gates", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const routes = read("server/routes/menuRoutes.ts");
  const page = read("client/src/pages/menu-builder.tsx");
  const api = read("client/src/lib/queryClient.ts");
  const create = routes.slice(routes.indexOf('["/api/owner/menus", "/api/owner/menus/create"]'), routes.indexOf("* PATCH /api/owner/menus/:menuId"));
  assert.match(create, /isAuthenticated,[\s\S]*canManageMenu,[\s\S]*createMenuWithLisaRecord/);
  assert.match(create, /req\.get\("Idempotency-Key"\)/);
  assert.doesNotMatch(create, /\.catch\(\(\) => \{\}\)|payload:|db\.insert/);
  assert.match(page, /apiRequest\("POST", "\/api\/owner\/menus\/create", attempt.input/);
  assert.match(page, /"Idempotency-Key": attempt.requestId/);
  assert.match(page, /assertMenuCreationReceipt\(payload, attempt\)/);
  assert.match(page, /confirmMenuCreationAttempt\(attempt\)/);
  assert.match(api, /credentials: "include"/);
  assert.match(api, /\.\.\.headers/);
  const publicSignals = read("server/routes.ts");
  assert.match(publicSignals, /source_heartbeat/);
  assert.doesNotMatch(publicSignals, /menuCreation|menu_created/);
});
