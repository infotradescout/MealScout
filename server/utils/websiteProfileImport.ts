import dns from "dns/promises";
import net from "net";
import * as http from "node:http";
import * as https from "node:https";
import * as cheerio from "cheerio";

const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3MB is plenty for an HTML document
const USER_AGENT = "MealScoutLinkImport/1.0 (+https://www.mealscout.us)";

export class WebsiteImportError extends Error {}

// Keep IPv4 and IPv6 ranges in separate blocklists. Node normalizes IPv4
// addresses to IPv4-mapped IPv6 values when a BlockList contains IPv6 rules,
// so combining these lists makes the ::ffff:0:0/96 rule match every IPv4
// address, including public ones.
const blockedIpv4Addresses = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}
const blockedIpv6Addresses = new net.BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export function isBlockedIp(ip: string): boolean {
  const family = net.isIPv4(ip) ? "ipv4" : net.isIPv6(ip) ? "ipv6" : null;
  if (family === "ipv4") return blockedIpv4Addresses.check(ip, "ipv4");
  if (family === "ipv6") return blockedIpv6Addresses.check(ip, "ipv6");
  return true;
}

export async function resolvePublicHostname(hostname: string) {
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
  return records;
}

export async function assertPublicHostname(hostname: string): Promise<void> {
  await resolvePublicHostname(hostname);
}

type PinnedHtmlHop = { redirectUrl: string } | { html: string };

function requestPinnedHtml(
  parsed: URL,
  address: string,
  family: number,
): Promise<PinnedHtmlHop> {
  return new Promise((resolve, reject) => {
    const transport = parsed.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        protocol: parsed.protocol,
        hostname: address,
        family,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        servername: parsed.protocol === "https:" ? parsed.hostname : undefined,
        rejectUnauthorized: true,
        headers: {
          Host: parsed.host,
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": USER_AGENT,
          Connection: "close",
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) {
          const location = response.headers.location;
          response.resume();
          if (!location) {
            reject(new WebsiteImportError("Couldn't reach that website."));
            return;
          }
          resolve({ redirectUrl: new URL(location, parsed).toString() });
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new WebsiteImportError("Couldn't reach that website."));
          return;
        }

        const contentType = String(response.headers["content-type"] || "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (
          contentType !== "text/html" &&
          contentType !== "application/xhtml+xml"
        ) {
          response.resume();
          reject(
            new WebsiteImportError(
              "That link doesn't look like a website page.",
            ),
          );
          return;
        }

        const declaredBytes = Number(response.headers["content-length"] || 0);
        if (declaredBytes > MAX_RESPONSE_BYTES) {
          response.resume();
          reject(new WebsiteImportError("That page is too large to read."));
          return;
        }

        const chunks: Buffer[] = [];
        let byteLength = 0;
        response.on("data", (chunk: Buffer | Uint8Array) => {
          const buffer = Buffer.from(chunk);
          byteLength += buffer.byteLength;
          if (byteLength > MAX_RESPONSE_BYTES) {
            response.destroy(
              new WebsiteImportError("That page is too large to read."),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          resolve({ html: Buffer.concat(chunks).toString("utf8") });
        });
        response.on("error", reject);
      },
    );
    request.setTimeout(FETCH_TIMEOUT_MS, () => {
      request.destroy(new WebsiteImportError("Couldn't reach that website."));
    });
    request.on("error", reject);
    request.end();
  });
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
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      throw new WebsiteImportError("Enter a valid website link.");
    }

    const records = await resolvePublicHostname(parsed.hostname);
    let hop: PinnedHtmlHop | null = null;
    let lastError: unknown = null;
    for (const record of records.slice(0, 4)) {
      try {
        hop = await requestPinnedHtml(
          parsed,
          record.address,
          record.family,
        );
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!hop) {
      if (lastError instanceof WebsiteImportError) throw lastError;
      throw new WebsiteImportError("Couldn't reach that website.");
    }
    if ("redirectUrl" in hop) {
      if (redirects === MAX_REDIRECTS) {
        throw new WebsiteImportError("That link redirects too many times.");
      }
      currentUrl = hop.redirectUrl;
      continue;
    }
    return hop.html;
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
    (t) =>
      typeof t === "string" && RESTAURANT_JSONLD_TYPES.has(t.toLowerCase()),
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
