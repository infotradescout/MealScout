import { spawn } from "node:child_process";
import express from "express";
import { guardUnauthenticatedProtectedHtml } from "../server/seo/protectedHtmlRoutes.ts";

const MARKETING_TITLE = "MealScout | Discover Local Food Near You";

const app = express();
app.use(guardUnauthenticatedProtectedHtml);
app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /admin\nDisallow: /dashboard\n");
});
app.use("*", (_req, res) => {
  res.status(200).type("html").send(
    `<!DOCTYPE html><html><head><title>${MARKETING_TITLE}</title></head><body><div id="root"></div></body></html>`,
  );
});

const server = app.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    PUBLIC_DISCOVERY_LIVE: "1",
    PUBLIC_DISCOVERY_BASE_URL: base,
    PUBLIC_DISCOVERY_LIVE_SITEMAP: "0",
  };
  const child = spawn(
    "npx",
    ["--yes", "tsx", "scripts/public-discovery-contract-v1.contract.test.ts"],
    { stdio: "inherit", env, shell: true },
  );
  child.on("exit", (code) => {
    server.close();
    process.exit(code ?? 1);
  });
});
