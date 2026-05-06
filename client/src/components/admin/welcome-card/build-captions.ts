/**
 * Per-platform caption builder for MealScout welcome cards.
 *
 * MISSION LENS (locked in project instruction):
 *   MealScout exists to restore foot traffic to local food places. Every
 *   line in every caption must push the reader toward "I need to GO there."
 *   Never "order it," "have it delivered," "add to cart," or "shop now."
 *
 *   Concrete consequences for caption copy:
 *     - Openers say "open in [city]," "come find them," "pull up to [name],"
 *       "stop in tonight," "the back patio is open." Never "order now,"
 *       "delivery available," "shop now."
 *     - Closers reinforce the visit: "Come find them." "Stop in tonight."
 *       "Pull up." Followed by the affiliate profile link.
 *     - Real-data only. If a field is missing, the line is dropped, never
 *       fabricated. No invented cities, cuisines, items, hours, or metrics.
 *
 * BRAND RULES locked into the output:
 *   - "Follow The Flavor." tagline appears on every platform
 *   - No "AI" language (the agreed substitute is "Community-Powered")
 *   - The shared link is the user's MealScout profile (= affiliate link)
 *
 * Platforms supported in Round 3a:
 *   - facebook  (long form, link clickable inline, paragraph breaks)
 *   - instagram (link not clickable in caption, hashtag-rich, "link in bio"
 *                hint plus the full URL since users still copy/paste it)
 *   - x         (280-char hard limit, single sentence + link)
 *
 * Future rounds may add linkedin / threads / tiktok-bio.
 */

export type CaptionPlatform = "facebook" | "instagram" | "x";

export type CaptionSignupKind =
  | "food_truck"
  | "restaurant"
  | "caterer"
  | "private_chef"
  | "host"
  | "supplier";

export interface CaptionSignupInput {
  displayName: string;
  kind: CaptionSignupKind | string;
  typeLabel?: string | null;
  locationLabel?: string | null;
  profileUrl?: string | null;
  shareUrl?: string | null;
  category?: string | null;
  menuItemNames?: string[] | null;
  videoCount?: number | null;
  websiteUrl?: string | null;
  /**
   * @deprecated MealScout no longer surfaces order/delivery language. Field
   * remains in the input shape so legacy callers don't break, but it is
   * intentionally never rendered.
   */
  menuUrl?: string | null;
  /**
   * @deprecated See note on menuUrl. Kept for shape-compat only.
   */
  orderUrl?: string | null;
}

export interface PlatformCaption {
  platform: CaptionPlatform;
  body: string;
  hashtags: string[];
  /** Composed string ready to paste/post. */
  composed: string;
  /** True if composed fits within the platform's hard limit. */
  withinLimit: boolean;
  /** Hard character limit for the platform (informational; X = 280, others soft). */
  charLimit: number;
  /** Length of composed for UI display. */
  length: number;
}

const TAGLINE = "Follow The Flavor.";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Trimmed display name, with a safe fallback. */
const nameOf = (signup: CaptionSignupInput): string =>
  String(signup.displayName || "").trim() || "A new local spot";

/**
 * Returns just the city portion of "City, ST" — what humans say out loud.
 * Returns "" if no usable location is on the signup.
 */
const cityOf = (signup: CaptionSignupInput): string => {
  const raw = String(signup.locationLabel || "").trim();
  if (!raw || raw.toLowerCase() === "local") return "";
  return raw.split(",")[0].trim();
};

/* -------------------------------------------------------------------------- */
/* Foot-traffic opener                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Mission-aligned opener per kind. Pushes the reader to GO there. Real fields
 * only — no invented cities, cuisines, or items.
 */
