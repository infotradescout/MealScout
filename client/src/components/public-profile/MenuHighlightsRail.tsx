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
import type { PublicMenuSection, PublicMenuItem, PublicCta } from "@shared/publicProfiles";
import { ExternalLink, MenuSquare, ShoppingBag, Star } from "lucide-react";
import { ProfileSectionLabel, profileRailScrollerClass } from "./ProfileVisualPrimitives";

type MenuHighlightsRailProps = {
  menuSections: PublicMenuSection[];
  featuredMenuItems?: string[];
  /** Names of items the current user has previously favorited/recommended */
  userFavoriteItemNames?: Set<string>;
  safeCtas?: PublicCta[];
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
  safeCtas = [],
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

  const menuAction =
    safeCtas.find((cta) => cta.type === "order" && String(cta.href || "").trim()) ||
    safeCtas.find((cta) => cta.type === "menu" && String(cta.href || "").trim()) ||
    null;
  const menuActionLabel =
    menuAction?.type === "order" ? "Order online" : menuAction?.type === "menu" ? "View menu" : null;
  const MenuActionIcon = menuAction?.type === "order" ? ShoppingBag : MenuSquare;
  const menuActionIsExternal = Boolean(
    menuAction && /^https?:\/\//i.test(String(menuAction.href || "")),
  );

  return (
    <section aria-label="Menu highlights" className="space-y-3">
      <div className="flex items-center justify-between px-0">
        <ProfileSectionLabel>Menu highlights</ProfileSectionLabel>
      </div>

      {/* Horizontal scroll container — no page-level overflow */}
      <div className={`${profileRailScrollerClass} overflow-x-auto`}>
        {ranked.map((item, i) => {
          const isUserFav = userFavNamesNorm.has(item.name.toLowerCase().trim());
          const isFeatured = item.featured || featuredNames.has(item.name.toLowerCase().trim());

          return (
            <div
              key={`${item.name}:${i}`}
              className="flex w-[172px] flex-none snap-start flex-col overflow-hidden rounded-[1.15rem] border border-white/10 bg-[#100b08]/95 shadow-[0_16px_42px_rgba(0,0,0,0.36)] sm:w-[204px]"
            >
              {/* Image or gradient placeholder */}
              <div className="relative h-28 w-full overflow-hidden bg-gradient-to-br from-[#241108] to-[#0d0a08] sm:h-32">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(251,146,60,0.24),transparent_55%),linear-gradient(160deg,rgba(255,255,255,0.04),rgba(0,0,0,0.3))]" />
                )}
                {/* Badges */}
                <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
                  {isUserFav && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-500/90 px-1.5 py-0.5 text-[9px] font-bold text-black">
                      <Star className="h-2.5 w-2.5" />
                      Saved
                    </span>
                  )}
                  {!isUserFav && isFeatured && (
                    <span className="inline-flex rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-white/90">
                      Featured
                    </span>
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="flex flex-1 flex-col space-y-1 p-3">
                <p className="line-clamp-2 text-sm font-black leading-snug text-white">
                  {item.name}
                </p>
                {item.priceLabel ? (
                  <p className="text-sm font-black text-orange-200">{item.priceLabel}</p>
                ) : null}
                {item.description ? (
                  <p className="line-clamp-2 text-xs leading-snug text-white/55">{item.description}</p>
                ) : null}
                {menuAction && menuActionLabel ? (
                  <a
                    href={menuAction.href}
                    target={menuActionIsExternal ? "_blank" : undefined}
                    rel={menuActionIsExternal ? "noopener noreferrer" : undefined}
                    data-analytics-action={menuAction.type === "order" ? "order_click" : "menu_click"}
                    data-analytics-target-type="menu_highlight"
                    className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-orange-300/30 bg-orange-500/12 px-2.5 py-2 text-[11px] font-black uppercase tracking-[0.08em] text-orange-100 transition hover:bg-orange-500/18"
                  >
                    <MenuActionIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {menuActionLabel}
                    {menuActionIsExternal ? (
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    ) : null}
                  </a>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
