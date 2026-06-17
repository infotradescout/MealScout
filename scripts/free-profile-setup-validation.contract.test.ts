import { readFileSync } from "node:fs";

const readText = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const apiClient = readText("client/src/lib/api.ts");
const signupPage = readText("client/src/pages/restaurant-signup.tsx");
const signupRoute = readText("server/routes/restaurantSignupRoutes.ts");
const publicProfileContract = readText(
  "scripts/public-profile-route-and-assets.contract.test.ts",
);
const truckMenuGateContract = readText(
  "scripts/truck-menu-owner-approval-gate.contract.test.ts",
);

const requireIncludes = (source: string, snippet: string, message: string) => {
  if (!source.includes(snippet)) {
    throw new Error(message);
  }
};

const requireExcludes = (source: string, snippet: string, message: string) => {
  if (source.includes(snippet)) {
    throw new Error(message);
  }
};

requireIncludes(
  signupPage,
  'name="password"',
  "Restaurant signup account creation form must keep a visible password field.",
);
requireIncludes(
  signupPage,
  'name="confirmPassword"',
  "Restaurant signup account creation form must keep a visible confirm-password field.",
);
requireIncludes(
  signupPage,
  "password: signupData.password",
  "Create Free Profile payload must explicitly include password when creating a new account.",
);
requireIncludes(
  signupPage,
  'data-testid="checkbox-terms"',
  "Free profile setup must keep the Terms checkbox gate.",
);
requireIncludes(
  signupPage,
  'Link href="/terms-of-service"',
  "Free profile setup must link to Terms of Service.",
);
requireIncludes(
  signupPage,
  'Link href="/privacy-policy"',
  "Free profile setup must link to Privacy Policy.",
);
requireIncludes(
  signupPage,
  "getSafeFreeProfileErrorMessage(",
  "Free profile setup must sanitize technical error strings before showing a toast.",
);
requireIncludes(
  signupPage,
  'lower.includes("invalid_type")',
  "Free profile setup must suppress raw Zod invalid_type errors in UI copy.",
);

requireIncludes(
  apiClient,
  'normalizedPath.startsWith("/api/truck-claims")',
  "Truck claim onboarding calls must stay same-origin on MealScout hosts.",
);
requireIncludes(
  apiClient,
  'normalizedPath === "/api/restaurants/signup"',
  "Create Free Profile submission must stay same-origin on MealScout hosts.",
);
requireIncludes(
  apiClient,
  "/^\\/api\\/restaurants\\/[^/]+\\/verification\\/request",
  "Business verification submission must stay same-origin on MealScout hosts.",
);

requireIncludes(
  signupRoute,
  "Create a password to finish your free profile.",
  "Restaurant signup route must return a human-readable password requirement message.",
);
requireIncludes(
  signupRoute,
  "Please complete the required fields.",
  "Restaurant signup route must return a human-readable generic validation message.",
);
requireIncludes(
  signupRoute,
  "restaurantSignupUserSchema.safeParse",
  "Restaurant signup route must validate free-profile user data without throwing raw Zod errors.",
);
requireIncludes(
  signupRoute,
  ".safeParse(restaurantData || {})",
  "Restaurant signup route must safely validate restaurant profile payloads.",
);
requireExcludes(
  signupRoute,
  'message: error.message || "Failed to create restaurant account"',
  "Restaurant signup route must not forward raw thrown messages to end users.",
);

requireIncludes(
  publicProfileContract,
  'console.log("public-profile-route-and-assets.contract: PASS");',
  "Public profile contract coverage must remain present.",
);
requireIncludes(
  truckMenuGateContract,
  'console.log("truck-menu-owner-approval-gate.contract: PASS");',
  "Truck menu owner approval gate coverage must remain present.",
);

console.log("free-profile-setup-validation.contract: PASS");
