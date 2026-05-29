import assert from "node:assert/strict";
import { resolveEffectiveLocationContext } from "../server/services/sessionLocationContext";

type ReqLike = {
  session?: Record<string, any>;
};

const makeReq = (session: Record<string, any> = {}): ReqLike => ({ session });

(() => {
  const req = makeReq({
    adminMarketSelection: { marketKey: "mobile-al", city: "Mobile", state: "AL" },
    deviceLocationContext: {
      marketKey: "new-orleans-la",
      city: "New Orleans",
      state: "LA",
    },
  });
  const result = resolveEffectiveLocationContext(req, {
    userType: "super_admin",
    accountSettings: {},
  } as any);
  assert.equal(result.marketKey, "mobile-al");
  assert.equal(result.source, "admin_override");
})();

(() => {
  const req = makeReq({
    deviceLocationContext: {
      marketKey: "new-orleans-la",
      city: "New Orleans",
      state: "LA",
    },
  });
  const result = resolveEffectiveLocationContext(req, {
    userType: "food_truck",
    accountSettings: {},
  } as any);
  assert.equal(result.marketKey, "new-orleans-la");
  assert.equal(result.source, "session_device");
})();

(() => {
  const req = makeReq({});
  const result = resolveEffectiveLocationContext(req, {
    userType: "super_admin",
    accountSettings: {},
  } as any);
  assert.equal(result.marketKey, "pensacola-fl");
  assert.equal(result.source, "super_admin_default");
})();

(() => {
  const req = makeReq({});
  const result = resolveEffectiveLocationContext(req, {
    userType: "host",
    accountSettings: {
      defaultTerritory: {
        marketKey: "baton-rouge-la",
        city: "Baton Rouge",
        state: "LA",
      },
    },
  } as any);
  assert.equal(result.marketKey, "baton-rouge-la");
  assert.equal(result.source, "user_default");
})();

console.log("session-location-context.contract: PASS");
