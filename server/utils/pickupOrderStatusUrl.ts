const FALLBACK_PUBLIC_ORIGIN = "https://www.mealscout.us";

function resolvePublicOrigin(configuredBaseUrl?: string | null) {
  const firstConfiguredValue = String(configuredBaseUrl || "")
    .split(",")[0]
    ?.trim();
  try {
    const candidate = new URL(firstConfiguredValue || FALLBACK_PUBLIC_ORIGIN);
    if (candidate.protocol !== "https:" && candidate.protocol !== "http:") {
      return FALLBACK_PUBLIC_ORIGIN;
    }
    return candidate.origin;
  } catch {
    return FALLBACK_PUBLIC_ORIGIN;
  }
}

export function buildPickupOrderStatusUrl(
  orderId: string,
  configuredBaseUrl = process.env.PUBLIC_BASE_URL,
) {
  return `${resolvePublicOrigin(configuredBaseUrl)}/order-confirmation/${encodeURIComponent(orderId)}`;
}
