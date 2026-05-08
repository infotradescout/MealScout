const DEFAULT_FACEBOOK_PAGE_URL = "https://www.facebook.com/mealscout";
const DEFAULT_TWITTER_URL = "https://twitter.com/mealscout";

const clean = (value: string | null | undefined) => String(value || "").trim();

const escapeAttr = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizeUrl = (value: string, fallback: string) => {
  const candidate = clean(value);
  if (!candidate) return fallback;
  try {
    const withProtocol = /^[a-z]+:\/\//i.test(candidate)
      ? candidate
      : `https://${candidate}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fallback;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
};

export const getOfficialFacebookPageUrl = () =>
  normalizeUrl(
    process.env.MEALSCOUT_FACEBOOK_PAGE_URL || process.env.FACEBOOK_PAGE_URL || "",
    DEFAULT_FACEBOOK_PAGE_URL,
  );

export const getOfficialSocialProfiles = () => {
  const profiles = [
    getOfficialFacebookPageUrl(),
    normalizeUrl(process.env.MEALSCOUT_TWITTER_URL || "", DEFAULT_TWITTER_URL),
  ];
  return Array.from(new Set(profiles.filter(Boolean)));
};

export const buildOfficialSocialEntityMetaTags = () => {
  const facebookPageUrl = getOfficialFacebookPageUrl();
  const facebookPageId = clean(
    process.env.MEALSCOUT_FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID,
  );
  const facebookAppId = clean(process.env.FACEBOOK_APP_ID);

  const tags = [
    `<meta property="article:publisher" content="${escapeAttr(facebookPageUrl)}" />`,
    `<meta property="og:see_also" content="${escapeAttr(facebookPageUrl)}" />`,
    `<link rel="me" href="${escapeAttr(facebookPageUrl)}" />`,
  ];

  if (facebookPageId) {
    tags.push(
      `<meta property="fb:pages" content="${escapeAttr(facebookPageId)}" />`,
    );
  }

  if (facebookAppId) {
    tags.push(
      `<meta property="fb:app_id" content="${escapeAttr(facebookAppId)}" />`,
    );
  }

  return tags.join("\n  ");
};

export const injectOfficialSocialEntityMeta = (html: string) => {
  const marker = "<!-- MEALSCOUT_OFFICIAL_SOCIAL_ENTITY -->";
  const tags = buildOfficialSocialEntityMetaTags();

  if (html.includes(marker)) {
    return html.replace(marker, tags);
  }

  if (html.includes('property="article:publisher"')) {
    return html;
  }

  return html.replace("</head>", `  ${tags}\n</head>`);
};
