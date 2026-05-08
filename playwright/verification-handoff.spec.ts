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

    await page.goto(`${FRONTEND}/post-verification?status=check-email`, {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate((path) => {
      window.sessionStorage.setItem(
        "mealscout:post-verification-redirect",
        path,
      );
    }, truckIntent);

    await page.goto(
      `${FRONTEND}/post-verification?status=check-email&redirect=${encodeURIComponent(
        "/scout",
      )}`,
      { waitUntil: "domcontentloaded" },
    );

    const loginLink = page.getByRole("link", {
      name: /i verified, log in|log in to continue/i,
    });

    await expect(loginLink).toHaveAttribute(
      "href",
      new RegExp(
        encodeURIComponent(truckIntent).replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        ),
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

    await page.getByTestId("button-email-login").click();
    await page.getByTestId("input-email").fill("event-user@example.test");
    await page.getByTestId("input-password").fill("NotARealPassword123!");
    await page.getByTestId("button-login-submit").click();

    await expect(page.getByTestId("button-resend-verification")).toBeVisible();
    await page.getByTestId("button-resend-verification").click();

    expect(resendPayload).toEqual({
      email: "event-user@example.test",
      intendedNextPath: "/event-signup",
    });
  });
});
