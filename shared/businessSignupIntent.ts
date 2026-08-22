export type SignupBusinessType =
  | "restaurant"
  | "bar"
  | "food_truck"
  | "caterer"
  | "private_chef";

export type BusinessSignupIntent = "create" | "claim";

export type BusinessAuthProvisioningUserType =
  | "customer"
  | "restaurant_owner"
  | "food_truck"
  | "bar_owner"
  | "caterer"
  | "private_chef"
  | string;

export type BusinessSignupRouteIntent = {
  businessType: SignupBusinessType;
  hasExplicitBusinessType: boolean;
  intent: BusinessSignupIntent;
  isClaim: boolean;
  source: string | null;
  passthrough: Record<string, string>;
};

const BUSINESS_TYPES = new Set<SignupBusinessType>([
  "restaurant",
  "bar",
  "food_truck",
  "caterer",
  "private_chef",
]);

const PASSTHROUGH_LIMITS: Record<string, number> = {
  q: 240,
  claimListingId: 80,
  claimMode: 32,
  prefillName: 160,
  prefillAddress: 300,
  prefillCity: 120,
  prefillState: 80,
  prefillPlaceId: 240,
  prefillLat: 32,
  prefillLng: 32,
  ref: 64,
};

const toParams = (input: string | URLSearchParams) =>
  input instanceof URLSearchParams
    ? input
    : new URLSearchParams(String(input || "").replace(/^\?/, ""));

export function normalizeBusinessSignupSource(value: unknown): string | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized.length > 64) return null;
  return /^[a-z0-9][a-z0-9_-]*$/.test(normalized) ? normalized : null;
}

function normalizeBusinessType(value: unknown): SignupBusinessType {
  const normalized = String(value || "")
    .trim()
    .toLowerCase() as SignupBusinessType;
  return BUSINESS_TYPES.has(normalized) ? normalized : "restaurant";
}

function readPassthrough(params: URLSearchParams) {
  const values: Record<string, string> = {};
  for (const [key, maxLength] of Object.entries(PASSTHROUGH_LIMITS)) {
    const value = String(params.get(key) || "").trim();
    if (value) values[key] = value.slice(0, maxLength);
  }
  return values;
}

export function parseBusinessSignupRouteIntent(
  input: string | URLSearchParams,
): BusinessSignupRouteIntent {
  const params = toParams(input);
  const hasExplicitBusinessType = BUSINESS_TYPES.has(
    String(params.get("businessType") || "")
      .trim()
      .toLowerCase() as SignupBusinessType,
  );
  const businessType = normalizeBusinessType(params.get("businessType"));
  const requestedClaim =
    params.get("claim") === "1" ||
    String(params.get("intent") || "").toLowerCase() === "claim";
  const isClaim = businessType === "food_truck" && requestedClaim;

  return {
    businessType,
    hasExplicitBusinessType,
    intent: isClaim ? "claim" : "create",
    isClaim,
    source: normalizeBusinessSignupSource(params.get("source")),
    passthrough: readPassthrough(params),
  };
}

export function buildRestaurantSignupPath(input: {
  businessType?: SignupBusinessType;
  intent?: BusinessSignupIntent;
  source?: string | null;
  passthrough?: Record<string, string | null | undefined>;
}): string {
  const businessType = normalizeBusinessType(input.businessType);
  const intent =
    businessType === "food_truck" && input.intent === "claim"
      ? "claim"
      : "create";
  const params = new URLSearchParams({ businessType, intent });
  const source = normalizeBusinessSignupSource(input.source);
  if (source) params.set("source", source);
  if (intent === "claim") params.set("claim", "1");

  for (const [key, maxLength] of Object.entries(PASSTHROUGH_LIMITS)) {
    const value = String(input.passthrough?.[key] || "").trim();
    if (value) params.set(key, value.slice(0, maxLength));
  }

  return `/restaurant-signup?${params.toString()}`;
}

export function buildRestaurantSignupContinuationPath(
  intent: BusinessSignupRouteIntent,
  sourceOverride?: string,
) {
  return buildRestaurantSignupPath({
    businessType: intent.businessType,
    intent: intent.intent,
    source: sourceOverride || intent.source,
    passthrough: intent.passthrough,
  });
}

export function buildFoodTruckClaimContinuationPath(input: {
  listingId: unknown;
  q?: unknown;
  source?: unknown;
}): string | null {
  const listingId = String(input.listingId || "").trim().slice(0, 80);
  if (!listingId) return null;
  return buildRestaurantSignupPath({
    businessType: "food_truck",
    intent: "claim",
    source: normalizeBusinessSignupSource(input.source) || "claim-business",
    passthrough: {
      claimListingId: listingId,
      q: String(input.q || "").trim().slice(0, PASSTHROUGH_LIMITS.q),
    },
  });
}

export function resolveBusinessAuthProvisioningUserType(input: {
  requestedUserType: BusinessAuthProvisioningUserType;
  existingUserType?: BusinessAuthProvisioningUserType | null;
}): BusinessAuthProvisioningUserType {
  const existing = String(input.existingUserType || "").trim();
  if (existing) return existing;
  const requested = String(input.requestedUserType || "").trim();
  if (requested === "food_truck") return "customer";
  if (requested === "customer") return "restaurant_owner";
  return requested || "restaurant_owner";
}

export function shouldRestoreBusinessSignupDraft(
  intent: Pick<
    BusinessSignupRouteIntent,
    "businessType" | "hasExplicitBusinessType" | "isClaim"
  >,
  draftBusinessType: unknown,
): boolean {
  if (intent.isClaim) return false;
  if (!intent.hasExplicitBusinessType) return true;
  return normalizeBusinessType(draftBusinessType) === intent.businessType;
}
