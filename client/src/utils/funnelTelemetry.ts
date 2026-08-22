import { trackUxEvent } from "@/utils/uxTelemetry";

export const FUNNEL_EVENTS = {
  landingView: "funnel_landing_view",
  primaryCtaClick: "funnel_primary_cta_click",
  signupStarted: "funnel_signup_started",
  signupSubmitted: "funnel_signup_submitted",
  signupCompleted: "funnel_signup_completed",
  activationStarted: "funnel_activation_started",
} as const;

type FunnelEventName = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS];

const hasWindow = () => typeof window !== "undefined";

export const toSafeFunnelDestinationPath = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const baseUrl = hasWindow()
      ? window.location.origin
      : "https://www.mealscout.us";
    return new URL(raw, baseUrl).pathname || null;
  } catch {
    return null;
  }
};

const getSafeReferrer = () => {
  if (typeof document === "undefined" || !document.referrer) return null;
  try {
    const referrer = new URL(document.referrer);
    return `${referrer.origin}${referrer.pathname}`;
  } catch {
    return null;
  }
};

const getAttribution = () => {
  if (!hasWindow()) return {};

  const params = new URLSearchParams(window.location.search);
  const get = (key: string) => (params.get(key) || "").trim();

  return {
    path: window.location.pathname,
    // Referrer query strings can contain claim searches or prefill details.
    // Keep the source page while excluding those values from telemetry.
    referrer: getSafeReferrer(),
    utmSource: get("utm_source") || null,
    utmMedium: get("utm_medium") || null,
    utmCampaign: get("utm_campaign") || null,
    utmContent: get("utm_content") || null,
    utmTerm: get("utm_term") || null,
  };
};

const sessionOnce = (key: string): boolean => {
  if (!hasWindow()) return true;
  try {
    const storageKey = `funnel:${key}`;
    if (window.sessionStorage.getItem(storageKey)) return false;
    window.sessionStorage.setItem(storageKey, "1");
    return true;
  } catch {
    return true;
  }
};

export const trackFunnelEvent = (
  eventName: FunnelEventName,
  properties?: Record<string, unknown>,
) => {
  trackUxEvent(eventName, {
    ...getAttribution(),
    ...(properties || {}),
  });
};

export const trackFunnelEventOncePerSession = (
  eventName: FunnelEventName,
  key: string,
  properties?: Record<string, unknown>,
) => {
  if (!sessionOnce(`${eventName}:${key}`)) return;
  trackFunnelEvent(eventName, properties);
};
