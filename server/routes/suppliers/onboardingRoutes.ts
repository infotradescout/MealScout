import type { Express } from "express";
import { z } from "zod";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { isAuthenticated } from "../../unifiedAuth";
import { db } from "../../db";
import { suppliers } from "@shared/schema";
import type {
  EnsureSupplierProfile,
  SupplierRouteMiddleware,
} from "./shared";

type SupplierOnboardingRouteDeps = {
  isSupplierProfileOrAdmin: SupplierRouteMiddleware;
  ensureSupplierProfile: EnsureSupplierProfile;
  stripe: Stripe | null;
};

export function registerSupplierOnboardingRoutes(
  app: Express,
  deps: SupplierOnboardingRouteDeps,
) {
  const { isSupplierProfileOrAdmin, ensureSupplierProfile, stripe } = deps;

  // Logged-in users can add a supplier profile to their existing account.
  app.post(
    "/api/supplier/profile/activate",
    isAuthenticated,
    async (req: any, res) => {
      try {
        if (req.user?.isDisabled) {
          return res.status(403).json({ message: "Account disabled" });
        }

        const schema = z.object({
          businessName: z.string().trim().min(1).max(120).optional(),
        });
        const parsed = schema.parse(req.body || {});

        let supplier = await ensureSupplierProfile(String(req.user.id));
        const businessName = String(parsed.businessName || "").trim();
        if (businessName && businessName !== String((supplier as any)?.businessName || "")) {
          const [updated] = await db
            .update(suppliers)
            .set({
              businessName,
              updatedAt: new Date(),
            } as any)
            .where(eq(suppliers.id, String((supplier as any).id)))
            .returning();
          if (updated) supplier = updated as any;
        }

        return res.json({
          success: true,
          supplier,
        });
      } catch (error: any) {
        console.error("Error activating supplier profile:", error);
        if (error instanceof z.ZodError) {
          return res
            .status(400)
            .json({ message: "Invalid supplier activation payload" });
        }
        return res
          .status(500)
          .json({ message: "Failed to activate supplier profile" });
      }
    },
  );

  // Stripe Connect onboarding for suppliers (payout setup).
  app.post(
    "/api/supplier/stripe/onboard",
    isAuthenticated,
    (req, res, next) => isSupplierProfileOrAdmin(req, res, next),
    async (req: any, res) => {
      try {
        if (!stripe) return res.status(500).json({ message: "Stripe not configured" });

        const supplier = await ensureSupplierProfile(req.user.id);
        let accountId = String((supplier as any).stripeConnectAccountId || "").trim() || null;

        if (!accountId) {
          const account = await stripe.accounts.create({
            type: "express",
            country: "US",
            email: req.user.email,
            capabilities: {
              transfers: { requested: true },
            },
            metadata: {
              supplierId: String((supplier as any).id),
              businessName: String((supplier as any).businessName || ""),
            },
          });
          accountId = account.id;

          await db
            .update(suppliers)
            .set({ stripeConnectAccountId: accountId, updatedAt: new Date() } as any)
            .where(eq(suppliers.id, String((supplier as any).id)));
        }

        const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
        const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
        const accountLink = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: `${normalizedBaseUrl}/supplier/dashboard?setup=refresh`,
          return_url: `${normalizedBaseUrl}/supplier/dashboard?setup=complete`,
          type: "account_onboarding",
        });

        res.json({ onboardingUrl: accountLink.url });
      } catch (error: any) {
        console.error("Error creating supplier Stripe Connect onboarding:", error);
        res.status(500).json({ message: "Failed to initiate Stripe onboarding" });
      }
    },
  );

  app.get(
    "/api/supplier/stripe/status",
    isAuthenticated,
    (req, res, next) => isSupplierProfileOrAdmin(req, res, next),
    async (req: any, res) => {
      try {
        if (!stripe) return res.status(500).json({ message: "Stripe not configured" });

        const supplier = await ensureSupplierProfile(req.user.id);
        const accountId = String((supplier as any).stripeConnectAccountId || "").trim();
        if (!accountId) {
          return res.json({
            connected: false,
            chargesEnabled: false,
            payoutsEnabled: false,
            onboardingCompleted: false,
          });
        }

        const account = await stripe.accounts.retrieve(accountId);

        await db
          .update(suppliers)
          .set({
            stripeChargesEnabled: Boolean((account as any).charges_enabled),
            stripePayoutsEnabled: Boolean((account as any).payouts_enabled),
            stripeOnboardingCompleted: Boolean((account as any).details_submitted),
            stripeConnectStatus: (account as any).charges_enabled ? "active" : "pending",
            updatedAt: new Date(),
          } as any)
          .where(eq(suppliers.id, String((supplier as any).id)));

        res.json({
          connected: true,
          chargesEnabled: Boolean((account as any).charges_enabled),
          payoutsEnabled: Boolean((account as any).payouts_enabled),
          onboardingCompleted: Boolean((account as any).details_submitted),
          accountId,
        });
      } catch (error: any) {
        console.error("Error checking supplier Stripe status:", error);
        res.status(500).json({ message: "Failed to check Stripe status" });
      }
    },
  );
}
