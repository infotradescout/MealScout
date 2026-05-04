import type { Request } from "express";

const BOT_UA_PATTERN =
  /(bot|crawler|spider|slurp|preview|fetcher|scanner|googlebot|bingbot|bingpreview|adidxbot|duckduckbot|applebot|yandex|baiduspider|gptbot|oai-searchbot|chatgpt-user|claudebot|anthropic-ai|perplexitybot|bytespider|ccbot|cohere-ai|facebookexternalhit|facebot|facebookbot|meta-externalagent|meta-externalfetcher|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|pinterest|embedly|quora link preview)/i;

export const shouldServePrerender = (req: Request) => {
  const force = String(req.query?.prerender || "").toLowerCase();
  if (force === "1" || force === "true") return true;
  const ua = String(req.get("user-agent") || "");
  return BOT_UA_PATTERN.test(ua);
};
