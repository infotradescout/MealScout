import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { registerMealScoutCountyMapRoutes } from "../server/routes/countyMapRuntimeRoutes";
import { createMealScoutCountyMapRuntime } from "../server/services/countyMapRuntime";

type CapturedRequest = {
  method: string | undefined;
  url: string;
  authorization: string | undefined;
  product: string | undefined;
  body: unknown;
};

type FakeRequest = {
  params: Record<string, string>;
  body?: Record<string, unknown>;
  get(name: string): string | undefined;
};

type FakeResponse = {
  status(code: number): FakeResponse;
  json(body: unknown): FakeResponse;
};

type ResponseState = { statusCode: number; body: unknown };
type RouteHandler = (
  request: FakeRequest,
  response: FakeResponse
) => void | Promise<void>;

class FakeApp {
  readonly getRoutes = new Map<string, RouteHandler>();
  readonly postRoutes = new Map<string, RouteHandler>();

  get(path: string, handler: RouteHandler): void {
    this.getRoutes.set(path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.postRoutes.set(path, handler);
  }
}

function request(
  params: Record<string, string>,
  token?: string,
  body?: Record<string, unknown>
): FakeRequest {
  return {
    params,
    body,
    get(name) {
      return name.toLowerCase() === "x-mealscout-county-sync-token"
        ? token
        : undefined;
    },
  };
}

async function invoke(
  handler: RouteHandler | undefined,
  req: FakeRequest
): Promise<ResponseState> {
  assert.ok(handler, "expected MealScout County-map route to be registered");
  const state: ResponseState = { statusCode: 200, body: null };
  const response: FakeResponse = {
    status(code) {
      state.statusCode = code;
      return response;
    },
    json(body) {
      state.body = body;
      return response;
    },
  };
  await handler(req, response);
  return state;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
    : null;
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return "http://127.0.0.1:" + address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

describe("MealScout County-map runtime", { concurrency: false }, () => {
  const productSecret = "mealscout-county-product-secret-proof";
  const syncToken = "mealscout-internal-county-sync-token-proof";
  const privateOrderId = "order-private-12345";
  const privateRestaurantId = "restaurant-private-12345";
  const captured: CapturedRequest[] = [];
  const previousEnvironment = {
    baseUrl: process.env.COUNTY_MAP_BASE_URL,
    productSecret: process.env.COUNTY_MAP_PRODUCT_SECRET,
    syncToken: process.env.MEALSCOUT_COUNTY_MAP_SYNC_TOKEN,
  };

  const countyServer = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      captured.push({
        method: req.method,
        url: req.url || "/",
        authorization: req.headers.authorization,
        product: typeof req.headers["x-county-map-product"] === "string"
          ? req.headers["x-county-map-product"]
          : undefined,
        body,
      });
      res.statusCode = req.method === "POST" ? 201 : 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.method === "POST"
            ? { accepted: true, event: body }
            : {
                records: [{
                  subjectType: "food-venue",
                  subjectId: "public-venue-1",
                  state: "verified",
                }],
              }
        )
      );
    })().catch(() => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: { code: "test_county_server_failure" } }));
    });
  });

  const runtime = createMealScoutCountyMapRuntime({
    loadCompletedPickupOrder: async (orderId) => {
      if (orderId === "order-not-completed-12345") {
        return {
          orderId,
          restaurantId: privateRestaurantId,
          orderType: "pickup",
          status: "ready",
          completedAt: null,
          merchantAcknowledgedAt: "2026-09-02T15:00:00.000Z",
          countyFips: "17031",
        };
      }
      if (orderId !== privateOrderId) return null;
      return {
        orderId,
        restaurantId: privateRestaurantId,
        orderType: "pickup",
        status: "completed",
        completedAt: "2026-09-02T16:00:00.000Z",
        merchantAcknowledgedAt: "2026-09-02T15:00:00.000Z",
        countyFips: "17031",
      };
    },
  });
  const app = new FakeApp();
  registerMealScoutCountyMapRoutes(app as never, runtime);
  const contextHandler = app.getRoutes.get(
    "/api/internal/county-map/context/:countyFips"
  );
  const completionHandler = app.postRoutes.get(
    "/api/internal/county-map/pickup-orders/:orderId/completion"
  );

  before(async () => {
    const countyBaseUrl = await listen(countyServer);
    process.env.COUNTY_MAP_BASE_URL = countyBaseUrl + "/api/v1";
    process.env.COUNTY_MAP_PRODUCT_SECRET = productSecret;
    process.env.MEALSCOUT_COUNTY_MAP_SYNC_TOKEN = syncToken;
  });

  after(async () => {
    if (countyServer.listening) await close(countyServer);
    for (const [name, value] of [
      ["COUNTY_MAP_BASE_URL", previousEnvironment.baseUrl],
      ["COUNTY_MAP_PRODUCT_SECRET", previousEnvironment.productSecret],
      ["MEALSCOUT_COUNTY_MAP_SYNC_TOKEN", previousEnvironment.syncToken],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("is registered with a database-level terminal pickup gate", () => {
    const routes = readFileSync(resolve(process.cwd(), "server/routes.ts"), "utf8");
    const service = readFileSync(
      resolve(process.cwd(), "server/services/countyMapRuntime.ts"),
      "utf8"
    );
    assert.ok(routes.includes(
      'import { registerMealScoutCountyMapRoutes } from "./routes/countyMapRuntimeRoutes";'
    ));
    assert.ok(routes.includes("registerMealScoutCountyMapRoutes(app);"));
    assert.ok(service.includes('eq(pickupOrders.orderType, "pickup")'));
    assert.ok(service.includes('eq(pickupOrders.status, "completed")'));
    assert.ok(service.includes("isNotNull(pickupOrders.completedAt)"));
  });

  it("rejects an unauthorized read before contacting County-map", async () => {
    const response = await invoke(
      contextHandler,
      request({ countyFips: "17031" })
    );
    assert.equal(response.statusCode, 401);
    assert.equal(captured.length, 0);
  });

  it("reads context and writes only a proven, privacy-minimized outcome", async () => {
    const context = await invoke(
      contextHandler,
      request({ countyFips: "17031" }, syncToken)
    );
    assert.equal(context.statusCode, 200);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await invoke(
        completionHandler,
        request(
          { orderId: privateOrderId },
          syncToken,
          { countyFips: "17031" }
        )
      );
      assert.equal(response.statusCode, 200);
    }

    const nonterminal = await invoke(
      completionHandler,
      request(
        { orderId: "order-not-completed-12345" },
        syncToken,
        { countyFips: "17031" }
      )
    );
    assert.equal(nonterminal.statusCode, 409);

    const countyMismatch = await invoke(
      completionHandler,
      request(
        { orderId: privateOrderId },
        syncToken,
        { countyFips: "06037" }
      )
    );
    assert.equal(countyMismatch.statusCode, 409);

    const writes = captured.filter((entry) => entry.method === "POST");
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0].body, writes[1].body);
    assert.equal(writes[0].authorization, "Bearer " + productSecret);
    assert.equal(writes[0].product, "mealscout");

    const event = writes[0].body as Record<string, any>;
    assert.equal(event.eventType, "mealscout.pickup.completed");
    assert.deepEqual(event.visibility, { level: "source-product" });
    assert.deepEqual(event.data, {
      state: "completed",
      serviceMode: "pickup",
      countyMatch: "persisted",
      merchantAcknowledgementPresent: true,
    });
    assert.equal(event.subject.type, "food-order-outcome");
    assert.match(
      event.evidenceRefs[0],
      /^urn:mealscout:pickup-completion:[a-f0-9]{40}$/
    );

    const serialized = JSON.stringify(event).toLowerCase();
    for (const forbidden of [
      privateOrderId.toLowerCase(),
      privateRestaurantId.toLowerCase(),
      "customer",
      "item",
      "address",
      "payment",
      "subtotal",
      "totalcents",
      "email",
      "phone",
      productSecret.toLowerCase(),
      syncToken.toLowerCase(),
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });
});
