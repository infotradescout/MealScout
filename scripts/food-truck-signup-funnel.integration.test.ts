import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import type { AddressInfo } from "node:net";

import bcrypt from "bcryptjs";
import express from "express";
import passport from "passport";
import pg from "pg";
import { neonConfig } from "@neondatabase/serverless";
import { WebSocket, WebSocketServer } from "ws";

const OPT_IN = "MEALSCOUT_FOOD_TRUCK_SIGNUP_DB_TEST";
const EXPECTED_DATABASE = "mealscout_signup_test";

type HttpResult = {
  status: number;
  body: any;
  cookie: string | null;
  headers: Headers;
};

function requireDisposableLocalDatabase() {
  assert.equal(process.env[OPT_IN], "1", `${OPT_IN}=1 is required`);
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  assert.ok(databaseUrl, "DATABASE_URL is required");
  const parsed = new URL(databaseUrl);
  assert.equal(
    parsed.hostname,
    "127.0.0.1",
    "The signup integration proof only accepts a loopback PostgreSQL host.",
  );
  assert.ok(parsed.port, "The disposable PostgreSQL port must be explicit.");
  assert.equal(
    parsed.pathname,
    `/${EXPECTED_DATABASE}`,
    `The disposable database must be named ${EXPECTED_DATABASE}.`,
  );
  assert.equal(
    parsed.searchParams.get("sslmode"),
    "disable",
    "The loopback disposable database must explicitly disable SSL.",
  );
  return { databaseUrl, parsed };
}

async function createLoopbackPostgresWebSocketProxy(
  expectedHost: string,
  expectedPort: number,
) {
  const proxy = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    proxy.once("listening", resolve);
    proxy.once("error", reject);
  });

  proxy.on("connection", (webSocket, request) => {
    const requestUrl = new URL(request.url || "/", "ws://127.0.0.1");
    const address = String(requestUrl.searchParams.get("address") || "");
    const separator = address.lastIndexOf(":");
    const targetHost = address.slice(0, separator);
    const targetPort = Number(address.slice(separator + 1));

    if (targetHost !== expectedHost || targetPort !== expectedPort) {
      webSocket.close(1008, "Unexpected PostgreSQL target");
      return;
    }

    const tcp = net.createConnection({ host: targetHost, port: targetPort });
    webSocket.on("message", (data) => tcp.write(Buffer.from(data as any)));
    webSocket.on("close", () => tcp.end());
    webSocket.on("error", (error) => {
      console.error("Disposable PostgreSQL WebSocket client error:", error);
      tcp.destroy();
    });
    tcp.on("data", (data) => {
      if (webSocket.readyState === WebSocket.OPEN) webSocket.send(data);
    });
    tcp.on("error", (error) => {
      console.error("Disposable PostgreSQL TCP proxy error:", error);
      webSocket.close(1011, "PostgreSQL connection failed");
    });
    tcp.on("close", () => webSocket.close());
  });

  return proxy;
}

function closeWebSocketProxy(proxy: WebSocketServer) {
  for (const client of proxy.clients) client.terminate();
  return new Promise<void>((resolve, reject) => {
    proxy.close((error) => (error ? reject(error) : resolve()));
  });
}

