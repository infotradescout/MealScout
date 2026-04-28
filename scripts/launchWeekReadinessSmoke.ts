import assert from "node:assert/strict";

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000")
  .replace(/\/+$/, "");
const adminCookie = String(process.env.TEST_ADMIN_AUTH_COOKIE || "").trim();
const ownerCookie = String(process.env.TEST_OWNER_AUTH_COOKIE || "").trim();
const sendDigest = String(process.env.RUN_ADMIN_DIGEST_SEND || "").toLowerCase() ===
  "true";

const fetchJson = async (
  path: string,
  options: RequestInit & { cookie?: string } = {},
) => {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.cookie) {
    headers.set("Cookie", options.cookie);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
};

if (!adminCookie) {
  console.log(
    "launch week readiness smoke skipped: set TEST_ADMIN_AUTH_COOKIE",
  );
  process.exit(0);
}

const run = async () => {
  const launch = await fetchJson("/api/admin/launch-week?days=7", {
    cookie: adminCookie,
  });
  assert.equal(
    launch.response.ok,
    true,
    `launch-week expected 2xx, got ${launch.response.status} ${JSON.stringify(
      launch.payload,
    )}`,
  );

  const summary = launch.payload.summary;
  assert.equal(typeof summary?.totalNewOwners, "number");
  assert.equal(typeof summary?.newToday, "number");
  assert.equal(typeof summary?.noMenuYet, "number");
  assert.equal(typeof summary?.failedImports, "number");
  assert.equal(typeof summary?.stuck, "number");
  assert.equal(Array.isArray(launch.payload.owners), true);

  const owners = launch.payload.owners as any[];
  for (const owner of owners.slice(0, 10)) {
    assert.equal(typeof owner.id, "string");
    assert.equal(typeof owner.setupScore, "number");
    assert.equal(typeof owner.totalFailedImports, "number");
    assert.equal(Array.isArray(owner.restaurants), true);
    for (const restaurant of owner.restaurants) {
      assert.equal(typeof restaurant.id, "string");
      assert.equal(typeof restaurant.publicPreviewUrl, "string");
      assert.equal(typeof restaurant.failedImports, "number");
    }
  }

  const previewRestaurant = owners
    .flatMap((owner) => owner.restaurants || [])
    .find((restaurant) => restaurant?.publicPreviewUrl);
  if (previewRestaurant) {
    const preview = await fetch(`${baseUrl}${previewRestaurant.publicPreviewUrl}`, {
      headers: { Accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
    });
    assert.ok(
      preview.status < 500,
      `public preview returned ${preview.status} for ${previewRestaurant.publicPreviewUrl}`,
    );
  } else {
    console.log("launch-week preview check skipped: no restaurants in window");
  }

  if (ownerCookie) {
    const onboarding = await fetchJson("/api/owner/onboarding", {
      cookie: ownerCookie,
    });
    assert.equal(
      onboarding.response.ok,
      true,
      `owner onboarding expected 2xx, got ${onboarding.response.status} ${JSON.stringify(
        onboarding.payload,
      )}`,
    );
    assert.equal(typeof onboarding.payload.completed, "number");
    assert.equal(typeof onboarding.payload.total, "number");
    assert.equal(typeof onboarding.payload.isDiscoverable, "boolean");
    assert.ok(
      onboarding.payload.publicPreviewUrl === null ||
        typeof onboarding.payload.publicPreviewUrl === "string",
    );
    assert.equal(Array.isArray(onboarding.payload.steps), true);
  } else {
    console.log("owner onboarding check skipped: set TEST_OWNER_AUTH_COOKIE");
  }

  if (sendDigest) {
    const digest = await fetchJson("/api/admin/launch-week/digest/send", {
      method: "POST",
      cookie: adminCookie,
    });
    assert.equal(
      digest.response.ok,
      true,
      `digest send expected 2xx, got ${digest.response.status} ${JSON.stringify(
        digest.payload,
      )}`,
    );
    assert.equal(digest.payload.ok, true);
  } else {
    console.log(
      "digest send check skipped: set RUN_ADMIN_DIGEST_SEND=true to send email",
    );
  }

  console.log("launch week readiness smoke passed");
};

run().catch((error) => {
  console.error("launch week readiness smoke failed:", error);
  process.exit(1);
});
