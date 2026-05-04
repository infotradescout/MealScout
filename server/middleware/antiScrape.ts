import { Request, Response, NextFunction } from 'express';

// Allow TradeScout crawler and common browsers; block obvious scrapers
const allowedBots = ['TradeScout', 'tradescout'];
const allowedBrowsers = ['Chrome', 'Firefox', 'Safari', 'Edge', 'OPR', 'Brave'];
const bannedSignatures = ['curl', 'python', 'wget', 'httpclient', 'libwww', 'scrapy', 'postman'];
const knownSearchOrLlmBots =
  /(googlebot|google-inspectiontool|bingbot|bingpreview|adidxbot|duckduckbot|applebot|facebookexternalhit|facebot|facebookbot|meta-externalagent|meta-externalfetcher|linkedinbot|gptbot|oai-searchbot|chatgpt-user|claudebot|anthropic-ai|perplexitybot|bytespider|ccbot|cohere-ai)/i;

const isSeoCriticalPath = (path: string) => {
  const value = String(path || "").toLowerCase();
  const indexNowKey = String(process.env.INDEXNOW_KEY || "")
    .trim()
    .toLowerCase();
  const indexNowKeyPath = indexNowKey ? `/${indexNowKey}.txt` : "";
  return (
    value === "/robots.txt" ||
    value === "/llms.txt" ||
    value === "/.well-known/llms.txt" ||
    value === "/ai.txt" ||
    value === "/.well-known/ai.txt" ||
    value === "/ai-summary.json" ||
    value === "/.well-known/ai-summary.json" ||
    value === "/meal-scout.json" ||
    value === "/meta.json" ||
    value === "/answers/mealscout" ||
    value === "/answers/mealscout.txt" ||
    value === "/opensearch.xml" ||
    value === "/.well-known/opensearch.xml" ||
    (indexNowKeyPath && value === indexNowKeyPath) ||
    value === "/sitemap.xml" ||
    /^\/sitemap[\w-]*\.xml$/.test(value)
  );
};

export function antiScrape(req: Request, res: Response, next: NextFunction) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();

  if (isSeoCriticalPath(req.path || req.url || "")) return next();

  // Always allow API routes that require auth
  if (req.path.startsWith('/api/')) return next();

  // Allow known browser UAs
  const isBrowser = allowedBrowsers.some((b) => ua.includes(b.toLowerCase()));

  // Allow TradeScout crawler explicitly
  const isTradeScout = allowedBots.some((b) => ua.includes(b.toLowerCase()));
  const isKnownCrawler = knownSearchOrLlmBots.test(ua);

  // Block obvious scraper signatures
  const isBanned = bannedSignatures.some((b) => ua.includes(b));

  if (isTradeScout || isKnownCrawler) return next();
  if (isBanned && !isBrowser) {
    return res.status(403).send('Scraping is not permitted.');
  }

  // Allow indexing for legitimate browsers and bots; do not set noindex
  // Keep middleware as a guard without blocking search engines
  return next();
}
