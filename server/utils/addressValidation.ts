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

const getGoogleMapsApiKey = () =>
  String(
    process.env.GOOGLE_MAPS_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_WEB_API_KEY ||
      "",
  ).trim();

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

  if (missing.length > 0) {
    return {
      ok: false,
      reason: "missing_components",
      message: "Address is missing required components.",
      missingComponentTypes: missing,
      suggested,
    };
  }

  if (hasUnconfirmed || hasInferred) {
    return {
      ok: false,
      reason: "unconfirmed",
      message: "Address could not be fully confirmed.",
      missingComponentTypes: [],
      suggested,
    };
  }

  return {
    ok: true,
    reason: "unconfirmed",
    message: "Address validated.",
    missingComponentTypes: [],
    suggested,
  };
}
