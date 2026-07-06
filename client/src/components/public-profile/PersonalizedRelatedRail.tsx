/**
 * PersonalizedRelatedRail
 *
 * A horizontally scrolling discovery rail at the bottom of the profile.
 * Shows nearby or related businesses. When user context is available
 * (favorites, follows), it prioritizes businesses the user has interacted with.
 *
 * Falls back to a simple city-level discovery link set when no related data exists.
 * Renders nothing if city is unknown.
 */
import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import { MapPin } from "lucide-react";

type RelatedBusiness = {
  id: string;
  name: string;
  profileType?: string | null;
  cuisineType?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  imageUrl?: string | null;
  profilePath?: string | null;
  city?: string | null;
};

type PersonalizedRelatedRailProps = {
  profile: PublicRestaurantProfile & { city?: string | null };
  relatedBusinesses?: RelatedBusiness[];
  citySlug?: string | null;
  /** IDs the current user has favorited — used to promote those entries */
  userFavoriteIds?: Set<string>;
};

function typeLabel(profileType: string | null | undefined): string {
  const t = String(profileType || "").toLowerCase();
  if (t === "truck" || t === "food_truck") return "Food truck";
  if (t === "bar") return "Bar";
  if (t === "restaurant") return "Restaurant";
  return "";
}

function initialsFor(name: string): string {
  return String(name || "MS")
    .split(" ")
    .map((p) => p[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function PersonalizedRelatedRail({
  profile,
  relatedBusinesses = [],
  citySlug,
  userFavoriteIds = new Set(),
}: PersonalizedRelatedRailProps) {
  const city = String(profile.city || "").trim();
  if (!city && relatedBusinesses.length === 0) return null;

  // Sort: user favorites first, then by name
  const sorted = [...relatedBusinesses].sort((a, b) => {
    const aFav = userFavoriteIds.has(a.id) ? 1 : 0;
    const bFav = userFavoriteIds.has(b.id) ? 1 : 0;
    return bFav - aFav;
  });

  return (
    <section aria-label="Discover more nearby" className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
          {city ? `More in ${city}` : "Discover more"}
        </p>
        {citySlug ? (
          <a
            href={`/food-trucks-today/${encodeURIComponent(citySlug)}`}
            className="text-xs font-semibold text-orange-300 hover:text-orange-200"
          >
            See all →
          </a>
        ) : null}
      </div>

      {sorted.length > 0 ? (
        /* Horizontal scroll rail */
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4">
          {sorted.slice(0, 8).map((biz) => {
            const href = biz.profilePath || `/truck/${biz.id}`;
            const isFav = userFavoriteIds.has(biz.id);
            const imgSrc = biz.logoUrl || biz.coverImageUrl || biz.imageUrl || null;

            return (
              <a
                key={biz.id}
                href={href}
                className="flex-none w-28 space-y-1.5 group"
              >
                {/* Avatar */}
                <div className="relative h-20 w-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1d110a] to-[#0d0a08]">
                  {imgSrc ? (
                    <img
                      src={imgSrc}
                      alt={biz.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="text-lg font-black text-orange-100/60">
                        {initialsFor(biz.name)}
                      </span>
                    </div>
                  )}
                  {isFav ? (
                    <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-rose-400" />
                  ) : null}
                </div>

                {/* Name + type */}
                <div>
                  <p className="text-xs font-semibold text-white/85 line-clamp-2 leading-snug">
                    {biz.name}
                  </p>
                  {biz.profileType ? (
                    <p className="text-[10px] text-white/40">{typeLabel(biz.profileType)}</p>
                  ) : null}
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        /* Fallback: city-level discovery links */
        <div className="grid grid-cols-2 gap-2">
          <a
            href="/scout"
            className="rounded-xl border border-white/10 bg-[#0f0d0b] px-3 py-2.5 text-sm text-white/80 hover:bg-white/5"
          >
            Open Scout
          </a>
          {citySlug ? (
            <a
              href={`/food-trucks-today/${encodeURIComponent(citySlug)}`}
              className="rounded-xl border border-white/10 bg-[#0f0d0b] px-3 py-2.5 text-sm text-white/80 hover:bg-white/5"
            >
              Food trucks today
            </a>
          ) : null}
          <a
            href="/claim-business"
            className="rounded-xl border border-white/10 bg-[#0f0d0b] px-3 py-2.5 text-sm text-white/80 hover:bg-white/5"
          >
            Claim a business
          </a>
          <a
            href="/restaurant-signup?businessType=food_truck"
            className="rounded-xl border border-white/10 bg-[#0f0d0b] px-3 py-2.5 text-sm text-white/80 hover:bg-white/5"
          >
            List a truck
          </a>
        </div>
      )}
    </section>
  );
}
