import dns from "dns/promises";
import net from "net";
import * as cheerio from "cheerio";

const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3MB is plenty for an HTML document
const USER_AGENT = "MealScoutLinkImport/1.0 (+https://www.mealscout.us)";

export class WebsiteImportError extends Error {}

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 0) return true; // "this" network
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true; // loopback
    if (normalized.startsWith("fe80:")) return true; // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.split("::ffff:")[1];
      if (mapped && net.isIPv4(mapped)) return isBlockedIp(mapped);
    }
    return false;
  }
  return true; // unrecognized format, refuse rather than guess
}

export async function assertPublicHostname(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local")) {
    throw new WebsiteImportError("That link isn't reachable.");
  }
  const records = await dns.lookup(hostname, { all: true }).catch(() => []);
  if (records.length === 0) {
    throw new WebsiteImportError("That link isn't reachable.");
  }
  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new WebsiteImportError("That link isn't reachable.");
    }
  }
}

async function fetchHtml(startUrl: string): Promise<string> {
  let currentUrl = startUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new WebsiteImportError("Enter a valid website link.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new WebsiteImportError("Enter a valid website link.");
    }

    await assertPublicHostname(parsed.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch {
      throw new WebsiteImportError("Couldn't reach that website.");
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new WebsiteImportError("Couldn't reach that website.");
      }
      currentUrl = new URL(location, parsed).toString();
      continue;
    }

    if (!response.ok) {
      throw new WebsiteImportError("Couldn't reach that website.");
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("html")) {
      throw new WebsiteImportError("That link doesn't look like a website page.");
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_RESPONSE_BYTES) {
      throw new WebsiteImportError("That page is too large to read.");
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new WebsiteImportError("Couldn't reach that website.");
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new WebsiteImportError("That page is too large to read.");
        }
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks).toString("utf-8");
  }

  throw new WebsiteImportError("That link redirects too many times.");
}

export type WebsiteProfileImportResult = {
  sourceUrl: string;
  name?: string;
  description?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  imageUrl?: string;
  instagramUrl?: string;
  facebookPageUrl?: string;
};

const RESTAURANT_JSONLD_TYPES = new Set([
  "restaurant",
  "localbusiness",
  "foodestablishment",
  "cafeorcoffeeshop",
  "bakery",
  "bar",
]);

function flattenJsonLd(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw.flatMap(flattenJsonLd);
  if (raw && typeof raw === "object") {
    const node = raw as Record<string, unknown>;
    if (Array.isArray(node["@graph"])) return flattenJsonLd(node["@graph"]);
    return [node];
  }
  return [];
}

function matchesRestaurantType(node: any): boolean {
  const type = node?.["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some(
    (t) => typeof t === "string" && RESTAURANT_JSONLD_TYPES.has(t.toLowerCase()),
  );
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max).trim() : trimmed;
}

// A site's <title>/og:title often appends a tagline or location after a
// separator (e.g. "Joe's Diner | Best BBQ in Austin"). Keep the first segment
// as the business name. Separators require surrounding whitespace so hyphenated
// names like "Chick-fil-A" are preserved.
function stripTitleSuffix(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const [first] = value.split(/\s+[|•·–—]\s+|\s+-\s+/);
  return (first || value).trim();
}

// Page titles frequently fall back to router/CMS placeholders that are not a
// real business name. Skip these so a better candidate (og:site_name, etc.) wins.
function isGenericName(value: string): boolean {
  return /^(home|homepage|welcome|untitled|not available|no title|index|menu|loading|page not found|404)$/i.test(
    value.trim(),
  );
}

export async function fetchWebsiteProfilePreview(
  url: string,
): Promise<WebsiteProfileImportResult> {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const result: WebsiteProfileImportResult = { sourceUrl: url };

  let businessNode: any = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (businessNode) return;
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw);
      const candidate = flattenJsonLd(parsed).find(matchesRestaurantType);
      if (candidate) businessNode = candidate;
    } catch {
      // Malformed JSON-LD on the page; ignore and fall back to meta tags.
    }
  });

  const sameAs: string[] = businessNode?.sameAs
    ? ([] as string[]).concat(businessNode.sameAs)
    : [];

  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogSiteName = $('meta[property="og:site_name"]').attr("content");
  const ogDescription = $('meta[property="og:description"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  const metaDescription = $('meta[name="description"]').attr("content");
  const pageTitle = $("title").first().text();

  // Prefer the authoritative JSON-LD name, then the owner-set og:site_name
  // (usually the clean brand on site builders), then the cleaned og:title or
  // page title. Skip placeholder titles like "Home" / "Not available".
  const nameCandidates = [
    businessNode?.name ? String(businessNode.name) : undefined,
    stripTitleSuffix(ogSiteName),
    stripTitleSuffix(ogTitle),
    stripTitleSuffix(pageTitle),
  ];
  const preferredName =
    nameCandidates.find((c) => c && !isGenericName(c)) ||
    nameCandidates.find((c) => !!c);
  result.name = truncate(preferredName, 120);
  result.description = truncate(
    businessNode?.description || ogDescription || metaDescription,
    500,
  );
  result.phone = truncate(businessNode?.telephone, 40);

  const address = businessNode?.address;
  if (address && typeof address === "object") {
    result.address = truncate(address.streetAddress, 120);
    result.city = truncate(address.addressLocality, 80);
    result.state = truncate(address.addressRegion, 40);
  }

  const image = businessNode?.image;
  result.imageUrl =
    truncate(typeof image === "string" ? image : image?.url, 500) ||
    truncate(ogImage, 500);

  const socialLinks = [...sameAs];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) socialLinks.push(href);
  });
  result.instagramUrl = socialLinks.find((link) =>
    /instagram\.com\//i.test(link),
  );
  result.facebookPageUrl = socialLinks.find((link) =>
    /facebook\.com\//i.test(link),
  );

  return result;
}
