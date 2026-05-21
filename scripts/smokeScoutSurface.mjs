const normalizeBaseUrl = (input) =>
  String(input || "")
    .trim()
    .replace(/\/$/, "")
    .replace(/^http:\/\/localhost(?=[:/]|$)/, "http://127.0.0.1")
    .replace(/^https:\/\/localhost(?=[:/]|$)/, "https://127.0.0.1");

const baseUrl = normalizeBaseUrl(
  process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000",
);

const allowedModes = new Set(["activity", "discovery", "quiet"]);
const allowedPlacements = new Set(["primary", "secondary", "supporting", "lower"]);
const allowedLayouts = new Set([
  "hero_cards",
  "horizontal_cards",
  "compact_deals",
  "vertical_list",
]);

const forbiddenKeyPatterns = [
  /sourceCounts/i,
  /recommendationDislikeCount/i,
  /privateBoostScore/i,
  /visitIntentScore/i,
  /orderVelocityScore/i,
  /repeatCustomerScore/i,
  /menuItemVelocityScore/i,
  /dealConversionScore/i,
  /engagementDepthScore/i,
  /freshnessActivityScore/i,
  /dislikeCount/i,
  /rawDislike/i,
];

const scanForbiddenKeys = (value, path = "root", hits = []) => {
  if (!value || typeof value !== "object") return hits;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      scanForbiddenKeys(entry, `${path}[${index}]`, hits),
    );
    return hits;
  }

  for (const [key, next] of Object.entries(value)) {
    if (forbiddenKeyPatterns.some((pattern) => pattern.test(key))) {
      hits.push(`${path}.${key}`);
    }
    scanForbiddenKeys(next, `${path}.${key}`, hits);
  }
  return hits;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const isRecommendationBackedCard = (card) => {
  const reasons = Array.isArray(card?.reasons) ? card.reasons.map(String) : [];
  const source = String(card?.source || "");
  const sourceDetail = String(card?.metadata?.sourceDetail || "");
  if (source === "recommendation" || source === "community") return true;
  if (sourceDetail.includes("private_behavior")) return true;
  if (sourceDetail.includes("restaurant_signals")) return true;
  return reasons.some((reason) =>
    /recommended by locals|local favorite|popular nearby|you follow this|you recommended this|one of your favorites/i.test(
      reason,
    ),
  );
};

const validateCard = (card, sectionId) => {
  assert(card && typeof card === "object", `${sectionId}: card must be object`);
  const required = [
    "id",
    "entityType",
    "entityId",
    "title",
    "badges",
    "reasons",
    "availability",
    "cta",
    "score",
    "source",
  ];
  for (const field of required) {
    assert(field in card, `${sectionId}: missing card.${field}`);
  }
  assert(Array.isArray(card.badges), `${sectionId}: badges must be array`);
  assert(Array.isArray(card.reasons), `${sectionId}: reasons must be array`);
  assert(card.cta && typeof card.cta === "object", `${sectionId}: cta required`);
  assert(
    typeof card.cta.href === "string" && card.cta.href.trim().length > 0 && card.cta.href !== "#",
    `${sectionId}: cta.href must be non-empty`,
  );
  assert(Number.isFinite(Number(card.score)), `${sectionId}: score must be numeric`);
};

