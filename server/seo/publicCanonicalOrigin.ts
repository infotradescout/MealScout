export const MEALSCOUT_PUBLIC_CANONICAL_ORIGIN = "https://www.mealscout.us";

export const normalizePublicCanonicalOrigin = (raw: unknown): string => {
  const value = String(raw ?? "").trim();
  if (!value || value.startsWith("//")) {
    return MEALSCOUT_PUBLIC_CANONICAL_ORIGIN;
  }
  if (/^https?(?::|\/)/i.test(value) && !/^https?:\/\//i.test(value)) {
    return MEALSCOUT_PUBLIC_CANONICAL_ORIGIN;
  }

  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      ? value
      : `https://${value}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return MEALSCOUT_PUBLIC_CANONICAL_ORIGIN;
    }

    if (parsed.hostname.toLowerCase().replace(/^www\./, "") === "mealscout.us") {
      return MEALSCOUT_PUBLIC_CANONICAL_ORIGIN;
    }

    return parsed.origin;
  } catch {
    return MEALSCOUT_PUBLIC_CANONICAL_ORIGIN;
  }
};

export const resolvePublicCanonicalOrigin = (input: {
  publicBaseUrl?: unknown;
  serviceUrl?: unknown;
} = {}): string =>
  normalizePublicCanonicalOrigin(input.publicBaseUrl || input.serviceUrl);
