/** Real request-logging middleware, with isolated request/DB dependencies. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const filename = process.env.REQUEST_LOGGING_SOURCE || "server/index.ts";
const content = readFileSync(filename, "utf8");
const parsed = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const marker = content.indexOf("// Request logging for admin reporting (skip static assets)");
assert.ok(marker >= 0, "Existing request-logging owner must remain identifiable");
const statements = parsed.statements.filter((statement) =>
  ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
  statement.expression.expression.getText(parsed) === "app.use" &&
  statement.getStart(parsed) > marker && statement.getText(parsed).includes(".insert(requestLogs)") &&
  statement.getText(parsed).includes('res.on("finish"'));
assert.equal(statements.length, 1, "Use the existing unique middleware, not a replacement model");
const callback = statements[0].expression.arguments[0].getText(parsed);
const compiled = ts.transpileModule(`module.exports = ${callback};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function exercise({ available = true, pathname = "/scout", reject = false } = {}) {
  const writes = [];
  const errors = [];
  const table = {};
  const failure = new Error("isolated insert rejection");
  const db = available ? { insert(actual) {
    assert.equal(actual, table);
    return { values(value) {
      writes.push(value);
      return reject ? Promise.reject(failure) : Promise.resolve();
    }};
  }} : undefined;
  const module = { exports: null };
  vm.runInNewContext(compiled, {
    module, db, requestLogs: table, crypto, Date,
    console: { error: (...args) => errors.push(args) },
    deriveActorType: () => "human",
    deriveSourceType: () => "direct",
    classifyRequestEventType: () => "page_view",
    inferRequestSurface: () => "discovery",
    extractRestaurantEntity: () => ({ entityId: null, entityType: null }),
  }, { timeout: 2000 });
  const request = {
    method: "GET", originalUrl: pathname, url: pathname,
    user: { id: "fixture-user" }, sessionID: "fixture-session", ip: "127.0.0.1",
    cookies: { visitor_id: "fixture-visitor" }, query: { city: "fixture-city" },
    get: (key) => key === "user-agent" ? "FixtureBrowser/1.0" : key === "referer" ? "https://example.test/" : undefined,
  };
  let nextCalls = 0;
  let finish;
  module.exports(request, { statusCode: 200, on(event, callback) {
    assert.equal(event, "finish"); finish = callback;
  }}, () => { nextCalls++; });
  assert.equal(nextCalls, 1, "Normal request handling must always continue");
  assert.equal(typeof finish, "function");
  return { finish, writes, errors, request, failure };
}

test("missing optional database cannot crash after a response finishes", () => {
  const result = exercise({ available: false });
  assert.doesNotThrow(() => result.finish());
  assert.equal(result.writes.length, 0);
});

test("available database retains the existing request record and actor fields", async () => {
  const result = exercise();
  result.finish();
  await Promise.resolve();
  assert.equal(result.writes.length, 1);
  const row = result.writes[0];
  assert.equal(row.method, "GET");
  assert.equal(row.path, "/scout");
  assert.equal(row.statusCode, 200);
  assert.equal(row.userId, "fixture-user");
  assert.equal(row.sessionId, "fixture-session");
  assert.equal(row.actorType, "human");
  assert.equal(row.sourceType, "direct");
  assert.equal(row.eventType, "page_view");
  assert.equal(row.surface, "discovery");
  assert.equal(row.ip, "127.0.0.1");
  assert.equal(row.userAgent, "FixtureBrowser/1.0");
  assert.equal(row.entityId, null);
  assert.equal(row.entityType, null);
  assert.equal(row.metadata.query, result.request.query);
  assert.equal(row.metadata.referrer, "https://example.test/");
  assert.ok(row.durationMs >= 0);
  assert.ok(row.createdAt instanceof Date);
  const expectedActor = crypto.createHash("sha256")
    .update("fixture-user|FixtureBrowser/1.0|fixture-visitor").digest("hex").slice(0, 20);
  assert.equal(row.anonymousActorId, expectedActor);
  assert.equal(result.errors.length, 0);
});

test("static assets remain excluded from request logging", () => {
  const result = exercise({ pathname: "/assets/application.js" });
  result.finish();
  assert.equal(result.writes.length, 0);
});

test("a rejected insert remains observed without an unhandled rejection", async () => {
  const result = exercise({ reject: true });
  assert.doesNotThrow(() => result.finish());
  await Promise.resolve();
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0][0], "Failed to write request log:");
  assert.equal(result.errors[0][1], result.failure);
});


// Execute the actual mobile-smoke script with bounded HTTP fixtures. Correct
// anonymous denial is not a successful authenticated owner journey.
async function exerciseMobileSmoke(overrides = {}) {
  const filename = "scripts/mobileDeepLinkSmoke.ts";
  const actual = readFileSync(filename, "utf8");
  assert.equal(actual.split("main().catch((err) => {").length, 2);
  const instrumented = actual.replace("main().catch((err) => {", "globalThis.finished = main().catch((err) => {");
  const code = ts.transpileModule(instrumented, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const fixtureProcess = { env: { SMOKE_BASE_URL: "http://127.0.0.1:5100" }, exitCode: 0,
    exit(code) { this.exitCode = code; } };
  const visited = [];
  const output = [];
  const context = {
    process: fixtureProcess, AbortSignal,
    console: { log: (...args) => output.push(args.join(" ")), error: (...args) => output.push(args.join(" ")) },
    fetch: async (url) => {
      const pathname = new URL(url).pathname;
      visited.push(pathname);
      const defaults = pathname === "/p/food-truck/test-profile-id/test-profile-slug"
        ? { status: 404, body: '{"error":"Profile not found"}' }
        : pathname === "/restaurant-owner-dashboard"
          ? { status: 401, body: '{"error":"Not authenticated"}' }
          : { status: 200, body: '<!doctype html><html><body>Public application shell</body></html>' };
      const selected = { ...defaults, ...overrides[pathname] };
      if (selected.throw) throw new Error("Isolated network failure");
      return { status: selected.status, ok: selected.status >= 200 && selected.status < 300,
        text: async () => selected.body };
    },
  };
  vm.runInNewContext(code, context, { timeout: 2000 });
  await context.finished;
  return { status: fixtureProcess.exitCode, visited, output: output.join("\n") };
}

test("anonymous deep links require five public shells plus actual 404/401 boundaries", async () => {
  const result = await exerciseMobileSmoke();
  assert.equal(result.status, 0, result.output);
  assert.equal(result.visited.length, 7);
  assert.match(result.output, /passed \(7 routes\)/);
});

for (const [label, pathname, override] of [
  ["nonexistent profile must not silently become a public shell", "/p/food-truck/test-profile-id/test-profile-slug", { status: 200, body: "<!doctype html><html>Wrong catch-all</html>" }],
  ["anonymous owner page must not expose an application document", "/restaurant-owner-dashboard", { status: 200, body: "<!doctype html><html>Private owner content</html>" }],
  ["server failure is not an authorization denial", "/restaurant-owner-dashboard", { status: 500 }],
  ["valid public route must not return an API object", "/scout", { body: '{"unexpected":"json"}' }],
  ["valid public route must not become missing", "/scout", { status: 404 }],
  ["network failure cannot pass", "/scout", { throw: true }],
]) {
  test(`mobile routing contract: ${label}`, async () => {
    const result = await exerciseMobileSmoke({ [pathname]: override });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Mobile deep-link smoke failed/);
  });
}
