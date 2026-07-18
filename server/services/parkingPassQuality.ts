type ParkingPassQualityFlag =
  | "missing_price"
  | "missing_address"
  | "missing_city"
  | "missing_state"
  | "invalid_state"
  | "bad_address_format"
  | "missing_coords"
  | "invalid_coords"
  | "invalid_time_window"
  | "missing_spots"
  | "invalid_spots"
  | "payments_disabled";

type HostProfileQualityFlag =
  | "missing_business_name"
  | "suspicious_business_name"
  | "missing_address"
  | "bad_address_format"
  | "suspicious_address";

const NON_BLOCKING_HOST_PROFILE_QUALITY_FLAGS = new Set<HostProfileQualityFlag>([
  "bad_address_format",
]);

const NON_BLOCKING_PARKING_PASS_QUALITY_FLAGS =
  new Set<ParkingPassQualityFlag>([
    "missing_coords",
    "invalid_coords",
    "payments_disabled",
    "invalid_state",
    "bad_address_format",
    "invalid_time_window",
    "missing_spots",
    "invalid_spots",
  ]);

const normalize = (value?: string | number | null) =>
  String(value ?? "").trim();

export const normalizeUsStateAbbr = (value: string): string => {
  const raw = value.trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;

  const key = raw.trim().toLowerCase();
  const byName: Record<string, string> = {
    alabama: "AL",
    alaska: "AK",
    arizona: "AZ",
    arkansas: "AR",
    california: "CA",
    colorado: "CO",
    connecticut: "CT",
    delaware: "DE",
    florida: "FL",
    flordia: "FL",
    floridia: "FL",
    georgia: "GA",
    hawaii: "HI",
    idaho: "ID",
    illinois: "IL",
    indiana: "IN",
    iowa: "IA",
    kansas: "KS",
    kentucky: "KY",
    louisiana: "LA",
    maine: "ME",
    maryland: "MD",
    massachusetts: "MA",
    michigan: "MI",
    minnesota: "MN",
    mississippi: "MS",
    missouri: "MO",
    montana: "MT",
    nebraska: "NE",
    nevada: "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    northcarolina: "NC",
    "north carolina": "NC",
    northdakota: "ND",
    "north dakota": "ND",
    ohio: "OH",
    oklahoma: "OK",
    oregon: "OR",
    pennsylvania: "PA",
    "rhode island": "RI",
    southcarolina: "SC",
    "south carolina": "SC",
    southdakota: "SD",
    "south dakota": "SD",
    tennessee: "TN",
    texas: "TX",
    utah: "UT",
    vermont: "VT",
    virginia: "VA",
    washington: "WA",
    "west virginia": "WV",
    wisconsin: "WI",
    wyoming: "WY",
    "district of columbia": "DC",
    dc: "DC",
  };

  return byName[key] || byName[key.replace(/\./g, "")] || raw;
};

const toNumberOrNull = (value: any): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
};

