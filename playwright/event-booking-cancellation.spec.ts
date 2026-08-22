import { expect, test, type Page, type Route } from "@playwright/test";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5174";
const EVENT_ID =
  "pp:4950164b-6246-444e-a293-aea953aba78a:2026-08-23";
const TRUCK_ID = "event-checkout-truck";
const PAYMENT_INTENT_ID = "pi_event_checkout_cancel";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function installCheckoutApi(
  page: Page,
  options: { delayBookingResponse: boolean },
) {
  const bookingStarted = deferred();
  const releaseBookingResponse = deferred();
  const cancellations: Array<{
    intentId: string;
    truckId: string;
    method: string;
  }> = [];

  await page.route("https://js.stripe.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        (function () {
          function makeElement() {
            var handlers = {};
            return {
              mount: function () {
                if (handlers.ready) setTimeout(handlers.ready, 0);
              },
              destroy: function () {},
              on: function (name, handler) { handlers[name] = handler; },
              off: function (name) { delete handlers[name]; },
              update: function () {}
            };
          }
          function Stripe() {
            return {
              _registerWrapper: function () {},
              registerAppInfo: function () {},
              createToken: function () { return Promise.resolve({}); },
              createPaymentMethod: function () { return Promise.resolve({}); },
              confirmCardPayment: function () { return Promise.resolve({}); },
              elements: function () {
                return {
                  create: function () { return makeElement(); },
                  update: function () {},
                  submit: function () { return Promise.resolve({}); }
                };
              }
            };
          }
          Stripe.version = "basil";
          window.Stripe = Stripe;
        })();
      `,
    });
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname);

    if (path === "/api/auth/user") {
      return json(route, {
        id: "event-checkout-owner",
        email: "event-checkout@example.test",
        firstName: "Event",
        lastName: "Checkout",
        userType: "food_truck",
        roles: [],
        emailVerified: true,
        continuationPath: null,
      });
    }
    if (path === "/api/business-access/me") {
      return json(route, {
        hasAnyAccess: true,
        restaurants: [
          {
            id: TRUCK_ID,
            isOwner: true,
            businessType: "food_truck",
            isFoodTruck: true,
            permissions: { manageParkingPass: true },
          },
        ],
      });
    }
    if (path === "/api/payments/stripe-config") {
      return json(route, {
        paymentsReady: true,
        publishableKey: "pk_test_event_checkout_cancel",
      });
    }
    if (path === `/api/public/events/${EVENT_ID}`) {
      return json(route, {
        id: EVENT_ID,
        title: "Future paid Parking Pass",
        description: "A production-shaped paid parking occurrence.",
        date: "2026-08-23T00:00:00.000Z",
        startTime: "07:00",
        endTime: "21:00",
        status: "open",
        requiresPayment: true,
        hostPriceCents: 2500,
        ended: false,
        noIndex: true,
        host: {
          id: "event-checkout-host",
          name: "Test Host",
          city: "Pensacola",
          state: "FL",
        },
        truck: null,
      });
    }
    if (
      path === `/api/events/${EVENT_ID}/book` &&
      request.method() === "POST"
    ) {
      bookingStarted.resolve();
      if (options.delayBookingResponse) {
        await releaseBookingResponse.promise;
      }
      return json(route, {
        bookingId: "booking-event-checkout-cancel",
        clientSecret: `${PAYMENT_INTENT_ID}_secret_test`,
        paymentIntentId: PAYMENT_INTENT_ID,
        hostPaymentsReady: false,
        totalCents: 3500,
        breakdown: { hostPrice: 2500, platformFee: 1000 },
      });
    }

    const cancelMatch = path.match(
      /^\/api\/bookings\/payment-intent\/([^/]+)\/cancel$/,
    );
    if (cancelMatch && request.method() === "POST") {
      const cancellation = {
        intentId: cancelMatch[1],
        truckId: String(url.searchParams.get("truckId") || ""),
        method: request.method(),
      };
      await json(route, { ok: true });
      cancellations.push(cancellation);
      return;
    }

    return json(route, request.method() === "GET" ? {} : { ok: true });
  });

  return {
    bookingStarted: bookingStarted.promise,
    releaseBookingResponse: releaseBookingResponse.resolve,
    cancellations,
  };
}

async function openEventCheckout(page: Page) {
  await page.goto(
    `${FRONTEND}/event/future-paid-parking-pass--${EVENT_ID}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.getByRole("button", { name: /Book This Spot/ }).click();
  const dialog = page.getByRole("dialog", { name: "Book This Spot" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Continue to Payment" }),
  ).toBeEnabled();
  return dialog;
}

test("closing while Event Detail checkout is in flight cancels the returned intent", async ({
  page,
}) => {
  const api = await installCheckoutApi(page, { delayBookingResponse: true });
  const dialog = await openEventCheckout(page);

  await dialog.getByRole("button", { name: "Continue to Payment" }).click();
  await api.bookingStarted;
  await expect(dialog.getByText("Preparing payment...")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  api.releaseBookingResponse();
  await expect.poll(() => api.cancellations).toEqual([
    {
      intentId: PAYMENT_INTENT_ID,
      truckId: TRUCK_ID,
      method: "POST",
    },
  ]);
});

test("closing a prepared Event Detail checkout releases its current intent", async ({
  page,
}) => {
  const api = await installCheckoutApi(page, { delayBookingResponse: false });
  const dialog = await openEventCheckout(page);

  await dialog.getByRole("button", { name: "Continue to Payment" }).click();
  await expect(dialog.getByRole("button", { name: "Pay $35.00" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(() => api.cancellations).toEqual([
    {
      intentId: PAYMENT_INTENT_ID,
      truckId: TRUCK_ID,
      method: "POST",
    },
  ]);
});
