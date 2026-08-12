import { readFileSync } from "node:fs";

const app = readFileSync("client/src/App.tsx", "utf8");
const page = readFileSync("client/src/pages/profile-setup.tsx", "utf8");

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
  app,
  'const ProfileSetupPage = lazy(() => import("@/pages/profile-setup"));',
  "MealScout profile setup page must lazy-load as its own page.",
);
requireIncludes(
  app,
  '<Route path="/profile-setup" component={ProfileSetupPage} />',
  "MealScout profile setup page must be available at /profile-setup.",
);
requireIncludes(
  app,
  '"/profile-setup"',
  "MealScout profile setup page must be treated as a public route.",
);

for (const requiredCopy of [
  "Your food profile, built for hungry customers.",
  "Create your complete MealScout Profile for free",
  "Most simple done-for-you",
  "A restaurant website tells people you exist.",
  "A MealScout Profile helps people decide what to eat.",
  "For restaurants, food trucks, bakeries, caterers, meal prep sellers, pop-ups, farmers market vendors, and online food brands.",
  "Complete MealScout Profile",
  "Done-For-You Setup",
  "Custom Setup Service",
  "Square One Brand Package",
  "Use the AI you already have",
  "Any free or paid AI can prepare your profile",
  "the owner can consent in that chat",
  "approve, apply, and publish it through MealScout",
  "Availability may vary by category, location, vendor, and",
  "offer.",
]) {
  requireIncludes(page, requiredCopy, `Profile setup page missing required copy: ${requiredCopy}`);
}

for (const requiredMechanic of [
  'Link href="/restaurant-signup"',
  "mailto:support@mealscout.us?subject=MealScout%20Done-For-You%20Profile%20Setup",
  "Large menus",
  "Food trucks with rotating schedules",
  "Online food sellers",
  "Marketing and affiliate tools where available",
]) {
  requireIncludes(
    page,
    requiredMechanic,
    `Profile setup page missing required offer mechanic: ${requiredMechanic}`,
  );
}

for (const staleOrRiskyCopy of [
  "websites for restaurants",
  "confirmed discounts",
  "guaranteed discounts",
]) {
  requireExcludes(
    page,
    staleOrRiskyCopy,
    `Profile setup page must avoid stale or risky copy: ${staleOrRiskyCopy}`,
  );
}

console.log("mealscout-profile-setup-page.contract: PASS");
