export const PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION = 2 as const;

export const PROFILE_EVIDENCE_REVIEW_LIMITS = {
  proposalsPerBatch: 50,
  ledgerProposals: 200,
  ledgerDecisions: 200,
  batchId: 120,
  sourceIdentity: 240,
  sourceLabel: 160,
  sourceUrl: 500,
  evidenceExcerpt: 500,
  imageEvidenceIds: 12,
  imageEvidenceId: 200,
  actorId: 200,
  clientRequestId: 80,
  queuedMenuItems: 200,
  queuedScheduleItems: 100,
  queuedMenuName: 160,
  queuedMenuDescription: 1000,
  queuedMenuPrice: 40,
  queuedMenuCategory: 120,
  queuedScheduleLocation: 200,
  queuedScheduleAddress: 300,
  queuedScheduleCity: 120,
  queuedScheduleState: 120,
  queuedScheduleNotes: 500,
} as const;

export const PROFILE_EVIDENCE_REVIEW_FIELDS = [
  "description",
  "cuisineType",
  "phone",
  "city",
  "state",
  "websiteUrl",
  "facebookPageUrl",
  "instagramUrl",
  "xUrl",
  "onlineOrderingUrl",
  "deliveryUrl",
  "doordashUrl",
  "uberEatsUrl",
  "toastUrl",
  "squareUrl",
  "chowNowUrl",
  "grubhubUrl",
  "cateringInquiryUrl",
  "truckBookingInquiryUrl",
] as const;

export type ProfileEvidenceReviewField =
  (typeof PROFILE_EVIDENCE_REVIEW_FIELDS)[number];

export type ProfileEvidenceRestaurantColumn =
  | "description"
  | "cuisineType"
  | "phone"
  | "city"
  | "state"
  | "websiteUrl"
  | "facebookPageUrl"
  | "instagramUrl"
  | "xUrl";

export type ProfileEvidencePublicActionLink =
  | "onlineOrderingUrl"
  | "deliveryUrl"
  | "doordashUrl"
  | "uberEatsUrl"
  | "toastUrl"
  | "squareUrl"
  | "chowNowUrl"
  | "grubhubUrl"
  | "cateringInquiryUrl"
  | "truckBookingInquiryUrl";

export type ProfileEvidenceFieldDestination =
  | {
      kind: "restaurant_column";
      column: ProfileEvidenceRestaurantColumn;
    }
  | {
      kind: "public_action_link";
      key: ProfileEvidencePublicActionLink;
    };

export type ProfileEvidenceValueKind =
  | "multiline_text"
  | "short_text"
  | "phone"
  | "url";

export type ProfileEvidenceFieldDefinition = {
  field: ProfileEvidenceReviewField;
  label: string;
  valueKind: ProfileEvidenceValueKind;
  maxLength: number;
  destination: ProfileEvidenceFieldDestination;
  allowedHostSuffixes?: readonly string[];
};

const column = (
  field: ProfileEvidenceRestaurantColumn,
  label: string,
  valueKind: ProfileEvidenceValueKind,
  maxLength: number,
  allowedHostSuffixes?: readonly string[],
): ProfileEvidenceFieldDefinition => ({
  field,
  label,
  valueKind,
  maxLength,
  destination: { kind: "restaurant_column", column: field },
  allowedHostSuffixes,
});

const actionLink = (
  field: ProfileEvidencePublicActionLink,
  label: string,
  allowedHostSuffixes?: readonly string[],
): ProfileEvidenceFieldDefinition => ({
  field,
  label,
  valueKind: "url",
  maxLength: 500,
  destination: { kind: "public_action_link", key: field },
  allowedHostSuffixes,
});

export const PROFILE_EVIDENCE_FIELD_REGISTRY: Readonly<
  Record<ProfileEvidenceReviewField, ProfileEvidenceFieldDefinition>
