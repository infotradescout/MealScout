import { readFileSync } from "node:fs";

const eventRoutes = readFileSync("server/routes/eventRoutes.ts", "utf8");
const eventBookingModal = readFileSync(
  "client/src/components/event-booking-modal.tsx",
  "utf8",
);

const bookingRouteStart = eventRoutes.indexOf('"/api/events/:eventId/book"');
const confirmRouteStart = eventRoutes.indexOf('"/api/bookings/:bookingId/confirm"');

if (bookingRouteStart < 0 || confirmRouteStart < 0) {
  throw new Error("Event booking or confirmation route not found.");
}

const bookingRoute = eventRoutes.slice(bookingRouteStart, confirmRouteStart);

const forbiddenSnippets = [
  "Premium subscription required for event access.",
  "platform_hold",
  "paymentIntents.create(intentParams)",
  "{ stripeAccount: host.stripeConnectAccountId }",
  "paymentPending: true",
  "payment_pending_manual_review",
  "We'll send payment instructions.",
];

for (const snippet of forbiddenSnippets) {
  if (bookingRoute.includes(snippet)) {
    throw new Error(`Event spot booking route still contains blocker: ${snippet}`);
  }
}

const requiredSnippets = [
  "createParkingPassPurchase",
  "host.stripeChargesEnabled",
  "host.stripePayoutsEnabled",
  "host.stripeOnboardingCompleted",
  'participationType:',
  'event.eventType === "parking_pass" ? "parking_pass" : "paid_event"',
  "[event-booking] create failed",
  "paymentIntentId: purchase.paymentIntentId",
  'settlementTopology: "destination_charge"',
];

for (const snippet of requiredSnippets) {
  if (!bookingRoute.includes(snippet)) {
    throw new Error(`Event spot booking route is missing required behavior: ${snippet}`);
  }
}

const cancellationRouteStart = eventRoutes.indexOf(
  '"/api/bookings/:bookingId/cancel"',
);
if (cancellationRouteStart < 0) {
  throw new Error("Event booking cancellation route not found.");
}
const confirmRoute = eventRoutes.slice(
  confirmRouteStart,
  cancellationRouteStart,
);
for (const required of [
  "confirmParkingPassPurchaseFromIntent",
  "legacy_payment_state_unbound",
  'settlementState: "action_required"',
]) {
  if (!confirmRoute.includes(required)) {
    throw new Error(
      `Event confirmation route is missing canonical/fail-closed behavior: ${required}`,
    );
  }
}
if (confirmRoute.includes('status: "confirmed"')) {
  throw new Error(
    "Event confirmation route still contains a local confirmation mutation outside the canonical purchase service.",
  );
}

for (const required of [
  'apiUrl(`/api/bookings/${encodeURIComponent(bookingId)}/confirm`)',
  'credentials: "include"',
  "waitForBookingConfirmation",
  "return waitForBookingConfirmation();",
  'confirmationOutcome === "confirmed"',
  '"Payment received"',
]) {
  if (!eventBookingModal.includes(required)) {
    throw new Error(
      `Event checkout client is missing truthful confirmation behavior: ${required}`,
    );
  }
}

if (eventBookingModal.includes('await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/confirm`')) {
  throw new Error(
    "Event checkout client still bypasses the configured API base for booking confirmation.",
  );
}

console.log("Event spot booking destination-charge contract OK");
