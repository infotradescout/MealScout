import { getCached, setCached } from "./googleApiCache";
import { getGoogleMapsServerApiKey } from "../services/googleMapsCredentials";

// Cache address validation results for 30 days — addresses rarely change and
// validation is expensive ($0.005/call on the Address Validation API).
const ADDRESS_VALIDATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const normalizeAddressKey = (input: AddressValidationInput): string =>
  [
    String(input.address || "").trim().toLowerCase(),
    String(input.city || "").trim().toLowerCase(),
    String(input.state || "").trim().toLowerCase(),
  ]
    .filter(Boolean)
    .join("|");

type AddressValidationInput = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
};

export type AddressValidationResult = {
  ok: boolean;
  reason: "missing_components" | "unconfirmed";
  message: string;
  missingComponentTypes: string[];
  suggested: {
    formattedAddress: string;
    address: string;
    city: string;
    state: string;
  };
};

const getGoogleMapsApiKey = getGoogleMapsServerApiKey;

const pickAddressPart = (
  parts: Array<{
    confirmationLevel?: string;
    componentType?: string;
    componentName?: { text?: string };
  }> | undefined,
  componentType: string,
) => {
  if (!Array.isArray(parts)) return "";
  const match = parts.find((part) => part.componentType === componentType);
  return String(match?.componentName?.text || "").trim();
};

const parseUsAddress = (
  data: any,
  fallback: { address: string; city: string; state: string },
) => {
  const validated = data?.result?.address;
  const formattedAddress = String(validated?.formattedAddress || "").trim();
  const addressLines = Array.isArray(validated?.postalAddress?.addressLines)
    ? validated.postalAddress.addressLines
    : [];
  const lineFromAddress = String(addressLines[0] || "").trim();
  const cityFromAddress = String(validated?.postalAddress?.locality || "").trim();
  const stateFromAddress = String(
    validated?.postalAddress?.administrativeArea || "",
  ).trim();

  const components = Array.isArray(data?.result?.addressComponents)
    ? data.result.addressComponents
    : [];

  const cityFromComponents =
    pickAddressPart(components, "locality") ||
    pickAddressPart(components, "postal_town") ||
    pickAddressPart(components, "administrative_area_level_2");
  const stateFromComponents =
    pickAddressPart(components, "administrative_area_level_1") || "";

  return {
    formattedAddress,
    address: lineFromAddress || fallback.address,
    city: cityFromAddress || cityFromComponents || fallback.city,
    state: stateFromAddress || stateFromComponents || fallback.state,
  };
};

export async function validateUsAddress(
  input: AddressValidationInput,
): Promise<AddressValidationResult | null> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) return null;

  const address = String(input.address || "").trim();
  const city = String(input.city || "").trim();
  const state = String(input.state || "").trim();
  if (!address) return null;

  // ── Cache check (L1+L2 via googleApiCache) ──────────────────────────────────
  const cacheKey = normalizeAddressKey(input);
  const cached = await getCached<AddressValidationResult>("address_validation", cacheKey);
  if (cached) return cached;

  const payload = {
    address: {
      regionCode: "US",
      addressLines: [address, city, state].filter(Boolean),
    },
    enableUspsCass: true,
  };

  const response = await fetch(
    `https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json().catch(() => ({}))) as any;
  const verdict = data?.result?.verdict || {};
  const missing = Array.isArray(verdict?.missingComponentTypes)
    ? verdict.missingComponentTypes
        .map((item: unknown) => String(item || "").trim())
        .filter(Boolean)
    : [];

  const hasUnconfirmed = Boolean(verdict?.hasUnconfirmedComponents);
  const hasInferred = Boolean(verdict?.hasInferredComponents);

  const suggested = parseUsAddress(data, { address, city, state });

  let result: AddressValidationResult;
  if (missing.length > 0) {
    result = {
      ok: false,
      reason: "missing_components",
      message: "Address is missing required components.",
      missingComponentTypes: missing,
      suggested,
    };
  } else if (hasUnconfirmed || hasInferred) {
    result = {
      ok: false,
      reason: "unconfirmed",
      message: "Address could not be fully confirmed.",
      missingComponentTypes: [],
      suggested,
    };
  } else {
    result = {
      ok: true,
      reason: "unconfirmed",
      message: "Address validated.",
      missingComponentTypes: [],
      suggested,
    };
  }

  // Persist for 30 days — re-validating the same address repeatedly wastes quota
  setCached("address_validation", cacheKey, result, ADDRESS_VALIDATION_TTL_MS);

  return result;
}
