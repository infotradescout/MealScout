import "dotenv/config";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";

import { db } from "../server/db";
import { menuItems, menus, restaurants, users } from "@shared/schema";

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000").replace(
  /\/+$/,
  "",
);
const clientOrigin = String(
  process.env.TEST_CLIENT_ORIGIN || process.env.CLIENT_ORIGIN || "http://localhost:5000",
).trim();

type OnboardingPayload = {
  isDiscoverable: boolean;
  visibilityBlockers: string[];
  publicProfileChecks?: {
    blockers: string[];
    warnings: string[];
  };
};

const getSetCookieHeader = (response: Response): string[] => {
  const anyHeaders = response.headers as any;
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
};

const login = async (email: string, password: string): Promise<string> => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: clientOrigin,
      Referer: `${clientOrigin}/login`,
    },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(
    response.ok,
    true,
    `login failed (${response.status}): ${JSON.stringify(payload)}`,
  );

  const cookie = getSetCookieHeader(response)
    .map((part) => String(part || "").split(";")[0])
    .filter(Boolean)
    .join("; ");
  assert.ok(cookie, "login succeeded but no auth cookie was returned");
  return cookie;
};

const getOnboarding = async (authCookie: string): Promise<OnboardingPayload> => {
  const response = await fetch(`${baseUrl}/api/owner/onboarding`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: authCookie,
    },
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(
    response.ok,
    true,
    `owner onboarding failed (${response.status}): ${JSON.stringify(payload)}`,
  );
  return payload as OnboardingPayload;
};

const run = async () => {
  const regclassRows = await db.execute(sql<{
    menus_table: string | null;
    menu_items_table: string | null;
  }>`
    select
      to_regclass('public.menus')::text as menus_table,
      to_regclass('public.menu_items')::text as menu_items_table
  `);
  const hasMenusTable = Boolean(regclassRows.rows?.[0]?.menus_table);
  const hasMenuItemsTable = Boolean(regclassRows.rows?.[0]?.menu_items_table);
  const hasMenuSchema = hasMenusTable && hasMenuItemsTable;

  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `discoverability-test+${unique}@mealscout.local`;
  const password = `MealScout!${Math.floor(100000 + Math.random() * 900000)}Aa`;
  const passwordHash = await bcrypt.hash(password, 10);

  let userId = "";
  let restaurantId = "";
  let menuId = "";

  try {
    const [createdUser] = await db
      .insert(users)
      .values({
        userType: "restaurant_owner",
        email,
        firstName: "Discoverability",
        lastName: "Flow",
        phone: `555${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
        passwordHash,
        emailVerified: true,
        appContext: "mealscout",
      } as any)
      .returning({ id: users.id });

    assert.ok(createdUser?.id, "failed to create test owner");
    userId = String(createdUser.id);

    const [createdRestaurant] = await db
      .insert(restaurants)
      .values({
        ownerId: userId,
        name: `Discoverability Flow ${unique}`,
        address: "123 Main Street",
        city: "Austin",
        state: "TX",
        phone: "5551234567",
        businessType: "restaurant",
        isActive: true,
        isVerified: false,
      } as any)
      .returning({ id: restaurants.id });

    assert.ok(createdRestaurant?.id, "failed to create test restaurant");
    restaurantId = String(createdRestaurant.id);

    const authCookie = await login(email, password);

    const before = await getOnboarding(authCookie);
    assert.equal(before.isDiscoverable, false, "expected pre-setup profile to be not discoverable");
    assert.equal(before.visibilityBlockers.includes("no_menu"), true);
    assert.equal(before.visibilityBlockers.includes("no_items"), true);
    assert.equal(before.visibilityBlockers.includes("unverified"), true);
    assert.equal(
      before.visibilityBlockers.includes("missing_description_or_photo"),
      true,
    );

    await db
      .update(restaurants)
      .set({
        isVerified: true,
        cuisineType: "American",
        description: "Neighborhood spot with rotating specials and handcrafted meals.",
      } as any)
      .where(eq(restaurants.id, restaurantId));

    if (hasMenuSchema) {
      const [createdMenu] = await db
        .insert(menus)
        .values({
          restaurantId,
          name: "Main Menu",
          serviceType: "all",
        } as any)
        .returning({ id: menus.id });
      assert.ok(createdMenu?.id, "failed to create menu");
      menuId = String(createdMenu.id);

      await db.insert(menuItems).values({
        restaurantId,
        menuId,
        name: "House Burger",
        priceCents: 1299,
        isAvailable: true,
      } as any);
    }

    const after = await getOnboarding(authCookie);
    assert.equal(after.visibilityBlockers.includes("unverified"), false);
    assert.equal(
      after.visibilityBlockers.includes("missing_description_or_photo"),
      false,
    );

    if (hasMenuSchema) {
      assert.equal(after.isDiscoverable, true, "expected fully set up profile to be discoverable");
      assert.equal(after.visibilityBlockers.includes("no_menu"), false);
      assert.equal(after.visibilityBlockers.includes("no_items"), false);
      console.log("owner discoverability flow test passed (full mode)");
    } else {
      assert.equal(after.isDiscoverable, false, "without menu schema, discoverability should remain false");
      assert.equal(after.visibilityBlockers.includes("no_menu"), true);
      assert.equal(after.visibilityBlockers.includes("no_items"), true);
      console.log("owner discoverability flow test passed (profile mode; menu tables unavailable)");
    }
  } finally {
    if (restaurantId) {
      if (hasMenuItemsTable) {
        await db.delete(menuItems).where(eq(menuItems.restaurantId, restaurantId));
      }
      if (hasMenusTable) {
        await db.delete(menus).where(eq(menus.restaurantId, restaurantId));
      }
      await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
    }
    if (userId) {
      await db.delete(users).where(eq(users.id, userId));
    }
  }
};

run().catch((error) => {
  console.error("owner discoverability flow test failed:", error);
  process.exit(1);
});
