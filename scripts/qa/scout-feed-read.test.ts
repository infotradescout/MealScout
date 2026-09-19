import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readScoutFeed, ScoutFeedReadError } from "../../client/src/lib/scout-feed-read";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
for (const status of [401, 403, 404, 429, 500, 503]) {
  test(`discovery HTTP ${status} is a failed read, never an empty collection`, async () => {
    globalThis.fetch = async () => Response.json({}, { status });
    await assert.rejects(readScoutFeed("/api/fixture", null), (e: unknown) => e instanceof ScoutFeedReadError && e.status === status);
  });
}
for (const data of [[], [{ id: "qa" }], { trucks: [] }, { trucks: [{ id: "qa" }], generatedAt: "fixture" }]) {
  test(`successful discovery preserves the supplied collection: ${JSON.stringify(data)}`, async () => {
    globalThis.fetch = async (_url, init) => { assert.equal(init?.credentials, "include"); assert.ok(init?.signal); return Response.json(data); };
    assert.deepEqual(await readScoutFeed("/api/fixture", "trucks"), data);
  });
}
for (const data of [null, {}, "html", [null], ["wrong"], [{}], [{ id: "" }], [{ id: 12 }], { trucks: {} }, { trucks: [null] }]) {
  test(`malformed discovery is not reported as no nearby food: ${JSON.stringify(data)}`, async () => {
    globalThis.fetch = async () => Response.json(data);
    await assert.rejects(readScoutFeed("/api/fixture", "trucks"), (e: unknown) => e instanceof ScoutFeedReadError && e.status === null);
  });
}
test("transport failures remain retryable read failures", async () => {
  globalThis.fetch = async () => { throw new TypeError("Network unavailable"); };
  await assert.rejects(readScoutFeed("/api/fixture", null), ScoutFeedReadError);
});
test("query cancellation aborts the in-flight discovery read", async () => {
  const controller = new AbortController(); controller.abort();
  globalThis.fetch = async (_url, init) => { assert.equal(init?.signal?.aborted, true); throw new DOMException("Cancelled", "AbortError"); };
  await assert.rejects(readScoutFeed("/api/fixture", null, controller.signal), { name: "AbortError" });
});
