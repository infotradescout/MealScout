import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const menu = read("client/src/pages/online-menu.tsx");
const checkout = read("client/src/pages/pickup-checkout.tsx");
const confirmation = read("client/src/pages/order-confirmation.tsx");
const app = read("client/src/App.tsx");
const topBar = read(
  "client/src/components/public-ordering/PublicOrderingTopBar.tsx",
);
const orderingJourney = `${menu}\n${checkout}\n${confirmation}\n${topBar}`;

test("public ordering uses the consumer shell instead of role navigation", () => {
  assert.doesNotMatch(menu, /import Navigation from/);
  assert.doesNotMatch(checkout, /import Navigation from/);
  assert.doesNotMatch(confirmation, /import Navigation from/);
  assert.match(menu, /data-public-menu-shell="warm-food-led"/);
  assert.match(checkout, /data-public-checkout-shell="warm-food-led"/);
  assert.match(confirmation, /data-public-order-status-shell="warm-food-led"/);
  assert.match(menu, /<PublicOrderingTopBar/);
  assert.match(checkout, /<PublicOrderingTopBar/);
  assert.match(confirmation, /<PublicOrderingTopBar/);
  assert.match(app, /currentPath\.startsWith\("\/menu\/"\)/);
  assert.match(app, /currentPath\.startsWith\("\/checkout\/"\)/);
  assert.match(app, /currentPath\.startsWith\("\/order-confirmation\/"\)/);
  assert.match(
    app,
    /if \(usesSelfContainedConsumerShell\)[\s\S]*<Router \/>[\s\S]*<\/TooltipProvider>/,
  );
  assert.match(topBar, />\s*Scout\s*</);
  assert.doesNotMatch(
    orderingJourney,
    /Open Scout|Scout nearby|Keep scouting|Back to Scout/,
  );
});

test("menu imagery is resilient and clearly labels representative photos", () => {
  assert.match(menu, /getDishCategoryPhoto\(item\.name, item\.description\)/);
  assert.match(menu, /onError=\{\(\) =>/);
  assert.match(menu, /Photo coming soon/);
  assert.match(menu, /imageMode === "primary"/);
});

test("unavailable menu items remain visible and cannot be added", () => {
  assert.doesNotMatch(menu, /filter\(\(i\) => i\.isAvailable\)/);
  assert.match(menu, /cat\.items\.map\(\(item\) =>/);
  assert.match(menu, /orderingEnabled=\{orderingEnabled && item\.isAvailable\}/);
  assert.match(menu, /!item\.isAvailable &&/);
  assert.match(menu, />\s*Unavailable\s*</);
  assert.match(menu, /aria-label=\{`Add \$\{item\.name\} to cart`\}/);
});

test("cart, order creation, fee math, and Stripe confirmation contracts remain intact", () => {
  assert.match(menu, /const CART_KEY = "mealscout_cart"/);
  assert.match(menu, /localStorage\.setItem\(CART_KEY/);
  assert.match(menu, /navigate\(`\/checkout\/\$\{restaurantId\}`\)/);
  assert.match(checkout, /fetch\("\/api\/pickup-orders"/);
  assert.match(checkout, /estimateProcessingFeeCents/);
  assert.match(checkout, /<PaymentElement \/>/);
  assert.match(checkout, /stripe\.confirmPayment\(/);
  assert.match(checkout, /navigate\(`\/order-confirmation\/\$\{data\.order\.id\}`\)/);
});

console.log("mealscout-public-ordering-shell.contract: PASS");
