import { expect, test, type Page, type Route } from "@playwright/test";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5174";
const RESTAURANT_ID = "owner-review-truck";
const DESCRIPTION_ID = "a".repeat(64);
const WEBSITE_ID = "b".repeat(64);
const PHONE_ID = "e".repeat(64);
const DESCRIPTION_FINGERPRINT = "c".repeat(64);
const WEBSITE_FINGERPRINT = "d".repeat(64);
const PHONE_FINGERPRINT = "f".repeat(64);

type Proposal = {
  id: string;
  field: "description" | "websiteUrl" | "phone";
  label: string;
  valueKind: "multiline_text" | "url" | "phone";
  currentValue: string | null;
  proposedValue: string;
  confidence: "high";
  source: {
    kind: "website" | "screenshot";
    label: string;
    url: string;
    excerpt: string;
    imageEvidenceIds: string[];
    images: Array<{ id: string; url: string }>;
    reviewable: boolean;
    unavailableReason: string | null;
  };
  receivedAt: string;
  currentValueFingerprint: string;
};

const initialProposals: Proposal[] = [
  {
    id: DESCRIPTION_ID,
    field: "description",
    label: "About your business",
    valueKind: "multiline_text",
    currentValue: "Current owner-written description.",
    proposedValue: "Suggested description from the business website.",
    confidence: "high",
    source: {
      kind: "screenshot",
      label: "Business website screenshot",
      url: "",
      excerpt: "",
      imageEvidenceIds: ["visible-screenshot"],
      images: [
        {
          id: "visible-screenshot",
          url: "https://owner-review.example/evidence-visible.png",
        },
      ],
      reviewable: true,
      unavailableReason: null,
    },
    receivedAt: "2026-07-22T12:00:00.000Z",
    currentValueFingerprint: DESCRIPTION_FINGERPRINT,
  },
  {
    id: WEBSITE_ID,
    field: "websiteUrl",
    label: "Website",
    valueKind: "url",
    currentValue: null,
    proposedValue: "https://owner-review.example/",
    confidence: "high",
    source: {
      kind: "website",
      label: "Business website",
      url: "https://owner-review.example/",
      excerpt: "Official public website shown on owner-provided material.",
      imageEvidenceIds: [],
      images: [],
      reviewable: true,
      unavailableReason: null,
    },
    receivedAt: "2026-07-22T12:00:00.000Z",
    currentValueFingerprint: WEBSITE_FINGERPRINT,
  },
  {
    id: PHONE_ID,
    field: "phone",
    label: "Phone",
    valueKind: "phone",
    currentValue: "850-555-0100",
    proposedValue: "850-555-0199",
    confidence: "high",
    source: {
      kind: "screenshot",
      label: "Referenced screenshot",
      url: "",
      excerpt: "",
      imageEvidenceIds: ["opaque-screenshot"],
      images: [],
      reviewable: false,
      unavailableReason: "The referenced screenshot is not available to view.",
    },
    receivedAt: "2026-07-22T12:00:00.000Z",
    currentValueFingerprint: PHONE_FINGERPRINT,
  },
];

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

async function installOwnerApi(page: Page) {
  let proposals = [...initialProposals];
  let staleDeclineReturned = false;
  const decisions: Array<Record<string, unknown>> = [];

  await page.route(
    "https://owner-review.example/evidence-visible.png",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      }),
  );

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/auth/user") {
      return json(route, {
        id: "owner-review-user",
        email: "owner-review@example.test",
        firstName: "Owner",
        lastName: "Reviewer",
        userType: "food_truck",
        roles: [],
        emailVerified: true,
      });
    }
    if (path === "/api/business-access/me") {
      return json(route, {
        hasAnyAccess: true,
        permissions: {
          manageDeals: true,
          manageParkingPass: true,
          viewAnalytics: true,
          manageProfile: true,
        },
        restaurants: [
          {
            id: RESTAURANT_ID,
            isOwner: true,
            permissions: {
              manageDeals: true,
              manageParkingPass: true,
              viewAnalytics: true,
              manageProfile: true,
            },
          },
        ],
      });
    }
    if (path === "/api/restaurants/my-restaurants") {
      return json(route, [
        {
          id: RESTAURANT_ID,
          ownerId: "owner-review-user",
          name: "Owner Review Truck",
          businessType: "food_truck",
          isFoodTruck: true,
          isActive: true,
          description: "Current owner-written description.",
          cuisineType: "Street food",
          city: "Pensacola",
          state: "FL",
          phone: "850-555-0100",
          logoUrl: null,
          menuItemCount: 1,
          menuApproval: {
            status: "needs_owner_confirmation",
            ownerApproved: false,
            ownerApprovalRequired: true,
          },
          profileCompletionTruth: {
            businessType: "food_truck",
            publicRouteState: "published",
            fixedWeeklyHoursState: "not_applicable",
            datedTruckScheduleState: "missing",
            datedTruckScheduleWorkflowState: "unresolved",
            livePresenceState: "offline",
            menuState: "present_needs_confirmation",
            mediaState: "ready",
            availabilityReady: false,
            coreContentComplete: false,
            publicProfileReady: false,
            missingRequired: ["menu", "dated_truck_schedule"],
            optionalGrowth: {
              hasSocial: false,
              hasBookingOrCateringLink: false,
              hasActiveDeal: false,
              completedCount: 0,
              totalCount: 3,
            },
          },
          socialAutopostSettings: { publicActionLinks: {} },
        },
      ]);
    }

    const evidenceMatch = path.match(
      new RegExp(`^/api/restaurants/${RESTAURANT_ID}/profile-evidence-review(?:/([a-f0-9]{64}))?$`),
    );
    if (evidenceMatch && request.method() === "GET") {
      return json(route, {
        schemaVersion: 2,
        restaurantId: RESTAURANT_ID,
        pendingCount: proposals.length,
        proposals,
      });
    }
    if (evidenceMatch?.[1] && request.method() === "PATCH") {
      const proposalId = evidenceMatch[1];
      const body = request.postDataJSON() as Record<string, unknown>;
      decisions.push({ proposalId, ...body });
      if (
        proposalId === WEBSITE_ID &&
        body.action === "decline" &&
        !staleDeclineReturned
      ) {
        staleDeclineReturned = true;
        return json(
          route,
          {
            code: "stale_review",
            message: "The current value changed.",
          },
          409,
        );
      }
      proposals = proposals.filter((proposal) => proposal.id !== proposalId);
      return json(route, { ok: true, proposalId, action: body.action });
    }

    if (path.startsWith("/api/public/profiles/")) {
      return json(route, { message: "Not found" }, 404);
    }
    if (path === "/api/owner/value-attribution") {
      return json(route, { entities: [] });
    }
    if (path === "/api/bookings/my-truck") return json(route, []);
    if (path.endsWith("/stats")) {
      return json(route, {
        totalDeals: 0,
        activeDeals: 0,
        totalViews: 0,
        totalClaims: 0,
        conversionRate: 0,
      });
    }
    return json(route, request.method() === "GET" ? {} : { ok: true });
  });

  return { decisions: () => decisions };
}

