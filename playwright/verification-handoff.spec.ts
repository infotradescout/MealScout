import { test, expect } from "@playwright/test";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5174";

async function mockGuest(page: any) {
  await page.route("**/api/auth/user", async (route: any) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unauthorized" }),
    });
  });
}

async function mockUser(page: any, userType: string) {
  await page.route("**/api/auth/user", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: `test-${userType}`,
        email: `${userType}@example.test`,
        firstName: "Test",
        lastName: "User",
        userType,
        roles: [],
        emailVerified: true,
      }),
    });
  });
}

async function dismissBetaDisclaimer(page: any) {
  const closeButton = page.getByTestId("button-beta-disclaimer-close");
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
}

test.describe("verification handoff routing", () => {
  test("fresh verified email redirect beats stale session storage", async ({ page }) => {
    await mockGuest(page);

    await page.goto(`${FRONTEND}/post-verification?status=check-email`, {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate(() => {
      window.sessionStorage.setItem(
        "mealscout:post-verification-redirect",
        "/supplier/dashboard",
      );
    });

    await page.goto(
      `${FRONTEND}/post-verification?verified=1&redirect=${encodeURIComponent(
        "/host-signup",
      )}`,
      { waitUntil: "domcontentloaded" },
    );
    await dismissBetaDisclaimer(page);

    const loginLink = page.getByRole("link", {
      name: /log in to continue|i verified, log in/i,
    });

    await expect(loginLink).toHaveAttribute(
      "href",
      /redirect=%2Fhost-signup/,
    );
  });

  test("check-email mode preserves same-session food truck intent", async ({ page }) => {
    await mockGuest(page);

    const truckIntent = "/restaurant-signup?businessType=food_truck&claim=1";

    // Commit 4c8d34a0 ("enforce email verification check in post-verification
    // handoff") replaced the static login link with a button that confirms
    // verification server-side before navigating, so the redirect target is
    // no longer readable off a static href — it only resolves after the
    // check-status call succeeds and the app performs the redirect itself.
    await page.route("**/api/auth/verification-status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ verified: true }),
      });
    });

    await page.goto(`${FRONTEND}/post-verification?status=check-email`, {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate((path) => {
      window.sessionStorage.setItem(
        "mealscout:post-verification-redirect",
        path,
      );
      window.sessionStorage.setItem(
        "mealscout:lastSignupEmail",
        "truck-driver@example.test",
      );
    }, truckIntent);

    await page.goto(
      `${FRONTEND}/post-verification?status=check-email&redirect=${encodeURIComponent(
        "/scout",
      )}`,
      { waitUntil: "domcontentloaded" },
    );
    await dismissBetaDisclaimer(page);

    await page.getByRole("button", { name: /i verified, log in/i }).click();

    await page.waitForURL(
      new RegExp(
        `/login\\?redirect=${encodeURIComponent(truckIntent).replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        )}`,
      ),
    );
  });

  test("customer /dashboard resolves to Scout", async ({ page }) => {
    await mockUser(page, "customer");

    await page.goto(`${FRONTEND}/dashboard`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(/\/scout/);
  });

  test("supplier /dashboard still resolves to supplier dashboard", async ({ page }) => {
    await mockUser(page, "supplier");

    await page.goto(`${FRONTEND}/dashboard`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(/\/supplier\/dashboard/);
  });

  test("login resend carries intended redirect", async ({ page }) => {
    await mockGuest(page);

    let resendPayload: any = null;

    await page.route("**/api/auth/login", async (route: any) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "email_not_verified",
          error: "Verify your email first.",
        }),
      });
    });

    await page.route("**/api/auth/resend-verification", async (route: any) => {
      resendPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "sent" }),
      });
    });

    await page.goto(
      `${FRONTEND}/login?redirect=${encodeURIComponent("/event-signup")}`,
      { waitUntil: "domcontentloaded" },
    );
    await dismissBetaDisclaimer(page);

    await page.getByTestId("button-email-login").click();
    await page.getByTestId("input-email").fill("event-user@example.test");
    await page.getByTestId("input-password").fill("NotARealPassword123!");
    await page.getByTestId("button-login-submit").click();

    await expect(page.getByTestId("button-resend-verification")).toBeVisible();
    await page.getByTestId("button-resend-verification").click();

    // resendPayload is set by the mocked route handler asynchronously;
    // checking it synchronously races that network round-trip.
    await expect.poll(() => resendPayload).toEqual({
      email: "event-user@example.test",
      intendedNextPath: "/event-signup",
    });
  });
});
