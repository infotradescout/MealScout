import assert from "node:assert/strict";
import test from "node:test";

import {
  isIsolatedDeployment,
  isIsolatedSitemapPath,
} from "../server/seo/previewIsolation";

test("explicit preview isolation protects the disposable Render service", () => {
  assert.equal(
    isIsolatedDeployment({ MEALSCOUT_PREVIEW_NOINDEX: "true" }),
    true,
  );
});

test("Vercel preview deployments are isolated by trusted platform state", () => {
  assert.equal(isIsolatedDeployment({ VERCEL_ENV: "preview" }), true);
});

test("production remains indexable, including verified custom domains", () => {
  assert.equal(
    isIsolatedDeployment({
      MEALSCOUT_PREVIEW_NOINDEX: "false",
      VERCEL_ENV: "production",
    }),
    false,
  );
  assert.equal(isIsolatedDeployment({}), false);
});

test("all XML sitemap routes are blocked for isolated deployments", () => {
  assert.equal(isIsolatedSitemapPath("/sitemap.xml"), true);
  assert.equal(isIsolatedSitemapPath("/sitemap-trucks.xml"), true);
  assert.equal(isIsolatedSitemapPath("/sitemap-time-pages.xml"), true);
  assert.equal(isIsolatedSitemapPath("/robots.txt"), false);
  assert.equal(isIsolatedSitemapPath("/sitemap"), false);
});

console.log("mealscout-preview-sitemap-isolation.contract: PASS");
