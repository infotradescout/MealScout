import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const clean = (value: unknown) => String(value || "").trim();
const sleep = (milliseconds: number) =>
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    milliseconds,
  );

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
};
const digest = (value: unknown) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");

async function withFixedNow<T>(iso: string, callback: () => Promise<T>) {
  const RealDate = globalThis.Date;
  const fixedNow = RealDate.parse(iso);
  class FixtureDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) super(fixedNow);
      else if (args.length === 1) super(args[0]);
      else if (args.length === 2) super(args[0], args[1]);
      else if (args.length === 3) super(args[0], args[1], args[2]);
      else if (args.length === 4) super(args[0], args[1], args[2], args[3]);
      else if (args.length === 5)
        super(args[0], args[1], args[2], args[3], args[4]);
      else if (args.length === 6)
        super(args[0], args[1], args[2], args[3], args[4], args[5]);
      else
        super(
          args[0],
          args[1],
          args[2],
          args[3],
          args[4],
          args[5],
          args[6],
        );
    }
    static now() {
      return fixedNow;
    }
  }
  (globalThis as any).Date = FixtureDate;
  try {
    return await callback();
  } finally {
    (globalThis as any).Date = RealDate;
  }
}

class InterceptedStripe {
  readonly intents = new Map<string, any>();
  readonly chargesById = new Map<string, any>();
  readonly transfersById = new Map<string, any>();
  readonly feesById = new Map<string, any>();
  readonly refundsById = new Map<string, any>();
  readonly reversalsById = new Map<string, any>();
  readonly feeRefundsById = new Map<string, any>();
  readonly paymentIntentByKey = new Map<string, string>();
  readonly transferByKey = new Map<string, string>();
  readonly refundByKey = new Map<string, string>();
  readonly reversalByKey = new Map<string, string>();
  readonly feeRefundByKey = new Map<string, string>();
  readonly settlementBalances = new Map<string, { connected: number; platform: number }>();
  paymentIntentCreateCalls = 0;
  accountRetrieveCalls = 0;
  transferCreateCalls = 0;
  refundCreateCalls = 0;
  failPaymentIntentCreateAfterPersist = false;
  failTransferCreateAfterPersist = false;
  failRefundCreateAfterPersist = false;
  failFeeRefundCreateAfterPersist = false;
  connectReady = true;

  accounts = {
    retrieve: async (_accountId: string) => undefined,
  } as any;
  paymentIntents = {} as any;
  charges = {} as any;
  transfers = {} as any;
  applicationFees = {} as any;
  refunds = {} as any;

  constructor(private readonly paymentIntentNamespace = "fixture") {
    this.accounts.retrieve = async (accountId: string) => {
      this.accountRetrieveCalls += 1;
      return {
        id: accountId,
        details_submitted: this.connectReady,
        charges_enabled: this.connectReady,
        payouts_enabled: this.connectReady,
      };
    };
    this.paymentIntents.create = async (params: any, options: any = {}) => {
      this.paymentIntentCreateCalls += 1;
      const key = clean(options.idempotencyKey);
      const existingId = this.paymentIntentByKey.get(key);
      if (existingId) return this.intents.get(existingId);
      const id = `pi_${this.paymentIntentNamespace}_${this.intents.size + 1}`;
      const intent = {
        id,
        object: "payment_intent",
        amount: params.amount,
        currency: params.currency,
        application_fee_amount: params.application_fee_amount || 0,
        transfer_data: params.transfer_data,
        metadata: params.metadata || {},
        status: "requires_payment_method",
        client_secret: `${id}_secret_fixture`,
        latest_charge: null,
      };
      this.intents.set(id, intent);
      this.paymentIntentByKey.set(key, id);
      if (this.failPaymentIntentCreateAfterPersist) {
        this.failPaymentIntentCreateAfterPersist = false;
        throw Object.assign(
          new Error("provider accepted PaymentIntent before timeout"),
          { code: "api_connection_error" },
        );
      }
      return intent;
    };
    this.paymentIntents.retrieve = async (id: string) => {
      const intent = this.intents.get(id);
      if (!intent) throw new Error(`unknown PaymentIntent ${id}`);
      return intent;
    };
    this.paymentIntents.search = async () => ({
      data: [...this.intents.values()],
    });
    this.paymentIntents.cancel = async (id: string) => {
      const intent = this.intents.get(id);
      if (!intent) throw new Error(`unknown PaymentIntent ${id}`);
      intent.status = "canceled";
      return intent;
    };

    this.charges.retrieve = async (id: string) => {
      const charge = this.chargesById.get(id);
      if (!charge) throw new Error(`unknown charge ${id}`);
      return charge;
    };

    this.transfers.retrieve = async (id: string) => {
      const transfer = this.transfersById.get(id);
      if (!transfer) throw new Error(`unknown transfer ${id}`);
      return transfer;
    };
    this.transfers.list = (params: any) => ({
      autoPagingToArray: async () =>
        [...this.transfersById.values()].filter(
          (transfer) =>
            transfer.destination === params.destination &&
            Number(transfer.created || 0) >= Number(params.created?.gte || 0),
        ),
    });
    this.transfers.create = async (params: any, options: any = {}) => {
      this.transferCreateCalls += 1;
      const key = clean(options.idempotencyKey);
      const existingId = this.transferByKey.get(key);
      if (existingId) return this.transfersById.get(existingId);
      const id = `tr_payout_fixture_${this.transferByKey.size + 1}`;
      const transfer = {
        id,
        object: "transfer",
        amount: params.amount,
        currency: params.currency,
        destination: params.destination,
        metadata: params.metadata || {},
        created: Math.floor(Date.now() / 1000),
        reversed: false,
      };
      this.transfersById.set(id, transfer);
      this.transferByKey.set(key, id);
      if (this.failTransferCreateAfterPersist) {
        this.failTransferCreateAfterPersist = false;
        throw Object.assign(
          new Error("provider accepted transfer before timeout"),
          { code: "api_connection_error" },
        );
      }
      return transfer;
    };
    this.transfers.listReversals = async (transferId: string) => ({
      data: [...this.reversalsById.values()].filter(
        (reversal) => reversal.transfer === transferId,
      ),
    });
    this.transfers.retrieveReversal = async (
      _transferId: string,
      reversalId: string,
    ) => this.reversalsById.get(reversalId);
    this.transfers.createReversal = async (
      transferId: string,
      params: any,
      options: any = {},
    ) => {
      const key = clean(options.idempotencyKey);
      const existingId = this.reversalByKey.get(key);
      if (existingId) return this.reversalsById.get(existingId);
      const balance = this.settlementBalances.get(transferId);
      assert.ok(balance, "A destination transfer must have a tracked balance");
      assert.ok(balance.connected >= params.amount, "Destination cannot fund the gross reversal before the fee is returned");
      balance.connected -= params.amount;
      balance.platform += params.amount;
      const id = `trr_fixture_${this.reversalByKey.size + 1}`;
      const reversal = {
        id,
        object: "transfer_reversal",
        transfer: transferId,
        amount: params.amount,
        currency: "usd",
        metadata: params.metadata || {},
      };
      this.reversalsById.set(id, reversal);
      this.reversalByKey.set(key, id);
      return reversal;
    };

    this.applicationFees.retrieve = async (id: string) => {
      const fee = this.feesById.get(id);
      if (!fee) throw new Error(`unknown application fee ${id}`);
      return fee;
    };
    this.applicationFees.listRefunds = async (feeId: string) => ({
      data: [...this.feeRefundsById.values()].filter(
        (refund) => refund.fee === feeId,
      ),
    });
    this.applicationFees.retrieveRefund = async (
      _feeId: string,
      refundId: string,
    ) => this.feeRefundsById.get(refundId);
    this.applicationFees.createRefund = async (
      feeId: string,
      params: any,
      options: any = {},
    ) => {
      const key = clean(options.idempotencyKey);
      const existingId = this.feeRefundByKey.get(key);
      if (existingId) return this.feeRefundsById.get(existingId);
      const fee = this.feesById.get(feeId);
      const charge = this.chargesById.get(fee?.charge);
      const balance = this.settlementBalances.get(charge?.transfer);
      assert.ok(balance, "The refunded fee must belong to a tracked destination charge");
      balance.connected += params.amount;
      balance.platform -= params.amount;
      const id = `fr_fixture_${this.feeRefundByKey.size + 1}`;
      const refund = {
        id,
        object: "fee_refund",
        fee: feeId,
        amount: params.amount,
        currency: "usd",
        metadata: params.metadata || {},
      };
      this.feeRefundsById.set(id, refund);
      this.feeRefundByKey.set(key, id);
      if (this.failFeeRefundCreateAfterPersist) {
        this.failFeeRefundCreateAfterPersist = false;
        throw Object.assign(new Error("provider accepted fee refund before timeout"), { code: "api_connection_error" });
      }
      return refund;
    };

    this.refunds.list = async (params: any) => ({
      data: [...this.refundsById.values()].filter(
        (refund) => refund.charge === params.charge,
      ),
    });
    this.refunds.retrieve = async (id: string) => this.refundsById.get(id);
    this.refunds.create = async (params: any, options: any = {}) => {
      this.refundCreateCalls += 1;
      const key = clean(options.idempotencyKey);
      const existingId = this.refundByKey.get(key);
      if (existingId) return this.refundsById.get(existingId);
      const charge = this.chargesById.get(params.charge);
      if (!charge) throw new Error(`unknown refund charge ${params.charge}`);
      const balance = this.settlementBalances.get(charge.transfer);
      assert.ok(balance, "The customer refund must belong to a tracked destination charge");
      balance.platform -= params.amount;
      const id = `re_fixture_${this.refundByKey.size + 1}`;
      const refund = {
        id,
        object: "refund",
        amount: params.amount,
        currency: charge.currency,
        charge: charge.id,
        payment_intent: charge.payment_intent,
        metadata: params.metadata || {},
        status: "succeeded",
        failure_reason: null,
      };
      this.refundsById.set(id, refund);
      this.refundByKey.set(key, id);
      if (this.failRefundCreateAfterPersist) {
        this.failRefundCreateAfterPersist = false;
        throw Object.assign(
          new Error("provider accepted refund before timeout"),
          { code: "api_connection_error" },
        );
      }
      return refund;
    };
  }

  succeedIntent(intentId: string) {
    const intent = this.intents.get(intentId);
    assert.ok(intent, `missing intercepted intent ${intentId}`);
    const chargeId = `ch_${intentId}`;
    const transferId = `tr_${intentId}`;
    const feeId = intent.application_fee_amount > 0 ? `fee_${intentId}` : null;
    intent.status = "succeeded";
    intent.latest_charge = chargeId;
    this.chargesById.set(chargeId, {
      id: chargeId,
      object: "charge",
      amount: intent.amount,
      currency: intent.currency,
      payment_intent: intent.id,
      transfer: transferId,
      application_fee: feeId,
    });
    this.transfersById.set(transferId, {
      id: transferId,
      object: "transfer",
      amount: intent.amount,
      currency: intent.currency,
      destination: intent.transfer_data.destination,
      metadata: {},
      created: Math.floor(Date.now() / 1000),
      reversed: false,
    });
    // Stripe moves the gross charge to the connected account and then returns
    // the application fee to the platform. Processing fees are outside this model.
    this.settlementBalances.set(transferId, {
      connected: intent.amount - Number(intent.application_fee_amount || 0),
      platform: Number(intent.application_fee_amount || 0),
    });
    if (feeId) {
      this.feesById.set(feeId, {
        id: feeId,
        object: "application_fee",
        amount: intent.application_fee_amount,
        currency: intent.currency,
        charge: chargeId,
      });
    }
    return intent;
  }
}

