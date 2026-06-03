import { existsSync, readFileSync } from "node:fs";

const spinePath = "MEALSCOUT_HANDOFF_SPINE.md";

if (!existsSync(spinePath)) {
  throw new Error("MEALSCOUT_HANDOFF_SPINE.md does not exist.");
}

const spine = readFileSync(spinePath, "utf8");

function requireIncludes(snippet: string, label = snippet) {
  if (!spine.toLowerCase().includes(snippet.toLowerCase())) {
    throw new Error(`Handoff spine missing ${label}.`);
  }
}

function requireMatch(pattern: RegExp, label: string) {
  if (!pattern.test(spine)) {
    throw new Error(`Handoff spine missing ${label}.`);
  }
}

[
  "WORKFLOW.md",
  "CLEANUP_MAP.md",
  "CODEBASE_PATTERNS_OVERVIEW.md",
  "scripts/repoDoctor.mjs",
  "What MealScout Is",
  "What MealScout Is Not",
  "Core User Flows",
  "Entry Routes",
  "Server Route Groups",
  "Data Tables",
  "External Integrations",
  "Known Danger Zones",
  "Validation Commands",
  "Developer Onboarding Checklist",
  "Cleanup Tickets",
].forEach((snippet) => requireIncludes(snippet));

requireIncludes(
  "MealScout is a local food discovery, profile, scheduling, and booking platform for food trucks, restaurants, hosts, customers, suppliers, and operators.",
  "plain MealScout definition",
);

[
  "MealScout is not Merlin.",
  "MealScout is not TradeScout.",
  "MealScout is not an unrestricted intake/OCR engine.",
  "MealScout is not a generic AI automation layer.",
  "MealScout is not a place to keep adding disconnected features.",
].forEach((snippet) => requireIncludes(snippet));

[
  "customer discovery",
  "public profile view/action",
  "food truck / restaurant claim",
  "owner profile update",
  "menu setup",
  "schedule/manual stop update",
  "Parking Pass host listing",
  "Parking Pass truck booking",
  "admin Launch Board",
  "affiliate/claim pitch operator flow",
  "mobile shell route surface",
].forEach((snippet) => requireIncludes(snippet));

[
  "Public Customer Routes",
  "Owner / Truck Routes",
  "Host Routes",
  "Admin / Staff Routes",
  "Booking / Parking Pass Routes",
  "Mobile-Safe Routes",
  "Legacy / Danger Routes",
].forEach((snippet) => requireIncludes(snippet));

[
  "Auth / Account",
  "Public Discovery / Profile / SEO / Search",
  "Restaurant / Truck Operations",
  "Menu / Order",
  "Host / Event / Booking",
  "Parking Pass / Payment / Webhook",
  "Admin / Staff",
  "Analytics / Launch Board",
  "Media / Uploads",
  "Support / Moderation",
  "Supplier",
  "Growth / Referral",
].forEach((snippet) => requireIncludes(snippet));

[
  "users",
  "restaurants",
  "menus",
  "menu_items",
  "hosts",
  "events",
  "event_bookings",
  "truck_import_listings",
  "truck_manual_schedules",
  "request_logs",
  "affiliate_share_events",
  "telemetry_events",
  "image_uploads",
  "suppliers",
  "pickup_orders",
  "restaurant_subscriptions",
].forEach((snippet) => requireIncludes(snippet));

[
  "Stripe",
  "Google Maps",
  "Cloudinary",
  "Brevo",
  "Capacitor",
  "Render",
  "Vercel",
  "Google OAuth",
  "Facebook OAuth",
].forEach((snippet) => requireIncludes(snippet));

[
  "adminCoreOpsRoutes.ts",
  "admin-dashboard.tsx",
  "parking-pass.tsx",
  "restaurant-owner-dashboard.tsx",
  "truckImportAdminRoutes.ts",
  "Raw `/api` calls",
  "Schema column assumptions",
  "Public/private route boundaries",
  "Payment/webhook reconciliation",
  "Claim pitch status in rawData JSON",
].forEach((snippet) => requireIncludes(snippet));

[
  "npm run check",
  "npm run build",
  "npm run test",
  "npm run verify:routes",
  "node scripts/repoDoctor.mjs",
].forEach((snippet) => requireIncludes(snippet));

const cleanupTickets = [...spine.matchAll(/^- C\d+ - /gm)];
if (cleanupTickets.length < 5 || cleanupTickets.length > 10) {
  throw new Error(
    `Expected 5-10 cleanup tickets, found ${cleanupTickets.length}.`,
  );
}

requireMatch(/Trace one public profile route/i, "public profile trace checklist item");
requireMatch(/Trace one Parking Pass booking path/i, "Parking Pass trace checklist item");
requireMatch(/Trace one admin Launch Board request/i, "Launch Board trace checklist item");

if (/Merlin[^.\n]*active project/i.test(spine) || /active project[^.\n]*Merlin/i.test(spine)) {
  throw new Error("Handoff spine describes Merlin as an active project.");
}

if (/propose[s]? new product features/i.test(spine)) {
  throw new Error("Handoff spine proposes new product features.");
}

console.log("mealscout-handoff-spine.contract: PASS");
