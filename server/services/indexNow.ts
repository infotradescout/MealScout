type IndexNowSubmitResult = {
  ok: boolean;
  status: number;
  provider: string;
  submitted: number;
  body?: string;
};

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

export function getIndexNowConfig() {
  const enabled =
    String(process.env.INDEXNOW_ENABLED || "").toLowerCase() === "true";
  const key = String(process.env.INDEXNOW_KEY || "").trim();
  const host = String(
    process.env.INDEXNOW_HOST || process.env.SITEMAP_SITE_URL || "www.mealscout.us",
  )
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  const keyLocation = String(process.env.INDEXNOW_KEY_LOCATION || "").trim();

  return {
    enabled,
    key,
    host,
    keyLocation:
      keyLocation ||
      (key ? `https://${host}/${encodeURIComponent(key)}.txt` : ""),
  };
}

export async function submitIndexNowUrls(
  urls: string[],
): Promise<IndexNowSubmitResult> {
  const config = getIndexNowConfig();
  if (!config.enabled) {
    return {
      ok: false,
      status: 400,
      provider: "IndexNow",
      submitted: 0,
      body: "INDEXNOW_ENABLED is false",
    };
  }
  if (!config.key || !config.host) {
    return {
      ok: false,
      status: 400,
      provider: "IndexNow",
      submitted: 0,
      body: "Missing INDEXNOW_KEY or INDEXNOW_HOST",
    };
  }

  const deduped = Array.from(
    new Set(
      urls
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .slice(0, 10000),
    ),
  );

  if (deduped.length === 0) {
    return {
      ok: false,
      status: 400,
      provider: "IndexNow",
      submitted: 0,
      body: "No URLs provided",
    };
  }

  const payload = {
    host: config.host,
    key: config.key,
    keyLocation: config.keyLocation,
    urlList: deduped,
  };

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text().catch(() => "");
  return {
    ok: response.ok,
    status: response.status,
    provider: "IndexNow",
    submitted: deduped.length,
    body: bodyText || undefined,
  };
}

