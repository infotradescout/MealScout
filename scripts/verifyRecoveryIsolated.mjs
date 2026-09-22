import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// An ordinary anonymous fetch must see the current public key too. No cookies,
// authorization, QA headers, key disclosure, or provider submissions here.
if (process.env.MEAL_HOST_INDEXNOW_MODE === "observe" && process.env.MEAL_HOST_INDEXNOW_EXPECTED_KEY_SHA256) {
  const origin = "https://www.mealscout.us";
  const options = () => ({ redirect: "error", signal: AbortSignal.timeout(20000) });
  const robots = await fetch(origin + "/robots.txt", options());
  assert.equal(robots.status, 200);
  const keyLocation = /^IndexNow:\s*(https:\/\/\S+)\s*$/mi.exec(await robots.text())?.[1];
  assert(keyLocation);
  const url = new URL(keyLocation);
  assert.equal(url.origin, origin);
  assert.equal(url.search, ""); assert.equal(url.hash, "");
  const key = /^\/([A-Za-z0-9-]{8,128})\.txt$/.exec(url.pathname)?.[1];
  assert(key);
  assert.equal(createHash("sha256").update(key).digest("hex"), process.env.MEAL_HOST_INDEXNOW_EXPECTED_KEY_SHA256, "Public verification metadata has not switched to the expected key");
  const file = await fetch(keyLocation, options());
  assert.equal(file.status, 200);
  assert.match(file.headers.get("content-type") || "", /^text\/plain/i);
  assert.equal((await file.text()).trim(), key);
  console.log("INDEXNOW_ANONYMOUS_VERIFICATION " + JSON.stringify({at:new Date().toISOString(),status:200,expectedKeyMatches:true,authenticationUsed:false,diagnosticBypassHeaders:false}));
}

// Explicit modes preserve existing recovery and already completed acquisition work.
if (process.env.MEAL_HOST_INDEXNOW_MODE) {
  await import("./verifyHostIndexNowDelivery.mjs");
} else if (process.env.MEAL_RETAINED_TAINT_PROOF === "1") {
  await import("./verifyRetainedJourneyTaints.mjs");
} else if (process.env.MEAL_TRAFFIC_DASHBOARD_OBSERVE) {
  await import("./observeTrafficQualityDashboard.mjs");
} else if (process.env.MEAL_TRAFFIC_DASHBOARD_SHA) {
  await import("./verifyTrafficQualityDashboard.mjs");
} else if (process.env.MEALSCOUT_ACQUISITION_PROOF === "1") {
  await import("./verifyAcquisitionSignals.mjs");
} else {
  await import("./verifyRecoveryIsolatedOriginal.mjs");
}
