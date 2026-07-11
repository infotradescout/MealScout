import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMealScoutEventInput, emitMealScoutEvent, type MealScoutEventInput } from "../server/services/merlinEventEmitter";

type FetchCall = {
  url: string;
  init: RequestInit;
};

function withMockFetch(
  handler: (call: FetchCall) => { status: number; body?: Record<string, unknown> }
): void {
  (globalThis as any).fetch = async (url: string | URL, init?: RequestInit) => {
    const call: FetchCall = { url: String(url), init: init || {} };
    const result = handler(call);
    return new Response(JSON.stringify(result.body || {}), {
      status: result.status,
      headers: { "Content-Type": "application/json" }
    });
  };
}

test("MealScout emitter is skipped when MERLIN_OR_ENABLED is not true", async () => {
  process.env.MERLIN_OR_ENABLED = "false";
  process.env.MERLIN_OR_EVENTS_URL = "http://localhost:3030/api/events/mealscout";
  const event: MealScoutEventInput = {
    entity_id: "restaurant-001",
    event_type: "restaurant_onboarded"
  };
  const result = await emitMealScoutEvent(event);
  assert.equal(result.skipped, true);
  assert.equal(result.emitted, false);
});

test("MealScout emitter posts when enabled", async () => {
  process.env.MERLIN_OR_ENABLED = "true";
  process.env.MERLIN_OR_EVENTS_URL = "https://merlin.local/api/events/mealscout";

  let observed = false;
  withMockFetch((call) => {
    observed = true;
    assert.equal(call.url, process.env.MERLIN_OR_EVENTS_URL);
    assert.equal(call.init.method, "POST");
    assert.equal(
      call.init.headers && typeof call.init.headers === "object" ? (call.init.headers as Record<string, string>)["Content-Type"] : undefined,
      "application/json"
    );
    return { status: 200 };
  });

  const event = buildMealScoutEventInput({
    entity_id: "restaurant-001",
    event_type: "restaurant_onboarded",
    restaurant: {
      id: "restaurant-001",
      name: "Taco Bay",
      city: "Baton Rouge",
      county: "East Baton Rouge"
    }
  });

  const result = await emitMealScoutEvent(event);
  assert.equal(result.emitted, true);
  assert.equal(result.skipped, false);
  assert.equal(observed, true);
});

test("MealScout emitter returns false without throwing when post fails", async () => {
  process.env.MERLIN_OR_ENABLED = "true";
  process.env.MERLIN_OR_EVENTS_URL = "https://merlin.local/api/events/mealscout";

  withMockFetch(() => ({ status: 500, body: { error: "failed" } }));
  const event = buildMealScoutEventInput({
    entity_id: "restaurant-001",
    event_type: "online_order_completed"
  });
  const result = await emitMealScoutEvent(event);
  assert.equal(result.emitted, false);
  assert.equal(result.skipped, false);
});

test("MealScout event shape includes required fields", async () => {
  process.env.MERLIN_OR_ENABLED = "true";
  process.env.MERLIN_OR_EVENTS_URL = "https://merlin.local/api/events/mealscout";

  let seenBody = false;
  withMockFetch((call) => {
    const bodyText = String(call.init.body || "{}");
    const body = JSON.parse(bodyText) as {
      entity_id: string;
      event_type: string;
      origin_surface: string;
      observed_at: string;
    };
    assert.equal(body.entity_id, "restaurant-001");
    assert.equal(body.event_type, "menu_updated");
    assert.equal(body.origin_surface, "mealscout");
    assert.equal(typeof body.observed_at, "string");
    seenBody = true;
    return { status: 200 };
  });

  const event = buildMealScoutEventInput({
    entity_id: "restaurant-001",
    event_type: "menu_updated"
  });
  const result = await emitMealScoutEvent(event);
  assert.equal(result.emitted, true);
  assert.equal(seenBody, true);
});
