type BusinessListingLike = {
  name?: string | null;
  address?: string | null;
  cuisineType?: string | null;
  businessType?: string | null;
  isFoodTruck?: boolean | null;
  description?: string | null;
  imageUrl?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  facebookCoverUrl?: string | null;
  googlePhotos?: unknown;
  facebookPhotos?: unknown;
  city?: string | null;
  state?: string | null;
  profileSource?: string | null;
  googleBusinessStatus?: string | null;
  ownerEmail?: string | null;
};

const HARD_TEST_TOKEN_PATTERN =
  /\b(test|testing|dummy|fake|placeholder|asdf|qwer|lorem|ipsum)\b/i;
const SOFT_TEST_TOKEN_PATTERN = /\b(sample|temp|demo)\b/i;
const PLACEHOLDER_NAME_PATTERN =
  /\b(restaurant|food\s*truck|truck|business|vendor)\s*#?\s*\d{1,4}\b/i;
const NON_PUBLIC_PROFILE_SOURCES = new Set([
  "search_query_seed",
  "demo_seed",
  "sample_seed",
  "development_seed",
  "fixture",
  "test_fixture",
  "admin_quarantine",
]);
const NON_PUBLIC_OWNER_EMAIL_PATTERN =
  /(?:^owner\d+@example\.com$|@example\.(?:com|net|org)$|@example\.test$|@test\.com$)/i;

const normalize = (value: unknown): string => String(value ?? "").trim();

const isMobileBusiness = (listing: BusinessListingLike): boolean => {
  const businessType = normalize(listing.businessType).toLowerCase();
  return (
    listing.isFoodTruck === true ||
    ["food_truck", "caterer", "private_chef"].includes(businessType)
  );
};

const looksLikeRealMarket = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3) return false;
  if (
    ["local", "nearby", "mobile", "various", "unknown", "none"].includes(
      normalized,
    )
  ) {
    return false;
  }
  return /[a-z]/i.test(normalized);
};

const hasLocationContext = (listing: BusinessListingLike): boolean => {
  const address = normalize(listing.address);
  const city = normalize(listing.city);
  const state = normalize(listing.state);
  if (address.length >= 5) return true;
  if (
    isMobileBusiness(listing) &&
    (looksLikeRealMarket(city) || looksLikeRealMarket(state))
  ) {
    return true;
  }
  return city.length >= 2 && state.length >= 2;
};

const hasCategoryContext = (listing: BusinessListingLike): boolean => {
  const cuisineType = normalize(listing.cuisineType);
  const businessType = normalize(listing.businessType);
  return cuisineType.length >= 2 || businessType.length >= 2;
};

const parsePhotoCollection = (value: unknown): any[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const hasPhotoCollection = (value: unknown): boolean =>
  parsePhotoCollection(value).some((photo) => {
    if (typeof photo === "string") return normalize(photo).length >= 8;
    return (
      normalize(photo?.url).length >= 8 ||
      normalize(photo?.imageUrl).length >= 8 ||
      normalize(photo?.photoUrl).length >= 8 ||
      normalize(photo?.src).length >= 8 ||
      normalize(photo?.name).length >= 8 ||
      normalize(photo?.photoName).length >= 8 ||
      normalize(photo?.photoReference).length >= 8
    );
  });

const hasDescriptionOrPhoto = (listing: BusinessListingLike): boolean => {
  const description = normalize(listing.description);
  const imageUrl = normalize(listing.imageUrl);
  const logoUrl = normalize(listing.logoUrl);
  const coverImageUrl = normalize(listing.coverImageUrl);
  const facebookCoverUrl = normalize(listing.facebookCoverUrl);
  return (
    description.length >= 20 ||
    imageUrl.length >= 8 ||
    logoUrl.length >= 8 ||
    coverImageUrl.length >= 8 ||
    facebookCoverUrl.length >= 8 ||
    hasPhotoCollection(listing.googlePhotos) ||
    hasPhotoCollection(listing.facebookPhotos)
  );
};

export function getPublicBusinessVisibilityChecks(listing: BusinessListingLike): {
  blockers: string[];
  warnings: string[];
} {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const name = normalize(listing.name);
  const likelyTestData = isLikelyTestBusiness(listing);
  const profileSource = normalize(listing.profileSource).toLowerCase();
  const ownerEmail = normalize(listing.ownerEmail).toLowerCase();
  const googleBusinessStatus = normalize(
    listing.googleBusinessStatus,
  ).toUpperCase();

  if (!name || name.length < 2) blockers.push("missing_name");
  if (!hasLocationContext(listing)) blockers.push("missing_location");
  if (!hasCategoryContext(listing)) blockers.push("missing_category");
  if (likelyTestData) blockers.push("flagged_test_data");
  if (NON_PUBLIC_PROFILE_SOURCES.has(profileSource)) {
    blockers.push("non_public_profile_source");
  }
  if (ownerEmail && NON_PUBLIC_OWNER_EMAIL_PATTERN.test(ownerEmail)) {
    blockers.push("non_public_owner_email");
  }
  if (googleBusinessStatus === "CLOSED_PERMANENTLY") {
    blockers.push("closed_permanently");
  }

  if (!hasDescriptionOrPhoto(listing)) {
    warnings.push("missing_description_or_photo");
  }

  return { blockers, warnings };
}

export function isLikelyTestBusiness(listing: BusinessListingLike): boolean {
  try {
    const name = normalize(listing.name);
    const address = normalize(listing.address);
    const cuisineType = normalize(listing.cuisineType);
    const description = normalize(listing.description);
    const city = normalize(listing.city);
    const state = normalize(listing.state);

    const fields = [name, address, cuisineType, description, city, state].filter(
      Boolean,
    );
    if (fields.length === 0) {
      return false;
    }

    const processEnv = (globalThis as any)?.process?.env || {};
    const customTokens = String(processEnv.PUBLIC_TEST_BUSINESS_TOKENS || "")
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
    if (customTokens.length > 0) {
      const haystack = fields.join(" ").toLowerCase();
      if (customTokens.some((token) => haystack.includes(token))) {
        return true;
      }
    }

    if (fields.some((field) => HARD_TEST_TOKEN_PATTERN.test(field))) {
      return true;
    }
    if (PLACEHOLDER_NAME_PATTERN.test(name)) {
      return true;
    }

    // "demo/sample/temp" are weaker signals, so only treat them as test data
    // when they appear in high-signal user-facing fields.
    if (
      SOFT_TEST_TOKEN_PATTERN.test(name) ||
      SOFT_TEST_TOKEN_PATTERN.test(address)
    ) {
      return true;
    }

    return false;
  } catch {
    // Never let visibility filtering crash public endpoints.
    return false;
  }
}

export function isPublicBusinessVisible(listing: BusinessListingLike): boolean {
  const checks = getPublicBusinessVisibilityChecks(listing);
  return checks.blockers.length === 0;
}
