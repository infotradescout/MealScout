import assert from "node:assert/strict";
import test from "node:test";

import {
  isCanonicalPublicHost,
  isIsolatedDeploymentRequest,
  isIsolatedSitemapPath,
  normalizeRequestHost,
  requestHost,
} from "../server/seo/previewIsolation";

const request = (host: string, forwardedHost?: string) => ({
  headers: {
    host,
    ...(forwardedHost ? { "x-forwarded-host": forwardedHost } : {}),
  },
});

test("canonical public hosts remain indexable", () => {
  assert.equal(isCanonicalPublicHost("www.mealscout.us:443"), true);
  assert.equal(isCanonicalPublicHost("mealscout.us"), true);
  assert.equal(isIsolatedDeploymentRequest(request("www.mealscout.us")), false);
});

test("local hosts do not become preview hosts during local tests", () => {
  assert.equal(normalizeRequestHost("127.0.0.1:5000"), "127.0.0.1");
  assert.equal(isIsolatedDeploymentRequest(request("127.0.0.1:5000")), false);
  assert.equal(isIsolatedDeploymentRequest(request("localhost:5000")), false);
});

test("noncanonical deployed hosts are isolated and honor forwarded host", () => {
  assert.equal(
    isIsolatedDeploymentRequest(
      request("mealscout-preview-60447b61.onrender.com"),
    ),
    true,
  );
  assert.equal(
    requestHost(
      request("internal-service.onrender.com", "mealscout-preview-60447b61.onrender.com"),
    ),
    "mealscout-preview-60447b61.onrender.com",
  );
  assert.equal(
    isIsolatedDeploymentRequest(
      request("internal-service.onrender.com", "mealscout-preview-60447b61.onrender.com"),
    ),
    true,
  );
});

test("all XML sitemap routes are blocked for isolated deployments", () => {
  assert.equal(isIsolatedSitemapPath("/sitemap.xml"), true);
  assert.equal(isIsolatedSitemapPath("/sitemap-trucks.xml"), true);
  assert.equal(isIsolatedSitemapPath("/sitemap-time-pages.xml"), true);
  assert.equal(isIsolatedSitemapPath("/robots.txt"), false);
  assert.equal(isIsolatedSitemapPath("/sitemap"), false);
});

console.log("mealscout-preview-sitemap-isolation.contract: PASS");
