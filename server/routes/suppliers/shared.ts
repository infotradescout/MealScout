import type { RequestHandler } from "express";
import type Stripe from "stripe";

export type SupplierRouteMiddleware = RequestHandler;

export type EnsureSupplierProfile = (userId: string) => Promise<any>;

export type ParsePageLimit = (
  raw: unknown,
  fallback: number,
  max: number,
) => number;

export type ParseBeforeTimestamp = (raw: unknown) => Date | null;

export type ResolveBuyerRestaurantOrThrow = (
  req: any,
  buyerRestaurantId: string,
) => Promise<any>;

export type ComputeOnPlatformPaymentFees = (supplierGrossCents: number) => {
  platformBaseFeeCents: number;
  platformFeeCents: number;
  stripeFeeEstimateCents: number;
  msProcessingFeeCents: number;
  processingTotalCents: number;
  buyerProcessingFeeCents: number;
  sellerProcessingFeeCents: number;
  totalCents: number;
};

export type ComputeAchCheaperThresholdCents = () => number;

export type SupplierOrdersRouteDeps = {
  isSupplierProfileOrAdmin: SupplierRouteMiddleware;
  ensureSupplierProfile: EnsureSupplierProfile;
  parsePageLimit: ParsePageLimit;
  parseBeforeTimestamp: ParseBeforeTimestamp;
  resolveBuyerRestaurantOrThrow: ResolveBuyerRestaurantOrThrow;
  computeOnPlatformPaymentFees: ComputeOnPlatformPaymentFees;
  stripe: Stripe | null;
};

export type SupplierPaymentsRouteDeps = {
  computeOnPlatformPaymentFees: ComputeOnPlatformPaymentFees;
  computeAchCheaperThresholdCents: ComputeAchCheaperThresholdCents;
  stripe: Stripe | null;
};
