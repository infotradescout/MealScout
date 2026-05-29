import type { Express } from "express";
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { logAudit } from "../auditLogger";
import {
  scoutcoinComplianceConfig,
  scoutcoinTokenConfigs,
  scoutcoinTxLedger,
  scoutcoinWalletRegistry,
} from "@shared/schema";
import {
  evaluateScoutcoinPolicy,
  type ScoutcoinTxType,
} from "../services/scoutcoinPolicy";

const txSchema = z.object({
  txType: z.enum(["buy", "send", "receive", "redeem", "refund"]),
  amountAtomic: z.string().regex(/^\d+$/),
  toWalletAddress: z.string().optional(),
  toUserId: z.string().optional(),
  perkSurface: z.enum(["mealscout", "tradescout"]).optional(),
  reason: z.string().max(280).optional(),
  jurisdictionCode: z.string().max(32).optional(),
});

const tokenConfigPatchSchema = z.object({
  chain: z.string().min(1).optional(),
  contractAddress: z.string().optional(),
  symbol: z.string().min(1).optional(),
  decimals: z.number().int().min(0).max(36).optional(),
  status: z.enum(["disabled", "testnet", "mainnet"]).optional(),
  priceModuleEnabled: z.boolean().optional(),
  priceProvider: z.string().optional(),
  providerConfigured: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

const compliancePatchSchema = z.object({
  kycRequiredForBuySend: z.boolean().optional(),
  blockedJurisdictions: z.array(z.string()).optional(),
  maxTxAmountAtomic: z.string().regex(/^\d+$/).optional(),
  dailyTxAmountAtomic: z.string().regex(/^\d+$/).optional(),
  metadata: z.record(z.any()).optional(),
});

async function getOrCreateTokenConfig(userId?: string) {
  const [existing] = await db
    .select()
    .from(scoutcoinTokenConfigs)
    .orderBy(desc(scoutcoinTokenConfigs.updatedAt))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(scoutcoinTokenConfigs)
    .values({
      chain: "base-sepolia",
      contractAddress: null,
      symbol: "SCOUT",
      decimals: 18,
      status: "disabled",
      priceModuleEnabled: false,
      providerConfigured: false,
      updatedByUserId: userId || null,
      metadata: {},
    })
    .returning();
  return created!;
}

async function getOrCreateComplianceConfig(userId?: string) {
  const [existing] = await db
    .select()
    .from(scoutcoinComplianceConfig)
    .orderBy(desc(scoutcoinComplianceConfig.updatedAt))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(scoutcoinComplianceConfig)
    .values({
      kycRequiredForBuySend: true,
      blockedJurisdictions: [],
      maxTxAmountAtomic: "0",
      dailyTxAmountAtomic: "0",
      metadata: {},
      updatedByUserId: userId || null,
    })
    .returning();
  return created!;
}

async function getOrCreateWallet(userId: string) {
  const [existing] = await db
    .select()
    .from(scoutcoinWalletRegistry)
    .where(eq(scoutcoinWalletRegistry.userId, userId))
    .limit(1);
  if (existing) return existing;
  const walletAddress = `custodial:${userId}`;
  const [created] = await db
    .insert(scoutcoinWalletRegistry)
    .values({
      userId,
      walletAddress,
      kycStatus: "not_started",
      isFrozen: false,
      metadata: {},
    })
    .returning();
  return created!;
}

async function getDailyUsedAtomic(userId: string): Promise<bigint> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ amountAtomic: scoutcoinTxLedger.amountAtomic })
    .from(scoutcoinTxLedger)
    .where(
      and(
        or(
          eq(scoutcoinTxLedger.fromUserId, userId),
          eq(scoutcoinTxLedger.toUserId, userId),
        ),
        gte(scoutcoinTxLedger.createdAt, dayStart),
        eq(scoutcoinTxLedger.status, "confirmed"),
      ),
    );
  return rows.reduce(
    (sum: bigint, row: { amountAtomic: string | null }) =>
      sum + BigInt(row.amountAtomic || "0"),
    0n,
  );
}