> = {
  description: column(
    "description",
    "About your business",
    "multiline_text",
    4000,
  ),
  cuisineType: column(
    "cuisineType",
    "Cuisine or food type",
    "short_text",
    160,
  ),
  phone: column("phone", "Public phone", "phone", 40),
  city: column("city", "Public service-area city", "short_text", 120),
  state: column("state", "Public service-area state", "short_text", 120),
  websiteUrl: column("websiteUrl", "Website", "url", 500),
  facebookPageUrl: column(
    "facebookPageUrl",
    "Facebook",
    "url",
    500,
    ["facebook.com", "fb.com"],
  ),
  instagramUrl: column(
    "instagramUrl",
    "Instagram",
    "url",
    500,
    ["instagram.com"],
  ),
  xUrl: column("xUrl", "X", "url", 500, ["x.com", "twitter.com"]),
  onlineOrderingUrl: actionLink("onlineOrderingUrl", "Online ordering"),
  deliveryUrl: actionLink("deliveryUrl", "Delivery"),
  doordashUrl: actionLink("doordashUrl", "DoorDash", ["doordash.com"]),
  uberEatsUrl: actionLink("uberEatsUrl", "Uber Eats", ["ubereats.com"]),
  toastUrl: actionLink("toastUrl", "Toast", ["toasttab.com", "toast.site"]),
  squareUrl: actionLink("squareUrl", "Square", ["square.site", "squareup.com"]),
  chowNowUrl: actionLink("chowNowUrl", "ChowNow", ["chownow.com"]),
  grubhubUrl: actionLink("grubhubUrl", "Grubhub", ["grubhub.com"]),
  cateringInquiryUrl: actionLink(
    "cateringInquiryUrl",
    "Catering inquiries",
  ),
  truckBookingInquiryUrl: actionLink(
    "truckBookingInquiryUrl",
    "Truck booking inquiries",
  ),
};

const FIELD_ALIASES: Record<string, ProfileEvidenceReviewField> = {
  description: "description",
  about: "description",
  bio: "description",
  cuisine_type: "cuisineType",
  cuisine: "cuisineType",
  category: "cuisineType",
  phone: "phone",
  public_phone: "phone",
  contact_phone: "phone",
  city: "city",
  service_area_city: "city",
  state: "state",
  service_area_state: "state",
  website: "websiteUrl",
  website_url: "websiteUrl",
  facebook: "facebookPageUrl",
  facebook_url: "facebookPageUrl",
  facebook_page_url: "facebookPageUrl",
  instagram: "instagramUrl",
  instagram_url: "instagramUrl",
  x: "xUrl",
  x_url: "xUrl",
  twitter: "xUrl",
  twitter_url: "xUrl",
  online_ordering_url: "onlineOrderingUrl",
  ordering_url: "onlineOrderingUrl",
  delivery_url: "deliveryUrl",
  doordash_url: "doordashUrl",
  uber_eats_url: "uberEatsUrl",
  ubereats_url: "uberEatsUrl",
  toast_url: "toastUrl",
  square_url: "squareUrl",
  chownow_url: "chowNowUrl",
  grubhub_url: "grubhubUrl",
  catering_inquiry_url: "cateringInquiryUrl",
  truck_booking_inquiry_url: "truckBookingInquiryUrl",
};

for (const field of PROFILE_EVIDENCE_REVIEW_FIELDS) {
  FIELD_ALIASES[
    field.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
  ] = field;
}

export const PROFILE_EVIDENCE_FIELD_ALIASES: Readonly<
  Record<string, ProfileEvidenceReviewField>
> = Object.freeze({ ...FIELD_ALIASES });

export type ProfileEvidenceConfidence =
  | "high"
  | "medium"
  | "low"
  | "unknown";

export type ProfileEvidenceSourceKind =
  | "screenshot"
  | "website"
  | "social"
  | "menu"
  | "operator"
  | "other";