async function run() {
  const { databaseUrl, parsed } = requireDisposableLocalDatabase();

  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = `food-truck-signup-${randomUUID()}`;
  process.env.PUBLIC_BASE_URL = "http://127.0.0.1";
  process.env.ADMIN_EMAIL = `no-admin-${randomUUID()}@example.test`;
  process.env.VAC_AUTO_VERIFY_ENABLED = "false";
  process.env.EMAIL_NOTIFICATIONS_MODE = "off";
  process.env.MERLIN_OR_ENABLED = "false";
  delete process.env.BREVO_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY;

  const wsProxy = await createLoopbackPostgresWebSocketProxy(
    parsed.hostname,
    Number(parsed.port),
  );
  const wsAddress = wsProxy.address() as AddressInfo;
  neonConfig.webSocketConstructor = WebSocket;
  neonConfig.wsProxy = (host, port) =>
    `127.0.0.1:${wsAddress.port}/v2?address=${host}:${port}`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.forceDisablePgSSL = true;
  neonConfig.pipelineConnect = false;
  neonConfig.pipelineTLS = false;

  const nativePool = new pg.Pool({ connectionString: databaseUrl });
  let server: import("node:http").Server | null = null;
  let applicationPool: { end: () => Promise<void> } | null = null;
  let restoreWelcomeEmail: (() => void) | null = null;
  const originalFetch = globalThis.fetch;

  const ownerIds = {
    claimantA: randomUUID(),
    claimantB: randomUUID(),
    concurrentA: randomUUID(),
    concurrentB: randomUUID(),
    legacy: randomUUID(),
    nativeDuplicate: randomUUID(),
    roleFailure: randomUUID(),
    recoveryFalse: randomUUID(),
    recoveryThrow: randomUUID(),
    verifiedReminder: randomUUID(),
    unverifiedReminder: randomUUID(),
    unverifiedFalse: randomUUID(),
    unverifiedThrow: randomUUID(),
    tokenOrdering: randomUUID(),
    setupPreflight: randomUUID(),
    setupValid: randomUUID(),
    claimSameOwner: randomUUID(),
    claimImport: randomUUID(),
    claimForeignClaimant: randomUUID(),
    claimForeignOwner: randomUUID(),
    claimIdentityMismatch: randomUUID(),
    claimCosmetic: randomUUID(),
    claimLinkedOwner: randomUUID(),
    claimLinkedImport: randomUUID(),
    identityClaimA: randomUUID(),
    identityClaimB: randomUUID(),
    ambiguousClaimant: randomUUID(),
    importSystem: randomUUID(),
  };
  const emails = {
    create: `create-${randomUUID()}@example.test`,
    claimantA: `claim-a-${randomUUID()}@example.test`,
    claimantB: `claim-b-${randomUUID()}@example.test`,
    concurrentA: `create-a-${randomUUID()}@example.test`,
    concurrentB: `create-b-${randomUUID()}@example.test`,
    legacy: `legacy-${randomUUID()}@example.test`,
    nativeDuplicate: `native-duplicate-${randomUUID()}@example.test`,
    roleFailure: `role-failure-${randomUUID()}@example.test`,
    recoveryFalse: `recover-false-${randomUUID()}@example.test`,
    recoveryThrow: `recover-throw-${randomUUID()}@example.test`,
    inviteContinuation: `claim-invite-${randomUUID()}@example.test`,
    verifiedReminder: `verified-reminder-${randomUUID()}@example.test`,
    unverifiedReminder: `unverified-reminder-${randomUUID()}@example.test`,
    unverifiedFalse: `unverified-false-${randomUUID()}@example.test`,
    unverifiedThrow: `unverified-throw-${randomUUID()}@example.test`,
    tokenOrdering: `token-ordering-${randomUUID()}@example.test`,
    setupPreflight: `setup-preflight-${randomUUID()}@example.test`,
    setupValid: `setup-valid-${randomUUID()}@example.test`,
    claimSameOwner: `same-owner-${randomUUID()}@example.test`,
    claimImport: `import-reuse-${randomUUID()}@example.test`,
    claimForeignClaimant: `foreign-claimant-${randomUUID()}@example.test`,
    claimForeignOwner: `foreign-owner-${randomUUID()}@example.test`,
    claimIdentityMismatch: `identity-mismatch-${randomUUID()}@example.test`,
    claimCosmetic: `cosmetic-${randomUUID()}@example.test`,
    claimLinkedOwner: `linked-owner-${randomUUID()}@example.test`,
    claimLinkedImport: `linked-import-${randomUUID()}@example.test`,
    identityClaimA: `identity-a-${randomUUID()}@example.test`,
    identityClaimB: `identity-b-${randomUUID()}@example.test`,
    ambiguousClaimant: `ambiguous-${randomUUID()}@example.test`,
  };
  const password = `DbProof-${randomUUID()}!aA7`;
  const claimListingId = randomUUID();
  const unclaimedDuplicateId = randomUUID();
  const claimedDuplicateId = randomUUID();
  const inviteContinuationListingId = randomUUID();
  const recoverFalseListingId = randomUUID();
  const recoverThrowListingId = randomUUID();
  const verifiedReminderListingId = randomUUID();
  const unverifiedReminderListingId = randomUUID();
  const unverifiedFalseListingId = randomUUID();
  const unverifiedThrowListingId = randomUUID();
  const tokenOrderingListingId = randomUUID();
  const expiredSetupToken = `expired-${randomUUID()}`;
  const usedSetupToken = `used-${randomUUID()}`;
  const validSetupToken = `valid-${randomUUID()}`;
  const hashSetupToken = (token: string) =>
    createHash("sha256").update(token).digest("hex");
  const sameOwnerListingId = randomUUID();
  const importReuseListingId = randomUUID();
  const foreignOwnerListingId = randomUUID();
  const identityMismatchListingId = randomUUID();
  const cosmeticListingId = randomUUID();
  const linkedOwnerListingAId = randomUUID();
  const linkedOwnerListingBId = randomUUID();
  const linkedImportListingAId = randomUUID();
  const linkedImportListingBId = randomUUID();
  const identityListingAId = randomUUID();
  const identityListingBId = randomUUID();
  const ambiguousListingId = randomUUID();
  const createAttemptId = randomUUID();
  let createOwnerId = "";
  const publicPhone = "+1-850-555-0199";
  const publicEmail = `registry-${randomUUID()}@example.test`;
  const publicExternalId = `external-${randomUUID()}`;

  try {
    const target = await nativePool.query(
      "select current_database() as database_name",
    );
    assert.equal(target.rows[0]?.database_name, EXPECTED_DATABASE);

    const initial = await nativePool.query(`
      select
        (select count(*)::int from users) as users,
        (select count(*)::int from restaurants) as restaurants,
        (select count(*)::int from truck_import_listings) as listings
    `);
    assert.deepEqual(
      initial.rows[0],
      { users: 0, restaurants: 0, listings: 0 },
      "The database must be a newly-created empty disposable fixture.",
    );

    const passwordHash = await bcrypt.hash(password, 4);
    for (const key of [
      "claimantA",
      "claimantB",
      "concurrentA",
      "concurrentB",
      "legacy",
      "nativeDuplicate",
      "roleFailure",
      "recoveryFalse",
      "recoveryThrow",
      "verifiedReminder",
      "claimSameOwner",
      "claimImport",
      "claimForeignClaimant",
      "claimForeignOwner",
      "claimIdentityMismatch",
      "claimCosmetic",
      "claimLinkedOwner",
      "claimLinkedImport",
      "identityClaimA",
      "identityClaimB",
      "ambiguousClaimant",
    ] as const) {
      await nativePool.query(
        `insert into users
           (id, email, password_hash, email_verified, user_type, first_name, last_name)
         values ($1, $2, $3, true, 'customer', 'DB', 'Proof')`,
        [ownerIds[key], emails[key], passwordHash],
      );
    }

    for (const key of [
      "unverifiedReminder",
      "unverifiedFalse",
      "unverifiedThrow",
    ] as const) {
      await nativePool.query(
        `insert into users
           (id, email, password_hash, email_verified, user_type, first_name, last_name)
         values ($1, $2, $3, false, 'customer', 'DB', 'Proof')`,
        [ownerIds[key], emails[key], passwordHash],
      );
    }
    await nativePool.query(
      `insert into users
         (id, email, password_hash, email_verified, user_type, first_name, last_name)
       values
         ($1, $2, null, false, 'customer', 'Token', 'Ordering'),
         ($3, 'system-import@mealscout.us', null, true, 'customer', 'Import', 'System'),
         ($4, $5, null, false, 'customer', 'Rejected', 'Original'),
         ($6, $7, null, false, 'customer', 'Valid', 'Original')`,
      [
        ownerIds.tokenOrdering,
        emails.tokenOrdering,
        ownerIds.importSystem,
        ownerIds.setupPreflight,
        emails.setupPreflight,
        ownerIds.setupValid,
        emails.setupValid,
      ],
    );

    await nativePool.query(
      `insert into account_setup_tokens
         (id, user_id, token_hash, expires_at, used_at)
       values
         ($1, $2, $3, now() - interval '1 hour', null),
         ($4, $2, $5, now() + interval '1 hour', now()) ,
         ($6, $7, $8, now() + interval '1 hour', null)`,
      [
        randomUUID(),
        ownerIds.setupPreflight,
        hashSetupToken(expiredSetupToken),
        randomUUID(),
        hashSetupToken(usedSetupToken),
        randomUUID(),
        ownerIds.setupValid,
        hashSetupToken(validSetupToken),
      ],
    );

    await nativePool.query(
      `insert into truck_import_listings
         (id, name, address, city, state, phone, email, external_id,
          latitude, longitude, confidence_score, status)
       values
         ($1, 'Concurrency Taco Truck', '101 Claim Lane', 'Austin', 'TX',
          $2, $3, $4, '30.26720000', '-97.74310000', 97, 'unclaimed'),
         ($5, 'Existing Registry Truck', '202 Duplicate Ave', 'Austin', 'TX',
          null, null, null, '30.26720000', '-97.74310000', 80, 'unclaimed'),
         ($6, 'Already Claimed Truck', '303 Claimed Road', 'Austin', 'TX',
          null, null, null, '30.26720000', '-97.74310000', 75, 'claimed'),
         ($7, 'Invited Exact Claim Truck', '505 Continuation Court', 'Austin', 'TX',
          null, $8, null, '30.26720000', '-97.74310000', 70, 'claim_requested'),
         ($9, 'Retry Attach Truck', '606 Recovery Row', 'Austin', 'TX',
          null, $10, null, '30.26720000', '-97.74310000', 65, 'unclaimed'),
         ($11, 'Retry Existing Pointer Truck', '707 Recovery Row', 'Austin', 'TX',
          null, $12, null, '30.26720000', '-97.74310000', 60, 'unclaimed')`,
      [
        claimListingId,
        publicPhone,
        publicEmail,
        publicExternalId,
        unclaimedDuplicateId,
        claimedDuplicateId,
        inviteContinuationListingId,
        emails.inviteContinuation,
        recoverFalseListingId,
        emails.recoveryFalse,
        recoverThrowListingId,
        emails.recoveryThrow,
      ],
    );
    await nativePool.query(
      `update truck_import_listings
       set invited_user_id = $1
       where id = $2`,
      [ownerIds.recoveryThrow, recoverThrowListingId],
    );

    await nativePool.query(
      `insert into restaurants
         (id, owner_id, name, address, city, state, business_type, is_food_truck, is_active)
       values ($1, $2, 'Legacy Alias Truck', '808 Legacy Drive', 'Austin', 'TX',
               ' Mobile_Food_Vendor ', false, true)`,
      [randomUUID(), ownerIds.legacy],
    );

    const reminderListings = [
      {
        id: verifiedReminderListingId,
        name: "Verified Password Reminder Truck",
        address: "901 Verified Way",
        email: emails.verifiedReminder,
        userId: ownerIds.verifiedReminder,
      },
      {
        id: unverifiedReminderListingId,
        name: "Unverified Password Reminder Truck",
        address: "902 Verification Way",
        email: emails.unverifiedReminder,
        userId: ownerIds.unverifiedReminder,
      },
      {
        id: unverifiedFalseListingId,
        name: "Unverified False Reminder Truck",
        address: "903 Verification Way",
        email: emails.unverifiedFalse,
        userId: ownerIds.unverifiedFalse,
      },
      {
        id: unverifiedThrowListingId,
        name: "Unverified Throw Reminder Truck",
        address: "904 Verification Way",
        email: emails.unverifiedThrow,
        userId: ownerIds.unverifiedThrow,
      },
      {
        id: tokenOrderingListingId,
        name: "Token Ordering Truck",
        address: "905 Setup Token Way",
        email: emails.tokenOrdering,
        userId: ownerIds.tokenOrdering,
      },
    ];
    for (const listing of reminderListings) {
      await nativePool.query(
        `insert into truck_import_listings
           (id, name, address, city, state, email, invited_user_id,
            latitude, longitude, confidence_score, status)
         values ($1, $2, $3, 'Austin', 'TX', $4, $5,
                 '30.26720000', '-97.74310000', 55, 'unclaimed')`,
        [listing.id, listing.name, listing.address, listing.email, listing.userId],
      );
    }

    const claimListings = [
      [sameOwnerListingId, "Same Owner Reuse Truck", "1100 Reuse Road"],
      [importReuseListingId, "Import Reuse Truck", "1200 Transfer Trail"],
      [foreignOwnerListingId, "Foreign Owner Truck", "1300 Conflict Court"],
      [identityMismatchListingId, "Authoritative Claim Truck", "1350 Listing Lane"],
      [cosmeticListingId, "Cosmetic Claim Truck", "1360 Cosmetic Lane"],
      [linkedOwnerListingAId, "Owner Linked Identity Truck", "1370 Link Lock"],
      [linkedOwnerListingBId, "OWNER---LINKED IDENTITY TRUCK!!!", "1370 link lock."],
      [linkedImportListingAId, "Import Linked Identity Truck", "1380 Link Lock"],
      [linkedImportListingBId, "IMPORT---LINKED IDENTITY TRUCK!!!", "1380 link lock."],
      [identityListingAId, "Shared Identity Truck", "1400 Lock Lane"],
      [identityListingBId, "SHARED---IDENTITY TRUCK!!!", "1400 lock lane."],
      [ambiguousListingId, "Ambiguous Identity Truck", "1500 Duplicate Drive"],
    ] as const;
    for (const [id, name, address] of claimListings) {
      await nativePool.query(
        `insert into truck_import_listings
           (id, name, address, city, state, latitude, longitude,
            confidence_score, status)
         values ($1, $2, $3, 'Austin', 'TX', '30.26720000', '-97.74310000',
                 50, 'unclaimed')`,
        [id, name, address],
      );
    }

    await nativePool.query(
      `update truck_import_listings
       set status = 'claimed'
       where id in ($1, $2)`,
      [linkedOwnerListingAId, linkedImportListingAId],
    );

    await nativePool.query(
      `insert into restaurants
         (id, owner_id, name, address, city, state, business_type,
          is_food_truck, is_active, claimed_from_import_id)
       values
         ($1, $2, 'Old Linked Name', 'Old Linked Address', 'Austin', 'TX',
          'restaurant', false, true, $3),
         ($4, $5, 'IMPORT---REUSE TRUCK!!!', '1200 transfer trail.', 'Austin', 'TX',
          ' MOBILE_FOOD_VENDOR ', false, true, null),
         ($6, $7, 'FOREIGN owner truck', '1300 conflict court!!!', 'Austin', 'TX',
          'food-truck', false, true, null),
         ($8, $9, 'Ambiguous Identity Truck', '1500 Duplicate Drive', 'Austin', 'TX',
          'food_truck', true, true, null),
         ($10, $11, 'AMBIGUOUS---IDENTITY TRUCK', '1500 duplicate drive.', 'Austin', 'TX',
          'mobile_food_vendor', false, true, null),
         ($12, $13, 'Stale Owner Profile', '1 Historical Place', 'Austin', 'TX',
          'restaurant', false, true, $14),
         ($15, $16, 'Stale Import Profile', '2 Historical Place', 'Austin', 'TX',
          'restaurant', false, true, $17)`,
      [
        randomUUID(),
        ownerIds.claimSameOwner,
        sameOwnerListingId,
        randomUUID(),
        ownerIds.importSystem,
        randomUUID(),
        ownerIds.claimForeignOwner,
        randomUUID(),
        ownerIds.ambiguousClaimant,
        randomUUID(),
        ownerIds.importSystem,
        randomUUID(),
        ownerIds.claimLinkedOwner,
        linkedOwnerListingAId,
        randomUUID(),
        ownerIds.importSystem,
        linkedImportListingAId,
      ],
    );

    // Hold the winning UPDATE's row lock long enough for the second HTTP claim
    // to enter PostgreSQL and wait on the same row. This is a disposable-only
    // fixture that proves the actual transaction predicate under contention.
    await nativePool.query(`
      create function mealscout_test_pause_claim_processing()
      returns trigger language plpgsql as $$
      begin
        if new.status = 'claim_processing' then
          perform pg_sleep(0.25);
        end if;
        return new;
      end;
      $$;
      create trigger mealscout_test_pause_claim_processing
      before update on truck_import_listings
      for each row execute function mealscout_test_pause_claim_processing();

      create function mealscout_test_pause_atomic_food_truck_create()
      returns trigger language plpgsql as $$
      begin
        if new.name = 'Atomic Twin Truck' then
          perform pg_sleep(0.25);
        end if;
        return new;
      end;
      $$;
      create trigger mealscout_test_pause_atomic_food_truck_create
      before insert on restaurants
      for each row execute function mealscout_test_pause_atomic_food_truck_create();
    `);

    const { pool } = await import("../server/db");
    applicationPool = pool;
    const { getSession, setupUnifiedAuth } = await import("../server/unifiedAuth");
    const { registerRestaurantSignupRoutes } = await import(
      "../server/routes/restaurantSignupRoutes"
    );
    const { registerTruckClaimRoutes } = await import(
      "../server/routes/truckClaimRoutes"
    );
    const { storage } = await import("../server/storage");
    const { sendAccountSetupInvite } = await import(
      "../server/utils/accountSetup"
    );
    const { emailService } = await import("../server/emailService");
    const originalSendWelcomeEmail = emailService.sendWelcomeEmail;
    const setupWelcomeCalls: string[] = [];
    const accountSetupHashInputs: string[] = [];
    emailService.sendWelcomeEmail = async (user) => {
      if (String(user.id) === ownerIds.tokenOrdering) {
        setupWelcomeCalls.push(String(user.id));
      }
      return false;
    };
    restoreWelcomeEmail = () => {
      emailService.sendWelcomeEmail = originalSendWelcomeEmail;
    };

    type DeliveryMode = "success" | "false" | "throw";
    const deliveryModes = new Map<string, DeliveryMode>();
    const verificationDeliveryModes = new Map<string, DeliveryMode>();
    const signInDeliveryModes = new Map<string, DeliveryMode>();
    const capturedSetupUrls = new Map<string, string>();
    const capturedSetupUrlHistory = new Map<string, string[]>();
    const capturedVerificationContinuations = new Map<string, string[]>();
    const capturedSignInContinuations = new Map<string, string[]>();
    const capture = (
      target: Map<string, string[]>,
      email: string,
      value: string,
    ) => target.set(email, [...(target.get(email) || []), value]);
    const sendSetupInvite: typeof sendAccountSetupInvite = (options) =>
      sendAccountSetupInvite(options, {
        createAccountSetupToken: (token) =>
          storage.createAccountSetupToken(token),
        deleteAccountSetupToken: (tokenId) =>
          storage.deleteAccountSetupToken(tokenId),
        sendAccountSetupEmail: async (user, setupUrl) => {
          const email = String(user.email || "").toLowerCase();
          capturedSetupUrls.set(email, setupUrl);
          capture(capturedSetupUrlHistory, email, setupUrl);
          const mode = deliveryModes.get(email) || "success";
          if (mode === "throw") throw new Error("test delivery rejection");
          return mode !== "false";
        },
      });
    const sendVerificationInvite = async (
      user: any,
      _req: any,
      continuationPath?: string | null,
    ) => {
      const email = String(user.email || "").toLowerCase();
      capture(
        capturedVerificationContinuations,
        email,
        String(continuationPath || ""),
      );
      const mode = verificationDeliveryModes.get(email) || "success";
      if (mode === "throw") throw new Error("test verification rejection");
      return mode === "false"
        ? ({ sent: false, skippedReason: "send_failed" } as const)
        : ({ sent: true } as const);
    };
    const sendSignInInvite = async (
      user: any,
      _req: any,
      continuationPath: string,
    ) => {
      const email = String(user.email || "").toLowerCase();
      capture(capturedSignInContinuations, email, continuationPath);
      const mode = signInDeliveryModes.get(email) || "success";
      if (mode === "throw") throw new Error("test sign-in rejection");
      return mode !== "false";
    };

    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json({ limit: "1mb" }));
    app.use(getSession());
    app.use(passport.initialize());
    app.use(passport.session());
    await setupUnifiedAuth(app, {
      hashAccountSetupPassword: async (setupPassword) => {
        accountSetupHashInputs.push(setupPassword);
        return bcrypt.hash(setupPassword, 12);
      },
    });
    registerRestaurantSignupRoutes(app, {
      ensureTrialForUser: async (user) => user,
      queueSocialPost: async () => null,
    });
    registerTruckClaimRoutes(app, {
      sendSetupInvite,
      sendVerificationInvite,
      sendSignInInvite,
      enrichClaimedProfile: async () => undefined,
      sendClaimVerification: async () => ({
        sent: false,
        skippedReason: "provider_not_configured" as const,
      }),
      sendClaimAdminNotice: async () => false,
    });

    server = await new Promise<import("node:http").Server>((resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      listener.once("error", reject);
    });
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Application HTTP is constrained to this disposable loopback server. The
    // PostgreSQL proxy uses raw TCP/WebSocket and is separately host-checked.
    globalThis.fetch = ((input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      if (url.hostname !== "127.0.0.1" || url.port !== String(address.port)) {
        throw new Error(`External HTTP egress blocked during DB proof: ${url.origin}`);
      }
      return originalFetch(input as any, init);
    }) as typeof fetch;

    const request = async (
      path: string,
      options: {
        method?: string;
        cookie?: string | null;
        body?: unknown;
        ip?: string;
      } = {},
    ): Promise<HttpResult> => {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (options.cookie) headers.Cookie = options.cookie;
      if (options.ip) headers["X-Forwarded-For"] = options.ip;
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      const setCookie = response.headers.get("set-cookie");
      return {
        status: response.status,
        body,
        cookie: setCookie ? setCookie.split(";", 1)[0] : null,
        headers: response.headers,
      };
    };

    const login = async (email: string) => {
      const result = await request("/api/auth/restaurant/login", {
        method: "POST",
        body: { email, password },
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.ok(result.cookie, "Authenticated login must return a session cookie.");
      return result.cookie;
    };

    const continuationPath =
      "/restaurant-signup?businessType=food_truck&intent=create&source=email";
    const registered = await request("/api/auth/restaurant/register", {
      method: "POST",
      body: {
        email: emails.create,
        firstName: "Email",
        lastName: "Owner",
        phone: "+1 850 555 0101",
        password,
        acceptTerms: true,
        businessType: "food_truck",
        intendedNextPath: continuationPath,
      },
    });
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    const registeredTruth = await nativePool.query(
      `select id, user_type,
         (select count(*)::int from restaurants where owner_id = users.id) as profiles
       from users where lower(email) = lower($1)`,
      [emails.create],
    );
    assert.equal(registeredTruth.rowCount, 1);
    assert.equal(registeredTruth.rows[0].user_type, "customer");
    assert.equal(registeredTruth.rows[0].profiles, 0);
    createOwnerId = registeredTruth.rows[0].id;
    await nativePool.query(
      `update users set email_verified = true where id = $1`,
      [createOwnerId],
    );

    const createCookie = await login(emails.create);
    const claimantACookie = await login(emails.claimantA);
    const claimantBCookie = await login(emails.claimantB);
    const concurrentACookie = await login(emails.concurrentA);
    const concurrentBCookie = await login(emails.concurrentB);
    const nativeDuplicateCookie = await login(emails.nativeDuplicate);
    const roleFailureCookie = await login(emails.roleFailure);
    const sameOwnerCookie = await login(emails.claimSameOwner);
    const importReuseCookie = await login(emails.claimImport);
    const foreignClaimantCookie = await login(emails.claimForeignClaimant);
    const identityMismatchCookie = await login(emails.claimIdentityMismatch);
    const cosmeticClaimCookie = await login(emails.claimCosmetic);
    const linkedOwnerCookie = await login(emails.claimLinkedOwner);
    const linkedImportCookie = await login(emails.claimLinkedImport);
    const identityClaimACookie = await login(emails.identityClaimA);
    const identityClaimBCookie = await login(emails.identityClaimB);
    const ambiguousClaimantCookie = await login(emails.ambiguousClaimant);

    const rejectedSetupIp = "198.51.100.40";
    const validSetupIp = "198.51.100.41";
    const rejectedHashCount = accountSetupHashInputs.length;
    const rejectedSetupTokens = [
      `missing-${randomUUID()}`,
      expiredSetupToken,
      usedSetupToken,
      `missing-${randomUUID()}`,
      expiredSetupToken,
    ];
    for (const [index, token] of rejectedSetupTokens.entries()) {
      const rejectedSetup = await request("/api/auth/complete-setup", {
        method: "POST",
        ip: rejectedSetupIp,
        body: {
          token,
          password: `Rejected-${index}-${randomUUID()}!aA7`,
          firstName: `Rejected${index}`,
          lastName: "Mutation",
          phone: "+1 850 555 0140",
        },
      });
      assert.equal(rejectedSetup.status, 409, JSON.stringify(rejectedSetup.body));
      assert.equal(
        rejectedSetup.body.code,
        "account_setup_already_completed",
      );
    }
    assert.equal(
      accountSetupHashInputs.length,
      rejectedHashCount,
      "Rejected setup tokens must not invoke the expensive password hasher.",
    );

    const rateLimitedSetup = await request("/api/auth/complete-setup", {
      method: "POST",
      ip: rejectedSetupIp,
      body: {
        token: usedSetupToken,
        password: `RateLimited-${randomUUID()}!aA7`,
        firstName: "Rate",
        lastName: "Limited",
        phone: "+1 850 555 0141",
      },
    });
    assert.equal(rateLimitedSetup.status, 429, JSON.stringify(rateLimitedSetup.body));
    assert.equal(rateLimitedSetup.headers.get("x-ratelimit-limit"), "5");
    assert.equal(rateLimitedSetup.headers.get("x-ratelimit-remaining"), "0");
    assert.ok(Number(rateLimitedSetup.headers.get("retry-after")) > 0);
    assert.ok(rateLimitedSetup.headers.get("x-ratelimit-reset"));
    assert.equal(accountSetupHashInputs.length, rejectedHashCount);

    const rejectedSetupTruth = await nativePool.query(
      `select password_hash, first_name, last_name, phone, email_verified,
              (select count(*)::int from account_setup_tokens where user_id = users.id) as tokens,
              (select count(*)::int from account_setup_tokens
               where user_id = users.id and used_at is not null) as used_tokens
       from users where id = $1`,
      [ownerIds.setupPreflight],
    );
    assert.deepEqual(rejectedSetupTruth.rows[0], {
      password_hash: null,
      first_name: "Rejected",
      last_name: "Original",
      phone: null,
      email_verified: false,
      tokens: 2,
      used_tokens: 1,
    });

    const validSetupPassword = `Valid-${randomUUID()}!aA7`;
    const validSetup = await request("/api/auth/complete-setup", {
      method: "POST",
      ip: validSetupIp,
      body: {
        token: validSetupToken,
        password: validSetupPassword,
        firstName: "ValidWinner",
        lastName: "Completed",
        phone: "+1 850 555 0142",
      },
    });
    assert.equal(validSetup.status, 200, JSON.stringify(validSetup.body));
    assert.deepEqual(accountSetupHashInputs, [validSetupPassword]);
    const validSetupTruth = await nativePool.query(
      `select password_hash, first_name, last_name, phone, email_verified,
              (select count(*)::int from account_setup_tokens where user_id = users.id) as tokens
       from users where id = $1`,
      [ownerIds.setupValid],
    );
    assert.equal(validSetupTruth.rows[0].first_name, "ValidWinner");
    assert.equal(validSetupTruth.rows[0].last_name, "Completed");
    assert.equal(validSetupTruth.rows[0].phone, "18505550142");
    assert.equal(validSetupTruth.rows[0].email_verified, true);
    assert.equal(validSetupTruth.rows[0].tokens, 0);
    assert.equal(bcrypt.getRounds(validSetupTruth.rows[0].password_hash), 12);
    assert.equal(
      await bcrypt.compare(validSetupPassword, validSetupTruth.rows[0].password_hash),
      true,
    );

    const setupRateLimitTruth = await nativePool.query(
      `select identity_key, count
       from rate_limit_counters
       where scope = 'auth:complete-account-setup'
         and identity_key in ($1, $2)
       order by identity_key`,
      [rejectedSetupIp, validSetupIp],
    );
    assert.deepEqual(setupRateLimitTruth.rows, [
      { identity_key: rejectedSetupIp, count: 6 },
      { identity_key: validSetupIp, count: 1 },
    ]);

    const publicSearch = await request(
      `/api/truck-claims/public-search?q=${encodeURIComponent("Concurrency Taco Truck")}`,
    );
    assert.equal(publicSearch.status, 200);
    assert.equal(publicSearch.body.length, 1);
    assert.equal(publicSearch.body[0].id, claimListingId);
    assert.deepEqual(Object.keys(publicSearch.body[0]).sort(), [
      "address",
      "city",
      "id",
      "name",
      "state",
    ]);
    const publicBody = JSON.stringify(publicSearch.body);
    assert.equal(publicBody.includes(publicPhone), false);
    assert.equal(publicBody.includes(publicEmail), false);
    assert.equal(publicBody.includes(publicExternalId), false);

    const exactSelection = await request(
      `/api/truck-claims/search?listingId=${encodeURIComponent(claimListingId)}`,
      { cookie: claimantACookie },
    );
    assert.equal(exactSelection.status, 200);
    assert.equal(exactSelection.body.length, 1);
    assert.equal(exactSelection.body[0].id, claimListingId);
    assert.equal(exactSelection.body[0].canClaim, true);

    const genericReminderBody = {
      success: true,
      message: "If setup can be sent for this listing, the owner will receive it.",
    };
    const assertExactClaimContinuation = (
      value: string | undefined,
      listingId: string,
      q: string,
    ) => {
      assert.ok(value, "Claim reminder must preserve a continuation path.");
      const parsed = new URL(value, "https://www.mealscout.us");
      assert.equal(parsed.origin, "https://www.mealscout.us");
      assert.equal(parsed.pathname, "/restaurant-signup");
      assert.deepEqual([...parsed.searchParams.keys()].sort(), [
        "businessType",
        "claim",
        "claimListingId",
        "intent",
        "q",
        "source",
      ]);
      assert.equal(parsed.searchParams.get("businessType"), "food_truck");
      assert.equal(parsed.searchParams.get("intent"), "claim");
      assert.equal(parsed.searchParams.get("claim"), "1");
      assert.equal(parsed.searchParams.get("claimListingId"), listingId);
      assert.equal(parsed.searchParams.get("q"), q);
      assert.equal(parsed.searchParams.get("source"), "setup-invite");
      return value;
    };
    const readSetupUrl = (value: string | undefined) => {
      assert.ok(value, "Setup delivery must expose its URL to the test harness.");
      const parsed = new URL(value);
      const token = parsed.searchParams.get("token");
      const redirect = parsed.searchParams.get("redirect");
      assert.ok(token, "Setup URL must contain an opaque setup token.");
      assert.ok(redirect, "Setup URL must contain the claim continuation.");
      return { token, redirect };
    };
    const inviteRequest = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: createCookie,
      body: { listingId: inviteContinuationListingId },
    });
    assert.equal(inviteRequest.status, 202);
    assert.deepEqual(inviteRequest.body, genericReminderBody);
    const setupUrl = capturedSetupUrls.get(
      emails.inviteContinuation.toLowerCase(),
    );
    assert.ok(setupUrl, "Accepted invite delivery must expose its test URL.");
    const parsedSetupUrl = new URL(setupUrl);
    const setupToken = parsedSetupUrl.searchParams.get("token");
    const exactInviteContinuation = parsedSetupUrl.searchParams.get("redirect");
    assert.ok(setupToken);
    assert.equal(
      exactInviteContinuation,
      `/restaurant-signup?businessType=food_truck&intent=claim&source=setup-invite&claim=1&q=Invited+Exact+Claim+Truck&claimListingId=${inviteContinuationListingId}`,
    );

    const inviteSetupPassword = `Invite-${randomUUID()}!aA7`;
    const completedSetup = await request("/api/auth/complete-setup", {
      method: "POST",
      ip: "198.51.100.50",
      body: {
        token: setupToken,
        password: inviteSetupPassword,
        firstName: "Invited",
        lastName: "Owner",
        phone: "+1 850 555 0102",
        redirect: exactInviteContinuation,
      },
    });
    assert.equal(completedSetup.status, 200, JSON.stringify(completedSetup.body));
    assert.equal(completedSetup.body.redirect, exactInviteContinuation);
    const invitedTruth = await nativePool.query(
      `select u.id, u.user_type, u.email_verified,
              (select count(*)::int from restaurants where owner_id = u.id) as profiles,
              l.invited_user_id
       from users u
       join truck_import_listings l on l.id = $2
       where lower(u.email) = lower($1)`,
      [emails.inviteContinuation, inviteContinuationListingId],
    );
    assert.equal(invitedTruth.rowCount, 1);
    assert.equal(invitedTruth.rows[0].user_type, "customer");
    assert.equal(invitedTruth.rows[0].email_verified, true);
    assert.equal(invitedTruth.rows[0].profiles, 0);
    assert.equal(invitedTruth.rows[0].invited_user_id, invitedTruth.rows[0].id);
    const invitedLogin = await request("/api/auth/restaurant/login", {
      method: "POST",
      body: { email: emails.inviteContinuation, password: inviteSetupPassword },
    });
    assert.equal(invitedLogin.status, 200, JSON.stringify(invitedLogin.body));
    assert.ok(invitedLogin.cookie);
    const invitedExactSelection = await request(
      `/api/truck-claims/search?listingId=${encodeURIComponent(inviteContinuationListingId)}`,
      { cookie: invitedLogin.cookie },
    );
    assert.equal(invitedExactSelection.status, 200);
    assert.equal(invitedExactSelection.body[0].id, inviteContinuationListingId);
    assert.equal(invitedExactSelection.body[0].canClaim, true);

    const verifiedReminder = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: createCookie,
      body: { listingId: verifiedReminderListingId },
    });
    assert.equal(verifiedReminder.status, 202);
    assert.deepEqual(verifiedReminder.body, genericReminderBody);
    assertExactClaimContinuation(
      capturedSignInContinuations.get(emails.verifiedReminder.toLowerCase())?.[0],
      verifiedReminderListingId,
      "Verified Password Reminder Truck",
    );
    assert.equal(
      capturedSetupUrlHistory.has(emails.verifiedReminder.toLowerCase()),
      false,
      "A verified password account must never receive an account-setup link.",
    );
    assert.equal(
      capturedVerificationContinuations.has(
        emails.verifiedReminder.toLowerCase(),
      ),
      false,
    );
    const verifiedReminderTruth = await nativePool.query(
      `select l.invited_user_id,
              l.last_invite_sent_at is not null as reserved,
              (select count(*)::int from account_setup_tokens where user_id = $2) as setup_tokens
       from truck_import_listings l where l.id = $1`,
      [verifiedReminderListingId, ownerIds.verifiedReminder],
    );
    assert.deepEqual(verifiedReminderTruth.rows[0], {
      invited_user_id: ownerIds.verifiedReminder,
      reserved: true,
      setup_tokens: 0,
    });

    const unverifiedReminder = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: createCookie,
      body: { listingId: unverifiedReminderListingId },
    });
    assert.equal(unverifiedReminder.status, 202);
    assert.deepEqual(unverifiedReminder.body, genericReminderBody);
    assertExactClaimContinuation(
      capturedVerificationContinuations.get(
        emails.unverifiedReminder.toLowerCase(),
      )?.[0],
      unverifiedReminderListingId,
      "Unverified Password Reminder Truck",
    );
    assert.equal(
      capturedSetupUrlHistory.has(emails.unverifiedReminder.toLowerCase()),
      false,
    );
    assert.equal(
      capturedSignInContinuations.has(emails.unverifiedReminder.toLowerCase()),
      false,
    );
    const unverifiedReminderTruth = await nativePool.query(
      `select l.invited_user_id,
              l.last_invite_sent_at is not null as reserved,
              u.email_verified,
              (select count(*)::int from account_setup_tokens where user_id = u.id) as setup_tokens
       from truck_import_listings l
       join users u on u.id = l.invited_user_id
       where l.id = $1`,
      [unverifiedReminderListingId],
    );
    assert.deepEqual(unverifiedReminderTruth.rows[0], {
      invited_user_id: ownerIds.unverifiedReminder,
      reserved: true,
      email_verified: false,
      setup_tokens: 0,
    });

    verificationDeliveryModes.set(
      emails.unverifiedFalse.toLowerCase(),
      "false",
    );
    const unverifiedFalseDelivery = await request(
      "/api/truck-claims/request",
      {
        method: "POST",
        cookie: claimantACookie,
        body: { listingId: unverifiedFalseListingId },
      },
    );
    assert.equal(unverifiedFalseDelivery.status, 202);
    assert.deepEqual(unverifiedFalseDelivery.body, genericReminderBody);
    assertExactClaimContinuation(
      capturedVerificationContinuations.get(
        emails.unverifiedFalse.toLowerCase(),
      )?.[0],
      unverifiedFalseListingId,
      "Unverified False Reminder Truck",
    );
    const unverifiedFalseRecovery = await nativePool.query(
      `select invited_user_id, last_invite_sent_at,
              (select count(*)::int from users where id = $2) as users
       from truck_import_listings where id = $1`,
      [unverifiedFalseListingId, ownerIds.unverifiedFalse],
    );
    assert.deepEqual(unverifiedFalseRecovery.rows[0], {
      invited_user_id: ownerIds.unverifiedFalse,
      last_invite_sent_at: null,
      users: 1,
    });
    verificationDeliveryModes.set(
      emails.unverifiedFalse.toLowerCase(),
      "success",
    );
    const unverifiedFalseRetry = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: claimantACookie,
      body: { listingId: unverifiedFalseListingId },
    });
    assert.equal(unverifiedFalseRetry.status, 202);
    assert.equal(
      (
        await nativePool.query(
          `select last_invite_sent_at is not null as reserved
           from truck_import_listings where id = $1`,
          [unverifiedFalseListingId],
        )
      ).rows[0].reserved,
      true,
    );

    verificationDeliveryModes.set(
      emails.unverifiedThrow.toLowerCase(),
      "throw",
    );
    const unverifiedThrowDelivery = await request(
      "/api/truck-claims/request",
      {
        method: "POST",
        cookie: claimantBCookie,
        body: { listingId: unverifiedThrowListingId },
      },
    );
    assert.equal(unverifiedThrowDelivery.status, 202);
    assert.deepEqual(unverifiedThrowDelivery.body, genericReminderBody);
    assertExactClaimContinuation(
      capturedVerificationContinuations.get(
        emails.unverifiedThrow.toLowerCase(),
      )?.[0],
      unverifiedThrowListingId,
      "Unverified Throw Reminder Truck",
    );
    const unverifiedThrowRecovery = await nativePool.query(
      `select invited_user_id, last_invite_sent_at,
              (select count(*)::int from users where id = $2) as users
       from truck_import_listings where id = $1`,
      [unverifiedThrowListingId, ownerIds.unverifiedThrow],
    );
    assert.deepEqual(unverifiedThrowRecovery.rows[0], {
      invited_user_id: ownerIds.unverifiedThrow,
      last_invite_sent_at: null,
      users: 1,
    });
    verificationDeliveryModes.set(
      emails.unverifiedThrow.toLowerCase(),
      "success",
    );
    const unverifiedThrowRetry = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: claimantBCookie,
      body: { listingId: unverifiedThrowListingId },
    });
    assert.equal(unverifiedThrowRetry.status, 202);
    assert.equal(
      (
        await nativePool.query(
          `select last_invite_sent_at is not null as reserved
           from truck_import_listings where id = $1`,
          [unverifiedThrowListingId],
        )
      ).rows[0].reserved,
      true,
    );

    signInDeliveryModes.set(emails.recoveryFalse.toLowerCase(), "false");
    const falseDelivery = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: claimantACookie,
      body: { listingId: recoverFalseListingId },
    });
    assert.equal(falseDelivery.status, 202);
    assert.deepEqual(falseDelivery.body, genericReminderBody);
    const falseRecovered = await nativePool.query(
      `select invited_user_id, last_invite_sent_at,
              (select count(*)::int from users where id = $2) as users
       from truck_import_listings where id = $1`,
      [recoverFalseListingId, ownerIds.recoveryFalse],
    );
    assert.deepEqual(falseRecovered.rows[0], {
      invited_user_id: null,
      last_invite_sent_at: null,
      users: 1,
    });
    assertExactClaimContinuation(
      capturedSignInContinuations.get(emails.recoveryFalse.toLowerCase())?.[0],
      recoverFalseListingId,
      "Retry Attach Truck",
    );
    assert.equal(
      capturedSetupUrlHistory.has(emails.recoveryFalse.toLowerCase()),
      false,
    );
    signInDeliveryModes.set(emails.recoveryFalse.toLowerCase(), "success");
    const falseRetry = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: claimantACookie,
      body: { listingId: recoverFalseListingId },
    });
    assert.equal(falseRetry.status, 202);
    assert.deepEqual(falseRetry.body, genericReminderBody);
    const falseRetryTruth = await nativePool.query(
      `select invited_user_id, last_invite_sent_at is not null as reserved
       from truck_import_listings where id = $1`,
      [recoverFalseListingId],
    );
    assert.deepEqual(falseRetryTruth.rows[0], {
      invited_user_id: ownerIds.recoveryFalse,
      reserved: true,
    });

    signInDeliveryModes.set(emails.recoveryThrow.toLowerCase(), "throw");
    const thrownDelivery = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: claimantBCookie,
      body: { listingId: recoverThrowListingId },
    });
    assert.equal(thrownDelivery.status, 202);
    assert.deepEqual(thrownDelivery.body, genericReminderBody);
    const throwRecovered = await nativePool.query(
      `select invited_user_id, last_invite_sent_at,
              (select count(*)::int from users where id = $2) as users
       from truck_import_listings where id = $1`,
      [recoverThrowListingId, ownerIds.recoveryThrow],
    );
    assert.deepEqual(throwRecovered.rows[0], {
      invited_user_id: ownerIds.recoveryThrow,
      last_invite_sent_at: null,
      users: 1,
    });
    assertExactClaimContinuation(
      capturedSignInContinuations.get(emails.recoveryThrow.toLowerCase())?.[0],
      recoverThrowListingId,
      "Retry Existing Pointer Truck",
    );
    assert.equal(
      capturedSetupUrlHistory.has(emails.recoveryThrow.toLowerCase()),
      false,
    );
    signInDeliveryModes.set(emails.recoveryThrow.toLowerCase(), "success");
    const throwRetry = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: claimantBCookie,
      body: { listingId: recoverThrowListingId },
    });
    assert.equal(throwRetry.status, 202);
    assert.deepEqual(throwRetry.body, genericReminderBody);
    const throwRetryTruth = await nativePool.query(
      `select invited_user_id, last_invite_sent_at is not null as reserved
       from truck_import_listings where id = $1`,
      [recoverThrowListingId],
    );
    assert.deepEqual(throwRetryTruth.rows[0], {
      invited_user_id: ownerIds.recoveryThrow,
      reserved: true,
    });

    const tokenOrderingEmail = emails.tokenOrdering.toLowerCase();
    const resetTokenOrderingCooldown = () =>
      nativePool.query(
        `update truck_import_listings
         set last_invite_sent_at = null
         where id = $1`,
        [tokenOrderingListingId],
      );
    const validateSetupToken = (token: string) =>
      request(
        `/api/auth/validate-setup-token?token=${encodeURIComponent(token)}`,
      );

    const firstTokenDelivery = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: sameOwnerCookie,
      body: { listingId: tokenOrderingListingId },
    });
    assert.equal(firstTokenDelivery.status, 202);
    const firstSetup = readSetupUrl(
      capturedSetupUrlHistory.get(tokenOrderingEmail)?.[0],
    );
    assertExactClaimContinuation(
      firstSetup.redirect || undefined,
      tokenOrderingListingId,
      "Token Ordering Truck",
    );
    assert.equal((await validateSetupToken(firstSetup.token!)).body.valid, true);

    await resetTokenOrderingCooldown();
    deliveryModes.set(tokenOrderingEmail, "false");
    const falseTokenDelivery = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: importReuseCookie,
      body: { listingId: tokenOrderingListingId },
    });
    assert.equal(falseTokenDelivery.status, 202);
    assert.deepEqual(falseTokenDelivery.body, genericReminderBody);
    const falseSetup = readSetupUrl(
      capturedSetupUrlHistory.get(tokenOrderingEmail)?.[1],
    );
    assert.equal((await validateSetupToken(firstSetup.token!)).body.valid, true);
    assert.equal((await validateSetupToken(falseSetup.token!)).body.valid, false);
    const afterFalseTokenTruth = await nativePool.query(
      `select l.invited_user_id, l.last_invite_sent_at,
              (select count(*)::int from account_setup_tokens where user_id = $2) as tokens,
              (select count(*)::int from users where id = $2) as users
       from truck_import_listings l where l.id = $1`,
      [tokenOrderingListingId, ownerIds.tokenOrdering],
    );
    assert.deepEqual(afterFalseTokenTruth.rows[0], {
      invited_user_id: ownerIds.tokenOrdering,
      last_invite_sent_at: null,
      tokens: 1,
      users: 1,
    });

    deliveryModes.set(tokenOrderingEmail, "throw");
    const thrownTokenDelivery = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: foreignClaimantCookie,
      body: { listingId: tokenOrderingListingId },
    });
    assert.equal(thrownTokenDelivery.status, 202);
    assert.deepEqual(thrownTokenDelivery.body, genericReminderBody);
    const thrownSetup = readSetupUrl(
      capturedSetupUrlHistory.get(tokenOrderingEmail)?.[2],
    );
    assert.equal((await validateSetupToken(firstSetup.token!)).body.valid, true);
    assert.equal((await validateSetupToken(thrownSetup.token!)).body.valid, false);
    const afterThrownTokenTruth = await nativePool.query(
      `select last_invite_sent_at,
              (select count(*)::int from account_setup_tokens where user_id = $2) as tokens
       from truck_import_listings where id = $1`,
      [tokenOrderingListingId, ownerIds.tokenOrdering],
    );
    assert.deepEqual(afterThrownTokenTruth.rows[0], {
      last_invite_sent_at: null,
      tokens: 1,
    });

    deliveryModes.set(tokenOrderingEmail, "success");
    const secondTokenDelivery = await request("/api/truck-claims/request", {
      method: "POST",
      cookie: identityClaimACookie,
      body: { listingId: tokenOrderingListingId },
    });
    assert.equal(secondTokenDelivery.status, 202);
    const secondSetup = readSetupUrl(
      capturedSetupUrlHistory.get(tokenOrderingEmail)?.[3],
    );
    assert.equal((await validateSetupToken(firstSetup.token!)).body.valid, true);
    assert.equal((await validateSetupToken(secondSetup.token!)).body.valid, true);
    assert.equal(
      Number(
        (
          await nativePool.query(
            `select count(*) from account_setup_tokens where user_id = $1`,
            [ownerIds.tokenOrdering],
          )
        ).rows[0].count,
      ),
      2,
    );

    const setupAttempts = [
      {
        token: firstSetup.token!,
        password: `First-${randomUUID()}!aA7`,
        firstName: "FirstToken",
        lastName: "WinnerCandidate",
        phone: "+1 850 555 0113",
        normalizedPhone: "18505550113",
        redirect: firstSetup.redirect,
      },
      {
        token: secondSetup.token!,
        password: `Second-${randomUUID()}!aA7`,
        firstName: "SecondToken",
        lastName: "WinnerCandidate",
        phone: "+1 850 555 0114",
        normalizedPhone: "18505550114",
        redirect: secondSetup.redirect,
      },
    ] as const;
    const setupResults = await Promise.all(
      setupAttempts.map((attempt) =>
        request("/api/auth/complete-setup", {
          method: "POST",
          ip: "198.51.100.51",
          body: attempt,
        }),
      ),
    );
    assert.deepEqual(
      setupResults.map((result) => result.status).sort((a, b) => a - b),
      [200, 409],
    );
    const setupWinnerIndex = setupResults.findIndex(
      (result) => result.status === 200,
    );
    const setupLoserIndex = setupWinnerIndex === 0 ? 1 : 0;
    const setupWinner = setupAttempts[setupWinnerIndex];
    const setupLoser = setupAttempts[setupLoserIndex];
    assert.equal(
      setupResults[setupWinnerIndex].body.redirect,
      setupWinner.redirect,
    );
    assert.equal(
      setupResults[setupLoserIndex].body.code,
      "account_setup_already_completed",
    );
    assert.equal((await validateSetupToken(firstSetup.token!)).body.valid, false);
    assert.equal((await validateSetupToken(secondSetup.token!)).body.valid, false);
    const completedTokenTruth = await nativePool.query(
      `select u.password_hash,
              u.email_verified,
              u.first_name,
              u.last_name,
              u.phone,
              (select count(*)::int from account_setup_tokens where user_id = u.id) as tokens,
              l.invited_user_id
       from users u
       join truck_import_listings l on l.id = $2
       where u.id = $1`,
      [ownerIds.tokenOrdering, tokenOrderingListingId],
    );
    assert.equal(completedTokenTruth.rows[0].email_verified, true);
    assert.equal(completedTokenTruth.rows[0].first_name, setupWinner.firstName);
    assert.equal(completedTokenTruth.rows[0].last_name, setupWinner.lastName);
    assert.equal(completedTokenTruth.rows[0].phone, setupWinner.normalizedPhone);
    assert.equal(completedTokenTruth.rows[0].tokens, 0);
    assert.equal(
      completedTokenTruth.rows[0].invited_user_id,
      ownerIds.tokenOrdering,
    );
    assert.equal(
      await bcrypt.compare(
        setupWinner.password,
        completedTokenTruth.rows[0].password_hash,
      ),
      true,
    );
    assert.equal(
      await bcrypt.compare(
        setupLoser.password,
        completedTokenTruth.rows[0].password_hash,
      ),
      false,
    );
    assert.deepEqual(setupWelcomeCalls, [ownerIds.tokenOrdering]);

    const winnerPasswordLogin = await request("/api/auth/restaurant/login", {
      method: "POST",
      body: { email: emails.tokenOrdering, password: setupWinner.password },
    });
    assert.equal(winnerPasswordLogin.status, 200);
    const loserPasswordLogin = await request("/api/auth/restaurant/login", {
      method: "POST",
      body: { email: emails.tokenOrdering, password: setupLoser.password },
    });
    assert.equal(loserPasswordLogin.status, 401);

    for (const attempt of setupAttempts) {
      const retry = await request("/api/auth/complete-setup", {
        method: "POST",
        ip: "198.51.100.51",
        body: attempt,
      });
      assert.equal(retry.status, 409, JSON.stringify(retry.body));
      assert.equal(retry.body.code, "account_setup_already_completed");
    }
    const afterSetupRetries = await nativePool.query(
      `select first_name, last_name, phone, password_hash,
              (select count(*)::int from account_setup_tokens where user_id = users.id) as tokens
       from users where id = $1`,
      [ownerIds.tokenOrdering],
    );
    assert.equal(afterSetupRetries.rows[0].first_name, setupWinner.firstName);
    assert.equal(afterSetupRetries.rows[0].last_name, setupWinner.lastName);
    assert.equal(afterSetupRetries.rows[0].phone, setupWinner.normalizedPhone);
    assert.equal(afterSetupRetries.rows[0].tokens, 0);
    assert.equal(
      await bcrypt.compare(
        setupWinner.password,
        afterSetupRetries.rows[0].password_hash,
      ),
      true,
    );
    assert.deepEqual(setupWelcomeCalls, [ownerIds.tokenOrdering]);

    const createTermsFailure = await request("/api/restaurants/signup", {
      method: "POST",
      cookie: createCookie,
      body: {
        restaurantData: {
          name: "New Owner Truck",
          address: "404 New Profile Way",
          city: "Austin",
          state: "TX",
          businessType: "food_truck",
          onboardingAttemptId: createAttemptId,
          acceptTerms: false,
        },
      },
    });
    assert.equal(createTermsFailure.status, 400);

    const beforeCreate = await nativePool.query(
      `select user_type from users where id = $1`,
      [createOwnerId],
    );
    assert.equal(beforeCreate.rows[0].user_type, "customer");
    assert.equal(
      Number(
        (
          await nativePool.query(
            `select count(*) from restaurants where owner_id = $1`,
            [createOwnerId],
          )
        ).rows[0].count,
      ),
      0,
    );

    for (const duplicate of [
      { name: "EXISTING---REGISTRY TRUCK", address: "202 duplicate ave!!!" },
      { name: "Already Claimed Truck", address: "303 Claimed Road" },
    ]) {
      const rejected = await request("/api/restaurants/signup", {
        method: "POST",
        cookie: createCookie,
        body: {
          restaurantData: {
            ...duplicate,
            city: "Austin",
            state: "TX",
            businessType: "food_truck",
            onboardingAttemptId: randomUUID(),
            acceptTerms: true,
          },
        },
      });
      assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
      assert.equal(rejected.body.code, "food_truck_identity_exists");
    }

    const created = await request("/api/restaurants/signup", {
      method: "POST",
      cookie: createCookie,
      body: {
        restaurantData: {
          name: "New Owner Truck",
          address: "404 New Profile Way",
          city: "Austin",
          state: "TX",
          businessType: "food_truck",
          cuisineType: "Tacos",
          onboardingAttemptId: createAttemptId,
          acceptTerms: true,
        },
      },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.created, true);
    assert.equal(created.body.completionKind, "create");
    assert.equal(created.body.restaurant.ownerId, createOwnerId);
    assert.equal(created.body.restaurant.businessType, "food_truck");
    const createdTruth = await nativePool.query(
      `select
         (select count(*)::int from restaurants where owner_id = $1) as profiles,
         (select user_type from users where id = $1) as role`,
      [createOwnerId],
    );
    assert.deepEqual(createdTruth.rows[0], { profiles: 1, role: "food_truck" });

    const legacyNativeDuplicate = await request("/api/restaurants/signup", {
      method: "POST",
      cookie: nativeDuplicateCookie,
      body: {
        restaurantData: {
          name: "LEGACY---ALIAS TRUCK",
          address: "808 legacy drive!!!",
          city: "Austin",
          state: "TX",
          businessType: "food_truck",
          onboardingAttemptId: randomUUID(),
          acceptTerms: true,
        },
      },
    });
    assert.equal(
      legacyNativeDuplicate.status,
      409,
      JSON.stringify(legacyNativeDuplicate.body),
    );
    assert.equal(legacyNativeDuplicate.body.code, "food_truck_identity_exists");
    const nativeDuplicateNeutral = await nativePool.query(
      `select user_type,
              (select count(*)::int from restaurants where owner_id = users.id) as profiles
       from users where id = $1`,
      [ownerIds.nativeDuplicate],
    );
    assert.deepEqual(nativeDuplicateNeutral.rows[0], {
      user_type: "customer",
      profiles: 0,
    });

    const atomicPayload = (onboardingAttemptId: string) => ({
      restaurantData: {
        name: "Atomic Twin Truck",
        address: "909 Atomic Avenue",
        city: "Austin",
        state: "TX",
        businessType: "food_truck",
        onboardingAttemptId,
        acceptTerms: true,
      },
    });
    const [atomicA, atomicB] = await Promise.all([
      request("/api/restaurants/signup", {
        method: "POST",
        cookie: concurrentACookie,
        body: atomicPayload(randomUUID()),
      }),
      request("/api/restaurants/signup", {
        method: "POST",
        cookie: concurrentBCookie,
        body: atomicPayload(randomUUID()),
      }),
    ]);
    assert.deepEqual(
      [atomicA.status, atomicB.status].sort((a, b) => a - b),
      [200, 409],
    );
    const atomicSuccess = atomicA.status === 200 ? atomicA : atomicB;
    const atomicConflict = atomicA.status === 409 ? atomicA : atomicB;
    assert.equal(atomicConflict.body.code, "food_truck_identity_exists");
    const atomicWinnerId = String(atomicSuccess.body.restaurant.ownerId);
    const atomicLoserId =
      atomicWinnerId === ownerIds.concurrentA
        ? ownerIds.concurrentB
        : ownerIds.concurrentA;
    const atomicTruth = await nativePool.query(
      `select
         (select count(*)::int from restaurants
          where name = 'Atomic Twin Truck' and address = '909 Atomic Avenue') as profiles,
         (select user_type from users where id = $1) as winner_role,
         (select user_type from users where id = $2) as loser_role,
         (select count(*)::int from restaurants where owner_id = $2) as loser_profiles`,
      [atomicWinnerId, atomicLoserId],
    );
    assert.deepEqual(atomicTruth.rows[0], {
      profiles: 1,
      winner_role: "food_truck",
      loser_role: "customer",
      loser_profiles: 0,
    });

    const roleFailureAttemptId = randomUUID();
    await nativePool.query(`
      create function mealscout_test_reject_food_truck_role()
      returns trigger language plpgsql as $$
      begin
        raise exception 'disposable role promotion failure';
      end;
      $$;
      create trigger mealscout_test_reject_food_truck_role
      before update of user_type on users
      for each row
      when (new.id = '${ownerIds.roleFailure}' and new.user_type = 'food_truck')
      execute function mealscout_test_reject_food_truck_role();
    `);
    const roleFailureBody = {
      restaurantData: {
        name: "Rollback Role Truck",
        address: "1001 Rollback Road",
        city: "Austin",
        state: "TX",
        businessType: "food_truck",
        onboardingAttemptId: roleFailureAttemptId,
        acceptTerms: true,
        menuItems: [
          { name: "Rollback Taco", description: "Atomic fixture", price: "8.00" },
        ],
      },
    };
    const forcedRoleFailure = await request("/api/restaurants/signup", {
      method: "POST",
      cookie: roleFailureCookie,
      body: roleFailureBody,
    });
    assert.equal(forcedRoleFailure.status, 500, JSON.stringify(forcedRoleFailure.body));
    const rollbackTruth = await nativePool.query(
      `select
         (select user_type from users where id = $1) as role,
         (select count(*)::int from restaurants where owner_id = $1) as profiles,
         (select count(*)::int from menus m
          join restaurants r on r.id = m.restaurant_id where r.owner_id = $1) as menus,
         (select count(*)::int from menu_items mi
          join restaurants r on r.id = mi.restaurant_id where r.owner_id = $1) as menu_items`,
      [ownerIds.roleFailure],
    );
    assert.deepEqual(rollbackTruth.rows[0], {
      role: "customer",
      profiles: 0,
      menus: 0,
      menu_items: 0,
    });
    await nativePool.query(`
      drop trigger mealscout_test_reject_food_truck_role on users;
      drop function mealscout_test_reject_food_truck_role();
    `);
    const roleFailureRetry = await request("/api/restaurants/signup", {
      method: "POST",
      cookie: roleFailureCookie,
      body: roleFailureBody,
    });
    assert.equal(roleFailureRetry.status, 200, JSON.stringify(roleFailureRetry.body));
    const retryTruth = await nativePool.query(
      `select
         (select user_type from users where id = $1) as role,
         (select count(*)::int from restaurants where owner_id = $1) as profiles,
         (select count(*)::int from menus m
          join restaurants r on r.id = m.restaurant_id where r.owner_id = $1) as menus,
         (select count(*)::int from menu_items mi
          join restaurants r on r.id = mi.restaurant_id where r.owner_id = $1) as menu_items`,
      [ownerIds.roleFailure],
    );
    assert.deepEqual(retryTruth.rows[0], {
      role: "food_truck",
      profiles: 1,
      menus: 1,
      menu_items: 1,
    });

    const identityMismatchClaim = await request("/api/truck-claims", {
      method: "POST",
      cookie: identityMismatchCookie,
      body: {
        listingId: identityMismatchListingId,
        restaurantData: {
          name: "Different Claim Truck",
          address: "9999 Different Road",
          city: "Round Rock",
          acceptTerms: true,
        },
      },
    });
    assert.equal(
      identityMismatchClaim.status,
      409,
      JSON.stringify(identityMismatchClaim.body),
    );
    assert.equal(
      identityMismatchClaim.body.code,
      "food_truck_claim_identity_mismatch",
    );
    const identityMismatchTruth = await nativePool.query(
      `select
         (select status from truck_import_listings where id = $1) as status,
         (select count(*)::int from truck_claim_requests where listing_id = $1) as claims,
         (select user_type from users where id = $2) as role,
         (select count(*)::int from restaurants where owner_id = $2) as profiles`,
      [identityMismatchListingId, ownerIds.claimIdentityMismatch],
    );
    assert.deepEqual(identityMismatchTruth.rows[0], {
      status: "unclaimed",
      claims: 0,
      role: "customer",
      profiles: 0,
    });

    const cosmeticName = "COSMETIC---CLAIM TRUCK!!!";
    const cosmeticAddress = "1360 cosmetic lane.";
    const cosmeticClaim = await request("/api/truck-claims", {
      method: "POST",
      cookie: cosmeticClaimCookie,
      body: {
        listingId: cosmeticListingId,
        restaurantData: {
          name: cosmeticName,
          address: cosmeticAddress,
          city: "Round Rock",
          description: "Owner-edited non-identity detail",
          acceptTerms: true,
        },
      },
    });
    assert.equal(cosmeticClaim.status, 200, JSON.stringify(cosmeticClaim.body));
    const cosmeticTruth = await nativePool.query(
      `select r.name, r.address, r.city, r.description,
              r.claimed_from_import_id, r.owner_id,
              (select count(*)::int from restaurants where owner_id = $2) as profiles,
              (select count(*)::int from truck_claim_requests where listing_id = $1) as claims,
              (select user_type from users where id = $2) as role,
              (select status from truck_import_listings where id = $1) as status
       from restaurants r where r.claimed_from_import_id = $1`,
      [cosmeticListingId, ownerIds.claimCosmetic],
    );
    assert.deepEqual(cosmeticTruth.rows[0], {
      name: cosmeticName,
      address: cosmeticAddress,
      city: "Round Rock",
      description: "Owner-edited non-identity detail",
      claimed_from_import_id: cosmeticListingId,
      owner_id: ownerIds.claimCosmetic,
      profiles: 1,
      claims: 1,
      role: "food_truck",
      status: "claim_requested",
    });

    const linkedOwnerProfileBefore = await nativePool.query(
      `select id, owner_id, name, address, business_type, is_food_truck,
              claimed_from_import_id
       from restaurants where claimed_from_import_id = $1`,
      [linkedOwnerListingAId],
    );
    assert.deepEqual(linkedOwnerProfileBefore.rows[0], {
      id: linkedOwnerProfileBefore.rows[0].id,
      owner_id: ownerIds.claimLinkedOwner,
      name: "Stale Owner Profile",
      address: "1 Historical Place",
      business_type: "restaurant",
      is_food_truck: false,
      claimed_from_import_id: linkedOwnerListingAId,
    });

    const linkedOwnerConflict = await request("/api/truck-claims", {
      method: "POST",
      cookie: linkedOwnerCookie,
      body: {
        listingId: linkedOwnerListingBId,
        restaurantData: { acceptTerms: true },
      },
    });
    assert.equal(linkedOwnerConflict.status, 409);
    assert.equal(
      linkedOwnerConflict.body.code,
      "food_truck_identity_already_linked",
    );
    const linkedOwnerTruth = await nativePool.query(
      `select
         (select status from truck_import_listings where id = $1) as attempted_status,
         (select status from truck_import_listings where id = $3) as original_status,
         (select claimed_from_import_id from restaurants where owner_id = $2) as original_link,
         (select count(*)::int from truck_claim_requests where listing_id = $1) as attempted_claims,
         (select count(*)::int from restaurants where owner_id = $2) as profiles,
         (select user_type from users where id = $2) as role`,
      [
        linkedOwnerListingBId,
        ownerIds.claimLinkedOwner,
        linkedOwnerListingAId,
      ],
    );
    assert.deepEqual(linkedOwnerTruth.rows[0], {
      attempted_status: "unclaimed",
      original_status: "claimed",
      original_link: linkedOwnerListingAId,
      attempted_claims: 0,
      profiles: 1,
      role: "customer",
    });

    // The sibling guard above intentionally sees listing A while it is in a
    // different status. Reopen only the exact fixture row to prove that an
    // actual claim of A reuses its stale linked profile instead of duplicating.
    await nativePool.query(
      `update truck_import_listings set status = 'unclaimed' where id = $1`,
      [linkedOwnerListingAId],
    );
    const linkedOwnerActualClaim = await request("/api/truck-claims", {
      method: "POST",
      cookie: linkedOwnerCookie,
      body: {
        listingId: linkedOwnerListingAId,
        restaurantData: { acceptTerms: true },
      },
    });
    assert.equal(
      linkedOwnerActualClaim.status,
      200,
      JSON.stringify(linkedOwnerActualClaim.body),
    );
    assert.equal(linkedOwnerActualClaim.body.usedSeededRestaurant, true);
    const linkedOwnerReuseTruth = await nativePool.query(
      `select r.id, r.owner_id, r.name, r.address, r.business_type,
              r.is_food_truck, r.claimed_from_import_id,
              (select count(*)::int from restaurants where owner_id = $2) as profiles,
              (select count(*)::int from truck_claim_requests where listing_id = $1) as claims,
              (select status from truck_import_listings where id = $1) as actual_status,
              (select status from truck_import_listings where id = $3) as sibling_status,
              (select user_type from users where id = $2) as role
       from restaurants r where r.id = $4`,
      [
        linkedOwnerListingAId,
        ownerIds.claimLinkedOwner,
        linkedOwnerListingBId,
        linkedOwnerProfileBefore.rows[0].id,
      ],
    );
    assert.deepEqual(linkedOwnerReuseTruth.rows[0], {
      id: linkedOwnerProfileBefore.rows[0].id,
      owner_id: ownerIds.claimLinkedOwner,
      name: "Owner Linked Identity Truck",
      address: "1370 Link Lock",
      business_type: "food_truck",
      is_food_truck: true,
      claimed_from_import_id: linkedOwnerListingAId,
      profiles: 1,
      claims: 1,
      actual_status: "claim_requested",
      sibling_status: "unclaimed",
      role: "food_truck",
    });

    const linkedImportProfileBefore = await nativePool.query(
      `select id, owner_id, name, address, business_type, is_food_truck,
              claimed_from_import_id
       from restaurants where claimed_from_import_id = $1`,
      [linkedImportListingAId],
    );
    assert.deepEqual(linkedImportProfileBefore.rows[0], {
      id: linkedImportProfileBefore.rows[0].id,
      owner_id: ownerIds.importSystem,
      name: "Stale Import Profile",
      address: "2 Historical Place",
      business_type: "restaurant",
      is_food_truck: false,
      claimed_from_import_id: linkedImportListingAId,
    });

    const linkedImportConflict = await request("/api/truck-claims", {
      method: "POST",
      cookie: linkedImportCookie,
      body: {
        listingId: linkedImportListingBId,
        restaurantData: { acceptTerms: true },
      },
    });
    assert.equal(linkedImportConflict.status, 409);
    assert.equal(
      linkedImportConflict.body.code,
      "food_truck_identity_already_linked",
    );
    const linkedImportTruth = await nativePool.query(
      `select
         (select status from truck_import_listings where id = $1) as attempted_status,
         (select status from truck_import_listings where id = $3) as original_status,
         (select claimed_from_import_id from restaurants
          where owner_id = $2 and claimed_from_import_id = $3) as original_link,
         (select owner_id from restaurants where claimed_from_import_id = $3) as owner_id,
         (select count(*)::int from truck_claim_requests where listing_id = $1) as attempted_claims,
         (select count(*)::int from restaurants where owner_id = $4) as claimant_profiles,
         (select user_type from users where id = $4) as claimant_role`,
      [
        linkedImportListingBId,
        ownerIds.importSystem,
        linkedImportListingAId,
        ownerIds.claimLinkedImport,
      ],
    );
    assert.deepEqual(linkedImportTruth.rows[0], {
      attempted_status: "unclaimed",
      original_status: "claimed",
      original_link: linkedImportListingAId,
      owner_id: ownerIds.importSystem,
      attempted_claims: 0,
      claimant_profiles: 0,
      claimant_role: "customer",
    });

    await nativePool.query(
      `update truck_import_listings set status = 'unclaimed' where id = $1`,
      [linkedImportListingAId],
    );
    const linkedImportActualClaim = await request("/api/truck-claims", {
      method: "POST",
      cookie: linkedImportCookie,
      body: {
        listingId: linkedImportListingAId,
        restaurantData: { acceptTerms: true },
      },
    });
    assert.equal(
      linkedImportActualClaim.status,
      200,
      JSON.stringify(linkedImportActualClaim.body),
    );
    assert.equal(linkedImportActualClaim.body.usedSeededRestaurant, true);
    const linkedImportReuseTruth = await nativePool.query(
      `select r.id, r.owner_id, r.name, r.address, r.business_type,
              r.is_food_truck, r.claimed_from_import_id,
              (select count(*)::int from restaurants where owner_id = $2) as claimant_profiles,
              (select count(*)::int from truck_claim_requests where listing_id = $1) as claims,
              (select status from truck_import_listings where id = $1) as actual_status,
              (select status from truck_import_listings where id = $3) as sibling_status,
              (select user_type from users where id = $2) as claimant_role
       from restaurants r where r.id = $4`,
      [
        linkedImportListingAId,
        ownerIds.claimLinkedImport,
        linkedImportListingBId,
        linkedImportProfileBefore.rows[0].id,
      ],
    );
    assert.deepEqual(linkedImportReuseTruth.rows[0], {
      id: linkedImportProfileBefore.rows[0].id,
      owner_id: ownerIds.claimLinkedImport,
      name: "Import Linked Identity Truck",
      address: "1380 Link Lock",
      business_type: "food_truck",
      is_food_truck: true,
      claimed_from_import_id: linkedImportListingAId,
      claimant_profiles: 1,
      claims: 1,
      actual_status: "claim_requested",
      sibling_status: "unclaimed",
      claimant_role: "food_truck",
    });

    const sameOwnerClaim = await request("/api/truck-claims", {
      method: "POST",
      cookie: sameOwnerCookie,
      body: {
        listingId: sameOwnerListingId,
        restaurantData: { acceptTerms: true },
      },
    });
    assert.equal(sameOwnerClaim.status, 200, JSON.stringify(sameOwnerClaim.body));
    assert.equal(sameOwnerClaim.body.usedSeededRestaurant, true);
    assert.equal(sameOwnerClaim.body.restaurant.ownerId, ownerIds.claimSameOwner);
    const sameOwnerTruth = await nativePool.query(
      `select
         (select count(*)::int from restaurants where owner_id = $1) as profiles,
         (select count(*)::int from restaurants where claimed_from_import_id = $2) as linked,
         (select count(*)::int from truck_claim_requests where listing_id = $2) as claims,
         (select user_type from users where id = $1) as role,
         (select status from truck_import_listings where id = $2) as status`,
      [ownerIds.claimSameOwner, sameOwnerListingId],
    );
    assert.deepEqual(sameOwnerTruth.rows[0], {
      profiles: 1,
      linked: 1,
      claims: 1,
      role: "food_truck",
      status: "claim_requested",
    });

    const importRestaurantBefore = await nativePool.query(
      `select id from restaurants
       where owner_id = $1
         and trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) = 'import reuse truck'
         and trim(regexp_replace(lower(address), '[^a-z0-9]+', ' ', 'g')) = '1200 transfer trail'`,
      [ownerIds.importSystem],
    );
    assert.equal(importRestaurantBefore.rowCount, 1);
    const importReuseClaim = await request("/api/truck-claims", {
      method: "POST",
      cookie: importReuseCookie,
      body: {
        listingId: importReuseListingId,
        restaurantData: { acceptTerms: true },
      },
    });
    assert.equal(importReuseClaim.status, 200, JSON.stringify(importReuseClaim.body));
    assert.equal(importReuseClaim.body.usedSeededRestaurant, true);
    assert.equal(importReuseClaim.body.restaurant.id, importRestaurantBefore.rows[0].id);
    assert.equal(importReuseClaim.body.restaurant.ownerId, ownerIds.claimImport);
    const importReuseTruth = await nativePool.query(
      `select
         (select count(*)::int from restaurants
          where trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) = 'import reuse truck'
            and trim(regexp_replace(lower(address), '[^a-z0-9]+', ' ', 'g')) = '1200 transfer trail') as profiles,
         (select count(*)::int from truck_claim_requests where listing_id = $2) as claims,
         (select user_type from users where id = $1) as role,
         (select owner_id from restaurants where id = $3) as owner_id`,
      [
        ownerIds.claimImport,
        importReuseListingId,
        importRestaurantBefore.rows[0].id,
      ],
    );
    assert.deepEqual(importReuseTruth.rows[0], {
      profiles: 1,
      claims: 1,
      role: "food_truck",
      owner_id: ownerIds.claimImport,
    });

    const foreignOwnerConflict = await request("/api/truck-claims", {
      method: "POST",
      cookie: foreignClaimantCookie,
      body: {
        listingId: foreignOwnerListingId,
        restaurantData: { acceptTerms: true },
      },
    });
    assert.equal(
      foreignOwnerConflict.status,
      409,
      JSON.stringify(foreignOwnerConflict.body),
    );
    assert.equal(foreignOwnerConflict.body.code, "food_truck_identity_owned");
    const foreignOwnerTruth = await nativePool.query(
      `select
         (select status from truck_import_listings where id = $1) as status,
         (select count(*)::int from truck_claim_requests where listing_id = $1) as claims,
         (select user_type from users where id = $2) as claimant_role,
         (select count(*)::int from restaurants where owner_id = $2) as claimant_profiles,
         (select owner_id from restaurants
          where trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) = 'foreign owner truck'
            and trim(regexp_replace(lower(address), '[^a-z0-9]+', ' ', 'g')) = '1300 conflict court') as owner_id`,
      [
        foreignOwnerListingId,
        ownerIds.claimForeignClaimant,
      ],
    );
    assert.deepEqual(foreignOwnerTruth.rows[0], {
      status: "unclaimed",
      claims: 0,
      claimant_role: "customer",
      claimant_profiles: 0,
      owner_id: ownerIds.claimForeignOwner,
    });

    const ambiguousConflict = await request("/api/truck-claims", {
      method: "POST",
      cookie: ambiguousClaimantCookie,
      body: {
        listingId: ambiguousListingId,
        restaurantData: { acceptTerms: true },
      },
    });
    assert.equal(
      ambiguousConflict.status,
      409,
      JSON.stringify(ambiguousConflict.body),
    );
    assert.equal(
      ambiguousConflict.body.code,
      "food_truck_identity_ambiguous",
    );
    const ambiguousTruth = await nativePool.query(
      `select
         (select status from truck_import_listings where id = $1) as status,
         (select count(*)::int from truck_claim_requests where listing_id = $1) as claims,
         (select user_type from users where id = $2) as claimant_role,
         (select count(*)::int from restaurants
          where trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) = 'ambiguous identity truck'
            and trim(regexp_replace(lower(address), '[^a-z0-9]+', ' ', 'g')) = '1500 duplicate drive') as profiles`,
      [ambiguousListingId, ownerIds.ambiguousClaimant],
    );
    assert.deepEqual(ambiguousTruth.rows[0], {
      status: "unclaimed",
      claims: 0,
      claimant_role: "customer",
      profiles: 2,
    });

    const identityClaimBody = (listingId: string) => ({
      listingId,
      restaurantData: { acceptTerms: true },
    });
    const [identityClaimA, identityClaimB] = await Promise.all([
      request("/api/truck-claims", {
        method: "POST",
        cookie: identityClaimACookie,
        body: identityClaimBody(identityListingAId),
      }),
      request("/api/truck-claims", {
        method: "POST",
        cookie: identityClaimBCookie,
        body: identityClaimBody(identityListingBId),
      }),
    ]);
    assert.deepEqual(
      [identityClaimA.status, identityClaimB.status].sort((a, b) => a - b),
      [200, 409],
    );
    const identityWinner =
      identityClaimA.status === 200 ? ownerIds.identityClaimA : ownerIds.identityClaimB;
    const identityLoser =
      identityWinner === ownerIds.identityClaimA
        ? ownerIds.identityClaimB
        : ownerIds.identityClaimA;
    const identityConflict =
      identityClaimA.status === 409 ? identityClaimA : identityClaimB;
    assert.equal(
      identityConflict.body.code,
      "food_truck_identity_already_linked",
    );
    const identityClaimTruth = await nativePool.query(
      `select
         (select count(*)::int from restaurants
          where trim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g')) = 'shared identity truck'
            and trim(regexp_replace(lower(address), '[^a-z0-9]+', ' ', 'g')) = '1400 lock lane') as profiles,
         (select count(*)::int from truck_claim_requests where listing_id in ($1, $2)) as claims,
         (select count(*)::int from truck_import_listings
          where id in ($1, $2) and status = 'claim_requested') as won_listings,
         (select count(*)::int from truck_import_listings
          where id in ($1, $2) and status = 'unclaimed') as neutral_listings,
         (select user_type from users where id = $3) as winner_role,
         (select user_type from users where id = $4) as loser_role,
         (select count(*)::int from restaurants where owner_id = $4) as loser_profiles`,
      [identityListingAId, identityListingBId, identityWinner, identityLoser],
    );
    assert.deepEqual(identityClaimTruth.rows[0], {
      profiles: 1,
      claims: 1,
      won_listings: 1,
      neutral_listings: 1,
      winner_role: "food_truck",
      loser_role: "customer",
      loser_profiles: 0,
    });

    const claimTermsFailure = await request("/api/truck-claims", {
      method: "POST",
      cookie: claimantACookie,
      body: {
        listingId: claimListingId,
        restaurantData: { acceptTerms: false },
      },
    });
    assert.equal(claimTermsFailure.status, 400);
    assert.equal(
      (
        await nativePool.query(
          `select status from truck_import_listings where id = $1`,
          [claimListingId],
        )
      ).rows[0].status,
      "unclaimed",
    );

    const claimBody = {
      listingId: claimListingId,
      restaurantData: { acceptTerms: true },
    };
    const [claimA, claimB] = await Promise.all([
      request("/api/truck-claims", {
        method: "POST",
        cookie: claimantACookie,
        body: claimBody,
      }),
      request("/api/truck-claims", {
        method: "POST",
        cookie: claimantBCookie,
        body: claimBody,
      }),
    ]);
    assert.deepEqual(
      [claimA.status, claimB.status].sort((a, b) => a - b),
      [200, 409],
    );
    const winningIndex = claimA.status === 200 ? "claimantA" : "claimantB";
    const losingIndex = winningIndex === "claimantA" ? "claimantB" : "claimantA";
    const winnerId = ownerIds[winningIndex];
    const loserId = ownerIds[losingIndex];
    const success = claimA.status === 200 ? claimA : claimB;
    assert.equal(success.body.created, true);
    assert.equal(success.body.completionKind, "claim");
    assert.equal(success.body.restaurant.ownerId, winnerId);

    const claimTruth = await nativePool.query(
      `select
         (select count(*)::int from restaurants where claimed_from_import_id = $1) as profiles,
         (select count(*)::int from truck_claim_requests where listing_id = $1) as claims,
         (select owner_id from restaurants where claimed_from_import_id = $1) as owner_id,
         (select status from truck_import_listings where id = $1) as listing_status,
         (select user_type from users where id = $2) as winner_role,
         (select user_type from users where id = $3) as loser_role,
         (select count(*)::int from restaurants where owner_id = $3) as loser_profiles`,
      [claimListingId, winnerId, loserId],
    );
    assert.deepEqual(claimTruth.rows[0], {
      profiles: 1,
      claims: 1,
      owner_id: winnerId,
      listing_status: "claim_requested",
      winner_role: "food_truck",
      loser_role: "customer",
      loser_profiles: 0,
    });

    const loserCookie = losingIndex === "claimantA" ? claimantACookie : claimantBCookie;
    const loserRetry = await request("/api/truck-claims", {
      method: "POST",
      cookie: loserCookie,
      body: claimBody,
    });
    assert.equal(loserRetry.status, 409);
    const ownershipAfterRetry = await nativePool.query(
      `select owner_id from restaurants where claimed_from_import_id = $1`,
      [claimListingId],
    );
    assert.equal(ownershipAfterRetry.rows[0].owner_id, winnerId);

    console.log(
      "food-truck-signup-funnel.integration: PASS (neutral provisioning; exact continuations; public allowlist; delivery recovery; IP-limited inactive-token preflight; concurrent one-winner account setup; legal gates; atomic duplicate-safe create rollback; authoritative claim identity; stale sibling-link protection/reuse; and PostgreSQL same-/cross-listing concurrency)",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreWelcomeEmail?.();
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    }
    if (applicationPool) await applicationPool.end().catch(() => undefined);
    await nativePool.end().catch(() => undefined);
    await closeWebSocketProxy(wsProxy).catch(() => undefined);
  }
}

run().catch((error: any) => {
  console.error("food-truck-signup-funnel.integration: FAIL", error?.stack || error);
  if (error?.cause) console.error("database cause:", error.cause);
  process.exit(1);
});