const footTrafficOpener = (signup: CaptionSignupInput): string => {
  const name = nameOf(signup);
  const city = cityOf(signup);
  const inCity = city ? ` in ${city}` : "";

  switch (signup.kind) {
    case "food_truck":
      return city
        ? `${name} is now parked${inCity}. Come find them this week.`
        : `${name} just rolled into the MealScout map. Come find them.`;
    case "restaurant":
      return city
        ? `${name} is open${inCity}. Stop in tonight.`
        : `${name} is open. Stop in tonight.`;
    case "caterer":
      return city
        ? `${name} is now booking${inCity}. Stop in and meet them.`
        : `${name} is now booking on MealScout. Stop in and meet them.`;
    case "private_chef":
      return city
        ? `${name} is at the pass${inCity}. Sit at their counter.`
        : `${name} is at the pass on MealScout. Sit at their counter.`;
    case "host":
      return city
        ? `Doors are open at ${name}${inCity}. Pull up.`
        : `Doors are open at ${name}. Pull up.`;
    case "supplier":
      return city
        ? `${name} is stocking the local food scene${inCity}. Visit the floor.`
        : `${name} is stocking the local food scene on MealScout. Visit the floor.`;
    default:
      return city
        ? `${name} is now open${inCity}. Come find them.`
        : `${name} is now on MealScout. Come find them.`;
  }
};

/* -------------------------------------------------------------------------- */
/* Optional factual lines                                                     */
/* -------------------------------------------------------------------------- */

const categoryLine = (signup: CaptionSignupInput): string => {
  const cat = String(signup.category || "").trim();
  return cat ? `${cat}.` : "";
};

/**
 * Real menu items pulled from onboarding. Phrased as "what's on the pass" -
 * the room/counter, not the cart. Drops to "" if no items.
 */
const menuLine = (signup: CaptionSignupInput): string => {
  const items = (signup.menuItemNames || [])
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!items.length) return "";
  if (items.length === 1) return `On the pass: ${items[0]}.`;
  return `On the pass: ${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}.`;
};

/**
 * If the owner uploaded videos to their profile, point readers at the
 * profile - not at "watch the order link." Drops to "" if videoCount = 0.
 */
const videoLine = (signup: CaptionSignupInput): string => {
  return Number(signup.videoCount || 0) > 0
    ? `Walk-throughs and updates are on their profile.`
    : "";
};

/**
 * Mission-aligned closer per kind. Always anchors the post in a real-world
 * action ("stop in," "pull up," "come find them"), never "order."
 */
const footTrafficCloser = (signup: CaptionSignupInput): string => {
  const city = cityOf(signup);
  switch (signup.kind) {
    case "food_truck":
      return city ? `Find them in ${city} this week.` : `Come find them.`;
    case "restaurant":
      return `Stop in tonight.`;
    case "caterer":
      return city ? `Stop in${city ? ` in ${city}` : ""} and meet them.` : `Stop in and meet them.`;
    case "private_chef":
      return `Sit at the counter.`;
    case "host":
      return `Pull up.`;
    case "supplier":
      return `Visit their floor.`;
    default:
      return city ? `Come find them in ${city}.` : `Come find them.`;
  }
};

/* -------------------------------------------------------------------------- */
/* Hashtags                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Hashtags per kind. Conservative — evergreen, brand-safe, foot-traffic
 * leaning. Adds locality tag when a clean city is on the signup.
 */