export type ProfileEvidenceReviewProposal = {
  id: string;
  batchId: string;
  field: ProfileEvidenceReviewField;
  proposedValue: string;
  currentValueAtIntake: string | null;
  confidence: ProfileEvidenceConfidence;
  sourceKind: ProfileEvidenceSourceKind;
  sourceIdentity: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
  evidenceExcerpt: string | null;
  imageEvidenceIds: string[];
  receivedAt: string;
};

export type ProfileEvidenceDecisionAction =
  | "confirmed"
  | "corrected"
  | "declined";

export type ProfileEvidenceReviewDecision = {
  action: ProfileEvidenceDecisionAction;
  appliedValue: string | null;
  previousValue: string | null;
  previousValueFingerprint: string;
  decidedAt: string;
  decidedByUserId: string;
  clientRequestId: string;
  /**
   * Binds an idempotency key to the exact proposal/action/value/fingerprint
   * request. Older ledgers may omit it; normalization derives it safely from
   * the immutable stored decision semantics.
   */
  requestFingerprint?: string;
};

export type ProfileEvidenceReviewLedger = {
  schemaVersion: typeof PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION;
  proposals: ProfileEvidenceReviewProposal[];
  decisions: Record<string, ProfileEvidenceReviewDecision>;
};

export type ProfileEvidenceOwnerProposalDto = {
  id: string;
  field: ProfileEvidenceReviewField;
  label: string;
  valueKind: ProfileEvidenceValueKind;
  currentValue: string | null;
  proposedValue: string;
  confidence: ProfileEvidenceConfidence;
  source: {
    kind: ProfileEvidenceSourceKind;
    label: string | null;
    url: string | null;
    excerpt: string | null;
    imageEvidenceIds: string[];
    images: Array<{ id: string; url: string }>;
    reviewable: boolean;
    unavailableReason: string | null;
  };
  receivedAt: string;
  currentValueFingerprint: string;
};

export type ProfileEvidenceOwnerReviewDto = {
  schemaVersion: typeof PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION;
  restaurantId: string;
  pendingCount: number;
  proposals: ProfileEvidenceOwnerProposalDto[];
};

export class ProfileEvidenceValueValidationError extends Error {
  readonly field: ProfileEvidenceReviewField;
  readonly code: string;

  constructor(
    field: ProfileEvidenceReviewField,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProfileEvidenceValueValidationError";
    this.field = field;
    this.code = code;
  }
}

const toAliasKey = (value: unknown) =>
  String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s.-]+/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();

export function resolveProfileEvidenceReviewField(
  value: unknown,
): ProfileEvidenceReviewField | null {
  const key = toAliasKey(value);
  return key ? PROFILE_EVIDENCE_FIELD_ALIASES[key] || null : null;
}

export function isProfileEvidenceReviewField(
  value: unknown,
): value is ProfileEvidenceReviewField {
  return resolveProfileEvidenceReviewField(value) === value;
}

export function getProfileEvidenceFieldDefinition(
  field: ProfileEvidenceReviewField,
): ProfileEvidenceFieldDefinition {
  return PROFILE_EVIDENCE_FIELD_REGISTRY[field];
}

const assertScalar = (
  field: ProfileEvidenceReviewField,
  value: unknown,
): string => {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean")
  ) {
    throw new ProfileEvidenceValueValidationError(
      field,
      "invalid_type",
      "Evidence values must be text-like scalar values.",
    );
  }
  return String(value);
};

const containsUnsafeControlCharacters = (value: string, allowNewlines: boolean) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    if (code === 9) return false;
    if (allowNewlines && (code === 10 || code === 13)) return false;
    return code < 32 || code === 127;
  });