async function dismissBetaDialog(page: Page) {
  const button = page.getByRole("button", { name: /got it/i });
  if (await button.isVisible().catch(() => false)) await button.click();
}

test("owner reviews bounded profile evidence without stale or mobile drift", async ({
  page,
}) => {
  const api = await installOwnerApi(page);
  await page.goto(
    `${FRONTEND}/restaurant-owner-dashboard?setup=profile&restaurantId=${RESTAURANT_ID}`,
    { waitUntil: "domcontentloaded" },
  );
  await dismissBetaDialog(page);

  const review = page.getByTestId("owner-profile-evidence-review");
  await expect(review).toBeVisible();
  await expect(review.getByText("Current", { exact: true }).first()).toBeVisible();
  await expect(review.getByText("Suggested", { exact: true }).first()).toBeVisible();
  await expect(review.getByText("Current owner-written description.")).toBeVisible();
  await expect(
    review.getByText("Suggested description from the business website."),
  ).toBeVisible();
  await expect(page.getByText("internal-source-identity-secret")).toHaveCount(0);

  const screenshot = review.getByRole("img", {
    name: "Evidence image 1 for About your business",
  });
  await expect(screenshot).toBeVisible();
  await expect
    .poll(() => screenshot.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(
    review.getByRole("link", {
      name: "Open evidence image 1 for About your business in a new tab",
    }),
  ).toHaveAttribute(
    "href",
    "https://owner-review.example/evidence-visible.png",
  );

  const unavailable = page.getByTestId("profile-evidence-unavailable-phone");
  await expect(unavailable).toContainText("Evidence is not available to inspect");
  await expect(unavailable).toContainText(
    "The referenced screenshot is not available to view.",
  );
  await expect(page.getByTestId("button-confirm-evidence-phone")).toBeDisabled();
  await expect(page.getByTestId("button-correct-evidence-phone")).toBeDisabled();
  await expect(page.getByTestId("button-decline-evidence-phone")).toBeEnabled();

  await page.getByTestId("button-correct-evidence-description").click();
  await page
    .getByLabel("Correct value for About your business")
    .fill("Owner-corrected public description.");
  await page.getByTestId("button-save-evidence-correction-description").click();
  await expect(page.getByText("About your business updated.")).toBeVisible();
  await expect(page.getByLabel("About your business")).toHaveValue(
    "Current owner-written description.",
  );

  await page.getByTestId("button-decline-evidence-websiteUrl").click();
  await expect(
    page.getByText(/field changed while you were reviewing it/i),
  ).toBeVisible();
  await page.getByTestId("button-confirm-evidence-websiteUrl").click();
  await page.getByTestId("button-decline-evidence-phone").click();
  await expect(page.getByTestId("owner-profile-evidence-review-empty")).toBeVisible();

  expect(api.decisions()).toHaveLength(4);
  expect(api.decisions()[0]).toMatchObject({
    proposalId: DESCRIPTION_ID,
    action: "correct",
    correctedValue: "Owner-corrected public description.",
    expectedCurrentValueFingerprint: DESCRIPTION_FINGERPRINT,
  });
  expect(api.decisions()[1]).toMatchObject({
    proposalId: WEBSITE_ID,
    action: "decline",
    expectedCurrentValueFingerprint: WEBSITE_FINGERPRINT,
  });
  expect(api.decisions()[2]).toMatchObject({
    proposalId: WEBSITE_ID,
    action: "confirm",
    expectedCurrentValueFingerprint: WEBSITE_FINGERPRINT,
  });
  expect(api.decisions()[3]).toMatchObject({
    proposalId: PHONE_ID,
    action: "decline",
    expectedCurrentValueFingerprint: PHONE_FINGERPRINT,
  });
  expect(
    api
      .decisions()
      .filter((decision) => decision.proposalId === PHONE_ID)
      .map((decision) => decision.action),
  ).toEqual(["decline"]);
  for (const decision of api.decisions()) {
    expect(String(decision.clientRequestId || "")).toMatch(/^profile-review:/);
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
