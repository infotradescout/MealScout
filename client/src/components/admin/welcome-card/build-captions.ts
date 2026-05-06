/**
 * Per-platform caption builder for welcome cards.
 *
 * Real-data only. Every line is derived from fields actually captured during
 * signup (displayName, kind, typeLabel, locationLabel, category, menuItemNames,
 * videoCount, websiteUrl, menuUrl, orderUrl, profileUrl/shareUrl). When a field
 * is missing we omit the line entirely — never fabricate.
 *
 * Brand rules locked into the output:
 *  - "Follow The Flavor." tagline appears on every platform
 *  - No "AI" language anywhere
 *  - The shared link is the user's own MealScout profile/affiliate link
 *
 * Platforms supported in Round 2:
 *  - facebook  (long form, link clickable inline, paragraph breaks)
 *  - instagram (link not clickable in caption, hashtag-rich, "link in bio"
 *               hint plus the full URL since users still copy/paste it)
 *  - x         (280-char hard limit, single sentence + link)
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
  menuUrl?: string | null;
  orderUrl?: string | null;
}

export interface PlatformCaption {
  platform: CaptionPlatform;
  body: string;
  hashtags: string[];
  /** Composed string ready to paste/post (body + hashtags joined per platform conventions). */
  composed: string;
  /** True if the composed string fits within the platform's hard limit. */
  withinLimit: boolean;
  /** Hard character limit for the platform (informational; X = 280, others soft). */
  charLimit: number;
  /** Length of the composed string for UI display. */
  length: number;
}

const TAGLINE = "Follow The Flavor.";

/**
 * Cinematic-tight opener per business kind. Real fields only — no
 * placeholder cities, cuisines, or items.
 */
const cinematicOpener = (signup: CaptionSignupInput): string => {
  const name = String(signup.displayName || "").trim() || "A new local spot";
  const loc = String(signup.locationLabel || "").trim();
  const inLoc = loc && loc.toLowerCase() !== "local" ? ` in ${loc}` : "";

  switch (signup.kind) {
    case "food_truck":
      return loc
        ? `${loc}'s food truck lineup just got bigger — meet ${name}.`
        : `A new food truck just rolled into MealScout: ${name}.`;
    case "restaurant":
      return inLoc
        ? `There's a new local spot${inLoc}: ${name}.`
        : `New on MealScout: ${name}.`;
    case "caterer":
      return inLoc
        ? `Catering${inLoc}? ${name} just joined MealScout.`
        : `${name} just joined MealScout's caterer lineup.`;
    case "private_chef":
      return inLoc
        ? `Private dining${inLoc} just got an upgrade — ${name} is on MealScout.`
        : `${name}, a private chef, just joined MealScout.`;
    case "host":
      return inLoc
        ? `${name}${inLoc} is now hosting food trucks through MealScout.`
        : `${name} just joined MealScout as a host location.`;
    case "supplier":
      return inLoc
        ? `${name}${inLoc} is now supplying local food businesses on MealScout.`
        : `${name} just joined MealScout's supplier network.`;
    default:
      return inLoc
        ? `${name}${inLoc} is now on MealScout.`
        : `${name} just joined MealScout.`;
  }
};

/**
 * Optional factual lines pulled from real signup fields. Each returns "" if
 * the underlying field is missing, so we never fabricate.
 */
const categoryLine = (signup: CaptionSignupInput): string => {
  const cat = String(signup.category || "").trim();
  return cat ? `${cat}.` : "";
};

const menuLine = (signup: CaptionSignupInput): string => {
  const items = (signup.menuItemNames || [])
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!items.length) return "";
  if (items.length === 1) return `On the menu: ${items[0]}.`;
  return `On the menu: ${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}.`;
};

const videoLine = (signup: CaptionSignupInput): string => {
  return Number(signup.videoCount || 0) > 0
    ? `Videos and updates are live on their profile.`
    : "";
};

/**
 * Hashtags per kind. Conservative — we only use evergreen, brand-safe tags
 * that won't go stale and that map to actually local communities. Location
 * tag added when we have a city.
 */
const hashtagsFor = (signup: CaptionSignupInput): string[] => {
  const base = ["#MealScout", "#FollowTheFlavor"];
  const kindTags: Record<string, string[]> = {
    food_truck: ["#FoodTruck", "#FoodTruckLife", "#StreetFood"],
    restaurant: ["#LocalEats", "#SupportLocal"],
    caterer: ["#Catering", "#PrivateEvents"],
    private_chef: ["#PrivateChef", "#ChefLife"],
    host: ["#FoodTrucksWelcome", "#LocalFood"],
    supplier: ["#FoodSupplier", "#LocalFood"],
  };
  const tags = [...base, ...(kindTags[signup.kind as string] || [])];

  // Add a locality tag if we have a clean single-word or "City, ST" location.
  const loc = String(signup.locationLabel || "").trim();
  if (loc && loc.toLowerCase() !== "local") {
    const cleaned = loc
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
  return String(signup.shareUrl || signup.profileUrl || "https://www.mealscout.us").trim();
};

/**
 * Build the Facebook caption — long form, paragraph breaks, link inline.
 * Facebook is the canonical/longest version.
 */
const buildFacebook = (signup: CaptionSignupInput): PlatformCaption => {
  const opener = cinematicOpener(signup);
  const lines = [
    categoryLine(signup),
    menuLine(signup),
    videoLine(signup),
  ].filter(Boolean);
  const link = profileLink(signup);
  const hashtags = hashtagsFor(signup);

  const body = [
    opener,
    lines.join(" "),
    `See their profile: ${link}`,
    TAGLINE,
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
 * Build the Instagram caption. Link is NOT clickable in IG captions, so we
 * include it as plain text plus a short "link in bio" hint. Hashtag-rich.
 */
const buildInstagram = (signup: CaptionSignupInput): PlatformCaption => {
  const opener = cinematicOpener(signup);
  const lines = [
    categoryLine(signup),
    menuLine(signup),
  ].filter(Boolean);
  const link = profileLink(signup);
  const hashtags = hashtagsFor(signup);

  const body = [
    opener,
    lines.join(" "),
    `${TAGLINE} ${link}`,
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
 * Build the X (Twitter) caption — single sentence under 280 chars, link
 * counts as 23 chars regardless of actual length.
 */
const buildX = (signup: CaptionSignupInput): PlatformCaption => {
  const link = profileLink(signup);
  const hashtags = hashtagsFor(signup).slice(0, 2); // X favors fewer
  const opener = cinematicOpener(signup);

  // Try richer first, then progressively trim if over the limit.
  // X effective length: full text minus actual link length plus 23.
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
    `${opener} ${TAGLINE} ${link} ${hashtags.join(" ")}`.trim(),
    `${opener} ${link} ${hashtags.join(" ")}`.trim(),
    `${opener} ${link}`.trim(),
    // Final fallback: shortest possible
    `${String(signup.displayName || "New on MealScout").trim()} is now on MealScout. ${link}`.trim(),
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

/**
 * Public API: returns all three platform captions for a signup. Caller picks
 * which to display / post.
 */
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
