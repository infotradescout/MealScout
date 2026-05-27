import { readFileSync } from "node:fs";
import { computeProfileCompletionStatus } from "../shared/profileCompletionStatus";

const routeFile = readFileSync("server/routes/restaurantOperationsRoutes.ts", "utf8");
const ownerDashboardFile = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");

if (!routeFile.includes("computeProfileCompletionStatus")) {
  throw new Error("PDA-2.10 contract missing shared status adapter usage in server reconciliation.");
}

if (!ownerDashboardFile.includes("computeProfileCompletionStatus")) {
  throw new Error("PDA-2.10 contract missing shared status adapter usage in owner completion UI.");
}

const statusA = computeProfileCompletionStatus({
  menuUrl: "https://menu.example",
  imageUrl: "https://img.example",
  operatingHours: { mon: [{ open: "09:00", close: "17:00" }] },
  address: "123 Main",
  phone: "555-555-5555",
  instagramUrl: "https://instagram.com/test",
  cateringInquiryUrl: "https://example.com/catering",
});

const statusB = computeProfileCompletionStatus(
  {
    menuUrl: "https://menu.example",
    imageUrl: "https://img.example",
    operatingHours: { mon: [{ open: "09:00", close: "17:00" }] },
    address: "123 Main",
    phone: "555-555-5555",
    instagramUrl: "https://instagram.com/test",
    cateringInquiryUrl: "https://example.com/catering",
  },
  { hasActiveDeal: true },
);

if (!statusA.menu || !statusA.photos || !statusA.hours || !statusA["service-area"] || !statusA.contact || !statusA.social || !statusA["catering-events"]) {
  throw new Error("PDA-2.10 deterministic adapter output failed for completed fields.");
}
if (statusA.deal !== false) {
  throw new Error("PDA-2.10 deterministic adapter output failed: default deal state should be false.");
}
if (statusB.deal !== true) {
  throw new Error("PDA-2.10 deterministic adapter output failed: hasActiveDeal override should set deal true.");
}

console.log("owner-profile-completion-status.contract: PASS");