export function registerScoutcoinRoutes(app: Express) {
  app.get("/api/scoutcoin/config", async (_req, res) => {
    const tokenConfig = await getOrCreateTokenConfig();
    const complianceConfig = await getOrCreateComplianceConfig();
    res.json({
      token: {
        chain: tokenConfig.chain,
        contractAddress: tokenConfig.contractAddress,
        symbol: tokenConfig.symbol,
        decimals: tokenConfig.decimals,
        status: tokenConfig.status,
      },
      priceModule: {
        enabled: Boolean(tokenConfig.priceModuleEnabled),
        providerConfigured: Boolean(tokenConfig.providerConfigured),
        provider: tokenConfig.priceProvider || null,
        mode:
          tokenConfig.status === "mainnet"
            ? "mainnet_provider_required"
            : "mock_testnet_only",
      },
      compliance: {
        kycRequiredForBuySend: Boolean(complianceConfig.kycRequiredForBuySend),
        blockedJurisdictions: Array.isArray(complianceConfig.blockedJurisdictions)
          ? complianceConfig.blockedJurisdictions
          : [],
        maxTxAmountAtomic: complianceConfig.maxTxAmountAtomic,
        dailyTxAmountAtomic: complianceConfig.dailyTxAmountAtomic,
      },
    });
  });

  app.get("/api/scoutcoin/wallet", isAuthenticated, async (req: any, res) => {
    const userId = String(req.user.id);
    const wallet = await getOrCreateWallet(userId);
    const [balanceRow] = await db
      .select({
        balanceAtomic:
          sql<string>`coalesce(sum(case when ${scoutcoinTxLedger.toUserId} = ${userId} then (${scoutcoinTxLedger.amountAtomic})::numeric else 0 end) - sum(case when ${scoutcoinTxLedger.fromUserId} = ${userId} then (${scoutcoinTxLedger.amountAtomic})::numeric else 0 end), 0)::text`,
      })
      .from(scoutcoinTxLedger)
      .where(eq(scoutcoinTxLedger.status, "confirmed"));

    res.json({
      wallet,
      balanceAtomic: balanceRow?.balanceAtomic || "0",
    });
  });

  app.get(
    "/api/scoutcoin/transactions",
    isAuthenticated,
    async (req: any, res) => {
      const userId = String(req.user.id);
      const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
      const rows = await db
        .select()
        .from(scoutcoinTxLedger)
        .where(
          or(
            eq(scoutcoinTxLedger.fromUserId, userId),
            eq(scoutcoinTxLedger.toUserId, userId),
            eq(scoutcoinTxLedger.createdByUserId, userId),
          ),
        )
        .orderBy(desc(scoutcoinTxLedger.createdAt))
        .limit(limit);
      res.json(rows);
    },
  );

  app.post(
    "/api/scoutcoin/transactions",
    isAuthenticated,
    async (req: any, res) => {
      const userId = String(req.user.id);
      const parsed = txSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid transaction payload." });
      }
      const payload = parsed.data;
      const wallet = await getOrCreateWallet(userId);
      const tokenConfig = await getOrCreateTokenConfig();
      const complianceConfig = await getOrCreateComplianceConfig();
      const dailyUsedAtomic = await getDailyUsedAtomic(userId);
      const amountAtomic = BigInt(payload.amountAtomic);
      const policy = evaluateScoutcoinPolicy({
        txType: payload.txType as ScoutcoinTxType,
        tokenStatus: tokenConfig.status as "disabled" | "testnet" | "mainnet",
        kycStatus: wallet.kycStatus,
        walletFrozen: Boolean(wallet.isFrozen),
        amountAtomic,
        maxTxAmountAtomic: BigInt(complianceConfig.maxTxAmountAtomic || "0"),
        dailyTxAmountAtomic: BigInt(complianceConfig.dailyTxAmountAtomic || "0"),
        dailyUsedAtomic,
        jurisdictionCode: payload.jurisdictionCode || wallet.jurisdictionCode,
        blockedJurisdictions: Array.isArray(complianceConfig.blockedJurisdictions)
          ? complianceConfig.blockedJurisdictions.map((v: unknown) => String(v))
          : [],
        kycRequiredForBuySend: Boolean(complianceConfig.kycRequiredForBuySend),
      });

      if (!policy.allowed) {
        await db.insert(scoutcoinTxLedger).values({
          txType: payload.txType,
          status: "blocked",
          fromUserId: userId,
          fromWalletAddress: wallet.walletAddress,
          toWalletAddress: payload.toWalletAddress || null,
          amountAtomic: payload.amountAtomic,
          reason: policy.reason,
          perkSurface: payload.perkSurface || null,
          metadata: { policyCode: policy.code },
          createdByUserId: userId,
        });
        await logAudit(
          userId,
          "scoutcoin_transaction_blocked",
          "scoutcoin_tx",
          payload.txType,
          req.ip,
          req.get("User-Agent"),
          { code: policy.code, reason: policy.reason },
        );
        return res.status(403).json({
          message: policy.reason,
          code: policy.code,
        });
      }
      if (
        payload.txType === "buy" &&
        (!tokenConfig.providerConfigured || !tokenConfig.priceProvider)
      ) {
        await logAudit(
          userId,
          "scoutcoin_transaction_blocked",
          "scoutcoin_tx",
          "buy",
          req.ip,
          req.get("User-Agent"),
          { code: "price_provider_not_configured" },
        );
        return res.status(403).json({
          code: "price_provider_not_configured",
          message:
            "Buying is disabled until a supported provider is configured.",
        });
      }

      const [tx] = await db
        .insert(scoutcoinTxLedger)
        .values({
          txType: payload.txType,
          status: "confirmed",
          fromUserId:
            payload.txType === "receive" ? null : (userId as string | null),
          toUserId:
            payload.toUserId ||
            (payload.txType === "buy" ? userId : null) ||
            null,
          fromWalletAddress:
            payload.txType === "receive" ? null : wallet.walletAddress,
          toWalletAddress: payload.toWalletAddress || wallet.walletAddress,
          amountAtomic: payload.amountAtomic,
          perkSurface: payload.perkSurface || null,
          reason: payload.reason || null,
          metadata: {
            jurisdictionCode: payload.jurisdictionCode || wallet.jurisdictionCode,
          },
          createdByUserId: userId,
        })
        .returning();

      await logAudit(
        userId,
        "scoutcoin_transaction_recorded",
        "scoutcoin_tx",
        tx.id,
        req.ip,
        req.get("User-Agent"),
        { txType: payload.txType, amountAtomic: payload.amountAtomic },
      );
      res.json(tx);
    },
  );

  app.post(
    "/api/admin/scoutcoin/config/token",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      const parsed = tokenConfigPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid token config payload." });
      }
      const existing = await getOrCreateTokenConfig(String(req.user.id));
      const nextStatus = parsed.data.status ?? existing.status;
      const nextProviderConfigured =
        parsed.data.providerConfigured ?? existing.providerConfigured;
      const nextProvider = parsed.data.priceProvider ?? existing.priceProvider;
      if (
        nextStatus === "mainnet" &&
        (!nextProviderConfigured || !String(nextProvider || "").trim())
      ) {
        return res.status(400).json({
          message:
            "Mainnet status requires a configured mainnet price provider (DEX/oracle/onramp).",
        });
      }
      const [updated] = await db
        .update(scoutcoinTokenConfigs)
        .set({
          ...parsed.data,
          updatedByUserId: String(req.user.id),
          updatedAt: new Date(),
        })
        .where(eq(scoutcoinTokenConfigs.id, existing.id))
        .returning();
      await logAudit(
        String(req.user.id),
        "scoutcoin_token_config_updated",
        "scoutcoin_token_config",
        updated.id,
        req.ip,
        req.get("User-Agent"),
        parsed.data,
      );
      res.json(updated);
    },
  );

  app.post(
    "/api/admin/scoutcoin/config/compliance",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      const parsed = compliancePatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: "Invalid compliance config payload." });
      }
      const existing = await getOrCreateComplianceConfig(String(req.user.id));
      const [updated] = await db
        .update(scoutcoinComplianceConfig)
        .set({
          ...parsed.data,
          updatedByUserId: String(req.user.id),
          updatedAt: new Date(),
        })
        .where(eq(scoutcoinComplianceConfig.id, existing.id))
        .returning();
      await logAudit(
        String(req.user.id),
        "scoutcoin_compliance_config_updated",
        "scoutcoin_compliance_config",
        updated.id,
        req.ip,
        req.get("User-Agent"),
        parsed.data,
      );
      res.json(updated);
    },
  );

  app.post(
    "/api/admin/scoutcoin/wallets/:userId/freeze",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      const targetUserId = String(req.params.userId);
      const wallet = await getOrCreateWallet(targetUserId);
      const freeze = Boolean(req.body?.freeze);
      const reason = String(req.body?.reason || "").trim() || null;
      const [updated] = await db
        .update(scoutcoinWalletRegistry)
        .set({
          isFrozen: freeze,
          freezeReason: freeze ? reason || "Admin freeze" : null,
          updatedAt: new Date(),
        })
        .where(eq(scoutcoinWalletRegistry.id, wallet.id))
        .returning();

      await db.insert(scoutcoinTxLedger).values({
        txType: "admin_freeze",
        status: "confirmed",
        fromUserId: String(req.user.id),
        toUserId: targetUserId,
        amountAtomic: "0",
        reason: freeze ? reason || "Admin freeze" : "Admin unfreeze",
        metadata: { freeze },
        createdByUserId: String(req.user.id),
      });
      await logAudit(
        String(req.user.id),
        freeze ? "scoutcoin_wallet_frozen" : "scoutcoin_wallet_unfrozen",
        "scoutcoin_wallet",
        targetUserId,
        req.ip,
        req.get("User-Agent"),
        { reason },
      );
      res.json(updated);
    },
  );

  app.post(
    "/api/admin/scoutcoin/wallets/:userId/kyc",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      const targetUserId = String(req.params.userId);
      const nextStatus = String(req.body?.kycStatus || "");
      if (!["not_started", "pending", "verified", "rejected"].includes(nextStatus)) {
        return res.status(400).json({ message: "Invalid KYC status." });
      }
      const wallet = await getOrCreateWallet(targetUserId);
      const [updated] = await db
        .update(scoutcoinWalletRegistry)
        .set({
          kycStatus: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(scoutcoinWalletRegistry.id, wallet.id))
        .returning();
      await logAudit(
        String(req.user.id),
        "scoutcoin_kyc_status_updated",
        "scoutcoin_wallet",
        targetUserId,
        req.ip,
        req.get("User-Agent"),
        { kycStatus: nextStatus },
      );
      res.json(updated);
    },
  );
}
