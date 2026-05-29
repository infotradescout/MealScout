import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";

export const scoutcoinTokenConfigs = pgTable("scoutcoin_token_configs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  chain: varchar("chain").notNull().default("base-sepolia"),
  contractAddress: varchar("contract_address"),
  symbol: varchar("symbol").notNull().default("SCOUT"),
  decimals: integer("decimals").notNull().default(18),
  status: varchar("status").notNull().default("disabled"), // disabled | testnet | mainnet
  priceModuleEnabled: boolean("price_module_enabled").notNull().default(false),
  priceProvider: varchar("price_provider"),
  providerConfigured: boolean("provider_configured").notNull().default(false),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const scoutcoinWalletRegistry = pgTable(
  "scoutcoin_wallet_registry",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id),
    walletAddress: varchar("wallet_address").notNull(),
    custodialProviderId: varchar("custodial_provider_id"),
    kycStatus: varchar("kyc_status").notNull().default("not_started"), // not_started | pending | verified | rejected
    isFrozen: boolean("is_frozen").notNull().default(false),
    freezeReason: text("freeze_reason"),
    jurisdictionCode: varchar("jurisdiction_code"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_scoutcoin_wallet_user").on(table.userId),
    uniqueIndex("uq_scoutcoin_wallet_address").on(table.walletAddress),
    index("idx_scoutcoin_wallet_kyc").on(table.kycStatus),
  ],
);

export const scoutcoinComplianceConfig = pgTable("scoutcoin_compliance_config", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  kycRequiredForBuySend: boolean("kyc_required_for_buy_send")
    .notNull()
    .default(true),
  blockedJurisdictions: jsonb("blocked_jurisdictions")
    .notNull()
    .default(sql`'[]'::jsonb`),
  maxTxAmountAtomic: varchar("max_tx_amount_atomic").notNull().default("0"),
  dailyTxAmountAtomic: varchar("daily_tx_amount_atomic").notNull().default("0"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const scoutcoinTxLedger = pgTable(
  "scoutcoin_tx_ledger",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    txType: varchar("tx_type").notNull(), // buy | send | receive | redeem | refund | admin_freeze
    status: varchar("status").notNull().default("confirmed"), // pending | confirmed | failed | blocked
    fromUserId: varchar("from_user_id").references(() => users.id),
    toUserId: varchar("to_user_id").references(() => users.id),
    fromWalletAddress: varchar("from_wallet_address"),
    toWalletAddress: varchar("to_wallet_address"),
    amountAtomic: varchar("amount_atomic").notNull().default("0"),
    chainTxHash: varchar("chain_tx_hash"),
    priceSource: varchar("price_source"),
    perkSurface: varchar("perk_surface"), // mealscout | tradescout
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdByUserId: varchar("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_scoutcoin_tx_type").on(table.txType),
    index("idx_scoutcoin_tx_from").on(table.fromUserId),
    index("idx_scoutcoin_tx_to").on(table.toUserId),
    index("idx_scoutcoin_tx_created").on(table.createdAt),
  ],
);

export const insertScoutcoinTokenConfigSchema = createInsertSchema(
  scoutcoinTokenConfigs,
  {
    status: z.enum(["disabled", "testnet", "mainnet"]),
  },
).omit({ id: true, createdAt: true, updatedAt: true });

export const insertScoutcoinWalletRegistrySchema = createInsertSchema(
  scoutcoinWalletRegistry,
  {
    kycStatus: z.enum(["not_started", "pending", "verified", "rejected"]),
  },
).omit({ id: true, createdAt: true, updatedAt: true });

export const insertScoutcoinComplianceConfigSchema = createInsertSchema(
  scoutcoinComplianceConfig,
).omit({ id: true, createdAt: true, updatedAt: true });

export const insertScoutcoinTxLedgerSchema = createInsertSchema(
  scoutcoinTxLedger,
  {
    txType: z.enum([
      "buy",
      "send",
      "receive",
      "redeem",
      "refund",
      "admin_freeze",
    ]),
    status: z.enum(["pending", "confirmed", "failed", "blocked"]),
  },
).omit({ id: true, createdAt: true, updatedAt: true });

export type ScoutcoinTokenConfig = typeof scoutcoinTokenConfigs.$inferSelect;
export type ScoutcoinWalletRegistry = typeof scoutcoinWalletRegistry.$inferSelect;
export type ScoutcoinComplianceConfig = typeof scoutcoinComplianceConfig.$inferSelect;
export type ScoutcoinTxLedger = typeof scoutcoinTxLedger.$inferSelect;
