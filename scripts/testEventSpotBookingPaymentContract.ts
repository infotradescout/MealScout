import { readFileSync } from "node:fs";

const eventRoutes = readFileSync("server/routes/eventRoutes.ts", "utf8");

const bookingRouteStart = eventRoutes.indexOf('"/api/events/:eventId/book"');
const confirmRouteStart = eventRoutes.indexOf('"/api/bookings/:bookingId/confirm"');

if (bookingRouteStart < 0 || confirmRouteStart < 0) {
  throw new Error("Event booking or confirmation route not found.");
}

const bookingRoute = eventRoutes.slice(bookingRouteStart, confirmRouteStart);

const forbiddenSnippets = [
  "Premium subscription required for event access.",
  "Host has not completed payment setup",
  "{ stripeAccount: host.stripeConnectAccountId }",
];

for (const snippet of forbiddenSnippets) {
  if (bookingRoute.includes(snippet)) {
    throw new Error(`Event spot booking route still contains blocker: ${snippet}`);
  }
}

const requiredSnippets = [
  "hostPaymentMode",
  "platform_hold",
  "transfer_data",
  "paymentIntents.create(intentParams)",
  "[event-booking] create failed",
  "paymentIntentId: paymentIntent.id",
];

for (const snippet of requiredSnippets) {
  if (!bookingRoute.includes(snippet)) {
    throw new Error(`Event spot booking route is missing required behavior: ${snippet}`);
  }
}

console.log("Event spot booking payment contract OK");
