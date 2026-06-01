import { readFileSync } from "node:fs";

const navigation = readFileSync("client/src/components/navigation.tsx", "utf8");
const useAuth = readFileSync("client/src/hooks/useAuth.ts", "utf8");

const requiredNavigationSnippets = [
  "const sanitizeOwnerNavHref = (href: string) => {",
  "\"setup\", \"ref\", \"setupStep\", \"setupPanel\", \"onboarding\"",
  "href={sanitizeOwnerNavHref(item.path)}",
  "{ path: \"/scout\", icon: Compass, label: \"Scout\" }",
  "{ path: \"/parking-pass\", icon: ParkingSquare, label: \"Parking Pass\" }",
  "{ path: \"/orders\", icon: ShoppingCart, label: \"Orders\" }",
  "{ path: \"/kitchen\", icon: ChefHat, label: \"Kitchen\" }",
  "{ path: \"/share-hub\", icon: Share2, label: \"Share\" }",
];

for (const snippet of requiredNavigationSnippets) {
  if (!navigation.includes(snippet)) {
    throw new Error(`Missing owner navigation escape snippet: ${snippet}`);
  }
}

const requiredAuthSnippets = [
  "const hardBlockingStep =",
  "nextRequiredStep === \"account_onboarding\"",
  "nextRequiredStep === \"business_setup\"",
  "if (!hardBlockingStep) return;",
];

for (const snippet of requiredAuthSnippets) {
  if (!useAuth.includes(snippet)) {
    throw new Error(`Missing auth escape guard snippet: ${snippet}`);
  }
}

if (!useAuth.includes("if (!hardBlockingStep) return;")) {
  throw new Error("Continuation redirect is not gated by hard blocking step");
}

console.log("owner-dashboard-navigation-escape.contract: PASS");