const hashtagsFor = (signup: CaptionSignupInput): string[] => {
  const base = ["#MealScout", "#FollowTheFlavor", "#StopInTonight"];
  const kindTags: Record<string, string[]> = {
    food_truck: ["#FoodTruck", "#StreetFood", "#PullUp"],
    restaurant: ["#LocalEats", "#SupportLocal", "#OpenTonight"],
    caterer: ["#Catering", "#PrivateEvents"],
    private_chef: ["#PrivateChef", "#ChefsCounter"],
    host: ["#FoodTrucksWelcome", "#LocalFood"],
    supplier: ["#FoodSupplier", "#LocalFood"],
  };
  const tags = [...base, ...(kindTags[signup.kind as string] || [])];

  // Add a locality tag if we have a clean city.
  const city = cityOf(signup);
  if (city) {
    const cleaned = city
      .replace(/[^a-zA-Z]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join("");
    if (cleaned && cleaned.length <= 32) {
      tags.push(`#${cleaned}`);
    }
  }
  return tags;
};

const profileLink = (signup: CaptionSignupInput): string => {
  return String(
    signup.shareUrl || signup.profileUrl || "https://www.mealscout.us",
  ).trim();
};

/* -------------------------------------------------------------------------- */
/* Per-platform builders                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Facebook: long form, paragraph breaks, link inline. Canonical/longest.
 */
const buildFacebook = (signup: CaptionSignupInput): PlatformCaption => {
  const opener = footTrafficOpener(signup);
  const facts = [categoryLine(signup), menuLine(signup), videoLine(signup)]
    .filter(Boolean)
    .join(" ");
  const closer = footTrafficCloser(signup);
  const link = profileLink(signup);
  const hashtags = hashtagsFor(signup);

  const body = [
    opener,
    facts,
    `See the place: ${link}`,
    `${closer} ${TAGLINE}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const composed = `${body}\n\n${hashtags.join(" ")}`.trim();
  return {
    platform: "facebook",
    body,
    hashtags,
    composed,
    charLimit: 63206,
    length: composed.length,
    withinLimit: composed.length <= 63206,
  };
};

/**
 * Instagram: link not clickable in caption, so include it as plain text + a
 * "link in bio" hint. Hashtag-rich.
 */
const buildInstagram = (signup: CaptionSignupInput): PlatformCaption => {
  const opener = footTrafficOpener(signup);
  const facts = [categoryLine(signup), menuLine(signup)]
    .filter(Boolean)
    .join(" ");
  const closer = footTrafficCloser(signup);
  const link = profileLink(signup);
  const hashtags = hashtagsFor(signup);

  const body = [
    opener,
    facts,
    `${closer} ${TAGLINE}`,
    `${link}`,
    `(Link in bio for the full profile.)`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const composed = `${body}\n\n${hashtags.join(" ")}`.trim();
  return {
    platform: "instagram",
    body,
    hashtags,
    composed,
    charLimit: 2200,
    length: composed.length,
    withinLimit: composed.length <= 2200,
  };
};

/**
 * X (Twitter): single sentence, under 280 chars. Link counts as 23 chars
 * regardless of actual length.
 */
const buildX = (signup: CaptionSignupInput): PlatformCaption => {
  const link = profileLink(signup);
  const hashtags = hashtagsFor(signup).slice(0, 2); // X favors fewer
  const opener = footTrafficOpener(signup);
  const closer = footTrafficCloser(signup);
  const name = nameOf(signup);
  const city = cityOf(signup);

  const measure = (text: string): number => {
    const linkRegex = /https?:\/\/\S+/g;
    let total = text.length;
    const matches = text.match(linkRegex) || [];
    for (const m of matches) {
      total = total - m.length + 23;
    }
    return total;
  };

  const candidates = [
    `${opener} ${closer} ${TAGLINE} ${link} ${hashtags.join(" ")}`.trim(),
    `${opener} ${closer} ${link} ${hashtags.join(" ")}`.trim(),
    `${opener} ${link} ${hashtags.join(" ")}`.trim(),
    `${opener} ${link}`.trim(),
    // Final fallback: shortest possible, still mission-aligned.
    city
      ? `${name} is open in ${city}. Stop in tonight. ${link}`.trim()
      : `${name} is open. Stop in tonight. ${link}`.trim(),
  ];

  let composed = candidates[candidates.length - 1] || "";
  for (const c of candidates) {
    if (measure(c) <= 280) {
      composed = c;
      break;
    }
  }

  return {
    platform: "x",
    body: composed,
    hashtags,
    composed,
    charLimit: 280,
    length: measure(composed),
    withinLimit: measure(composed) <= 280,
  };
};

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export const buildWelcomeCardCaptions = (
  signup: CaptionSignupInput,
): Record<CaptionPlatform, PlatformCaption> => {
  return {
    facebook: buildFacebook(signup),
    instagram: buildInstagram(signup),
    x: buildX(signup),
  };
};

export const PLATFORM_LABELS: Record<CaptionPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
};
