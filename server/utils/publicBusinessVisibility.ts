type BusinessListingLike = {
  name?: string | null;
  address?: string | null;
  cuisineType?: string | null;
  description?: string | null;
  city?: string | null;
  state?: string | null;
};

const HARD_TEST_TOKEN_PATTERN =
  /\b(test|testing|dummy|fake|placeholder|asdf|qwer|lorem|ipsum)\b/i;
const SOFT_TEST_TOKEN_PATTERN = /\b(sample|temp|demo)\b/i;
const PLACEHOLDER_NAME_PATTERN =
  /\b(restaurant|food\s*truck|truck|business|vendor)\s*#?\s*\d{1,4}\b/i;

const normalize = (value: unknown): string => String(value ?? "").trim();

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
  // Public membership must not be decided by a hidden street address. Owners
  // may legitimately keep that field private, and address text such as
  // "Sample Road" or "Testing Street" is not evidence that the business
  // identity itself is synthetic. Address evidence remains available to
  // explicit internal hygiene/reporting callers through isLikelyTestBusiness.
  return !isLikelyTestBusiness({
    name: listing.name,
    cuisineType: listing.cuisineType,
    description: listing.description,
    city: listing.city,
    state: listing.state,
  });
}
