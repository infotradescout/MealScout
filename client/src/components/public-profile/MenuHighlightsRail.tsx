/**
 * MenuHighlightsRail
 *
 * A horizontally scrolling rail of menu item highlights — the "what should I order?"
 * answer at a glance. Surfaces featured items first, then community-recommended items,
 * then priced items. Personalized items (user favorites) are promoted to the front
 * when a userFavoriteItemNames set is provided.
 *
 * Renders nothing when there are no displayable items.
 */
import type { PublicMenuSection, PublicMenuItem } from "@shared/publicProfiles";
import { Heart } from "lucide-react";
import { getDishCategoryPhoto } from "@/lib/dishCategoryPhoto";

type MenuHighlightsRailProps = {
  menuSections: PublicMenuSection[];
  featuredMenuItems?: string[];
  /** Names of items the current user has previously favorited/recommended */
  userFavoriteItemNames?: Set<string>;
  maxItems?: number;
};

function scoreItem(
  item: PublicMenuItem,
  featuredNames: Set<string>,
  userFavoriteNames: Set<string>,
): number {
  let score = 0;
  if (userFavoriteNames.has(item.name.toLowerCase())) score += 100;
  if (item.featured) score += 50;
  if (featuredNames.has(item.name.toLowerCase())) score += 40;
  if (item.imageUrl) score += 20;
  if (item.priceLabel) score += 10;
  if (item.description) score += 5;
  return score;
}

export function MenuHighlightsRail({
  menuSections,
  featuredMenuItems = [],
  userFavoriteItemNames = new Set(),
  maxItems = 8,
}: MenuHighlightsRailProps) {
  const sections = Array.isArray(menuSections) ? menuSections : [];
  const featuredNames = new Set(
    (featuredMenuItems ?? []).map((n) => String(n || "").toLowerCase().trim()),
  );
  const userFavNamesNorm = new Set(
    [...userFavoriteItemNames].map((n) => n.toLowerCase().trim()),
  );

  // Flatten all items, deduplicate by name, score and sort
  const seen = new Set<string>();
  const allItems: PublicMenuItem[] = [];
  for (const section of sections) {
    for (const item of section.items ?? []) {
      const key = String(item.name || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      allItems.push(item);
    }
  }

  const ranked = allItems
    .sort((a, b) => scoreItem(b, featuredNames, userFavNamesNorm) - scoreItem(a, featuredNames, userFavNamesNorm))
    .slice(0, maxItems);

  if (ranked.length === 0) return null;

  return (
    <section aria-label="Menu highlights" className="space-y-3">
      <div className="flex items-center justify-between px-0">
        <p className="profile-section-label">
          Menu highlights
        </p>
      </div>

      {/* Horizontal scroll container — no page-level overflow */}
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4">
        {ranked.map((item, i) => {
          const isUserFav = userFavNamesNorm.has(item.name.toLowerCase().trim());
          const isFeatured = item.featured || featuredNames.has(item.name.toLowerCase().trim());
          const categoryPhoto = item.imageUrl
            ? null
            : getDishCategoryPhoto(item.name, item.description);

          return (
            <div
              key={`${item.name}:${i}`}
              className="profile-surface flex-none w-40 overflow-hidden rounded-2xl"
            >
              {/* Image or gradient placeholder */}
              <div className="relative h-28 w-full overflow-hidden bg-gradient-to-br from-orange-100 to-amber-50">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : categoryPhoto ? (
                  <img
                    src={categoryPhoto.image}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    aria-hidden="true"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(244,81,44,0.22),transparent_55%)]" />
                )}
                {/* Badges */}
                <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
                  {isUserFav && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-500/90 px-1.5 py-0.5 text-[9px] font-bold text-black">
                      <Heart className="h-2.5 w-2.5 fill-current" />
                      Saved
                    </span>
                  )}
                  {!isUserFav && isFeatured && (
                    <span className="inline-flex rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-semibold text-[#4a2719] shadow-sm">
                      Featured
                    </span>
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="p-2.5 space-y-0.5">
                <p className="line-clamp-2 text-xs font-bold leading-snug text-[color:var(--profile-ink)]">
                  {item.name}
                </p>
                {item.priceLabel ? (
                  <p className="text-[11px] font-bold text-[#b93619]">{item.priceLabel}</p>
                ) : null}
                {item.description && !item.priceLabel ? (
                  <p className="line-clamp-2 text-[10px] text-[color:var(--profile-muted)]">{item.description}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