const normalizeText = (
  field: ProfileEvidenceReviewField,
  value: unknown,
  options: { multiline: boolean; maxLength: number },
) => {
  const raw = assertScalar(field, value).replace(/\r\n?/g, "\n");
  if (containsUnsafeControlCharacters(raw, options.multiline)) {
    throw new ProfileEvidenceValueValidationError(
      field,
      "unsafe_control_character",
      "Evidence values cannot contain control characters.",
    );
  }
  const normalized = options.multiline
    ? raw
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim()
    : raw.replace(/\s+/g, " ").trim();
  if (!normalized) {
    throw new ProfileEvidenceValueValidationError(
      field,
      "empty_value",
      "Evidence values cannot be blank.",
    );
  }
  if (normalized.length > options.maxLength) {
    throw new ProfileEvidenceValueValidationError(
      field,
      "value_too_long",
      `Evidence value exceeds the ${options.maxLength}-character limit.`,
    );
  }
  return normalized;
};

const hostMatches = (hostname: string, suffix: string) =>
  hostname === suffix || hostname.endsWith(`.${suffix}`);

const normalizeUrl = (
  field: ProfileEvidenceReviewField,
  value: unknown,
  definition: ProfileEvidenceFieldDefinition,
) => {
  const raw = normalizeText(field, value, {
    multiline: false,
    maxLength: definition.maxLength,
  });
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProfileEvidenceValueValidationError(
      field,
      "invalid_url",
      "Evidence URL must be a complete HTTP or HTTPS URL.",
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ProfileEvidenceValueValidationError(
      field,
      "unsafe_url_scheme",
      "Evidence URL must use HTTP or HTTPS.",
    );
  }
  if (parsed.username || parsed.password) {
    throw new ProfileEvidenceValueValidationError(
      field,
      "url_credentials_not_allowed",
      "Evidence URL cannot contain embedded credentials.",
    );
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    definition.allowedHostSuffixes?.length &&
    !definition.allowedHostSuffixes.some((suffix) =>
      hostMatches(hostname, suffix),
    )
  ) {
    throw new ProfileEvidenceValueValidationError(
      field,
      "unexpected_url_host",
      `Evidence URL does not match the expected ${definition.label} host.`,
    );
  }
  const normalized = parsed.toString();
  if (normalized.length > definition.maxLength) {
    throw new ProfileEvidenceValueValidationError(
      field,
      "value_too_long",
      `Evidence URL exceeds the ${definition.maxLength}-character limit.`,
    );
  }
  return normalized;
};

export function normalizeProfileEvidenceReviewValue(
  field: ProfileEvidenceReviewField,
  value: unknown,
): string {
  const definition = getProfileEvidenceFieldDefinition(field);
  if (definition.valueKind === "url") {
    return normalizeUrl(field, value, definition);
  }
  if (definition.valueKind === "phone") {
    const phone = normalizeText(field, value, {
      multiline: false,
      maxLength: definition.maxLength,
    });
    if (!/^[0-9+().\-\s#xXeEtT]+$/.test(phone)) {
      throw new ProfileEvidenceValueValidationError(
        field,
        "invalid_phone",
        "Public phone contains unsupported characters.",
      );
    }
    if ((phone.match(/\d/g) || []).length < 7) {
      throw new ProfileEvidenceValueValidationError(
        field,
        "invalid_phone",
        "Public phone must contain at least seven digits.",
      );
    }
    return phone;
  }
  return normalizeText(field, value, {
    multiline: definition.valueKind === "multiline_text",
    maxLength: definition.maxLength,
  });
}

export function normalizeProfileEvidenceConfidence(
  value: unknown,
): ProfileEvidenceConfidence {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "medium" || normalized === "med") return "medium";
  if (normalized === "low") return "low";
  return "unknown";
}

export function normalizeProfileEvidenceSourceKind(
  value: unknown,
): ProfileEvidenceSourceKind {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (/screen|image|photo|ocr/.test(normalized)) return "screenshot";
  if (/instagram|facebook|twitter|social|tiktok|youtube/.test(normalized)) {
    return "social";
  }
  if (/menu/.test(normalized)) return "menu";
  if (/owner|operator|admin|manual/.test(normalized)) return "operator";
  if (/web|site|url|page/.test(normalized)) return "website";
  return "other";
}
