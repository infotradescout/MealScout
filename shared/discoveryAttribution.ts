/**
 * Public Discovery Contract v1 §9 — attribution spine helpers.
 *
 * Pure (no DOM / DB). Client and server share first-touch ranking so optional
 * survey answers cannot overwrite stronger recorded sources (utm_source, etc.).
 */

export const DISCOVERY_SPINE_EVENTS = [
  "discovery_landing",
  "discovery_entity_view",
  "discovery_primary_action",
  "discovery_phone_click",
  "discovery_request_started",
  "discovery_request_sent",
  "discovery_connection_accepted",
  "discovery_outcome_recorded",
] as const;

export type DiscoverySpineEvent = (typeof DISCOVERY_SPINE_EVENTS)[number];

export const DISCOVERY_SPINE_EVENT_SET = new Set<string>(DISCOVERY_SPINE_EVENTS);

/** Existing SEO landing page analytics (kept for admin aggregates). */
export const DISCOVERY_PAGE_ANALYTICS_EVENTS = [
  "discovery_page_view",
  "discovery_card_click",
  "discovery_profile_click",
  "discovery_cta_click",
] as const;

export type DiscoveryAttributionChannel =
  | "query_utm"
  | "query_ref"
  | "referrer"
  | "optional_survey"
  | "unknown";

export type DiscoveryAttributionRecord = {
  source: string;
  channel: DiscoveryAttributionChannel;
  strength: number;
  capturedAt: string;
  landingPath: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  ref: string | null;
  referrer: string | null;
  surveyAnswer: string | null;
};

export const DISCOVERY_ATTRIBUTION_STRENGTH: Record<
  DiscoveryAttributionChannel,
  number
> = {
  query_utm: 100,
  query_ref: 90,
  referrer: 50,
  optional_survey: 10,
  unknown: 0,
};

/** MealScout profile analytics actions that count as primary discovery CTAs. */
export const DISCOVERY_PRIMARY_PROFILE_ACTIONS = new Set([
  "menu_click",
  "order_click",
  "truck_booking_click",
  "catering_click",
  "directions_click",
]);

/** Secondary actions — emit only as non-primary profile events, never overwrite. */
export const DISCOVERY_SECONDARY_PROFILE_ACTIONS = new Set([
  "share_click",
  "social_click",
  "website_click",
  "cross_promotion_click",
  "deal_click",
  "event_click",
]);

export function isDiscoverySpineEvent(
  value: unknown,
): value is DiscoverySpineEvent {
  return (
    typeof value === "string" && DISCOVERY_SPINE_EVENT_SET.has(value.trim())
  );
}

export function normalizeDiscoverySource(raw: unknown): string | null {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .slice(0, 120);
  if (!value) return null;
  // Collapse common ChatGPT / OpenAI referral variants.
  if (
    value === "chatgpt.com" ||
    value === "chat.openai.com" ||
    value === "chatgpt" ||
    value === "openai"
  ) {
    return "chatgpt.com";
  }
  return value;
}