const fetchSurface = async (url) => {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Request failed ${res.status} for ${url}`);
  }
  return res.json();
};

const runContractChecks = (payload, label) => {
  assert(payload && typeof payload === "object", `${label}: payload missing`);
  assert(typeof payload.generatedAt === "string", `${label}: generatedAt missing`);
  assert(allowedModes.has(String(payload.mode || "")), `${label}: invalid mode`);
  assert(payload.map && Array.isArray(payload.map.markers), `${label}: map.markers missing`);
  assert(Array.isArray(payload.sections), `${label}: sections missing`);

  for (const section of payload.sections) {
    assert(section && typeof section === "object", `${label}: section invalid`);
    assert(typeof section.id === "string" && section.id.length > 0, `${label}: section.id missing`);
    assert(typeof section.title === "string" && section.title.length > 0, `${label}: section.title missing`);
    assert(allowedPlacements.has(String(section.placement || "")), `${label}: invalid section placement`);
    assert(allowedLayouts.has(String(section.layout || "")), `${label}: invalid section layout`);
    assert(Array.isArray(section.cards), `${label}: section.cards missing`);
    for (const card of section.cards) {
      validateCard(card, section.id);
    }
  }

  const forbiddenHits = scanForbiddenKeys(payload);
  assert(
    forbiddenHits.length === 0,
    `${label}: forbidden keys exposed -> ${forbiddenHits.join(", ")}`,
  );

  const markerIds = new Set();
  for (const marker of payload.map.markers) {
    assert(Number.isFinite(Number(marker.lat)), `${label}: marker.lat invalid`);
    assert(Number.isFinite(Number(marker.lng)), `${label}: marker.lng invalid`);
    markerIds.add(`${String(marker.entityType)}:${String(marker.entityId)}`);
  }

  const recommendedSection = payload.sections.find(
    (section) => section.id === "recommended-nearby",
  );
  if (recommendedSection) {
    assert(
      recommendedSection.cards.length > 0,
      `${label}: recommended-nearby cannot be empty`,
    );
    for (const card of recommendedSection.cards) {
      assert(
        isRecommendationBackedCard(card),
        `${label}: recommended-nearby contains non-backed card ${card.id}`,
      );
    }
  }

  const trucksSectionIndex = payload.sections.findIndex(
    (section) => section.id === "trucks-serving-now",
  );
  const nearbySectionIndex = payload.sections.findIndex(
    (section) => section.id === "nearby-now",
  );
  if (trucksSectionIndex >= 0 && nearbySectionIndex >= 0) {
    assert(
      trucksSectionIndex < nearbySectionIndex,
      `${label}: trucks-serving-now must be before nearby-now`,
    );
  }

  const dealsSection = payload.sections.find((section) => section.id === "deals-today");
  if (dealsSection) {
    assert(dealsSection.cards.length > 0, `${label}: deals-today cannot be empty`);
  }
  const happeningSection = payload.sections.find(
    (section) => section.id === "happening-today",
  );
  if (happeningSection) {
    assert(happeningSection.cards.length > 0, `${label}: happening-today cannot be empty`);
  }

  const earlySectionIds = new Set([
    "trucks-serving-now",
    "nearby-now",
    "recommended-nearby",
    "deals-today",
    "happening-today",
    "open-near-you",
  ]);
  const seenEarly = new Set();
  for (const section of payload.sections) {
    if (!earlySectionIds.has(section.id)) continue;
    for (const card of section.cards) {
      const key = `${String(card.entityType)}:${String(card.entityId)}`;
      if (card.entityType === "deal") continue;
      assert(!seenEarly.has(key), `${label}: duplicate early card entity ${key}`);
      seenEarly.add(key);
    }
  }

  return {
    sections: payload.sections.map((section) => ({
      id: section.id,
      title: section.title,
      count: section.cards.length,
    })),
    markers: payload.map.markers.length,
  };
};

const run = async () => {
  const liveUrl = `${baseUrl}/api/scout/surface?lat=30.4213&lng=-87.2169&radiusMiles=12&limit=40`;
  const quietUrl = `${baseUrl}/api/scout/surface?lat=0&lng=-140&radiusMiles=1&limit=20`;

  console.log(`[smoke:scout-surface] base=${baseUrl}`);
  const livePayload = await fetchSurface(liveUrl);
  const liveSummary = runContractChecks(livePayload, "live");
  console.log("[live] mode:", livePayload.mode);
  console.log(
    "[live] sections:",
    liveSummary.sections.map((section) => `${section.title}(${section.count})`).join(", "),
  );
  console.log("[live] markers:", liveSummary.markers);

  const quietPayload = await fetchSurface(quietUrl);
  const quietSummary = runContractChecks(quietPayload, "quiet");
  if (quietPayload.sections.length === 0) {
    assert(
      quietPayload.mode === "quiet",
      "quiet: expected quiet mode when sections are empty",
    );
  }
  console.log("[quiet] mode:", quietPayload.mode);
  console.log(
    "[quiet] sections:",
    quietSummary.sections.map((section) => `${section.title}(${section.count})`).join(", ") ||
      "(none)",
  );
  console.log("[quiet] markers:", quietSummary.markers);

  console.log("[smoke:scout-surface] PASS");
};

run().catch((error) => {
  console.error("[smoke:scout-surface] FAIL", error?.message || error);
  process.exit(1);
});

