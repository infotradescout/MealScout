import { readFileSync } from "node:fs";

const continuationService = readFileSync("server/services/loginContinuation.ts", "utf8");
const restaurantSignup = readFileSync("client/src/pages/restaurant-signup.tsx", "utf8");

const requiredContinuationSnippets = [
  'nextRequiredStep = "menu";',
  'continuationPath = "/menu-builder";',
  'nextRequiredStep = "schedule";',
  'continuationPath = "/restaurant-owner-dashboard?setup=schedule";',
  'nextRequiredStep = "verification";',
  'reason = "Verification details are still missing, but setup can continue.";',
];

for (const snippet of requiredContinuationSnippets) {
  if (!continuationService.includes(snippet)) {
    throw new Error(`Missing continuation non-blocking verification snippet: ${snippet}`);
  }
}

const menuStepIndex = continuationService.indexOf('nextRequiredStep = "menu";');
const verificationStepIndex = continuationService.indexOf('nextRequiredStep = "verification";');
if (menuStepIndex < 0 || verificationStepIndex < 0 || verificationStepIndex < menuStepIndex) {
  throw new Error("Verification must not be prioritized before menu completion in continuation order");
}

if (!restaurantSignup.includes('data-testid="button-skip-verification"')) {
  throw new Error("Restaurant signup must expose non-blocking verification skip/continue action");
}

console.log("business-onboarding-verification-order.contract: PASS");
