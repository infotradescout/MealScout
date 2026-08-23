import type { RequestHandler } from "express";
import { sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { toPublicRestaurantListingWithVisibility } from "../publicProfiles/toPublicRestaurantListingWithVisibility";
import { deriveProfileEvidenceQuarantineVisibility } from "./profileEvidenceQuarantine";

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
      and u.is_disabled = false
      and r.is_active = true
    limit 2
  `);
  const rows = result.rows as CustomDomainRow[];
  if (rows.length !== 1) return null;

  const restaurantId = String(rows[0].restaurant_id);
  const restaurant = await storage.getRestaurant(restaurantId);
  const publicListing = restaurant
    ? await toPublicRestaurantListingWithVisibility(restaurant)
    : null;
  if (
    !(publicListing as any)?.id ||
    deriveProfileEvidenceQuarantineVisibility(restaurant).isQuarantined
  ) {
    return null;
  }

  return {
    restaurantId,
    canonicalPath: `/restaurant/${encodeURIComponent(
      restaurantId,
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

    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, resolved.canonicalPath);
  } catch (error) {
    console.error("[custom-profile-domain] resolution failed:", error);
    return next();
  }
};
