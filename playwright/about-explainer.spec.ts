import { expect, test, type Page } from "@playwright/test";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5174";

const GUIDE_CHAPTER_IDS = [
  "scout-discovery",
  "public-profiles",
  "menus-and-orders",
  "schedule-and-location",
  "business-workspace",
  "parking-pass",
  "hosts-and-events",
  "sharing-and-audience",
  "supplier-marketplace",
  "food-work",
  "food-video",
  "customer-accounts",
  "mobile-access",
  "trust-and-support",
];

async function mockGuest(page: Page) {
  await page.route("**/api/auth/user", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unauthorized" }),
    });
  });
}

async function dismissBetaDialog(page: Page) {
  const button = page.getByRole("button", { name: /got it/i });
  if (await button.isVisible().catch(() => false)) {
    await button.click();
  }
}

test.describe("complete MealScout About guide", () => {
  test.beforeEach(async ({ page }) => {
    await mockGuest(page);
    await page.goto(`${FRONTEND}/about`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    await dismissBetaDialog(page);
  });

  test("teaches the product from its profile-first spine", async ({ page }) => {
    await expect(page).toHaveTitle(/complete product guide/i);
    await expect(
      page.getByRole("heading", { name: /local food, easier to find\. easier to run\./i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /a profile-first local food system for discovery, decisions, and the work behind them/i,
      }),
    ).toBeVisible();

    await expect(page.getByRole("heading", { name: "Diners and local food lovers" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Food trucks and mobile vendors" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hosts and property operators" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Suppliers and food-business partners" })).toBeVisible();

    await expect(page.getByText("Standard profile", { exact: true })).toBeVisible();
    await expect(page.getByText("Free", { exact: true })).toBeVisible();
    await expect(page.getByText("Most are $100", { exact: true })).toBeVisible();
    await expect(page.getByText("Custom quote", { exact: true })).toBeVisible();

    await expect(page.locator("header[data-nav-root='global']")).toHaveCount(1);
    await expect(page.locator(".ms-about-guide-list > details")).toHaveCount(14);

    for (const chapterId of GUIDE_CHAPTER_IDS) {
      await expect(page.locator(`#${chapterId}`)).toHaveCount(1);
    }
  });

  test("keeps the guide navigable, responsive, and visually complete", async ({ page }) => {
    const jumpbar = page.getByRole("navigation", { name: "MealScout guide chapters" });
    await expect(jumpbar).toBeVisible();
    await expect(jumpbar.getByRole("link", { name: "Complete guide" })).toHaveAttribute(
      "href",
      "#complete-guide",
    );
    await expect(page.getByRole("link", { name: /find food with scout/i })).toHaveAttribute(
      "href",
      "/scout",
    );
    await expect(page.getByRole("link", { name: /claim an existing food truck/i })).toHaveAttribute(
      "href",
      "/claim-business",
    );

    const jumpbarPosition = await jumpbar.evaluate((element) => getComputedStyle(element).position);
    expect(jumpbarPosition).toBe("sticky");

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(hasHorizontalOverflow).toBe(false);

    const images = page.locator("main.ms-about img");
    const visibleImages = page.locator("main.ms-about img:visible");
    const visibleImageCount = await visibleImages.count();
    for (let index = 0; index < visibleImageCount; index += 1) {
      const image = visibleImages.nth(index);
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0))
        .toBe(true);
    }
    expect(visibleImageCount).toBeGreaterThan(0);

    const brokenImages = await images.evaluateAll((elements) =>
      elements
        .filter((image) => image.getClientRects().length > 0)
        .filter(
          (image) =>
            !(image as HTMLImageElement).complete ||
            (image as HTMLImageElement).naturalWidth === 0,
        )
        .map((image) => (image as HTMLImageElement).src),
    );
    expect(brokenImages).toEqual([]);
  });

  test("opens a directly linked help chapter", async ({ page }) => {
    await page.goto(`${FRONTEND}/about#parking-pass`, { waitUntil: "load" });

    const chapter = page.locator("#parking-pass");
    await expect(chapter).toHaveAttribute("open", "");
    await expect(chapter.locator("summary")).toBeFocused();
    await expect(chapter.getByText("Parking Pass and mobile-food operations")).toBeVisible();
  });
});