const firstFiniteNumber = (
  ...values: Array<number | string | null | undefined>
) => {
  for (const value of values) {
    const parsed = toNumberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const SUSPICIOUS_TEST_TOKEN =
  /\b(test|asdf|qwer|dummy|sample|temp|fake|placeholder|smoketest|smoke[-_\s]?test|smoke[-_\s]?host)\b/i;
const SUSPICIOUS_PRIVATE_HOST_NAME =
  /^(my|our)\s+(house|home|place)$|^(home|house|residence|personal residence)$/i;
const LONG_GIBBERISH_TOKEN = /^[a-z0-9]{16,}$/i;
const STREET_HINT =
  /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|hwy|highway|pkwy|parkway|way|ct|court)\b/i;

export function computeHostProfileQualityFlags(profile: {
  businessName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
}): HostProfileQualityFlag[] {
  const flags: HostProfileQualityFlag[] = [];
  const businessName = normalize(profile.businessName);
  const address = normalize(profile.address);

  if (!businessName) {
    flags.push("missing_business_name");
  } else {
    const isSingleTokenName = !/\s/.test(businessName);
    if (
      SUSPICIOUS_TEST_TOKEN.test(businessName) ||
      SUSPICIOUS_PRIVATE_HOST_NAME.test(businessName) ||
      (isSingleTokenName && LONG_GIBBERISH_TOKEN.test(businessName))
    ) {
      flags.push("suspicious_business_name");
    }
  }

  if (!address) {
    flags.push("missing_address");
  } else {
    if (!/\d/.test(address) && !STREET_HINT.test(address)) {
      flags.push("bad_address_format");
    }
    if (SUSPICIOUS_TEST_TOKEN.test(address)) {
      flags.push("suspicious_address");
    }
  }

  return Array.from(new Set(flags));
}

export function isHostProfileMapEligible(
  profile: Parameters<typeof computeHostProfileQualityFlags>[0],
) {
  return getHostProfileBlockingQualityFlags(profile).length === 0;
}

export function getHostProfileBlockingQualityFlags(
  profile: Parameters<typeof computeHostProfileQualityFlags>[0],
) {
  return computeHostProfileQualityFlags(profile).filter(
    (flag) => !NON_BLOCKING_HOST_PROFILE_QUALITY_FLAGS.has(flag),
  );
}

export function computeParkingPassQualityFlags(listing: {
  host?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    latitude?: string | number | null;
    longitude?: string | number | null;
    stripeConnectAccountId?: string | null;
    stripeChargesEnabled?: boolean | null;
    spotCount?: number | null;
    parkingPassStartTime?: string | null;
    parkingPassEndTime?: string | null;
    parkingPassBreakfastPriceCents?: number | null;
    parkingPassLunchPriceCents?: number | null;
    parkingPassDinnerPriceCents?: number | null;
    parkingPassDailyPriceCents?: number | null;
    parkingPassWeeklyPriceCents?: number | null;
    parkingPassMonthlyPriceCents?: number | null;
  } | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  startTime?: string | null;
  endTime?: string | null;
  maxTrucks?: number | null;
  breakfastPriceCents?: number | null;
  lunchPriceCents?: number | null;
  dinnerPriceCents?: number | null;
  dailyPriceCents?: number | null;
  weeklyPriceCents?: number | null;
  monthlyPriceCents?: number | null;
}): ParkingPassQualityFlag[] {
  const flags: ParkingPassQualityFlag[] = [];

  const host = listing.host ?? null;
  const address = normalize(listing.address ?? host?.address);
  const city = normalize(listing.city ?? host?.city);
  const stateRaw = normalize(listing.state ?? host?.state);
  const state = stateRaw ? normalizeUsStateAbbr(stateRaw) : "";
  // Platform payments: we must be able to charge trucks for Parking Pass bookings.
  // Host payouts (Stripe Connect) are optional; if not enabled we hold host earnings as credit.
  const platformPaymentsEnabled = Boolean(process.env.STRIPE_SECRET_KEY);

  if (!address) flags.push("missing_address");
  // City/state are optional because many legacy host rows store the full location in `address`.
  // If state is provided, validate it to avoid obviously bad data.
  if (stateRaw && state && !/^[A-Za-z]{2}$/.test(state))
    flags.push("invalid_state");
  if (address && !/\d/.test(address)) flags.push("bad_address_format");

  const lat = toNumberOrNull(listing.latitude ?? host?.latitude);
  const lng = toNumberOrNull(listing.longitude ?? host?.longitude);
  if (lat === null || lng === null) {
    flags.push("missing_coords");
  } else if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    flags.push("invalid_coords");
  }

  const startTime = normalize(listing.startTime ?? host?.parkingPassStartTime);
  const endTime = normalize(listing.endTime ?? host?.parkingPassEndTime);
  if (!startTime || !endTime) {
    flags.push("invalid_time_window");
  } else {
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if (
      !Number.isFinite(sh) ||
      !Number.isFinite(sm) ||
      !Number.isFinite(eh) ||
      !Number.isFinite(em) ||
      eh * 60 + em <= sh * 60 + sm
    ) {
      flags.push("invalid_time_window");
    }
  }

  const maxTrucks = firstFiniteNumber(listing.maxTrucks, host?.spotCount);
  if (maxTrucks === null || maxTrucks === undefined) {
    flags.push("missing_spots");
  } else if (!Number.isFinite(maxTrucks) || maxTrucks < 1) {
    flags.push("invalid_spots");
  }

  const resolvedBreakfast = firstFiniteNumber(
    listing.breakfastPriceCents,
    host?.parkingPassBreakfastPriceCents,
  );
  const resolvedLunch = firstFiniteNumber(
    listing.lunchPriceCents,
    host?.parkingPassLunchPriceCents,
  );
  const resolvedDinner = firstFiniteNumber(
    listing.dinnerPriceCents,
    host?.parkingPassDinnerPriceCents,
  );
  const resolvedDaily = firstFiniteNumber(
    listing.dailyPriceCents,
    host?.parkingPassDailyPriceCents,
  );
  const resolvedWeekly = firstFiniteNumber(
    listing.weeklyPriceCents,
    host?.parkingPassWeeklyPriceCents,
  );
  const resolvedMonthly = firstFiniteNumber(
    listing.monthlyPriceCents,
    host?.parkingPassMonthlyPriceCents,
  );

  const hasPricing = [
    resolvedBreakfast,
    resolvedLunch,
    resolvedDinner,
    resolvedDaily,
    resolvedWeekly,
    resolvedMonthly,
  ].some(
    (value) =>
      value !== null &&
      value !== undefined &&
      Number.isFinite(Number(value)) &&
      Number(value) > 0,
  );
  if (!hasPricing) flags.push("missing_price");

  if (!platformPaymentsEnabled) flags.push("payments_disabled");

  return Array.from(new Set(flags));
}

export function isParkingPassPublicReady(
  listing: Parameters<typeof computeParkingPassQualityFlags>[0],
) {
  // Public-ready (pins/bookability) should match the simple model:
  // if a host has an address and any pricing, show it and allow booking.
  //
  // These flags are still useful diagnostics in admin tools, but should not
  // block pins/listings:
  // - payments/coords: operational or best-effort
  // - invalid_state/bad_address_format: legacy/dirty data is common
  // - invalid_time_window/spots: downstream logic defaults these safely
  return getParkingPassBlockingQualityFlags(listing).length === 0;
}

export function getParkingPassBlockingQualityFlags(
  listing: Parameters<typeof computeParkingPassQualityFlags>[0],
) {
  return computeParkingPassQualityFlags(listing).filter(
    (flag) => !NON_BLOCKING_PARKING_PASS_QUALITY_FLAGS.has(flag),
  );
}
