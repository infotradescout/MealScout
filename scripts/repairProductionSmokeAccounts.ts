import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { pool } from "../server/db";

type SmokeRole =
  | "customer"
  | "food_truck"
  | "restaurant_owner"
  | "super_admin";

type SmokeUserConfig = {
  key: string;
  email: string;
  role: SmokeRole;
  firstName: string;
  lastName: string;
  linkedBusiness: "none" | "food_truck" | "restaurant";
};

const asBool = (value: string | undefined) =>
  String(value || "")
    .trim()
    .toLowerCase() === "true";

const requireEnv = (name: string) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const valueOr = (name: string, fallback: string) => {
  const value = String(process.env[name] || "").trim();
  return value || fallback;
};

const ensurePool = () => {
  if (!pool) {
    throw new Error("Database pool is not available. Set DATABASE_URL.");
  }
  return pool;
};

async function upsertSmokeUser(
  client: any,
  config: SmokeUserConfig,
  passwordHash: string,
) {
  const existing = await client.query(
    `
      select id, email
      from users
      where lower(email) = lower($1)
      limit 1
    `,
    [config.email],
  );

  const marker = {
    smokeAccount: true,
    smokeKey: config.key,
    linkedBusiness: config.linkedBusiness,
    updatedAt: new Date().toISOString(),
  };

  if (existing.rows.length > 0) {
    const id = String(existing.rows[0].id);
    await client.query(
      `
        update users
        set
          user_type = $2,
          first_name = $3,
          last_name = $4,
          email_verified = true,
          is_disabled = false,
          password_hash = $5,
          must_reset_password = false,
          account_settings = coalesce(account_settings, '{}'::jsonb) || $6::jsonb,
          updated_at = now()
        where id = $1
      `,
      [id, config.role, config.firstName, config.lastName, passwordHash, JSON.stringify(marker)],
    );
    return id;
  }

  const id = randomUUID();
  await client.query(
    `
      insert into users (
        id,
        email,
        user_type,
        first_name,
        last_name,
        email_verified,
        is_disabled,
        password_hash,
        must_reset_password,
        account_settings,
        created_at,
        updated_at
      ) values (
        $1, lower($2), $3, $4, $5, true, false, $6, false, $7::jsonb, now(), now()
      )
    `,
    [id, config.email, config.role, config.firstName, config.lastName, passwordHash, JSON.stringify(marker)],
  );
  return id;
}

async function ensureSmokeRestaurant(
  client: any,
  params: {
    ownerId: string;
    key: "food_truck" | "restaurant";
    name: string;
    businessType: "food_truck" | "restaurant";
    city: string;
    state: string;
    address: string;
  },
) {
  const existing = await client.query(
    `
      select id
      from restaurants
      where lower(name) = lower($1)
      limit 1
    `,
    [params.name],
  );

  if (existing.rows.length > 0) {
    const id = String(existing.rows[0].id);
    await client.query(
      `
        update restaurants
        set
          owner_id = $2,
          business_type = $3,
          is_food_truck = $4,
          is_active = false,
          is_verified = false,
          address = $5,
          city = $6,
          state = $7,
          updated_at = now()
        where id = $1
      `,
      [
        id,
        params.ownerId,
        params.businessType,
        params.businessType === "food_truck",
        params.address,
        params.city,
        params.state,
      ],
    );
    return id;
  }

  const id = randomUUID();
  await client.query(
    `
      insert into restaurants (
        id,
        owner_id,
        name,
        business_type,
        is_food_truck,
        is_active,
        is_verified,
        address,
        city,
        state,
        created_at,
        updated_at
      ) values (
        $1, $2, $3, $4, $5, false, false, $6, $7, $8, now(), now()
      )
    `,
    [
      id,
      params.ownerId,
      params.name,
      params.businessType,
      params.businessType === "food_truck",
      params.address,
      params.city,
      params.state,
    ],
  );
  return id;
}

async function clearUserBusinessLinksExcept(
  client: any,
  userId: string,
  allowedRestaurantIds: string[],
) {
  await client.query(
    `
      update restaurants
      set owner_id = null, updated_at = now()
      where owner_id = $1
        and (
          cardinality($2::uuid[]) = 0
          or id <> all($2::uuid[])
        )
    `,
    [userId, allowedRestaurantIds],
  );

  await client.query(
    `
      update business_staff_memberships
      set status = 'revoked', revoked_at = now(), updated_at = now()
      where user_id = $1
        and (
          cardinality($2::uuid[]) = 0
          or restaurant_id <> all($2::uuid[])
        )
    `,
    [userId, allowedRestaurantIds],
  );
}

