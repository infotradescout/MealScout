type SmokeResult = {
  path: string;
  ok: boolean;
  status?: number;
  reason?: string;
};

const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000").replace(
  /\/$/,
  "",
);

const paths = [
  "/install",
  "/map",
  "/deal/test-deal-id",
  "/event/test-event-slug",
  "/menu/test-restaurant-id",
  "/checkout/test-restaurant-id",
];

function looksLikeHtml(body: string): boolean {
  const sample = body.slice(0, 400).toLowerCase();
  return sample.includes("<!doctype html") || sample.includes("<html");
}

async function probe(path: string): Promise<SmokeResult> {
  const url = `${baseUrl}${path}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/html" },
      redirect: "follow",
    });
    const body = await res.text();
    if (!res.ok) {
      return {
        path,
        ok: false,
        status: res.status,
        reason: `HTTP ${res.status}`,
      };
    }
    if (!looksLikeHtml(body)) {
      return {
        path,
        ok: false,
        status: res.status,
        reason: "Response was not HTML app shell",
      };
    }
    return { path, ok: true, status: res.status };
  } catch (err: any) {
    return {
      path,
      ok: false,
      reason: err?.message || String(err),
    };
  }
}

async function main() {
  console.log(`[mobile-smoke] base URL: ${baseUrl}`);
  const results = await Promise.all(paths.map((p) => probe(p)));
  const failures = results.filter((r) => !r.ok);

  for (const result of results) {
    if (result.ok) {
      console.log(`[PASS] ${result.path} (${result.status})`);
      continue;
    }
    const suffix = result.status ? ` (${result.status})` : "";
    console.error(`[FAIL] ${result.path}${suffix} - ${result.reason}`);
  }

  if (failures.length > 0) {
    console.error(
      `\nMobile deep-link smoke failed (${failures.length}/${results.length}).`,
    );
    process.exit(1);
  }

  console.log(`\nMobile deep-link smoke passed (${results.length} routes).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
