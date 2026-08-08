type HeaderValue = string | string[] | undefined;

export type PreviewIsolationRequest = {
  headers?: {
    host?: HeaderValue;
    "x-forwarded-host"?: HeaderValue;
  };
  hostname?: string;
};

const canonicalPublicHosts = new Set(["mealscout.us", "www.mealscout.us"]);
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

const firstHeaderValue = (value: HeaderValue): string => {
  const first = Array.isArray(value) ? value[0] : value;
  return String(first || "").split(",", 1)[0].trim();
};

export const normalizeRequestHost = (value: unknown): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    return new URL(`http://${raw}`).hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "");
  } catch {
    return raw.toLowerCase().replace(/^\[|\]$/g, "").split(":", 1)[0];
  }
};

export const requestHost = (req: PreviewIsolationRequest): string =>
  normalizeRequestHost(
    firstHeaderValue(req.headers?.["x-forwarded-host"]) ||
      firstHeaderValue(req.headers?.host) ||
      req.hostname,
  );

export const isCanonicalPublicHost = (host: unknown): boolean =>
  canonicalPublicHosts.has(normalizeRequestHost(host));

export const isIsolatedDeploymentRequest = (
  req: PreviewIsolationRequest,
): boolean => {
  const host = requestHost(req);
  if (!host || localHosts.has(host) || isCanonicalPublicHost(host)) return false;
  return true;
};

export const isIsolatedSitemapPath = (pathValue: unknown): boolean =>
  /^\/sitemap(?:-[^/]+)?\.xml$/i.test(String(pathValue || ""));