async function runFixture() {
  assert.equal(process.env.MEALSCOUT_DISPOSABLE_POSTGRES, "1");
  const { db, pool } = await import("../server/db");
  const { storage } = await import("../server/storage");
  const schema = await import("../shared/schema");
  const { and, eq } = await import("drizzle-orm");
  const bookingService = await import(
    "../server/services/parkingPassBookingService"
  );
  const payoutService = await import(
    "../server/services/legacyPayoutProviderService"
  );
  const eventMutationService = await import(
    "../server/services/eventParticipationMutationService"
  );
  const publicationService = await import(
    "../server/services/eventSeriesPublicationService"
  );
  const notificationDeliveryService = await import(
    "../server/services/eventNotificationDeliveryService"
  );
  const { publicPaidParticipationSqlCondition } = await import(
    "../server/services/publicParkingPassEligibility"
  );
  const { loadPublicParkingPassProjections } = await import(
    "../server/services/publicParkingPassProjection"
  );
  const { loadPersistedEventServiceTimeZone } = await import(
    "../server/services/persistedServiceTimeZone"
  );
  const { resolveCityTimeZoneStrict } = await import(
    "../server/services/cityTimeZone"
  );
  const { listParkingPassOccurrences } = await import(
    "../server/services/parkingPassVirtual"
  );
  const { isEventWithinPublicFeedWindow } = await import(
    "../server/services/publicEventTimeTruth"
  );
  const express = (await import("express")).default;
  const { registerHostParkingPassRoutes } = await import(
    "../server/routes/hosts/eventsRoutes"
  );
  const { registerHostInterestRoutes } = await import(
    "../server/routes/hostInterestRoutes"
  );
  const hostOwnership = await import("../server/services/hostOwnership");
  const interestDecision = await import("../server/services/interestDecision");
  const { registerBookingRoutes } = await import(
    "../server/routes/bookingRoutes"
  );
  const { registerEventRoutes } = await import(
    "../server/routes/eventRoutes"
  );
  const { registerEventCoordinatorRoutes } = await import(
    "../server/routes/eventCoordinatorRoutes"
  );
  const { registerDiscoveryRoutes } = await import(
    "../server/routes/discoveryRoutes"
  );
  const { createActionApiRouter, upsertManualSchedule } = await import(
    "../server/routes/actionRoutes"
  );
  const { registerPublicMapRoutes, clearPublicMapLocationsCache } =
    await import("../server/routes/publicMapRoutes");
  const { registerPublicDiscoveryRoutes } = await import(
    "../server/routes/publicDiscoveryRoutes"
  );
  const { registerSeoRoutes } = await import("../server/routes/seoRoutes");
  const { buildScoutSurface } = await import(
    "../server/services/scoutSurfaceService"
  );
  const { computeHostProfileQualityFlags, isHostProfileMapEligible } =
    await import("../server/services/parkingPassQuality");
  const stripe = new InterceptedStripe();

  await pool.query(`
    insert into users
      (id, email, user_type, is_disabled, public_profile_settings) values
      ('fixture-truck-owner', 'owner@desertfork.example', 'restaurant_owner', false, '{}'::jsonb),
      ('fixture-host-owner', 'owner@mesamarket.example', 'host', false, '{}'::jsonb),
      ('fixture-admin', 'admin@fixture.invalid', 'admin', false, '{}'::jsonb),
      ('fixture-recovery-admin', 'recovery@fixture.invalid', 'admin', false, '{}'::jsonb),
      ('fixture-system-admin', 'system@fixture.invalid', 'admin', false, '{}'::jsonb),
      ('fixture-other', 'other@fixture.invalid', 'customer', false, '{}'::jsonb),
      ('fixture-coordinator', 'coordinator@fixture.invalid', 'event_coordinator', false, '{}'::jsonb);
    insert into restaurants
      (id, owner_id, name, address, city, state, business_type, is_food_truck,
       is_active)
    values
      ('fixture-truck', 'fixture-truck-owner', 'Desert Fork Truck',
       '1 Truck Way', 'El Paso', 'TX', 'food_truck', true, true),
      ('fixture-truck-two', 'fixture-other', 'Second Fixture Truck',
       '2 Truck Way', 'El Paso', 'TX', 'food_truck', true, true);
    insert into cities (id, name, slug, state, timezone) values
      ('fixture-city-austin', 'Austin', 'austin', 'TX', 'America/Chicago'),
      ('fixture-city-el-paso', 'El Paso', 'el-paso', 'TX', 'America/Denver');
    insert into hosts
      (id, user_id, business_name, address, city, state, location_type,
       latitude, longitude, stripe_connect_account_id,
       stripe_onboarding_completed, stripe_charges_enabled,
       stripe_payouts_enabled)
    values
      ('fixture-host', 'fixture-host-owner', 'Fixture Host',
       '742 Protected Market Street', 'Austin', 'TX', 'venue',
       30.26724567, -97.74314567, 'acct_fixture_host', true, true, true),
      ('fixture-el-paso-host', 'fixture-host-owner', 'Mesa Market',
       '100 Mountain Time Way', 'El Paso', 'TX', 'venue',
       31.76190000, -106.48500000, 'acct_fixture_el_paso', true, true, true),
      ('fixture-el-paso-config-host', 'fixture-host-owner', 'Sunset Hall',
       '110 Mountain Time Way', 'El Paso', 'TX', 'venue',
       31.76200000, -106.48600000, 'acct_fixture_el_paso_config', true, true, true),
      ('fixture-no-zone-host', 'fixture-host-owner', 'No Zone Fixture Host',
       '200 Unknown Zone Way', 'Unregistered Place', 'TX', 'venue',
       31.00000000, -105.00000000, 'acct_fixture_no_zone', true, true, true);
    insert into event_series
      (id, host_id, coordinator_user_id, name, timezone, start_date,
       end_date, default_start_time, default_end_time,
       default_max_trucks, series_type, status)
    values
      ('fixture-series', 'fixture-host', 'fixture-coordinator',
       'Fixture Coordinated Series', 'America/Chicago',
       '2099-01-14', '2099-01-14', '10:20', '14:40', 4,
       'event', 'published'),
      ('fixture-el-paso-series', 'fixture-el-paso-host', null,
       'El Paso Parking Pass', 'America/Denver',
       '2026-08-29', '2026-08-29', '14:00', '14:40', 4,
       'parking_pass', 'published'),
      ('fixture-el-paso-public-series', 'fixture-el-paso-host', null,
       'El Paso Community Series', 'America/Denver',
       '2026-08-29', '2026-08-29', '14:00', '14:40', 4,
       'event', 'published'),
      ('fixture-el-paso-config-series', 'fixture-el-paso-config-host', null,
       'El Paso Config Series', 'America/Denver',
       '2026-08-30', '2026-08-30', '07:00', '21:00', 4,
       'parking_pass', 'published'),
      ('fixture-scout-denver-series', 'fixture-el-paso-host', null,
       'Denver Late Service', 'America/Denver',
       '2026-08-29', '2026-08-29', '22:00', '23:59', 4,
       'event', 'published');
    insert into events
      (id, host_id, name, event_type, date, start_time, end_time,
       max_trucks, status, hard_cap_enabled, requires_payment,
       host_price_cents)
    values
      ('fixture-paid-a', 'fixture-host', 'Paid A', 'parking_pass',
       '2099-01-10', '10:17', '14:43', 4, 'open', true, true, 1000),
      ('fixture-paid-b', 'fixture-host', 'Paid B', 'parking_pass',
       '2099-01-11', '11:13', '15:49', 4, 'open', true, true, 2500),
      ('fixture-paid-race', 'fixture-host', 'Paid Race', 'parking_pass',
       '2099-01-12', '10:00', '14:00', 2, 'open', true, true, 700),
      ('fixture-free', 'fixture-host', 'Free Coordinated', 'public_event',
       '2099-01-13', '09:00', '12:00', 4, 'open', false, false, 0),
      ('fixture-free-pending', 'fixture-host', 'Free Pending', 'public_event',
       '2099-01-15', '09:00', '12:00', 4, 'open', false, false, 0),
      ('fixture-paid-legacy', 'fixture-host', 'Paid Legacy', 'public_event',
       '2099-01-16', '09:00', '12:00', 4, 'open', false, true, 500),
      ('fixture-no-zone-paid', 'fixture-no-zone-host', 'No Zone Paid', 'parking_pass',
       '2099-01-17', '09:00', '12:00', 4, 'open', true, true, 500),
      ('fixture-hard-cap-race', 'fixture-host', 'Final Slot Race', 'public_event',
       '2099-01-18', '09:00', '12:00', 1, 'open', true, false, 0);
    update events set coordinator_user_id = 'fixture-coordinator'
      where id in ('fixture-free', 'fixture-hard-cap-race');
    -- Historical participating series rows predate durable publication. Seed
    -- them explicitly outside the runtime writer, then restore containment.
    alter table events disable trigger trigger_guard_publication_occurrence;
    insert into events
      (id, host_id, coordinator_user_id, series_id, name, event_type,
       date, start_time, end_time, max_trucks, status,
       hard_cap_enabled, requires_payment, host_price_cents)
    values
      ('fixture-paid-event', 'fixture-host', 'fixture-coordinator',
       'fixture-series', 'Paid Coordinated Event', 'public_event',
       '2099-01-14', '10:20', '14:40', 4, 'open', true, true, 600),
      ('fixture-el-paso-paid', 'fixture-el-paso-host', null,
       'fixture-el-paso-series', 'El Paso Paid', 'parking_pass',
       '2026-08-29', '14:00', '14:40', 4, 'open', true, true, 900),
      ('fixture-el-paso-public', 'fixture-el-paso-host', null,
       'fixture-el-paso-public-series', 'Desert Dinner Gathering', 'public_event',
       '2026-08-29', '14:00', '14:40', 4, 'open', false, false, 0),
      ('fixture-el-paso-config-event', 'fixture-el-paso-config-host', null,
       'fixture-el-paso-config-series', 'Sunset Market Availability', 'parking_pass',
       '2026-08-30', '07:00', '21:00', 4, 'open', true, true, 1000),
      ('fixture-scout-denver-event', 'fixture-el-paso-host', null,
       'fixture-scout-denver-series', 'Denver Late Food Gathering', 'public_event',
       '2026-08-29', '22:00', '23:59', 4, 'open', false, false, 0);
    alter table events enable trigger trigger_guard_publication_occurrence;
    insert into event_bookings
      (id, event_id, truck_id, host_id, status, host_price_cents,
       platform_fee_cents, total_cents, event_participation_version,
       participation_visibility_state)
    values
      ('fixture-free-booking', 'fixture-free', 'fixture-truck',
       'fixture-host', 'confirmed', 0, 0, 0, 0, 'eligible'),
      ('fixture-free-pending-booking', 'fixture-free-pending',
       'fixture-truck', 'fixture-host', 'pending', 0, 0, 0, 0, 'eligible'),
      ('fixture-el-paso-public-booking', 'fixture-el-paso-public',
       'fixture-truck', 'fixture-el-paso-host', 'confirmed', 0, 0, 0, 0,
       'eligible'),
      ('fixture-scout-denver-booking', 'fixture-scout-denver-event',
       'fixture-truck', 'fixture-el-paso-host', 'confirmed', 0, 0, 0, 0,
       'eligible');
    update event_bookings
       set booking_confirmed_at = '2026-08-29T19:00:00.000Z'
     where id in ('fixture-el-paso-public-booking', 'fixture-scout-denver-booking');
    insert into event_interests (id, event_id, truck_id, status) values
      ('fixture-hard-cap-race-host', 'fixture-hard-cap-race',
       'fixture-truck', 'pending'),
      ('fixture-hard-cap-race-coordinator', 'fixture-hard-cap-race',
       'fixture-truck-two', 'pending');
    insert into truck_manual_schedules
      (id, truck_id, date, start_time, end_time, location_name, address,
       city, state, is_public, status, timezone, source_type,
       source_confidence, owner_submitted_equivalent, expires_at,
       map_eligible, live_feed_eligible, last_confirmed_at)
    values
      ('fixture-manual-denver', 'fixture-truck', '2026-08-29', '14:00',
       '14:40', 'Denver Manual Stop', '100 Mountain Time Way', 'El Paso',
       'TX', true, 'open', 'America/Denver', 'owner_submitted', 'confirmed',
       true, '2026-08-30T12:00:00.000Z', true, true,
       '2026-08-29T20:00:00.000Z'),
      ('fixture-manual-chicago', 'fixture-truck', '2026-08-29', '15:00',
       '15:40', 'Chicago Manual Stop', '742 Protected Market Street',
       'Austin', 'TX', true, 'open', 'America/Chicago', 'owner_submitted',
       'confirmed', true, '2026-08-30T12:00:00.000Z', true, true,
       '2026-08-29T20:00:00.000Z');
    update event_series
       set default_daily_price_cents = 900,
           default_host_price_cents = 900
     where id = 'fixture-el-paso-series';
    update events
       set daily_price_cents = 900
     where id = 'fixture-el-paso-paid';
  `);
  await pool.query(
    `alter table event_bookings
       disable trigger trigger_guard_paid_parking_pass_booking`,
  );
  try {
    await pool.query(`
      insert into event_bookings
        (id, event_id, truck_id, host_id, status, host_price_cents,
         platform_fee_cents, total_cents, event_participation_version,
         participation_visibility_state)
      values
        ('fixture-paid-legacy-booking', 'fixture-paid-legacy',
         'fixture-truck', 'fixture-host', 'confirmed', 500, 50, 550, 0,
         'eligible')
    `);
  } finally {
    await pool.query(
      `alter table event_bookings
         enable trigger trigger_guard_paid_parking_pass_booking`,
    );
  }

  assert.equal(
    await storage.syncParkingPassSeriesFromHost("fixture-el-paso-host"),
    "fixture-el-paso-series",
  );
  const syncedElPasoSeries = await pool.query(
    `select name, timezone, default_start_time
       from event_series
      where id = 'fixture-el-paso-series'`,
  );
  assert.equal(
    syncedElPasoSeries.rows[0]?.name,
    "Parking Pass - Mesa Market",
    "compatibility sync must complete rather than preserving timezone via rollback",
  );
  assert.equal(syncedElPasoSeries.rows[0]?.default_start_time, "07:00");
  assert.equal(
    syncedElPasoSeries.rows[0]?.timezone,
    "America/Denver",
    "host compatibility sync must preserve the authoritative stored series timezone",
  );
  await pool.query(`
    update event_series
       set status = 'published',
           start_date = '2026-08-29',
           end_date = '2026-08-29',
           default_start_time = '14:00',
           default_end_time = '14:40',
           default_max_trucks = 4,
           published_at = now()
     where id = 'fixture-el-paso-series'
  `);

  assert.equal(
    await storage.ensureDraftParkingPassForHost("fixture-no-zone-host"),
    false,
    "draft seeding fails closed when no persisted venue timezone exists",
  );
  assert.equal(
    await storage.syncParkingPassSeriesFromHost("fixture-no-zone-host"),
    null,
    "host compatibility sync fails closed when no persisted venue timezone exists",
  );
  const noZoneSeries = await pool.query(
    `select count(*)::integer as count
       from event_series
      where host_id = 'fixture-no-zone-host'
        and series_type = 'parking_pass'`,
  );
  assert.equal(noZoneSeries.rows[0]?.count, 0);

  const routeApp = express();
  routeApp.use(express.json());
  routeApp.use((req: any, _res: any, next: any) => {
    const userId = String(req.headers["x-fixture-user"] || "").trim();
    req.user = userId
      ? {
          id: userId,
          userType:
            userId === "fixture-host-owner"
              ? "host"
              : userId === "fixture-coordinator"
                ? "event_coordinator"
                : userId === "fixture-admin"
                  ? "admin"
                  : "restaurant_owner",
          isDisabled: false,
        }
      : null;
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  registerHostInterestRoutes(routeApp, {
    getHostByUserId: hostOwnership.getHostByUserId,
    getEventAndHostForUser: hostOwnership.getEventAndHostForUser,
    userOwnsEvent: hostOwnership.userOwnsEvent,
    computeFillRate: interestDecision.computeFillRate,
  });
  registerHostParkingPassRoutes(routeApp);
  registerBookingRoutes(routeApp, {
    hasCompleteProfileAccess: async () => true,
  });
  registerEventRoutes(routeApp, {
    hasCompleteProfileAccess: async () => true,
  });
  registerEventCoordinatorRoutes(routeApp, {
    hasCompleteProfileAccess: async () => true,
  });
  registerDiscoveryRoutes(routeApp);
  routeApp.use("/api/actions", createActionApiRouter());
  registerPublicMapRoutes(routeApp);
  registerPublicDiscoveryRoutes(routeApp);
  registerSeoRoutes(routeApp);
  const routeServer = routeApp.listen(0, "127.0.0.1");
  await new Promise<void>((resolveListening, rejectListening) => {
    routeServer.once("listening", () => resolveListening());
    routeServer.once("error", rejectListening);
  });
  const routeAddress = routeServer.address();
  assert.ok(routeAddress && typeof routeAddress === "object");
  const routeBaseUrl = `http://127.0.0.1:${routeAddress.port}`;
  const routeJson = async (
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: any; text: string }> => {
    const response = await fetch(`${routeBaseUrl}${path}`, init);
    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body, text };
  };

  const originalProcessTimeZone = process.env.TZ;
  try {
    await withFixedNow("2026-08-29T20:20:00.000Z", async () => {
      for (const processTimeZone of ["UTC", "America/Chicago"]) {
        process.env.TZ = processTimeZone;
        const denverCity = await routeJson(
          "/api/public/discovery/city/el-paso/time/now",
        );
        assert.equal(denverCity.status, 200, denverCity.text);
        const denverSchedules = (denverCity.body?.trucks || []).flatMap(
          (truck: any) => truck.schedules || [],
        );
        assert.ok(
          denverSchedules.some(
            (schedule: any) =>
              schedule.kind === "booking" && schedule.date === "2026-08-29",
          ),
          `Denver city event date drifted under process TZ=${processTimeZone}`,
        );
        assert.ok(
          denverSchedules.some(
            (schedule: any) =>
              schedule.kind === "manual" && schedule.date === "2026-08-29",
          ),
          `Denver city manual date drifted under process TZ=${processTimeZone}`,
        );

        const chicagoCity = await routeJson(
          "/api/public/discovery/city/austin/time/now",
        );
        assert.equal(chicagoCity.status, 200, chicagoCity.text);
        const chicagoSchedules = (chicagoCity.body?.trucks || []).flatMap(
          (truck: any) => truck.schedules || [],
        );
        assert.ok(
          chicagoSchedules.some(
            (schedule: any) =>
              schedule.kind === "manual" && schedule.date === "2026-08-29",
          ),
          `Chicago city manual date drifted under process TZ=${processTimeZone}`,
        );

        const denverLocation = await routeJson(
          "/api/public/discovery/location/fixture-el-paso-host/time/now",
        );
        assert.equal(denverLocation.status, 200, denverLocation.text);
        const locationSchedules = (denverLocation.body?.trucks || []).flatMap(
          (truck: any) => truck.schedules || [],
        );
        assert.ok(
          locationSchedules.some(
            (schedule: any) => schedule.date === "2026-08-29",
          ),
          `location event date drifted under process TZ=${processTimeZone}`,
        );
      }
    });

    process.env.TZ = "America/Chicago";
    await withFixedNow("2026-08-30T05:30:00.000Z", async () => {
      const scoutFeed = await routeJson("/api/events/public");
      assert.equal(scoutFeed.status, 200, scoutFeed.text);
      const denverLateEvent = (scoutFeed.body || []).find(
        (event: any) => event.id === "fixture-scout-denver-event",
      );
      assert.ok(
        denverLateEvent,
        "active Denver Aug 29 event must remain in Scout while the Chicago browser is Aug 30",
      );
      assert.equal(denverLateEvent.serviceTimezone, "America/Denver");
      assert.equal(denverLateEvent.serviceDateKey, "2026-08-29");
      assert.equal(denverLateEvent.servicePhase, "in_service");
      assert.equal(
        denverLateEvent.serviceStartsAtUtc,
        "2026-08-30T04:00:00.000Z",
      );
      assert.equal(
        denverLateEvent.serviceEndsAtUtc,
        "2026-08-30T05:59:00.000Z",
      );
    });
  } finally {
    if (originalProcessTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalProcessTimeZone;
  }

  await pool.query(`
    insert into hosts
      (id, user_id, business_name, address, city, state, location_type)
    values
      ('fixture-coordinator-chicago-host', 'fixture-coordinator',
       'Existing Chicago Venue', '1 Chicago Way', 'Austin', 'TX',
       'event_coordinator');
    insert into cities (id, name, slug, state, timezone) values
      ('fixture-conflict-city-a', 'Fixture Conflict City',
       'fixture-conflict-city', 'TX', 'America/Chicago'),
      ('fixture-conflict-city-b', 'Fixture Conflict City',
       'fixture-conflict-city', 'TX', 'America/Denver');
  `);
  const coordinatorCreateBody = {
    businessName: "Mountain Time Gathering",
    address: "500 Exact Denver Venue Way",
    city: "El Paso",
    state: "TX",
    contactPhone: "915-555-0100",
    name: "Exact Denver Coordinator Event",
    description: "Stateful exact venue proof",
    date: "2099-06-01",
    startTime: "14:00",
    endTime: "14:40",
    maxTrucks: 1,
    hardCapEnabled: true,
  };
  const coordinatorCreate = await routeJson(
    "/api/event-coordinator/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "fixture-coordinator-create-v1",
        "x-fixture-user": "fixture-coordinator",
      },
      body: JSON.stringify(coordinatorCreateBody),
    },
  );
  assert.equal(coordinatorCreate.status, 201, coordinatorCreate.text);
  const coordinatorEventId = String(coordinatorCreate.body?.id || "");
  assert.ok(coordinatorEventId);
  const coordinatorVenue = await pool.query(
    `select event.hard_cap_enabled, host.address, host.city, host.state
       from events event
       join hosts host on host.id = event.host_id
      where event.id = $1`,
    [coordinatorEventId],
  );
  assert.deepEqual(coordinatorVenue.rows, [
    {
      hard_cap_enabled: true,
      address: "500 Exact Denver Venue Way",
      city: "El Paso",
      state: "TX",
    },
  ]);
  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  const coordinatorReplay = await routeJson(
    "/api/event-coordinator/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "fixture-coordinator-create-v1",
        "x-fixture-user": "fixture-coordinator",
      },
      body: JSON.stringify(coordinatorCreateBody),
    },
  );
  assert.equal(coordinatorReplay.status, 201, coordinatorReplay.text);
  assert.equal(coordinatorReplay.body?.id, coordinatorEventId);
  assert.equal(
    (
      await pool.query(
        `select count(*)::int as count from events
          where coordinator_user_id = 'fixture-coordinator'
            and name = 'Exact Denver Coordinator Event'`,
      )
    ).rows[0].count,
    1,
  );

  const concurrentCoordinatorBody = {
    ...coordinatorCreateBody,
    address: "501 Exact Denver Venue Way",
    name: "Concurrent Denver Coordinator Event",
    date: "2099-06-02",
  };
  const concurrentCoordinatorResponses = await Promise.all([
    routeJson("/api/event-coordinator/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "fixture-coordinator-concurrent-v1",
        "x-fixture-user": "fixture-coordinator",
      },
      body: JSON.stringify(concurrentCoordinatorBody),
    }),
    routeJson("/api/event-coordinator/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "fixture-coordinator-concurrent-v1",
        "x-fixture-user": "fixture-coordinator",
      },
      body: JSON.stringify(concurrentCoordinatorBody),
    }),
  ]);
  assert.equal(
    concurrentCoordinatorResponses.filter((response) => response.status === 201)
      .length,
    1,
  );
  assert.equal(
    concurrentCoordinatorResponses.filter((response) => response.status === 409)
      .length,
    1,
  );
  assert.equal(
    (
      await pool.query(
        `select count(*)::int as count from events
          where coordinator_user_id = 'fixture-coordinator'
            and name = 'Concurrent Denver Coordinator Event'`,
      )
    ).rows[0].count,
    1,
  );

  const missingZoneCountsBefore = await pool.query(
    `select
       (select count(*)::int from hosts where user_id = 'fixture-coordinator') as hosts,
       (select count(*)::int from events where coordinator_user_id = 'fixture-coordinator') as events`,
  );
  for (const [key, city] of [
    ["fixture-coordinator-no-zone-v1", "Unregistered Fixture Place"],
    ["fixture-coordinator-ambiguous-zone-v1", "Fixture Conflict City"],
  ] as const) {
    const rejected = await routeJson("/api/event-coordinator/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        "x-fixture-user": "fixture-coordinator",
      },
      body: JSON.stringify({
        ...coordinatorCreateBody,
        address: `${city} Exact Venue`,
        city,
        name: `${city} rejected event`,
      }),
    });
    assert.equal(rejected.status, 409, rejected.text);
    assert.equal(rejected.body?.code, "venue_timezone_unavailable");
  }
  const missingZoneCountsAfter = await pool.query(
    `select
       (select count(*)::int from hosts where user_id = 'fixture-coordinator') as hosts,
       (select count(*)::int from events where coordinator_user_id = 'fixture-coordinator') as events`,
  );
  assert.deepEqual(missingZoneCountsAfter.rows, missingZoneCountsBefore.rows);

  await pool.query(
    `insert into event_interests (id, event_id, truck_id, status) values
       ('fixture-hard-cap-accepted', $1, 'fixture-truck', 'accepted'),
       ('fixture-hard-cap-pending', $1, 'fixture-truck-two', 'pending')`,
    [coordinatorEventId],
  );
  const hardCapBlocked = await routeJson(
    "/api/event-coordinator/interests/fixture-hard-cap-pending",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-fixture-user": "fixture-coordinator",
      },
      body: JSON.stringify({ status: "accepted" }),
    },
  );
  assert.equal(hardCapBlocked.status, 409, hardCapBlocked.text);
  assert.equal(hardCapBlocked.body?.code, "CAPACITY_REACHED");

  const hardCapRaceRequests = [
    {
      path: "/api/hosts/interests/fixture-hard-cap-race-host/status",
      user: "fixture-host-owner",
    },
    {
      path: "/api/event-coordinator/interests/fixture-hard-cap-race-coordinator",
      user: "fixture-coordinator",
    },
  ];
  const hardCapRaceResponses = await Promise.all(
    hardCapRaceRequests.map((request) =>
      routeJson(request.path, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-fixture-user": request.user,
        },
        body: JSON.stringify({ status: "accepted" }),
      }),
    ),
  );
  assert.deepEqual(
    hardCapRaceResponses.map((response) => response.status).sort(),
    [200, 409],
    hardCapRaceResponses.map((response) => response.text).join(" | "),
  );
  assert.equal(
    hardCapRaceResponses.find((response) => response.status === 409)?.body
      ?.code,
    "CAPACITY_REACHED",
  );
  const acceptedRaceCount = async () =>
    Number(
      (
        await pool.query(
          `select count(*)::int as count
             from event_interests
            where event_id = 'fixture-hard-cap-race'
              and status = 'accepted'`,
        )
      ).rows[0]?.count || 0,
    );
  assert.equal(await acceptedRaceCount(), 1);
  const winnerIndex = hardCapRaceResponses.findIndex(
    (response) => response.status === 200,
  );
  const winnerRequest = hardCapRaceRequests[winnerIndex];
  const winnerReplay = await routeJson(winnerRequest.path, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-fixture-user": winnerRequest.user,
    },
    body: JSON.stringify({ status: "accepted" }),
  });
  assert.equal(winnerReplay.status, 200, winnerReplay.text);
  assert.equal(await acceptedRaceCount(), 1);

  await withFixedNow("2026-08-29T20:20:00.000Z", async () => {
    const hostConfig = await routeJson("/api/hosts/parking-pass", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "fixture-el-paso-host-route-v1",
        "x-fixture-user": "fixture-host-owner",
      },
      body: JSON.stringify({
        hostId: "fixture-el-paso-config-host",
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "07:00",
        endTime: "21:00",
        maxTrucks: 4,
        requiresPayment: true,
        breakfastPriceCents: 1000,
        lunchPriceCents: 0,
        dinnerPriceCents: 0,
      }),
    });
    assert.equal(hostConfig.status, 201, hostConfig.text);
    const preservedConfigZone = await pool.query(
      `select timezone, start_date::date::text as start_date_key
         from event_series
        where id = 'fixture-el-paso-config-series'`,
    );
    assert.equal(preservedConfigZone.rows[0]?.timezone, "America/Denver");
    assert.equal(preservedConfigZone.rows[0]?.start_date_key, "2026-08-30");

    const noZoneHostBefore = await pool.query(
      `select spot_count, parking_pass_days_of_week
         from hosts where id = 'fixture-no-zone-host'`,
    );
    const noZoneConfig = await routeJson("/api/hosts/parking-pass", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "fixture-no-zone-host-route-v1",
        "x-fixture-user": "fixture-host-owner",
      },
      body: JSON.stringify({
        hostId: "fixture-no-zone-host",
        daysOfWeek: [6],
        startTime: "07:00",
        endTime: "21:00",
        maxTrucks: 3,
        requiresPayment: true,
        breakfastPriceCents: 1000,
      }),
    });
    assert.equal(noZoneConfig.status, 409, noZoneConfig.text);
    assert.equal(noZoneConfig.body?.code, "venue_timezone_unavailable");
    const noZoneHostAfter = await pool.query(
      `select spot_count, parking_pass_days_of_week
         from hosts where id = 'fixture-no-zone-host'`,
    );
    assert.deepEqual(noZoneHostAfter.rows, noZoneHostBefore.rows);

    const restSchedule = await routeJson(
      "/api/trucks/fixture-truck/manual-schedule",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-fixture-user": "fixture-truck-owner",
        },
        body: JSON.stringify({
          date: "2026-08-29",
          startTime: "14:00",
          endTime: "14:40",
          address: "120 Mountain Time Way",
          locationName: "Mesa Lunch Stop",
          city: "El Paso",
          state: "TX",
          isPublic: true,
        }),
      },
    );
    assert.equal(restSchedule.status, 200, restSchedule.text);
    assert.equal(restSchedule.body?.timezone, "America/Denver");
    assert.equal(
      new Date(restSchedule.body?.expiresAt).toISOString(),
      "2026-08-29T20:40:00.000Z",
    );

    const noZoneManualBefore = await pool.query(
      `select count(*)::integer as count from truck_manual_schedules
        where truck_id = 'fixture-truck'`,
    );
    const noZoneRestSchedule = await routeJson(
      "/api/trucks/fixture-truck/manual-schedule",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-fixture-user": "fixture-truck-owner",
        },
        body: JSON.stringify({
          date: "2026-08-29",
          startTime: "14:00",
          endTime: "14:40",
          address: "Unknown Zone Way",
          locationName: "Unknown Zone Stop",
          city: "Unregistered Place",
          state: "TX",
        }),
      },
    );
    assert.equal(noZoneRestSchedule.status, 409, noZoneRestSchedule.text);
    const noZoneRestAfter = await pool.query(
      `select count(*)::integer as count from truck_manual_schedules
        where truck_id = 'fixture-truck'`,
    );
    assert.deepEqual(noZoneRestAfter.rows, noZoneManualBefore.rows);

    const actionSchedule = await upsertManualSchedule({
      userId: "fixture-truck-owner",
      truckId: "fixture-truck",
      date: "2026-08-29",
      startTime: "14:00",
      endTime: "14:40",
      address: "130 Mountain Time Way",
      locationName: "Action Mesa Stop",
      city: "El Paso",
      state: "TX",
      isPublic: true,
    });
    assert.equal(actionSchedule.success, true);
    assert.equal(actionSchedule.data?.schedule?.timezone, "America/Denver");
    assert.equal(
      new Date(actionSchedule.data?.schedule?.expiresAt).toISOString(),
      "2026-08-29T20:40:00.000Z",
    );
    const actionNoZoneBefore = await pool.query(
      `select count(*)::integer as count from truck_manual_schedules
        where truck_id = 'fixture-truck'`,
    );
    const actionNoZone = await upsertManualSchedule({
      userId: "fixture-truck-owner",
      truckId: "fixture-truck",
      date: "2026-08-29",
      startTime: "14:00",
      endTime: "14:40",
      address: "Unknown Zone Way",
      city: "Unregistered Place",
      state: "TX",
    });
    assert.equal(actionNoZone.success, false);
    const containedAction = await routeJson("/api/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "UPSERT_MANUAL_SCHEDULE",
        params: {
          userId: "fixture-truck-owner",
          truckId: "fixture-truck",
          date: "2026-08-29",
          startTime: "14:00",
          endTime: "14:40",
          address: "Should Never Persist",
          city: "El Paso",
          state: "TX",
        },
      }),
    });
    assert.equal(containedAction.status, 403, containedAction.text);
    const actionNoZoneAfter = await pool.query(
      `select count(*)::integer as count from truck_manual_schedules
        where truck_id = 'fixture-truck'`,
    );
    assert.deepEqual(actionNoZoneAfter.rows, actionNoZoneBefore.rows);
  });

  const elPasoVirtualRange = await listParkingPassOccurrences({
    start: new Date("2026-08-29T00:00:00.000Z"),
    horizonDays: 1,
    seriesIds: ["fixture-el-paso-series"],
  });
  assert.deepEqual(
    elPasoVirtualRange.occurrences.map((occurrence) => occurrence.id),
    ["fixture-el-paso-paid"],
    "UTC-midnight series start/end boundaries must retain the Aug 29 occurrence",
  );

  const purchaseInput = {
    purchaserUserId: "fixture-truck-owner",
    truckId: "fixture-truck",
    hostId: "fixture-host",
    idempotencyKey: "fixture-purchase-main-v1",
    lines: [
      {
        eventId: "fixture-paid-a",
        hostPriceCents: 1000,
        platformFeeCents: 110,
        slotType: "daily",
      },
      {
        eventId: "fixture-paid-b",
        hostPriceCents: 2500,
        platformFeeCents: 330,
        slotType: "daily",
      },
    ],
    stripe: stripe as any,
  };

  const financialRowsBefore = await pool.query(`
    select
      (select count(*)::integer from parking_pass_purchases) as purchases,
      (select count(*)::integer from parking_pass_provider_operations) as operations,
      (select count(*)::integer from event_bookings) as bookings
  `);
  const providerCallsBefore = {
    accounts: stripe.accountRetrieveCalls,
    creates: stripe.paymentIntentCreateCalls,
  };
  const previousNodeEnv = process.env.NODE_ENV;
  const previousTestMode = process.env.MEALSCOUT_TEST_MODE;
  process.env.NODE_ENV = " ProDucTion ";
  process.env.MEALSCOUT_TEST_MODE = "true";
  try {
    await assert.rejects(
      bookingService.createParkingPassPurchase({
        ...purchaseInput,
        idempotencyKey: "fixture-production-bypass-v1",
        bypassProvider: true,
      }),
      (error: any) => error?.code === "provider_bypass_forbidden",
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousTestMode === undefined) delete process.env.MEALSCOUT_TEST_MODE;
    else process.env.MEALSCOUT_TEST_MODE = previousTestMode;
  }
  const financialRowsAfter = await pool.query(`
    select
      (select count(*)::integer from parking_pass_purchases) as purchases,
      (select count(*)::integer from parking_pass_provider_operations) as operations,
      (select count(*)::integer from event_bookings) as bookings
  `);
  assert.deepEqual(financialRowsAfter.rows[0], financialRowsBefore.rows[0]);
  assert.deepEqual(
    {
      accounts: stripe.accountRetrieveCalls,
      creates: stripe.paymentIntentCreateCalls,
    },
    providerCallsBefore,
    "production bypass must make zero Stripe calls",
  );

  assert.equal(
    await loadPersistedEventServiceTimeZone({
      seriesId: "fixture-el-paso-series",
      city: "El Paso",
      state: "TX",
      database: db,
    }),
    "America/Denver",
    "stored series timezone must win over coarse Texas geography",
  );
  await withFixedNow("2026-08-29T19:30:00.000Z", async () => {
    const elPasoStripe = new InterceptedStripe("el_paso");
    const elPasoPurchaseInput = {
      purchaserUserId: "fixture-truck-owner",
      truckId: "fixture-truck",
      hostId: "fixture-el-paso-host",
      idempotencyKey: "fixture-el-paso-zone-v1",
      lines: [
        {
          eventId: "fixture-el-paso-paid",
          hostPriceCents: 900,
          platformFeeCents: 90,
          slotType: "daily",
        },
      ],
      stripe: elPasoStripe as any,
    };
    const elPasoPurchase = await bookingService.createParkingPassPurchase(
      elPasoPurchaseInput,
    );
    assert.ok(elPasoPurchase.paymentIntentId);
    assert.equal(elPasoStripe.paymentIntentCreateCalls, 1);
    elPasoStripe.succeedIntent(elPasoPurchase.paymentIntentId!);
    const elPasoConfirmed = await bookingService.createParkingPassPurchase(
      elPasoPurchaseInput,
    );
    assert.equal(elPasoConfirmed.clientSecret, null);
    const elPasoProjection = await loadPublicParkingPassProjections({
      eventIds: ["fixture-el-paso-paid"],
      database: db,
    });
    assert.equal(
      elPasoProjection.get("fixture-el-paso-paid")?.startsAt.toISOString(),
      "2026-08-29T20:00:00.000Z",
    );
    assert.equal(
      elPasoProjection.get("fixture-el-paso-paid")?.endsAt.toISOString(),
      "2026-08-29T21:00:00.000Z",
    );
    const elPasoCorrection =
      await eventMutationService.updateCoordinatedEvent({
        eventId: "fixture-el-paso-paid",
        actor: { userId: "fixture-host-owner" },
        requestId: "fixture-el-paso-correction-v1",
        updates: { startTime: "14:05", endTime: "14:45" },
        stripe: elPasoStripe as any,
        notifier: async (notice: any) => ({
          sent: true,
          providerStatus: "fixture_provider_confirmed",
          providerMessageId: `fixture-el-paso-${notice.idempotencyKey}`,
        }),
      });
    assert.equal(elPasoCorrection.fanout.mutation.status, "action_required");
    const elPasoArrivalChildren = await pool.query(
      `select child_kind, remedy, arrival_version_id, target_facts
         from event_participation_mutation_children
        where mutation_id = $1 order by action_key`,
      [elPasoCorrection.fanout.mutation.id],
    );
    const elPasoArrivalVersionId = elPasoArrivalChildren.rows.find(
      (child: any) => child.child_kind === "arrival_correct",
    )?.arrival_version_id;
    assert.ok(
      elPasoArrivalVersionId,
      JSON.stringify(elPasoArrivalChildren.rows),
    );
    const frozenElPasoArrival = await pool.query(
      `select start_at, end_at from parking_pass_arrival_versions
        where id = $1`,
      [elPasoArrivalVersionId],
    );
    assert.equal(
      new Date(frozenElPasoArrival.rows[0]?.start_at).toISOString(),
      "2026-08-29T20:05:00.000Z",
    );
    assert.equal(
      new Date(frozenElPasoArrival.rows[0]?.end_at).toISOString(),
      "2026-08-29T20:45:00.000Z",
    );
    await bookingService.acknowledgeProtectedParkingPassArrival({
      bookingId: elPasoConfirmed.bookingIds[0],
      versionId: elPasoArrivalVersionId,
      actor: { userId: "fixture-truck-owner" },
      idempotencyKey: "fixture-el-paso-arrival-ack-v1",
    });
    const elPasoRecovery =
      await eventMutationService.reconcileEventParticipationMutations({
        stripe: elPasoStripe as any,
        workerId: "fixture-el-paso-zone-recovery",
        notifier: async (notice: any) => ({
          sent: true,
          providerStatus: "fixture_provider_confirmed",
          providerMessageId: `fixture-el-paso-${notice.idempotencyKey}`,
        }),
      });
    assert.equal(elPasoRecovery.converged, 1);
    const convergedElPasoProjection =
      await loadPublicParkingPassProjections({
        eventIds: ["fixture-el-paso-paid"],
        database: db,
      });
    assert.equal(
      convergedElPasoProjection
        .get("fixture-el-paso-paid")
        ?.startsAt.toISOString(),
      "2026-08-29T20:00:00.000Z",
    );
  });
  await withFixedNow("2026-08-29T20:20:00.000Z", async () => {
    const publicRows = await storage.getAllUpcomingEvents();
    const elPasoPublicRow = publicRows.find(
      (event: any) => event.id === "fixture-el-paso-paid",
    );
    assert.ok(
      elPasoPublicRow,
      "storage keeps the El Paso event public while Denver service is active",
    );
    assert.equal(
      isEventWithinPublicFeedWindow(
        elPasoPublicRow,
        new Date("2026-08-29T20:20:00.000Z"),
      ),
      true,
      "public feed predicate uses the attached stored Denver timezone",
    );

    const scoutSurface = await buildScoutSurface({
      lat: 31.7619,
      lng: -106.485,
      radiusMiles: 10,
      limit: 80,
    });
    const scoutCards = scoutSurface.sections.flatMap(
      (section: any) => section.cards || [],
    );
    const publicScoutCard = scoutCards.find(
      (card: any) => card.entityId === "fixture-el-paso-public",
    );
    assert.ok(publicScoutCard, "Scout must expose the active Denver event");
    assert.equal(publicScoutCard.statusLabel, "Happening today");
    assert.deepEqual(
      {
        timeZone: publicScoutCard.metadata?.timeZone,
        dateKey: publicScoutCard.metadata?.dateKey,
        startsAt: publicScoutCard.metadata?.startsAt,
        endsAt: publicScoutCard.metadata?.endsAt,
      },
      {
        timeZone: "America/Denver",
        dateKey: "2026-08-29",
        startsAt: "2026-08-29T20:00:00.000Z",
        endsAt: "2026-08-29T20:40:00.000Z",
      },
    );

    clearPublicMapLocationsCache();
    const mapFixtureHost = await storage.getHost("fixture-el-paso-host");
    const mapFixtureOwner = await storage.getUser("fixture-host-owner");
    assert.ok(mapFixtureHost);
    assert.equal(mapFixtureOwner?.isDisabled, false);
    assert.equal(
      isHostProfileMapEligible(mapFixtureHost),
      true,
      JSON.stringify(computeHostProfileQualityFlags(mapFixtureHost)),
    );
    const mapUpcoming = await routeJson(
      "/api/map/hosts/fixture-el-paso-host/upcoming-bookings",
    );
    assert.equal(mapUpcoming.status, 200, mapUpcoming.text);
    const mapFree = mapUpcoming.body?.bookings?.find(
      (booking: any) => booking.eventId === "fixture-el-paso-public",
    );
    const mapPaid = mapUpcoming.body?.bookings?.find(
      (booking: any) => booking.eventId === "fixture-el-paso-paid",
    );
    assert.equal(mapFree?.date, "2026-08-29T20:00:00.000Z");
    assert.equal(mapPaid?.date, "2026-08-29T20:05:00.000Z");

    const publicTruckProfile = await routeJson(
      "/api/public/profiles/truck/fixture-truck",
    );
    assert.equal(publicTruckProfile.status, 200, publicTruckProfile.text);
    const publicDiscoveryEvent = publicTruckProfile.body?.events?.items?.find(
      (event: any) => event.id === "fixture-el-paso-public",
    );
    assert.deepEqual(
      {
        startsAt: publicDiscoveryEvent?.startsAt,
        endsAt: publicDiscoveryEvent?.endsAt,
        dateLabel: publicDiscoveryEvent?.dateLabel,
      },
      {
        startsAt: "2026-08-29T20:00:00.000Z",
        endsAt: "2026-08-29T20:40:00.000Z",
        dateLabel: "Aug 29, 2026",
      },
    );

    const seoEvents = await routeJson("/sitemap-events.xml");
    assert.equal(seoEvents.status, 200, seoEvents.text);
    assert.match(seoEvents.text, /fixture-el-paso-public/);
    const seoLocations = await routeJson("/sitemap-locations.xml");
    assert.equal(seoLocations.status, 200, seoLocations.text);
    assert.match(seoLocations.text, /fixture-el-paso-host/);
  });

  const noZonePurchasesBefore = await pool.query(
    `select count(*)::integer as count from parking_pass_purchases
      where host_id = 'fixture-no-zone-host'`,
  );
  await assert.rejects(
    bookingService.createParkingPassPurchase({
      purchaserUserId: "fixture-truck-owner",
      truckId: "fixture-truck",
      hostId: "fixture-no-zone-host",
      idempotencyKey: "fixture-no-persisted-zone-v1",
      lines: [
        {
          eventId: "fixture-no-zone-paid",
          hostPriceCents: 500,
          platformFeeCents: 50,
          slotType: "daily",
        },
      ],
      bypassProvider: true,
      stripe: null,
    }),
    (error: any) => error?.code === "venue_timezone_unavailable",
  );
  const noZonePurchasesAfter = await pool.query(
    `select count(*)::integer as count from parking_pass_purchases
      where host_id = 'fixture-no-zone-host'`,
  );
  assert.deepEqual(noZonePurchasesAfter.rows, noZonePurchasesBefore.rows);

  stripe.failPaymentIntentCreateAfterPersist = true;
  await assert.rejects(
    bookingService.createParkingPassPurchase(purchaseInput),
    (error: any) => error?.code === "api_connection_error",
  );
  assert.equal(stripe.intents.size, 1);
  assert.equal(stripe.paymentIntentCreateCalls, 1);

  await pool.query(
    `update restaurants set owner_id = 'fixture-other' where id = 'fixture-truck'`,
  );
  await assert.rejects(
    bookingService.createParkingPassPurchase(purchaseInput),
    (error: any) => error?.code === "parking_pass_purchase_forbidden",
  );
  assert.equal(stripe.paymentIntentCreateCalls, 1);
  await pool.query(
    `update restaurants set owner_id = 'fixture-truck-owner' where id = 'fixture-truck'`,
  );

  const recovered = await bookingService.createParkingPassPurchase(
    purchaseInput,
  );
  assert.ok(recovered.clientSecret);
  assert.equal(recovered.paymentIntentId, [...stripe.intents.keys()][0]);
  assert.equal(stripe.paymentIntentCreateCalls, 1);

  await pool.query(
    `update hosts set stripe_payouts_enabled = false where id = 'fixture-host'`,
  );
  await assert.rejects(
    bookingService.createParkingPassPurchase(purchaseInput),
    (error: any) => error?.code === "host_connect_not_ready",
  );
  await pool.query(
    `update hosts set stripe_payouts_enabled = true where id = 'fixture-host'`,
  );

  stripe.succeedIntent(recovered.paymentIntentId!);
  const destinationTransfer = stripe.transfersById.get(`tr_${recovered.paymentIntentId}`)!;
  const capturedIntent = stripe.intents.get(recovered.paymentIntentId!)!;
  assert.equal(destinationTransfer.amount, capturedIntent.amount);
  destinationTransfer.amount -= capturedIntent.application_fee_amount;
  await assert.rejects(
    bookingService.createParkingPassPurchase(purchaseInput),
    (error: any) => error?.code === "provider_settlement_mismatch",
    "A net-host transfer must not be mistaken for the gross destination charge",
  );
  destinationTransfer.amount = capturedIntent.amount;
  const confirmed = await bookingService.createParkingPassPurchase(
    purchaseInput,
  );
  assert.equal(confirmed.clientSecret, null);
  const purchaseRow = await pool.query(
    `select * from parking_pass_purchases where id = $1`,
    [confirmed.purchaseId],
  );
  assert.equal(purchaseRow.rows[0].status, "confirmed");
  assert.equal(
    purchaseRow.rows[0].settlement_status,
    "transferred_to_connect",
  );

  const paidEventPurchaseInput = {
    purchaserUserId: "fixture-truck-owner",
    truckId: "fixture-truck",
    hostId: "fixture-host",
    idempotencyKey: "fixture-paid-event-purchase-v1",
    lines: [
      {
        eventId: "fixture-paid-event",
        hostPriceCents: 600,
        platformFeeCents: 90,
        slotType: "daily",
      },
    ],
    stripe: stripe as any,
  };
  const paidEventPrepared = await bookingService.createParkingPassPurchase(
    paidEventPurchaseInput,
  );
  assert.equal(
    (
      await loadPublicParkingPassProjections({
        eventIds: ["fixture-paid-event"],
        database: db,
      })
    ).size,
    0,
  );
  stripe.succeedIntent(paidEventPrepared.paymentIntentId!);
  const paidEventConfirmed =
    await bookingService.createParkingPassPurchase(paidEventPurchaseInput);
  assert.equal(paidEventConfirmed.clientSecret, null);
  await assert.rejects(
    storage.updateEventSeries("fixture-series", {
      defaultStartTime: "07:45",
    }),
    /durable participation mutation service/i,
  );
  await pool.query(
    "insert into event_series " +
      "(id, host_id, name, timezone, start_date, end_date, " +
      "default_start_time, default_end_time, default_max_trucks, series_type, status) " +
      "values ('fixture-empty-series', 'fixture-host', 'Empty Compatibility Series', " +
      "'America/Chicago', '2099-02-01', '2099-02-01', '09:00', '12:00', 2, " +
      "'event', 'draft')",
  );
  const emptySeriesUpdate = await storage.updateEventSeries(
    "fixture-empty-series",
    { defaultStartTime: "09:15" },
  );
  assert.equal(emptySeriesUpdate.defaultStartTime, "09:15");

  const initialProjection = await loadPublicParkingPassProjections({
    eventIds: ["fixture-paid-a", "fixture-paid-b", "fixture-paid-event"],
    database: db,
  });
  assert.equal(initialProjection.size, 3);
  assert.doesNotMatch(
    JSON.stringify([...initialProjection.values()]),
    /742 Protected Market Street/i,
  );
  assert.equal(initialProjection.get("fixture-paid-a")?.latitude, 30.27);
  assert.equal(
    initialProjection.get("fixture-paid-a")?.startsAt.getUTCMinutes(),
    0,
  );
  assert.equal(
    initialProjection.get("fixture-paid-a")?.endsAt.getUTCMinutes(),
    0,
  );
  assert.equal(
    initialProjection.get("fixture-paid-event")?.addressPublicLabel,
    "Austin, TX",
  );

  const paidEventProjectionSize = async () =>
    (
      await loadPublicParkingPassProjections({
        eventIds: ["fixture-paid-event"],
        database: db,
      })
    ).size;
  await pool.query(
    `update parking_pass_purchases set settlement_status = 'pending'
      where id = $1`,
    [paidEventConfirmed.purchaseId],
  );
  assert.equal(await paidEventProjectionSize(), 0);
  await pool.query(
    `update parking_pass_purchases
        set settlement_status = 'transferred_to_connect'
      where id = $1`,
    [paidEventConfirmed.purchaseId],
  );
  const paidEventBookingId = paidEventConfirmed.bookingIds[0];
  await pool.query(
    `update event_bookings set public_location_consent_snapshot = false
      where id = $1`,
    [paidEventBookingId],
  );
  assert.equal(await paidEventProjectionSize(), 0);
  await pool.query(
    `update event_bookings set public_location_consent_snapshot = true
      where id = $1`,
    [paidEventBookingId],
  );
  await pool.query(
    `update users
        set public_profile_settings = '{"showAddress":false}'::jsonb
      where id = 'fixture-host-owner'`,
  );
  assert.equal(await paidEventProjectionSize(), 0);
  await pool.query(
    `update users set public_profile_settings = '{}'::jsonb
      where id = 'fixture-host-owner'`,
  );
  await pool.query(
    `update events set participation_version = participation_version + 1
      where id = 'fixture-paid-event'`,
  );
  assert.equal(await paidEventProjectionSize(), 0);
  await pool.query(
    `update events set participation_version = participation_version - 1
      where id = 'fixture-paid-event'`,
  );
  assert.equal(await paidEventProjectionSize(), 1);

  const bookingRows = await pool.query(
    `select id, event_id from event_bookings
      where purchase_id = $1 order by event_id`,
    [confirmed.purchaseId],
  );
  const bookingA = bookingRows.rows.find(
    (row: any) => row.event_id === "fixture-paid-a",
  );
  const bookingB = bookingRows.rows.find(
    (row: any) => row.event_id === "fixture-paid-b",
  );
  assert.ok(bookingA);
  assert.ok(bookingB);
  await assert.rejects(
    pool.query(
      `update event_bookings set status = 'pending' where id = $1`,
      [bookingA.id],
    ),
    (error: any) => /confirmed state cannot be reopened/i.test(error?.message),
  );
  const correction = await bookingService.correctProtectedParkingPassArrival({
    bookingId: bookingA.id,
    actor: { userId: "fixture-host-owner" },
    idempotencyKey: "fixture-arrival-correction-v1",
    reason: "Move arrival to the protected loading entrance",
    patch: {
      address: "999 Replacement Secret Avenue",
      city: "Houston",
      stateCode: "TX",
      latitude: 29.76041234,
      longitude: -95.36981234,
      startAt: new Date("2099-01-10T16:17:00.000Z"),
      endAt: new Date("2099-01-10T20:43:00.000Z"),
    },
  });
  assert.equal(
    (
      await loadPublicParkingPassProjections({
        eventIds: ["fixture-paid-a"],
        database: db,
      })
    ).size,
    0,
  );
  const correctionReplay =
    await bookingService.correctProtectedParkingPassArrival({
      bookingId: bookingA.id,
      actor: { userId: "fixture-host-owner" },
      idempotencyKey: "fixture-arrival-correction-v1",
      reason: "Move arrival to the protected loading entrance",
      patch: {
        address: "999 Replacement Secret Avenue",
        city: "Houston",
        stateCode: "TX",
        latitude: 29.76041234,
        longitude: -95.36981234,
        startAt: new Date("2099-01-10T16:17:00.000Z"),
        endAt: new Date("2099-01-10T20:43:00.000Z"),
      },
    });
  assert.equal(correctionReplay.id, correction.id);
  const acknowledged =
    await bookingService.acknowledgeProtectedParkingPassArrival({
      bookingId: bookingA.id,
      versionId: correction.id,
      actor: { userId: "fixture-truck-owner" },
      idempotencyKey: "fixture-arrival-ack-v1",
    });
  const ackReplay =
    await bookingService.acknowledgeProtectedParkingPassArrival({
      bookingId: bookingA.id,
      versionId: correction.id,
      actor: { userId: "fixture-truck-owner" },
      idempotencyKey: "fixture-arrival-ack-v1",
    });
  assert.equal(ackReplay.id, acknowledged.id);
  const correctedProjection = await loadPublicParkingPassProjections({
    eventIds: ["fixture-paid-a"],
    database: db,
  });
  assert.equal(correctedProjection.get("fixture-paid-a")?.addressPublicLabel, "Houston, TX");
  assert.doesNotMatch(
    JSON.stringify([...correctedProjection.values()]),
    /999 Replacement Secret Avenue/i,
  );

  const cancelInput = {
    purchaseId: confirmed.purchaseId,
    bookingLineIds: [bookingA.id],
    requestId: "fixture-selected-cancel-v1",
    reason: "Host cancelled the future selected line",
    actor: { userId: "fixture-admin" },
    stripe: stripe as any,
  };
  const cancellationAttempts = await Promise.allSettled([
    bookingService.cancelParkingPassLines(cancelInput),
    bookingService.cancelParkingPassLines(cancelInput),
  ]);
  for (const attempt of cancellationAttempts) {
    if (attempt.status === "rejected") {
      console.error("cancellation concurrency rejection", {
        code: attempt.reason?.code,
        details: attempt.reason?.details,
      });
    }
  }
  assert.equal(
    cancellationAttempts.every((attempt) => attempt.status === "fulfilled"),
    true,
  );
  const [cancelFirst, cancelReplay] = cancellationAttempts.map(
    (attempt) => (attempt as PromiseFulfilledResult<any>).value,
  );
  assert.equal(cancelFirst.id, cancelReplay.id);
  if (cancelFirst.status !== "provider_confirmed") {
    const cancellationState = await pool.query(
      `select id, status, provider_status, provider_error_code,
              provider_error_message
         from parking_pass_cancellation_operations
        where id = $1`,
      [cancelFirst.id],
    );
    const providerSteps = await pool.query(
      `select s.step_type, s.status, s.provider_error_code,
              s.provider_error_message, s.provider_refund_id,
              s.provider_transfer_reversal_id,
              s.provider_application_fee_refund_id
         from parking_pass_provider_operation_steps s
         join parking_pass_provider_operations o on o.id = s.operation_id
        where o.cancellation_operation_id = $1
        order by s.step_order`,
      [cancelFirst.id],
    );
    console.error("cancellation provider state", {
      cancellation: cancellationState.rows,
      steps: providerSteps.rows,
    });
  }
  assert.equal(cancelFirst.status, "provider_confirmed");
  assert.equal(stripe.refundsById.size, 1);
  assert.equal(stripe.reversalsById.size, 1);
  assert.equal(stripe.feeRefundsById.size, 1);
  assert.equal([...stripe.reversalsById.values()][0].amount, 1110);
  assert.equal([...stripe.feeRefundsById.values()][0].amount, 110);
  assert.deepEqual(stripe.settlementBalances.get(destinationTransfer.id), {
    connected: purchaseRow.rows[0].host_amount_cents - 1000,
    platform: purchaseRow.rows[0].platform_fee_cents - 110,
  }, "A partial refund leaves only the unrefunded lines' balances");
  const refundedLine = await pool.query(
    `select status, cash_refunded_cents, host_transfer_reversed_cents,
            application_fee_refunded_cents, settlement_state
       from event_bookings where id = $1`,
    [bookingA.id],
  );
  assert.deepEqual(refundedLine.rows[0], {
    status: "refunded",
    cash_refunded_cents: 1110,
    host_transfer_reversed_cents: 1000,
    application_fee_refunded_cents: 110,
    settlement_state: "provider_confirmed",
  });
  assert.equal(
    (
      await loadPublicParkingPassProjections({
        eventIds: ["fixture-paid-a"],
        database: db,
      })
    ).size,
    0,
  );

  const authoritativeRefund = [...stripe.refundsById.values()][0];
  await assert.rejects(
    bookingService.reconcileParkingPassRefund({
      ...authoritativeRefund,
      amount: authoritativeRefund.amount - 1,
    } as any),
    (error: any) => error?.code === "refund_webhook_mismatch",
  );
  await bookingService.reconcileParkingPassRefund(authoritativeRefund as any);
  assert.equal(stripe.refundsById.size, 1);

  const disputeBase = {
    id: "dp_fixture_main",
    object: "dispute",
    payment_intent: recovered.paymentIntentId,
    charge: `ch_${recovered.paymentIntentId}`,
    currency: "usd",
    amount: confirmed.totalCents,
  };
  await bookingService.markParkingPassPurchaseDisputed(
    { ...disputeBase, status: "needs_response" } as any,
    stripe as any,
  );
  let disputeLines = await pool.query(
    `select event_id, settlement_state from event_bookings
      where purchase_id = $1 order by event_id`,
    [confirmed.purchaseId],
  );
  assert.deepEqual(disputeLines.rows, [
    { event_id: "fixture-paid-a", settlement_state: "provider_confirmed" },
    { event_id: "fixture-paid-b", settlement_state: "disputed" },
  ]);
  await bookingService.markParkingPassPurchaseDisputed(
    { ...disputeBase, status: "won" } as any,
    stripe as any,
  );
  disputeLines = await pool.query(
    `select event_id, settlement_state from event_bookings
      where purchase_id = $1 order by event_id`,
    [confirmed.purchaseId],
  );
  assert.deepEqual(disputeLines.rows, [
    { event_id: "fixture-paid-a", settlement_state: "provider_confirmed" },
    { event_id: "fixture-paid-b", settlement_state: "destination_settled" },
  ]);
  await bookingService.markParkingPassPurchaseDisputed(
    { ...disputeBase, status: "lost" } as any,
    stripe as any,
  );
  const lostDisputeState = await pool.query(
    "select p.status as purchase_status, p.settlement_status, " +
      "b.event_id, b.status as booking_status, b.settlement_state " +
      "from parking_pass_purchases p join event_bookings b on b.purchase_id = p.id " +
      "where p.id = $1 order by b.event_id",
    [confirmed.purchaseId],
  );
  assert.equal(lostDisputeState.rows[0].purchase_status, "partially_refunded");
  assert.deepEqual(
    lostDisputeState.rows.map((row: any) => ({
      event_id: row.event_id,
      booking_status: row.booking_status,
      settlement_state: row.settlement_state,
    })),
    [
      {
        event_id: "fixture-paid-a",
        booking_status: "refunded",
        settlement_state: "provider_confirmed",
      },
      {
        event_id: "fixture-paid-b",
        booking_status: "confirmed",
        settlement_state: "disputed",
      },
    ],
  );
  await bookingService.markParkingPassPurchaseDisputed(
    { ...disputeBase, status: "won" } as any,
    stripe as any,
  );

  const deadlineMutation =
    await eventMutationService.updateCoordinatedEvent({
      eventId: "fixture-paid-b",
      actor: { userId: "fixture-host-owner" },
      requestId: "fixture-paid-b-deadline-correction-v1",
      updates: { startTime: "11:30", endTime: "16:00" },
      stripe: stripe as any,
      notifier: async () => ({ sent: true, providerStatus: "fixture_sent" }),
    });
  assert.equal(deadlineMutation.fanout.mutation.status, "action_required");
  const deadlineArrivalChild = deadlineMutation.fanout.children.find(
    (child: any) => child.childKind === "arrival_correct",
  );
  assert.ok(deadlineArrivalChild?.arrivalVersionId);
  await pool.query(
    "update parking_pass_arrival_versions " +
      "set acknowledgement_deadline_at = timestamp '2000-01-01 00:00:00' " +
      "where id = $1",
    [deadlineArrivalChild.arrivalVersionId],
  );
  const deadlineBeforeRecovery = await pool.query(
    "select version.state, booking.pending_arrival_version_id, booking.purchase_id " +
      "from parking_pass_arrival_versions version " +
      "join event_bookings booking on booking.id = version.booking_id " +
      "where version.id = $1",
    [deadlineArrivalChild.arrivalVersionId],
  );
  assert.deepEqual(deadlineBeforeRecovery.rows[0], {
    state: "proposed",
    pending_arrival_version_id: deadlineArrivalChild.arrivalVersionId,
    purchase_id: confirmed.purchaseId,
  });
  const refundObjectsBeforeDeadline = stripe.refundByKey.size;
  const refundCallsBeforeDeadline = stripe.refundCreateCalls;
  stripe.failRefundCreateAfterPersist = true;
  const firstDeadlineRecovery =
    await bookingService.reconcileExpiredParkingPassArrivalChanges({
      stripe: stripe as any,
    });
  assert.equal(firstDeadlineRecovery.failed, 1);
  assert.equal(firstDeadlineRecovery.cancelled, 0);
  assert.equal(stripe.refundByKey.size, refundObjectsBeforeDeadline + 1);
  const feeRefundsBeforeDeadline = stripe.feeRefundByKey.size;
  const reversalsBeforeDeadline = stripe.reversalByKey.size;
  stripe.failFeeRefundCreateAfterPersist = true;
  const secondDeadlineRecovery =
    await bookingService.reconcileExpiredParkingPassArrivalChanges({
      stripe: stripe as any,
    });
  assert.equal(secondDeadlineRecovery.failed, 1);
  assert.equal(secondDeadlineRecovery.cancelled, 0);
  assert.equal(stripe.feeRefundByKey.size, feeRefundsBeforeDeadline + 1);
  assert.equal(stripe.reversalByKey.size, reversalsBeforeDeadline);
  const thirdDeadlineRecovery =
    await bookingService.reconcileExpiredParkingPassArrivalChanges({ stripe: stripe as any });
  assert.equal(thirdDeadlineRecovery.cancelled, 1);
  assert.equal(stripe.feeRefundByKey.size, feeRefundsBeforeDeadline + 1);
  assert.equal(stripe.reversalByKey.size, reversalsBeforeDeadline + 1);
  assert.equal(stripe.refundByKey.size, refundObjectsBeforeDeadline + 1);
  assert.equal(stripe.refundCreateCalls, refundCallsBeforeDeadline + 1);
  assert.deepEqual(stripe.settlementBalances.get(destinationTransfer.id), {
    connected: 0, platform: 0,
  }, "Refund and fee-timeout recovery return the entire purchase without stranded host or platform funds");
  const deadlineParentRecovery =
    await eventMutationService.reconcileEventParticipationMutations({
      stripe: stripe as any,
      notifier: async () => ({ sent: true, providerStatus: "fixture_sent" }),
      workerId: "fixture-deadline-provider-recovery",
    });
  assert.equal(deadlineParentRecovery.converged, 1);
  const deadlineConvergence = await pool.query(
    "select parent.status as mutation_status, booking.status as booking_status " +
      "from event_participation_mutations parent " +
      "join event_participation_mutation_children child on child.mutation_id = parent.id " +
      "join event_bookings booking on booking.id = child.booking_id " +
      "where parent.id = $1 and child.booking_id = $2",
    [deadlineMutation.fanout.mutation.id, bookingB.id],
  );
  assert.equal(deadlineConvergence.rows[0].mutation_status, "converged");
  assert.equal(deadlineConvergence.rows[0].booking_status, "refunded");

  const raceInput = {
    purchaserUserId: "fixture-truck-owner",
    truckId: "fixture-truck",
    hostId: "fixture-host",
    idempotencyKey: "fixture-capture-race-v1",
    lines: [
      {
        eventId: "fixture-paid-race",
        hostPriceCents: 700,
        platformFeeCents: 70,
        slotType: "daily",
      },
    ],
    stripe: stripe as any,
  };
  const racePending = await bookingService.createParkingPassPurchase(raceInput);
  stripe.succeedIntent(racePending.paymentIntentId!);
  const captureRefundObjectsBefore = stripe.refundByKey.size;
  const captureRefundCallsBefore = stripe.refundCreateCalls;
  stripe.failRefundCreateAfterPersist = true;
  const captureRaceMutation =
    await eventMutationService.updateCoordinatedEvent({
      eventId: "fixture-paid-race",
      actor: { userId: "fixture-host-owner" },
      requestId: "fixture-captured-event-cancel-v1",
      updates: { status: "cancelled" },
      stripe: stripe as any,
      notifier: async () => ({ sent: true, providerStatus: "fixture_sent" }),
    });
  assert.equal(captureRaceMutation.fanout.mutation.status, "action_required");
  assert.equal(stripe.refundByKey.size, captureRefundObjectsBefore + 1);
  const captureRefundRecovery =
    await bookingService.reconcilePendingParkingPassRefunds({
      stripe: stripe as any,
    });
  assert.equal(captureRefundRecovery.succeeded, 1);
  assert.equal(stripe.refundByKey.size, captureRefundObjectsBefore + 1);
  assert.equal(stripe.refundCreateCalls, captureRefundCallsBefore + 1);
  const captureRaceRecovery =
    await eventMutationService.reconcileEventParticipationMutations({
      stripe: stripe as any,
      notifier: async () => ({ sent: true, providerStatus: "fixture_sent" }),
      workerId: "fixture-capture-race-recovery",
    });
  assert.equal(captureRaceRecovery.converged, 1);
  await assert.rejects(
    bookingService.createParkingPassPurchase(raceInput),
    (error: any) => error?.code === "purchase_closed",
  );
  const raceState = await pool.query(
    `select p.status as purchase_status, b.status as booking_status,
            c.status as cancellation_status, c.policy_trigger
       from parking_pass_purchases p
       join event_bookings b on b.purchase_id = p.id
       join parking_pass_cancellation_operations c on c.purchase_id = p.id
      where p.id = $1`,
    [racePending.purchaseId],
  );
  assert.deepEqual(raceState.rows[0], {
    purchase_status: "refunded",
    booking_status: "refunded",
    cancellation_status: "provider_confirmed",
    policy_trigger: "technical_non_service",
  });

  const sharedPublicRows = async (eventId: string) =>
    db
      .select({ id: schema.events.id })
      .from(schema.events)
      .leftJoin(
        schema.eventBookings,
        eq(schema.eventBookings.eventId, schema.events.id),
      )
      .leftJoin(
        schema.parkingPassPurchases,
        eq(
          schema.parkingPassPurchases.id,
          schema.eventBookings.purchaseId,
        ),
      )
      .where(
        and(
          eq(schema.events.id, eventId),
          publicPaidParticipationSqlCondition,
        ),
      );
  const freeVisible = () => sharedPublicRows("fixture-free");
  assert.equal((await freeVisible()).length, 1);
  assert.equal((await sharedPublicRows("fixture-free-pending")).length, 0);
  assert.equal((await sharedPublicRows("fixture-paid-legacy")).length, 0);
  assert.equal((await sharedPublicRows("fixture-paid-event")).length, 1);
  const firstMutation = await eventMutationService.updateCoordinatedEvent({
    eventId: "fixture-free",
    actor: { userId: "fixture-coordinator" },
    requestId: "fixture-free-event-correction-v1",
    updates: { startTime: "09:30", endTime: "12:30" },
    stripe: stripe as any,
    notifier: async () => ({
      sent: false,
      providerStatus: "fixture_rejected_before_acceptance",
      retrySafe: true,
    }),
  });
  assert.equal(firstMutation.fanout.mutation.status, "action_required");
  assert.equal((await freeVisible()).length, 0);
  await pool.query(
    "update users set is_disabled = true where id = 'fixture-coordinator'",
  );
  const recoveredNotificationKeys: string[] = [];
  const recoveredNotificationIds: string[] = [];
  const recoveredNotifier = async (notice: any) => {
    recoveredNotificationKeys.push(notice.idempotencyKey);
    recoveredNotificationIds.push("fixture-message-event-correction-v1");
    return {
      sent: true,
      providerStatus: "fixture_provider_accepted",
      providerMessageId: "fixture-message-event-correction-v1",
    };
  };
  const eventRecoveryRuns = await Promise.all([
    eventMutationService.reconcileEventParticipationMutations({
      stripe: stripe as any,
      notifier: recoveredNotifier,
      workerId: "fixture-event-recovery-a",
    }),
    eventMutationService.reconcileEventParticipationMutations({
      stripe: stripe as any,
      notifier: recoveredNotifier,
      workerId: "fixture-event-recovery-b",
    }),
  ]);
  assert.equal(
    eventRecoveryRuns.reduce((total, row) => total + row.converged, 0),
    1,
  );
  assert.equal(
    eventRecoveryRuns.reduce((total, row) => total + row.failed, 0),
    0,
  );
  const recoveredEventMutation = await pool.query(
    "select status, last_recovery_actor_type, recovery_attempt_count " +
      "from event_participation_mutations where id = $1",
    [firstMutation.fanout.mutation.id],
  );
  assert.equal(recoveredEventMutation.rows[0].status, "converged");
  assert.equal(recoveredEventMutation.rows[0].last_recovery_actor_type, "system");
  assert.ok(recoveredEventMutation.rows[0].recovery_attempt_count >= 1);
  assert.equal(recoveredNotificationKeys.length, 1);
  assert.equal(recoveredNotificationIds.length, 1);
  const recoveredNotificationChild = await pool.query(
    `select idempotency_key, notification_delivery_state,
            notification_provider_message_id, attempt_count
       from event_participation_mutation_children
      where mutation_id = $1 and child_kind = 'notification'`,
    [firstMutation.fanout.mutation.id],
  );
  assert.deepEqual(recoveredNotificationChild.rows[0], {
    idempotency_key: recoveredNotificationKeys[0],
    notification_delivery_state: "provider_confirmed",
    notification_provider_message_id: "fixture-message-event-correction-v1",
    attempt_count: 2,
  });
  assert.equal((await freeVisible()).length, 1);
  await pool.query(
    "update users set is_disabled = false where id = 'fixture-coordinator'",
  );

  let acceptedTimeoutNotificationCalls = 0;
  const acceptedTimeoutNotificationKeys: string[] = [];
  const ambiguousNoticeMutation =
    await eventMutationService.updateCoordinatedEvent({
      eventId: "fixture-free",
      actor: { userId: "fixture-coordinator" },
      requestId: "fixture-free-event-correction-notice-timeout-v2",
      updates: { startTime: "09:45", endTime: "12:45" },
      stripe: stripe as any,
      notifier: async (notice: any) => {
        acceptedTimeoutNotificationCalls += 1;
        acceptedTimeoutNotificationKeys.push(notice.idempotencyKey);
        throw Object.assign(
          new Error("provider accepted notification before timeout"),
          { code: "provider_accepted_timeout" },
        );
      },
    });
  assert.equal(ambiguousNoticeMutation.fanout.mutation.status, "action_required");
  assert.equal(acceptedTimeoutNotificationCalls, 1);
  await Promise.all([
    eventMutationService.reconcileEventParticipationMutations({
      stripe: stripe as any,
      notifier: async () => {
        acceptedTimeoutNotificationCalls += 1;
        return { sent: true, providerStatus: "unexpected_resend" };
      },
      workerId: "fixture-notice-timeout-recovery-a",
    }),
    eventMutationService.reconcileEventParticipationMutations({
      stripe: stripe as any,
      notifier: async () => {
        acceptedTimeoutNotificationCalls += 1;
        return { sent: true, providerStatus: "unexpected_resend" };
      },
      workerId: "fixture-notice-timeout-recovery-b",
    }),
  ]);
  assert.equal(
    acceptedTimeoutNotificationCalls,
    1,
    "accepted-timeout notification identity must never be resent",
  );
  const ambiguousNoticeChild = await pool.query(
    `select idempotency_key, notification_delivery_state, status,
            notification_provider_message_id, attempt_count, failure_code
       from event_participation_mutation_children
      where mutation_id = $1 and child_kind = 'notification'`,
    [ambiguousNoticeMutation.fanout.mutation.id],
  );
  assert.deepEqual(ambiguousNoticeChild.rows[0], {
    idempotency_key: acceptedTimeoutNotificationKeys[0],
    notification_delivery_state: "ambiguous",
    status: "action_required",
    notification_provider_message_id: null,
    attempt_count: 1,
    failure_code: "participant_notification_delivery_ambiguous",
  });

  const seriesMutation =
    await eventMutationService.updateCoordinatedSeries({
      seriesId: "fixture-series",
      actor: { userId: "fixture-coordinator" },
      requestId: "fixture-series-correction-v1",
      updates: {
        defaultStartTime: "08:10",
        defaultEndTime: "12:50",
      },
      stripe: stripe as any,
      notifier: async () => ({ sent: true, providerStatus: "fixture_sent" }),
    });
  assert.equal(seriesMutation.mutation.status, "action_required");
  assert.equal(await paidEventProjectionSize(), 0);
  const seriesArrivalChild = seriesMutation.fanout.children.find(
    (child: any) => child.childKind === "arrival_correct",
  );
  assert.ok(seriesArrivalChild?.arrivalVersionId);
  await bookingService.acknowledgeProtectedParkingPassArrival({
    bookingId: paidEventBookingId,
    versionId: seriesArrivalChild.arrivalVersionId,
    actor: { userId: "fixture-truck-owner" },
    idempotencyKey: "fixture-series-arrival-ack-v1",
  });
  const seriesRecovery =
    await eventMutationService.reconcileEventParticipationMutations({
      stripe: stripe as any,
      notifier: async () => ({ sent: true, providerStatus: "fixture_sent" }),
      workerId: "fixture-series-ack-recovery",
    });
  assert.equal(seriesRecovery.converged, 1);
  const recoveredSeriesMutation = await pool.query(
    "select status from event_participation_mutations where id = $1",
    [seriesMutation.mutation.id],
  );
  assert.equal(recoveredSeriesMutation.rows[0].status, "converged");
  assert.equal(await paidEventProjectionSize(), 1);
  const correctedPaidEventProjection =
    await loadPublicParkingPassProjections({
      eventIds: ["fixture-paid-event"],
      database: db,
    });
  assert.equal(
    correctedPaidEventProjection.get("fixture-paid-event")?.startsAt.getUTCMinutes(),
    0,
  );
  assert.doesNotMatch(
    JSON.stringify([...correctedPaidEventProjection.values()]),
    /742 Protected Market Street/i,
  );
  const draftSeriesMutation =
    await eventMutationService.updateCoordinatedSeries({
      seriesId: "fixture-series",
      actor: { userId: "fixture-coordinator" },
      requestId: "fixture-series-draft-with-participation-v1",
      updates: { status: "draft" },
      stripe: stripe as any,
      notifier: async () => ({ sent: true, providerStatus: "fixture_sent" }),
    });
  assert.equal(draftSeriesMutation.mutation.status, "converged");
  assert.equal(await paidEventProjectionSize(), 0);
  const draftedSeries = await pool.query(
    "select status from event_series where id = 'fixture-series'",
  );
  assert.equal(draftedSeries.rows[0].status, "draft");

  await pool.query(`
    insert into host_earnings_ledger
      (id, host_id, entry_type, source_type, settlement_topology,
       reconciliation_state, amount_cents, description)
    values
      ('fixture-legacy-earning', 'fixture-host', 'booking_earned',
       'historical_fixture', 'legacy_platform_hold', 'eligible_legacy',
       10000, 'Fixture eligible legacy funds');
    insert into host_payout_requests
      (id, host_id, user_id, amount_cents, status, funding_topology,
       eligibility_state, eligible_amount_snapshot_cents)
    values
      ('fixture-payout', 'fixture-host', 'fixture-host-owner', 2000,
       'approved', 'legacy_platform_hold', 'eligible_legacy', 10000);
  `);
  stripe.failTransferCreateAfterPersist = true;
  await assert.rejects(
    payoutService.executeLegacyPayoutTransfer({
      payoutRequestId: "fixture-payout",
      actorUserId: "fixture-admin",
      requestId: "fixture-payout-request-v1",
      stripe: stripe as any,
    }),
    (error: any) => error?.code === "api_connection_error",
  );
  assert.equal(stripe.transferCreateCalls, 1);
  await pool.query(
    `update users set is_disabled = true where id = 'fixture-admin'`,
  );
  stripe.connectReady = false;
  await pool.query(
    `update hosts
        set stripe_onboarding_completed = false,
            stripe_charges_enabled = false,
            stripe_payouts_enabled = false
      where id = 'fixture-host'`,
  );
  const payoutResults = await Promise.all([
    payoutService.executeLegacyPayoutTransfer({
      payoutRequestId: "fixture-payout",
      actorUserId: "fixture-recovery-admin",
      requestId: "fixture-payout-request-v1",
      stripe: stripe as any,
    }),
    payoutService.executeLegacyPayoutTransfer({
      payoutRequestId: "fixture-payout",
      actorUserId: "fixture-recovery-admin",
      requestId: "fixture-payout-request-v1",
      stripe: stripe as any,
    }),
  ]);
  assert.equal(payoutResults[0].operation.id, payoutResults[1].operation.id);
  assert.equal(payoutResults[0].operation.status, "provider_confirmed");
  assert.equal(stripe.transferByKey.size, 1);
  assert.equal(stripe.transferCreateCalls, 1);
  const recoveredPayoutOperation = await pool.query(
    `select recovery_attempt_count, last_recovery_actor_user_id,
            last_recovery_actor_type
       from legacy_payout_provider_operations
      where payout_request_id = 'fixture-payout'`,
  );
  assert.ok(recoveredPayoutOperation.rows[0].recovery_attempt_count >= 1);
  assert.equal(
    recoveredPayoutOperation.rows[0].last_recovery_actor_user_id,
    "fixture-recovery-admin",
  );
  assert.equal(
    recoveredPayoutOperation.rows[0].last_recovery_actor_type,
    "current_staff_takeover",
  );
  stripe.connectReady = true;
  await pool.query(`
    update hosts
       set stripe_onboarding_completed = true,
           stripe_charges_enabled = true,
           stripe_payouts_enabled = true
     where id = 'fixture-host';
    insert into host_payout_requests
      (id, host_id, user_id, amount_cents, status, funding_topology,
       eligibility_state, eligible_amount_snapshot_cents)
    values
      ('fixture-payout-system', 'fixture-host', 'fixture-host-owner', 1000,
       'approved', 'legacy_platform_hold', 'eligible_legacy', 8000);
  `);
  stripe.failTransferCreateAfterPersist = true;
  await assert.rejects(
    payoutService.executeLegacyPayoutTransfer({
      payoutRequestId: "fixture-payout-system",
      actorUserId: "fixture-system-admin",
      requestId: "fixture-payout-system-request-v1",
      stripe: stripe as any,
    }),
    (error: any) => error?.code === "api_connection_error",
  );
  await pool.query(
    `update users set is_disabled = true where id = 'fixture-system-admin'`,
  );
  const systemRecoveredPayout =
    await payoutService.executeLegacyPayoutTransfer({
      payoutRequestId: "fixture-payout-system",
      requestId: "fixture-payout-system-request-v1",
      recovery: {
        mode: "system",
        reason: "fixture_exact_submitted_operation_recovery",
      },
      stripe: stripe as any,
    });
  assert.equal(systemRecoveredPayout.operation.status, "provider_confirmed");
  assert.equal(systemRecoveredPayout.operation.lastRecoveryActorType, "system");
  assert.equal(stripe.transferCreateCalls, 2);
  assert.equal(stripe.transferByKey.size, 2);

  const expiredRequestDigest = digest({
    version: "legacy-payout-provider-v1",
    payoutRequestId: "fixture-payout-expired",
    requestId: "fixture-payout-expired-v1",
    actorUserId: "fixture-admin",
    hostId: "fixture-host",
    amountCents: 1000,
    currency: "usd",
    destinationAccountId: "acct_fixture_host",
    fundingTopology: "legacy_platform_hold",
    eligibleAmountSnapshotCents: 8000,
  });
  await pool.query(
    `insert into host_payout_requests
       (id, host_id, user_id, amount_cents, status, funding_topology,
        eligibility_state, eligible_amount_snapshot_cents)
     values
       ('fixture-payout-expired', 'fixture-host', 'fixture-host-owner', 1000,
         'processing', 'legacy_platform_hold', 'eligible_legacy', 8000)`,
  );
  await pool.query(
    `insert into legacy_payout_provider_operations
       (id, payout_request_id, request_id, idempotency_key, request_digest,
        actor_user_id, expected_host_id, expected_amount_cents,
        expected_currency, expected_destination_account_id,
        expected_funding_topology, expected_eligible_amount_snapshot_cents,
        status, attempt_count, idempotency_expires_at, created_at, updated_at)
     values
       ('fixture-payout-expired-op', 'fixture-payout-expired',
        'fixture-payout-expired-v1', 'fixture-payout-expired-provider-key',
        $1, 'fixture-admin', 'fixture-host', 1000, 'usd',
        'acct_fixture_host', 'legacy_platform_hold', 8000,
        'action_required', 1, now() - interval '1 minute',
        now() - interval '2 days', now())`,
    [expiredRequestDigest],
  );
  const transferCallsBeforeExpired = stripe.transferCreateCalls;
  await assert.rejects(
    payoutService.executeLegacyPayoutTransfer({
      payoutRequestId: "fixture-payout-expired",
      actorUserId: "fixture-recovery-admin",
      requestId: "fixture-payout-expired-v1",
      stripe: stripe as any,
    }),
    (error: any) =>
      error?.code === "provider_idempotency_retention_expired",
  );
  assert.equal(stripe.transferCreateCalls, transferCallsBeforeExpired);

  await pool.query(`
    insert into cities (id, name, slug, state, timezone)
    select 'fixture-many-zone-' || value::text,
           'Many Zone City', 'many-zone-city-' || value::text,
           'ZZ', 'America/Denver'
      from generate_series(1, 11) value
  `);
  assert.equal(
    await resolveCityTimeZoneStrict({ city: "Many Zone City", state: "ZZ" }),
    "America/Denver",
    "all persisted duplicates must be examined, not truncated",
  );
  await pool.query(`
    insert into cities (id, name, slug, state, timezone)
    values ('fixture-many-zone-conflict', 'Many Zone City',
            'many-zone-city-conflict', 'ZZ', 'America/Chicago')
  `);
  assert.equal(
    await resolveCityTimeZoneStrict({ city: "Many Zone City", state: "ZZ" }),
    null,
    "an eleventh-plus conflicting persisted timezone must fail closed",
  );

  // Per-recipient notification claims converge under concurrent workers.
  let confirmedNotificationCalls = 0;
  const confirmedNotificationInput = {
    notificationKind: "fixture_concurrent_notice",
    subjectId: "fixture-notice-subject-confirmed",
    recipientUserId: "fixture-truck-owner",
    recipientEmail: "owner@desertfork.example",
    serviceTimeZone: "America/Denver",
    serviceDateKey: "2026-08-29",
    payload: { version: "fixture-v1", dateKey: "2026-08-29" },
    send: async () => {
      confirmedNotificationCalls += 1;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      return {
        sent: true,
        providerStatus: "provider_accepted",
        providerMessageId: "fixture-notice-message-confirmed",
        retrySafe: false,
      };
    },
  };
  const concurrentNotifications = await Promise.all([
    notificationDeliveryService.deliverEventNotificationOnce(
      confirmedNotificationInput,
    ),
    notificationDeliveryService.deliverEventNotificationOnce(
      confirmedNotificationInput,
    ),
  ]);
  assert.equal(confirmedNotificationCalls, 1);
  assert.ok(
    concurrentNotifications.some(
      (delivery: any) => delivery.status === "provider_confirmed",
    ),
  );

  let ambiguousNotificationCalls = 0;
  const ambiguousNotificationInput = {
    ...confirmedNotificationInput,
    notificationKind: "fixture_ambiguous_notice",
    subjectId: "fixture-notice-subject-ambiguous",
    payload: { version: "fixture-v1", mode: "accepted-timeout" },
    send: async () => {
      ambiguousNotificationCalls += 1;
      return {
        sent: false,
        providerStatus: "provider_ambiguous",
        retrySafe: false,
      };
    },
  };
  const ambiguousDelivery =
    await notificationDeliveryService.deliverEventNotificationOnce(
      ambiguousNotificationInput,
    );
  assert.equal(ambiguousDelivery.status, "ambiguous");
  const ambiguousReplay =
    await notificationDeliveryService.deliverEventNotificationOnce(
      ambiguousNotificationInput,
    );
  assert.equal(ambiguousReplay.status, "ambiguous");
  assert.equal(ambiguousNotificationCalls, 1);

  let retrySafeNotificationCalls = 0;
  const retrySafeBase = {
    ...confirmedNotificationInput,
    notificationKind: "fixture_retry_safe_notice",
    subjectId: "fixture-notice-subject-retry-safe",
    payload: { version: "fixture-v1", mode: "pre-provider-rejection" },
  };
  const retrySafeDelivery =
    await notificationDeliveryService.deliverEventNotificationOnce({
      ...retrySafeBase,
      send: async () => {
        retrySafeNotificationCalls += 1;
        return {
          sent: false,
          providerStatus: "provider_not_configured",
          retrySafe: true,
        };
      },
    });
  assert.equal(retrySafeDelivery.status, "retry_safe");
  const retrySafeConverged =
    await notificationDeliveryService.deliverEventNotificationOnce({
      ...retrySafeBase,
      send: async () => {
        retrySafeNotificationCalls += 1;
        return {
          sent: true,
          providerStatus: "provider_accepted",
          providerMessageId: "fixture-notice-message-retry",
          retrySafe: false,
        };
      },
    });
  assert.equal(retrySafeConverged.status, "provider_confirmed");
  assert.equal(retrySafeNotificationCalls, 2);

  // A zero-event Parking Pass can be blacked out directly from its durable
  // series identity, and public virtualization immediately omits the date.
  await pool.query(`
    insert into event_series
      (id, host_id, name, timezone, start_date, end_date,
       default_start_time, default_end_time, default_max_trucks,
       default_daily_price_cents, default_host_price_cents,
       series_type, status)
    values
      ('fixture-blackout-series', 'fixture-host', 'Zero Event Parking Pass',
       'America/Chicago', '2099-04-01', null, '09:00', '12:00', 2,
       800, 800, 'parking_pass', 'published')
  `);
  const beforeBlackoutVirtual = await listParkingPassOccurrences({
    start: new Date("2099-04-01T00:00:00.000Z"),
    horizonDays: 1,
    seriesIds: ["fixture-blackout-series"],
  });
  assert.equal(beforeBlackoutVirtual.occurrences.length, 1);
  await bookingService.createParkingPassBlackout({
    hostId: "fixture-host",
    actorUserId: "fixture-host-owner",
    dateKey: "2099-04-01",
    now: new Date("2099-03-31T18:00:00.000Z"),
  });
  const afterBlackoutVirtual = await listParkingPassOccurrences({
    start: new Date("2099-04-01T00:00:00.000Z"),
    horizonDays: 1,
    seriesIds: ["fixture-blackout-series"],
  });
  assert.equal(afterBlackoutVirtual.occurrences.length, 0);
  const afterBlackoutPublic = await routeJson("/api/parking-pass");
  assert.equal(afterBlackoutPublic.status, 200, afterBlackoutPublic.text);
  assert.equal(
    (Array.isArray(afterBlackoutPublic.body) ? afterBlackoutPublic.body : []).some(
      (row: any) =>
        String(row?.id || "") ===
        "parking-pass:fixture-blackout-series:2099-04-01",
    ),
    false,
  );
  await bookingService.deleteParkingPassBlackout({
    hostId: "fixture-host",
    actorUserId: "fixture-host-owner",
    dateKey: "2099-04-01",
    now: new Date("2099-03-31T18:00:00.000Z"),
  });
  const afterBlackoutRemoval = await listParkingPassOccurrences({
    start: new Date("2099-04-01T00:00:00.000Z"),
    horizonDays: 1,
    seriesIds: ["fixture-blackout-series"],
  });
  assert.equal(afterBlackoutRemoval.occurrences.length, 1);
  await bookingService.createParkingPassBlackout({
    hostId: "fixture-host",
    actorUserId: "fixture-host-owner",
    dateKey: "2099-04-01",
    now: new Date("2099-03-31T18:00:00.000Z"),
  });
  await pool.query(`
    insert into events
      (id, host_id, series_id, name, event_type, date, start_time, end_time,
       max_trucks, status, hard_cap_enabled, requires_payment,
       host_price_cents, daily_price_cents)
    values
      ('fixture-blackout-paid', 'fixture-host', 'fixture-blackout-series',
       'Blocked Parking Pass', 'parking_pass', '2099-04-01', '09:00', '12:00',
       2, 'open', true, true, 800, 800)
  `);
  const purchaseRowsBeforeBlackout = await pool.query(
    `select count(*)::int as count from parking_pass_purchases`,
  );
  const paymentCallsBeforeBlackout = stripe.paymentIntentCreateCalls;
  await assert.rejects(
    bookingService.createParkingPassPurchase({
      purchaserUserId: "fixture-truck-owner",
      truckId: "fixture-truck",
      hostId: "fixture-host",
      idempotencyKey: "fixture-blackout-purchase-v1",
      lines: [
        {
          eventId: "fixture-blackout-paid",
          hostPriceCents: 800,
          platformFeeCents: 80,
          slotType: "daily",
        },
      ],
      stripe: stripe as any,
    }),
    (error: any) => error?.code === "parking_pass_date_blocked",
  );
  const purchaseRowsAfterBlackout = await pool.query(
    `select count(*)::int as count from parking_pass_purchases`,
  );
  assert.deepEqual(purchaseRowsAfterBlackout.rows, purchaseRowsBeforeBlackout.rows);
  assert.equal(stripe.paymentIntentCreateCalls, paymentCallsBeforeBlackout);

  // If a pending purchase wins reservation first, a later blackout wins the
  // date barrier and captured confirmation enters one technical refund.
  await pool.query(`
    insert into events
      (id, host_id, series_id, name, event_type, date, start_time, end_time,
       max_trucks, status, hard_cap_enabled, requires_payment,
       host_price_cents, daily_price_cents)
    values
      ('fixture-blackout-race-paid', 'fixture-host',
       'fixture-blackout-series', 'Race Parking Pass', 'parking_pass',
       '2099-04-02', '09:00', '12:00', 2, 'open', true, true, 800, 800)
  `);
  const blackoutRaceInput = {
    purchaserUserId: "fixture-truck-owner",
    truckId: "fixture-truck",
    hostId: "fixture-host",
    idempotencyKey: "fixture-blackout-race-purchase-v1",
    lines: [
      {
        eventId: "fixture-blackout-race-paid",
        hostPriceCents: 800,
        platformFeeCents: 80,
        slotType: "daily",
      },
    ],
    stripe: stripe as any,
  };
  const blackoutRacePurchase =
    await bookingService.createParkingPassPurchase(blackoutRaceInput);
  await bookingService.createParkingPassBlackout({
    hostId: "fixture-host",
    actorUserId: "fixture-host-owner",
    dateKey: "2099-04-02",
    now: new Date("2099-03-31T18:00:00.000Z"),
  });
  const capturedBlackoutIntent = stripe.succeedIntent(
    blackoutRacePurchase.paymentIntentId!,
  );
  const refundCallsBeforeBlackoutRace = stripe.refundCreateCalls;
  await assert.rejects(
    bookingService.confirmParkingPassPurchaseFromIntent(
      capturedBlackoutIntent as any,
      stripe as any,
    ),
    (error: any) => error?.code === "parking_pass_date_blocked",
  );
  const blackoutRaceState = await pool.query(
    `select purchase.status, booking.status as booking_status,
            cancellation.status as cancellation_status
       from parking_pass_purchases purchase
       join event_bookings booking on booking.purchase_id = purchase.id
       left join parking_pass_cancellation_operations cancellation
         on cancellation.purchase_id = purchase.id
        and cancellation.policy_trigger = 'technical_non_service'
      where purchase.id = $1`,
    [blackoutRacePurchase.purchaseId],
  );
  assert.equal(blackoutRaceState.rows[0].booking_status, "refunded");
  assert.equal(blackoutRaceState.rows[0].cancellation_status, "provider_confirmed");
  assert.equal(
    blackoutRaceState.rows.filter(
      (row: any) => row.cancellation_status === "provider_confirmed",
    ).length,
    1,
  );
  assert.equal(
    stripe.refundCreateCalls - refundCallsBeforeBlackoutRace,
    1,
    "the captured blackout race creates exactly one provider refund",
  );

  // Publication persists the complete target set first. An injected child
  // interruption leaves only private drafts; system recovery converges the
  // exact stored scope after the original owner is disabled.
  await pool.query(`
    insert into event_series
      (id, host_id, coordinator_user_id, name, timezone, recurrence_rule,
       start_date, end_date, default_start_time, default_end_time,
       default_max_trucks, series_type, status)
    values
      ('fixture-publication-series', 'fixture-host', null,
       'Durable Publication Fixture', 'America/Chicago',
       'WEEKLY:SU,MO,TU,WE,TH,FR,SA', '2099-05-01', '2099-05-03',
       '10:00', '14:00', 3, 'open_call', 'draft')
  `);
  await assert.rejects(
    publicationService.publishEventSeriesDurably({
      seriesId: "fixture-publication-series",
      actorUserId: "fixture-host-owner",
      requestId: "fixture-publication-request-v1",
      now: new Date("2099-04-30T18:00:00.000Z"),
      failAfterChildCount: 2,
    }),
    (error: any) => error?.code === "event_series_publication_interrupted",
  );
  const interruptedPublication = await pool.query(`
    select operation.id, operation.status, operation.expected_child_count,
           series.status as series_status,
           series.active_publication_operation_id,
           count(event.id)::int as private_event_count,
           count(event.id) filter (where event.status = 'draft')::int as draft_count
      from event_series_publication_operations operation
      join event_series series on series.id = operation.series_id
      left join events event on event.publication_operation_id = operation.id
     where operation.series_id = 'fixture-publication-series'
     group by operation.id, series.id
  `);
  assert.equal(interruptedPublication.rows[0].status, "action_required");
  assert.equal(interruptedPublication.rows[0].series_status, "draft");
  assert.equal(interruptedPublication.rows[0].private_event_count, 2);
  assert.equal(interruptedPublication.rows[0].draft_count, 2);
  const frozenPublicationChild = await pool.query(`
    select child.*, operation.id as parent_operation_id
      from event_series_publication_children child
      join event_series_publication_operations operation
        on operation.id = child.operation_id
     where operation.series_id = 'fixture-publication-series'
       and child.event_id is not null
     order by child.date_key
     limit 1
  `);
  const frozenChild = frozenPublicationChild.rows[0];
  assert.ok(frozenChild?.expected_event_id);
  await assert.rejects(
    pool.query(
      `update events set name = 'Forged wrong frozen name' where id = $1`,
      [frozenChild.expected_event_id],
    ),
    /facts differ from frozen child payload/i,
  );
  await assert.rejects(
    pool.query(
      `insert into events
         (id, host_id, coordinator_user_id, series_id,
          publication_operation_id, publication_date_key,
          publication_payload_digest, name, description, event_type, date,
          start_time, end_time, max_trucks, hard_cap_enabled,
          requires_payment, status)
       values
         ('fixture-forged-publication-id', $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10::date, $11, $12, $13, $14, $15, 'draft')`,
      [
        frozenChild.host_id,
        frozenChild.coordinator_user_id,
        frozenChild.series_id,
        frozenChild.operation_id,
        frozenChild.date_key,
        frozenChild.payload_digest,
        frozenChild.name,
        frozenChild.description,
        frozenChild.event_type,
        frozenChild.date_key,
        frozenChild.start_time,
        frozenChild.end_time,
        frozenChild.max_trucks,
        frozenChild.hard_cap_enabled,
        frozenChild.requires_payment,
      ],
    ),
    /outside frozen child scope/i,
  );
  await assert.rejects(
    pool.query(`
      insert into events
        (id, host_id, series_id, name, event_type, date, start_time, end_time,
         max_trucks, status)
      values
        ('fixture-direct-publication-bypass', 'fixture-host',
         'fixture-publication-series', 'Direct bypass', 'public_event',
         '2099-05-04', '10:00', '14:00', 1, 'open')
    `),
    /frozen publication child|suppressed by an active operation/i,
  );
  await pool.query(
    `update users set is_disabled = true where id = 'fixture-host-owner'`,
  );
  await Promise.all([
    publicationService.reconcileEventSeriesPublications({
      workerId: "fixture-publication-worker-a",
    }),
    publicationService.reconcileEventSeriesPublications({
      workerId: "fixture-publication-worker-b",
    }),
  ]);
  const convergedPublication = await pool.query(`
    select operation.id, operation.status, operation.expected_child_count,
           series.status as series_status,
           series.active_publication_operation_id,
           count(event.id)::int as event_count,
           count(distinct event.publication_date_key)::int as date_count,
           count(event.id) filter (where event.status = 'open')::int as open_count
      from event_series_publication_operations operation
      join event_series series on series.id = operation.series_id
      left join events event on event.publication_operation_id = operation.id
     where operation.series_id = 'fixture-publication-series'
     group by operation.id, series.id
  `);
  assert.equal(convergedPublication.rows[0].status, "converged");
  assert.equal(convergedPublication.rows[0].series_status, "published");
  assert.equal(convergedPublication.rows[0].active_publication_operation_id, null);
  assert.equal(convergedPublication.rows[0].event_count, 3);
  assert.equal(convergedPublication.rows[0].date_count, 3);
  assert.equal(convergedPublication.rows[0].open_count, 3);
  const exactPublishedIdentities = await pool.query(`
    select child.expected_event_id, event.id
      from event_series_publication_children child
      left join events event on event.id = child.expected_event_id
     where child.operation_id = $1
     order by child.date_key
  `, [convergedPublication.rows[0].id]);
  assert.equal(exactPublishedIdentities.rows.length, 3);
  assert.equal(
    exactPublishedIdentities.rows.every(
      (row: any) => row.id === row.expected_event_id,
    ),
    true,
  );
  await assert.rejects(
    pool.query(
      `insert into event_series_publication_children
         (operation_id, series_id, date_key, payload_digest, status)
       values ($1, 'fixture-publication-series', '2099-05-04',
               'out-of-digest', 'prepared')`,
      [convergedPublication.rows[0].id],
    ),
    /outside frozen target scope|child set is already frozen/i,
  );

  const destinationLedgerCount = await pool.query(
    `select count(*)::int as count from host_earnings_ledger
      where settlement_topology = 'destination_charge'
        and reconciliation_state = 'eligible_legacy'`,
  );
  assert.equal(destinationLedgerCount.rows[0].count, 0);

  await new Promise<void>((resolveClose, rejectClose) => {
    routeServer.close((error?: Error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
  await pool.end();
  console.log(
    "integrated-marketplace-provider-stateful: PASS " +
      "(PI recovery/authority/Connect, selected refund concurrency, " +
      "paid/free projection privacy, arrival and event/series resume, " +
      "capture-race recovery, dispute, automatic event/deadline recovery, " +
      "payout recovery/retention)",
  );
}

function runOrchestrator() {
  const dockerCandidates = [
    process.env.DOCKER_BIN,
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    "docker",
  ].filter((candidate): candidate is string => Boolean(candidate));
  const dockerBin =
    dockerCandidates.find((candidate) =>
      candidate === "docker" ? true : existsSync(candidate),
    ) || "docker";
  const containerName =
    `mealscout-imv1-stateful-${process.pid}-${Date.now()}`.toLowerCase();
  const password = "imv1-disposable-stateful-only";
  const docker = (args: string[], input?: string) =>
    spawnSync(dockerBin, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      input,
      maxBuffer: 50 * 1024 * 1024,
    });
  let started = false;
  try {
    const start = docker([
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-p",
      "127.0.0.1::5432",
      "postgres:16-alpine",
    ]);
    assert.equal(start.status, 0, start.stderr || start.stdout);
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const probe = docker([
        "exec",
        containerName,
        "pg_isready",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ]);
      if (probe.status === 0) {
        ready = true;
        break;
      }
      sleep(250);
    }
    assert.equal(ready, true, "disposable PostgreSQL 16 did not become ready");
    const portResult = docker(["port", containerName, "5432/tcp"]);
    assert.equal(portResult.status, 0, portResult.stderr || portResult.stdout);
    const portMatch = clean(portResult.stdout).match(/:(\d+)$/);
    assert.ok(portMatch, `could not parse disposable port: ${portResult.stdout}`);
    const databaseUrl =
      `postgresql://postgres:${password}@127.0.0.1:${portMatch[1]}/postgres`;
    const push = spawnSync(
      process.execPath,
      [resolve("node_modules/drizzle-kit/bin.cjs"), "push", "--force"],
      {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl },
      maxBuffer: 50 * 1024 * 1024,
      },
    );
    assert.equal(push.status, 0, push.stderr || push.stdout);
    const recommendationInteractionMigration = readFileSync(
      resolve("migrations/090_recommendation_interactions_and_uniques.sql"),
      "utf8",
    );
    const applyRecommendationInteractions = docker(
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      recommendationInteractionMigration,
    );
    assert.equal(
      applyRecommendationInteractions.status,
      0,
      applyRecommendationInteractions.stderr ||
        applyRecommendationInteractions.stdout,
    );
    const migration = readFileSync(
      resolve("migrations/142_integrated_marketplace_purchase_review_arrival.sql"),
      "utf8",
    );
    const apply = docker(
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      migration,
    );
    assert.equal(apply.status, 0, apply.stderr || apply.stdout);
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve(process.argv[1]), "--fixture"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "test",
          TZ: "UTC",
          DATABASE_URL: databaseUrl,
          MEALSCOUT_DISPOSABLE_POSTGRES: "1",
          STRIPE_SECRET_KEY: "",
        },
        maxBuffer: 50 * 1024 * 1024,
      },
    );
    process.stdout.write(child.stdout || "");
    process.stderr.write(child.stderr || "");
    assert.equal(child.status, 0, "stateful fixture child failed");
  } finally {
    if (started) docker(["stop", "-t", "2", containerName]);
  }
}

if (process.argv.includes("--fixture")) {
  runFixture().catch((error: any) => {
    console.error(
      "integrated-marketplace-provider-stateful: FAIL",
      error?.stack || error?.message || error,
    );
    if (error?.cause) {
      console.error("integrated-marketplace-provider-stateful: CAUSE", {
        message: error.cause.message,
        code: error.cause.code,
        detail: error.cause.detail,
        constraint: error.cause.constraint,
      });
    }
    process.exit(1);
  });
} else {
  runOrchestrator();
}