export function buildAttributionFromInputs(input: {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  ref?: string | null;
  referrer?: string | null;
  landingPath?: string | null;
  surveyAnswer?: string | null;
  now?: string;
}): DiscoveryAttributionRecord | null {
  const now = input.now || new Date().toISOString();
  const utmSource = normalizeDiscoverySource(input.utmSource);
  const ref = String(input.ref || "")
    .trim()
    .slice(0, 120) || null;
  const surveyAnswer = String(input.surveyAnswer || "")
    .trim()
    .slice(0, 160) || null;
  const referrer = String(input.referrer || "")
    .trim()
    .slice(0, 500) || null;
  const landingPath = String(input.landingPath || "")
    .trim()
    .slice(0, 500) || null;

  if (utmSource) {
    return {
      source: utmSource,
      channel: "query_utm",
      strength: DISCOVERY_ATTRIBUTION_STRENGTH.query_utm,
      capturedAt: now,
      landingPath,
      utmSource,
      utmMedium: String(input.utmMedium || "").trim().slice(0, 120) || null,
      utmCampaign: String(input.utmCampaign || "").trim().slice(0, 120) || null,
      utmContent: String(input.utmContent || "").trim().slice(0, 120) || null,
      utmTerm: String(input.utmTerm || "").trim().slice(0, 120) || null,
      ref,
      referrer,
      surveyAnswer: null,
    };
  }

  if (ref) {
    return {
      source: `ref:${ref.toLowerCase()}`,
      channel: "query_ref",
      strength: DISCOVERY_ATTRIBUTION_STRENGTH.query_ref,
      capturedAt: now,
      landingPath,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
      ref,
      referrer,
      surveyAnswer: null,
    };
  }

  if (referrer && isExternalReferrer(referrer, landingPath)) {
    const host = safeHostname(referrer);
    return {
      source: host ? `referrer:${host}` : "referrer",
      channel: "referrer",
      strength: DISCOVERY_ATTRIBUTION_STRENGTH.referrer,
      capturedAt: now,
      landingPath,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
      ref: null,
      referrer,
      surveyAnswer: null,
    };
  }

  if (surveyAnswer) {
    return {
      source: `survey:${surveyAnswer.toLowerCase()}`,
      channel: "optional_survey",
      strength: DISCOVERY_ATTRIBUTION_STRENGTH.optional_survey,
      capturedAt: now,
      landingPath,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
      ref: null,
      referrer,
      surveyAnswer,
    };
  }

  return null;
}

/**
 * First-touch preservation: keep the earlier record unless the incoming one is
 * strictly stronger. Optional survey never overwrites a stronger channel.
 */
export function mergeDiscoveryAttribution(
  existing: DiscoveryAttributionRecord | null | undefined,
  incoming: DiscoveryAttributionRecord | null | undefined,
): DiscoveryAttributionRecord | null {
  if (!existing && !incoming) return null;
  if (!existing) return incoming || null;
  if (!incoming) return existing;

  if (incoming.channel === "optional_survey") {
    if (existing.strength > DISCOVERY_ATTRIBUTION_STRENGTH.optional_survey) {
      return {
        ...existing,
        // Keep survey answer as supplemental metadata only.
        surveyAnswer: existing.surveyAnswer || incoming.surveyAnswer,
      };
    }
  }

  if (incoming.strength > existing.strength) {
    return {
      ...incoming,
      surveyAnswer: existing.surveyAnswer || incoming.surveyAnswer,
    };
  }

  // Equal or weaker: preserve first-touch; optionally attach missing survey.
  return {
    ...existing,
    surveyAnswer: existing.surveyAnswer || incoming.surveyAnswer,
  };
}

export function mapProfileActionToSpineEvent(
  actionType: string,
): DiscoverySpineEvent | null {
  const action = String(actionType || "").trim();
  if (action === "profile_view") return "discovery_entity_view";
  if (action === "call_click") return "discovery_phone_click";
  if (DISCOVERY_PRIMARY_PROFILE_ACTIONS.has(action)) {
    return "discovery_primary_action";
  }
  if (action === "order_click" || action === "truck_booking_click") {
    return "discovery_request_started";
  }
  return null;
}

/**
 * Primary vs request-started mapping for MealScout (not TradeScout "Start a Request").
 * Order / booking / catering also emit request_started alongside primary_action.
 */
export function spineEventsForProfileAction(
  actionType: string,
): DiscoverySpineEvent[] {
  const action = String(actionType || "").trim();
  if (action === "profile_view") return ["discovery_entity_view"];
  if (action === "call_click") return ["discovery_phone_click"];
  if (action === "order_click" || action === "catering_click") {
    return ["discovery_primary_action", "discovery_request_started"];
  }
  if (action === "truck_booking_click") {
    return ["discovery_primary_action", "discovery_request_started"];
  }
  if (DISCOVERY_PRIMARY_PROFILE_ACTIONS.has(action)) {
    return ["discovery_primary_action"];
  }
  return [];
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function isExternalReferrer(
  referrer: string,
  landingPath: string | null,
): boolean {
  const host = safeHostname(referrer);
  if (!host) return false;
  if (host.includes("mealscout.")) return false;
  if (host === "localhost" || host === "127.0.0.1") return false;
  // Ignore self-navigation artifacts when landingPath is present.
  if (landingPath && referrer.includes(landingPath)) return false;
  return true;
}
