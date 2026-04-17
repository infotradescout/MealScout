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

export type ResolveBuyerRestaurantOrNull = (
  req: any,
  buyerRestaurantId: unknown,
) => Promise<any>;

export type ResolveSupplyShoppingListOrThrow = (
  req: any,
  listId: string,
) => Promise<any>;

export type EnsureSupplyOrderPreferences = (userId: string) => Promise<any>;

export type NormalizeSupplyKey = (raw: string) => string;

export type ToDayKey = (value: Date) => string;

export type GetLocalizedPriceOffers = (params: {
  itemKey?: string | null;
  itemName?: string | null;
  buyerRestaurant?: any | null;
  maxRadiusMiles?: number | null;
}) => Promise<any[]>;

export type GetWatchSnapshotTrend = (params: {
  itemKey: string;
  areaKey: string;
  limitDays: number;
}) => Promise<any>;

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

export type SupplierSupplyIntelRouteDeps = {
  ensureSupplyOrderPreferences: EnsureSupplyOrderPreferences;
  resolveBuyerRestaurantOrThrow: ResolveBuyerRestaurantOrThrow;
  normalizeSupplyKey: NormalizeSupplyKey;
  toDayKey: ToDayKey;
  getLocalizedPriceOffers: GetLocalizedPriceOffers;
  getWatchSnapshotTrend: GetWatchSnapshotTrend;
};

export type SupplierShoppingListsRouteDeps = {
  resolveBuyerRestaurantOrThrow: ResolveBuyerRestaurantOrThrow;
  resolveSupplyShoppingListOrThrow: ResolveSupplyShoppingListOrThrow;
};

export type SearchSupplierProductsForTerms = (params: {
  terms: string[];
  buyerRestaurant: any;
  limit: number;
}) => Promise<any[]>;

export type HaversineMiles = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) => number;

export type RecordDemandAndNotifyIfUnlisted = (params: {
  buyerRestaurant?: any;
  itemNameRaw: string;
  quantity?: number | null;
  source: "manual" | "import" | "request";
}) => Promise<any>;

export type SupplierShoppingListOptimizeRouteDeps = {
  resolveBuyerRestaurantOrNull: ResolveBuyerRestaurantOrNull;
  resolveBuyerRestaurantOrThrow: ResolveBuyerRestaurantOrThrow;
  resolveSupplyShoppingListOrThrow: ResolveSupplyShoppingListOrThrow;
  ensureSupplyOrderPreferences: EnsureSupplyOrderPreferences;
  searchSupplierProductsForTerms: SearchSupplierProductsForTerms;
  normalizeSupplyKey: NormalizeSupplyKey;
  haversineMiles: HaversineMiles;
  recordDemandAndNotifyIfUnlisted: RecordDemandAndNotifyIfUnlisted;
};

export type SupplierSearchDemandRouteDeps = {
  resolveBuyerRestaurantOrThrow: ResolveBuyerRestaurantOrThrow;
  resolveBuyerRestaurantOrNull: ResolveBuyerRestaurantOrNull;
  haversineMiles: HaversineMiles;
  recordDemandAndNotifyIfUnlisted: RecordDemandAndNotifyIfUnlisted;
};

export type SupplierRequestsRouteDeps = {
  isSupplierProfileOrAdmin: SupplierRouteMiddleware;
  ensureSupplierProfile: EnsureSupplierProfile;
  resolveBuyerRestaurantOrThrow: ResolveBuyerRestaurantOrThrow;
  resolveBuyerRestaurantOrNull: ResolveBuyerRestaurantOrNull;
  haversineMiles: HaversineMiles;
  normalizeSupplyKey: NormalizeSupplyKey;
  recordDemandAndNotifyIfUnlisted: RecordDemandAndNotifyIfUnlisted;
  computeOnPlatformPaymentFees: ComputeOnPlatformPaymentFees;
};