async function main() {
  if (!asBool(process.env.ENABLE_PRODUCTION_SMOKE_REPAIR)) {
    throw new Error(
      "Refusing to run. Set ENABLE_PRODUCTION_SMOKE_REPAIR=true to continue.",
    );
  }

  const dbPool = ensurePool();
  const smokePassword = requireEnv("SMOKE_ACCOUNT_PASSWORD");
  const passwordHash = await bcrypt.hash(smokePassword, 12);

  const smokeUsers: SmokeUserConfig[] = [
    {
      key: "smoke_customer",
      email: valueOr("SMOKE_CUSTOMER_EMAIL", "smoke_customer@mealscout.us"),
      role: "customer",
      firstName: "Smoke",
      lastName: "Customer",
      linkedBusiness: "none",
    },
    {
      key: "smoke_linked_food_truck",
      email: valueOr(
        "SMOKE_LINKED_FOOD_TRUCK_EMAIL",
        "smoke_linked_food_truck@mealscout.us",
      ),
      role: "food_truck",
      firstName: "Smoke",
      lastName: "LinkedTruck",
      linkedBusiness: "food_truck",
    },
    {
      key: "smoke_unlinked_food_truck",
      email: valueOr(
        "SMOKE_UNLINKED_FOOD_TRUCK_EMAIL",
        "smoke_unlinked_food_truck@mealscout.us",
      ),
      role: "food_truck",
      firstName: "Smoke",
      lastName: "UnlinkedTruck",
      linkedBusiness: "none",
    },
    {
      key: "smoke_restaurant_owner_linked",
      email: valueOr(
        "SMOKE_RESTAURANT_OWNER_LINKED_EMAIL",
        "smoke_restaurant_owner_linked@mealscout.us",
      ),
      role: "restaurant_owner",
      firstName: "Smoke",
      lastName: "LinkedRestaurant",
      linkedBusiness: "restaurant",
    },
    {
      key: "smoke_super_admin",
      email: valueOr(
        "SMOKE_SUPER_ADMIN_EMAIL",
        "smoke_super_admin@mealscout.us",
      ),
      role: "super_admin",
      firstName: "Smoke",
      lastName: "SuperAdmin",
      linkedBusiness: "none",
    },
  ];

  const client = await dbPool.connect();
  try {
    await client.query("begin");

    const userIds = new Map<string, string>();
    for (const config of smokeUsers) {
      const id = await upsertSmokeUser(client, config, passwordHash);
      userIds.set(config.key, id);
    }

    const linkedTruckUserId = userIds.get("smoke_linked_food_truck")!;
    const linkedRestaurantUserId = userIds.get("smoke_restaurant_owner_linked")!;
    const unlinkedTruckUserId = userIds.get("smoke_unlinked_food_truck")!;

    const smokeTruckRestaurantId = await ensureSmokeRestaurant(client, {
      ownerId: linkedTruckUserId,
      key: "food_truck",
      name: valueOr("SMOKE_TRUCK_NAME", "Smoke Test Truck"),
      businessType: "food_truck",
      address: valueOr("SMOKE_TRUCK_ADDRESS", "100 Smoke Test Dr"),
      city: valueOr("SMOKE_MARKET_CITY", "Pensacola"),
      state: valueOr("SMOKE_MARKET_STATE", "FL"),
    });

    const smokeRestaurantId = await ensureSmokeRestaurant(client, {
      ownerId: linkedRestaurantUserId,
      key: "restaurant",
      name: valueOr("SMOKE_RESTAURANT_NAME", "Smoke Test Restaurant"),
      businessType: "restaurant",
      address: valueOr("SMOKE_RESTAURANT_ADDRESS", "200 Smoke Test Ave"),
      city: valueOr("SMOKE_MARKET_CITY", "Pensacola"),
      state: valueOr("SMOKE_MARKET_STATE", "FL"),
    });

    await clearUserBusinessLinksExcept(client, linkedTruckUserId, [
      smokeTruckRestaurantId,
    ]);
    await clearUserBusinessLinksExcept(client, linkedRestaurantUserId, [
      smokeRestaurantId,
    ]);
    await clearUserBusinessLinksExcept(client, unlinkedTruckUserId, []);

    await client.query("commit");

    const summary = {
      success: true,
      accounts: Object.fromEntries(userIds),
      linkedRestaurantIds: {
        smoke_linked_food_truck: smokeTruckRestaurantId,
        smoke_restaurant_owner_linked: smokeRestaurantId,
      },
      notes: [
        "Smoke accounts repaired idempotently.",
        "Linked accounts are attached only to smoke-seeded businesses.",
        "Unlinked food_truck account intentionally has no business attachment.",
      ],
    };
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error("[smoke-repair] failed:", error);
  process.exit(1);
});
