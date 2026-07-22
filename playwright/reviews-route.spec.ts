import { expect, test } from "@playwright/test";

test("restaurant reviews renders through the real App routing tree", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/user") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "reviews-route-user",
          email: "reviews-route@example.test",
          firstName: "Route",
          lastName: "Tester",
          userType: "customer",
          roles: [],
          emailVerified: true,
        }),
      });
    }
    if (url.pathname === "/api/restaurants/tree-route-fixture") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "tree-route-fixture",
          name: "Routing Tree Cafe",
          cuisineType: "Cafe",
          totalReviews: 0,
        }),
      });
    }
    if (url.pathname === "/api/reviews/restaurant/tree-route-fixture") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.goto("/restaurant/tree-route-fixture/reviews", {
    waitUntil: "domcontentloaded",
  });

  await expect(
    page.getByRole("heading", { name: "Recommendations", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Routing Tree Cafe")).toBeVisible();
  await expect(page.getByTestId("textarea-review")).toBeVisible();
  await expect(page.locator('[data-nav-root="local"]')).toHaveCount(1);
  expect(
    pageErrors.filter((message) =>
      /ScoutNavSearchProvider|useScoutNavSearch/i.test(message),
    ),
  ).toEqual([]);
});
