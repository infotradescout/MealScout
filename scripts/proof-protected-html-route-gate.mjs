/**
 * Local proof harness: mount only the protected HTML gate and assert
 * unauthenticated /admin + /dashboard responses are not the marketing shell.
 */
import express from "express";
import { guardUnauthenticatedProtectedHtml } from "../server/seo/protectedHtmlRoutes.ts";

const MARKETING_TITLE = "MealScout | Discover Local Food Near You";

const app = express();
app.use(guardUnauthenticatedProtectedHtml);
app.use("*", (_req, res) => {
  res
    .status(200)
    .type("html")
    .send(`<!DOCTYPE html><html><head><title>${MARKETING_TITLE}</title>
<script type="application/ld+json">{"@type":"Organization","description":"Discover food trucks"}</script>
</head><body><div id="root"></div><h1>Discover local food near you</h1></body></html>`);
});

const server = app.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const failures = [];

  for (const path of ["/admin", "/dashboard", "/vendor-dashboard", "/supplier-portal"]) {
    const res = await fetch(`${base}${path}`, {
      headers: { Accept: "text/html", "user-agent": "Mozilla/5.0" },
    });
    const text = await res.text();
    if (res.status !== 401) failures.push(`${path}: expected 401, got ${res.status}`);
    if (text.includes(MARKETING_TITLE)) failures.push(`${path}: marketing title leaked`);
    if (/application\/ld\+json/i.test(text)) failures.push(`${path}: JSON-LD leaked`);
    if (!/noindex/i.test(text)) failures.push(`${path}: missing noindex`);
    if (!/Sign in required/i.test(text)) failures.push(`${path}: missing interstitial`);
  }

  // Authenticated path continues to SPA/marketing handler (contract: must not break).
  const authedApp = express();
  authedApp.use((req, _res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: "proof-user" };
    next();
  });
  authedApp.use(guardUnauthenticatedProtectedHtml);
  authedApp.use("*", (_req, res) => {
    res.status(200).type("html").send("<!DOCTYPE html><title>authed-spa</title><div id='root'></div>");
  });
  const authedServer = authedApp.listen(0, "127.0.0.1", async () => {
    const authedPort = authedServer.address().port;
    const authedRes = await fetch(`http://127.0.0.1:${authedPort}/admin`, {
      headers: { Accept: "text/html" },
    });
    const authedText = await authedRes.text();
    if (authedRes.status !== 200 || !authedText.includes("authed-spa")) {
      failures.push("authenticated /admin must fall through to SPA handler");
    }

    server.close();
    authedServer.close();

    if (failures.length) {
      console.error("proof-protected-html-route-gate: FAIL");
      for (const f of failures) console.error(" -", f);
      process.exit(1);
    }
    console.log("proof-protected-html-route-gate: PASS");
    console.log("  unauthenticated /admin,/dashboard,/vendor-dashboard,/supplier-portal -> 401 interstitial");
    console.log("  authenticated /admin -> SPA fallthrough OK");
  });
});
