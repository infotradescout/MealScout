import { readFileSync } from "node:fs";

const scoutSurfaceService = readFileSync(
  "server/services/scoutSurfaceService.ts",
  "utf8",
);
const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");
const bookingModal = readFileSync(
  "client/src/components/booking-payment-modal.tsx",
  "utf8",
);
const hostRoutes = readFileSync("server/routes/hostRoutes.ts", "utf8");
const bookingRoutes = readFileSync("server/routes/bookingRoutes.ts", "utf8");

const funnelChecks: Array<{ stage: string; snippets: string[] }> = [
  {
    stage: "scout_cta_to_parking_pass",
    snippets: [
      'if (card.entityType === "event")',
      "parkingPassBookable",
      'label: "Book spot"',
      'return `/parking-pass?${params.toString()}`;',
      'params.set("source", "scout")',
      'params.set("eventId", parkingPassId)',
      'params.set("locationId", locationId)',
    ],
  },
  {
    stage: "parking_pass_context_handoff",
    snippets: [
      'params.get("pass") || params.get("eventId")',
      'params.get("hostId") || params.get("locationId")',
      'params.get("eventMenuId") || params.get("menuId")',
    ],
  },
  {
    stage: "parking_pass_feed_load",
    snippets: ['fetch("/api/parking-pass")', "filterBookablePassListings"],
  },
  {
    stage: "selection_recovery_before_payment",
    snippets: [
      "if (!listingHasAvailability(listing))",
      "Location unavailable",
      "Pick another open location.",
      "Select a booking slot",
      "disabled={!hasAvailability}",
      "setPaymentOpen(true)",
    ],
  },
  {
    stage: "stripe_config_and_checkout_prep",
    snippets: [
      'fetch(apiUrl("/api/payments/stripe-config"))',
      "const res = await fetch(`/api/parking-pass/${passId}/book`, {",
      '"Idempotency-Key": requestIdempotencyKey',
    ],
  },
  {
    stage: "post_payment_finalization_path",
    snippets: [
      "/api/bookings/payment-intent/",
      'return_url: `${window.location.origin}/parking-pass?booking=success`',
      'if (data?.paymentPending)',
      'if (data?.bypassed)',
    ],
  },
  {
    stage: "server_booking_entrypoint",
    snippets: ['"/api/parking-pass/:passId/book"', '"/api/payments/stripe-config"'],
  },
  {
    stage: "server_booking_status_and_cancel",
    snippets: [
      '"/api/bookings/payment-intent/:paymentIntentId"',
      '"/api/bookings/payment-intent/:paymentIntentId/cancel"',
      '"/api/bookings/truck/:truckId/schedule"',
    ],
  },
];

const docs: Array<{
  endpoint: string;
  method: string;
  status: string;
  payload: string;
  response: string;
  userFacingResult: string;
  funnelStage: string;
}> = [
  {
    endpoint: "/api/parking-pass",
    method: "GET",
    status: "200",
    payload: "none",
    response: "listings[]",
    userFacingResult: "bookable locations render",
    funnelStage: "feed_load",
  },
  {
    endpoint: "/api/payments/stripe-config",
    method: "GET",
    status: "200",
    payload: "none",
    response: "{paymentsReady,publishableKey}",
    userFacingResult: "checkout can initialize",
    funnelStage: "payment_config",
  },
  {
    endpoint: "/api/parking-pass/:passId/book",
    method: "POST",
    status: "200|4xx",
    payload: "{truckId,slotTypes,selectedDates}",
    response: "{clientSecret|paymentPending|bypassed}",
    userFacingResult: "continue to pay or safe pending fallback",
    funnelStage: "booking_submit",
  },
  {
    endpoint: "/api/bookings/payment-intent/:paymentIntentId",
    method: "GET",
    status: "200",
    payload: "query truckId",
    response: "{status:pending|confirmed|credited}",
    userFacingResult: "post-payment confirmation state",
    funnelStage: "post_payment",
  },
  {
    endpoint: "/api/bookings/payment-intent/:paymentIntentId/cancel",
    method: "POST",
    status: "200|409",
    payload: "query truckId",
    response: "{ok:true}|409",
    userFacingResult: "safe cancel/release path",
    funnelStage: "recovery_cancel",
  },
  {
    endpoint: "/api/bookings/truck/:truckId/schedule",
    method: "GET",
    status: "200|404",
    payload: "none",
    response: "schedule[]",
    userFacingResult: "profile/schedule visibility",
    funnelStage: "post_booking_visibility",
  },
];

for (const check of funnelChecks) {
  const haystack = [
    scoutSurfaceService,
    parkingPassPage,
    bookingModal,
    hostRoutes,
    bookingRoutes,
  ].join("\n");
  for (const snippet of check.snippets) {
    if (!haystack.includes(snippet)) {
      throw new Error(
        `Booking funnel stage missing wiring [${check.stage}]: ${snippet}`,
      );
    }
  }
}

for (const row of docs) {
  for (const field of [
    row.endpoint,
    row.method,
    row.status,
    row.payload,
    row.response,
    row.userFacingResult,
    row.funnelStage,
  ]) {
    if (!String(field || "").trim()) {
      throw new Error(`Booking funnel proof row is incomplete for ${row.endpoint}`);
    }
  }
}

console.table(docs);
console.log("booking-funnel-audit.contract: PASS");
