import { trackUxEvent } from "@/utils/uxTelemetry";

export const FUNNEL_EVENTS = {
  landingView: "funnel_landing_view",
  primaryCtaClick: "funnel_primary_cta_click",
  ownerIntentView: "funnel_owner_intent_view",
  ownerIntentToolUsed: "funnel_owner_intent_tool_used",
  ownerIntentCtaClick: "funnel_owner_intent_cta_click",
  signupStarted: "funnel_signup_started",
  signupSubmitted: "funnel_signup_submitted",
  signupCompleted: "funnel_signup_completed",
  activationStarted: "funnel_activation_started",
} as const;

type FunnelEventName = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS];

const hasWindow = () => typeof window !== "undefined";

const getAttribution = () => {
  if (!hasWindow()) return {};

  const params = new URLSearchParams(window.location.search);
  const get = (key: string) => (params.get(key) || "").trim();

  return {
    path: window.location.pathname,
    referrer:
      typeof document !== "undefined" ? document.referrer || null : null,
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
