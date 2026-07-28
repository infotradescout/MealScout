import type { RequestHandler } from "express";
import { sql } from "drizzle-orm";

import { db } from "../db";

const PLATFORM_HOSTS = new Set([
  "mealscout.us",
  "www.mealscout.us",
  "app.mealscout.us",
  "localhost",
  "127.0.0.1",
]);

export const normalizeCustomProfileHostname = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");

export const isMealScoutPlatformHostname = (value: unknown) => {
  const hostname = normalizeCustomProfileHostname(value);
  return (
    PLATFORM_HOSTS.has(hostname) ||
    hostname.endsWith(".mealscout.us")
  );
};

type CustomDomainRow = {
  restaurant_id: string;
};

export async function resolveCustomProfileDomain(hostnameValue: unknown) {
  const hostname = normalizeCustomProfileHostname(hostnameValue);
  if (!hostname || isMealScoutPlatformHostname(hostname)) return null;

  const result = await db.execute(sql`
    select r.id as restaurant_id
    from users u
    join restaurants r
      on r.id::text = u.account_settings->'customDomain'->>'restaurantId'
    where lower(regexp_replace(
      u.account_settings->'customDomain'->>'hostname',
      '^www\\.',
      ''
    )) = ${hostname}
      and u.account_settings->'customDomain'->>'status' = 'verified'
      and r.owner_id = u.id
      and r.is_active = true
    limit 2
  `);
  const rows = result.rows as CustomDomainRow[];
  if (rows.length !== 1) return null;

  return {
    restaurantId: String(rows[0].restaurant_id),
    canonicalPath: `/restaurant/${encodeURIComponent(
      String(rows[0].restaurant_id),
    )}`,
  };
}

export const customProfileDomainRootRedirect: RequestHandler = async (
  req,
  res,
  next,
) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path !== "/") return next();
  if (!(req.get("accept") || "").includes("text/html")) return next();

  try {
    const resolved = await resolveCustomProfileDomain(req.hostname);
    if (!resolved) return next();

    res.setHeader("Cache-Control", "public, max-age=60");
    return res.redirect(302, resolved.canonicalPath);
  } catch (error) {
    console.error("[custom-profile-domain] resolution failed:", error);
    return next();
  }
};
