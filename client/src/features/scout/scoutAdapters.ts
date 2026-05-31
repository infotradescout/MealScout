import type { ScoutSceneItem } from "./scoutTypes";

function toMiles(value?: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function slugify(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function truckProfilePath(truck: any): string | null {
  const id = String(truck?.id || "").trim();
  if (!id) return null;
  const slug = slugify(truck?.slug || truck?.name || "");
  return slug ? `/p/truck/${id}/${slug}` : `/p/truck/${id}`;
}

export function adaptRestaurantToSceneItem(restaurant: any): ScoutSceneItem {
  return {
    id: `restaurant-${String(restaurant?.id ?? "")}`,
    type: "restaurant",
    entityId: String(restaurant?.id ?? ""),
    title: restaurant?.businessName || restaurant?.name || "Local spot",
    subtitle: restaurant?.cuisineType || null,
    imageUrl: restaurant?.coverImageUrl || restaurant?.heroImageUrl || restaurant?.imageUrl || restaurant?.logoUrl || null,
    href: restaurant?.id ? `/restaurant/${restaurant.id}` : null,
    distanceMiles: toMiles(restaurant?.distanceMiles),
  };
}

export function adaptTruckToSceneItem(truck: any): ScoutSceneItem {
  return {
    id: `truck-${String(truck?.id ?? "")}`,
    type: "food_truck",
    entityId: String(truck?.id ?? ""),
    title: truck?.name || "Food truck",
    subtitle: truck?.cuisineType || null,
    imageUrl: truck?.heroImageUrl || truck?.coverImageUrl || truck?.imageUrl || truck?.logoUrl || null,
    href: truckProfilePath(truck),
    distanceMiles: toMiles(truck?.distanceMiles),
  };
}

export function adaptDealToSceneItem(deal: any): ScoutSceneItem {
  return {
    id: `deal-${String(deal?.id ?? "")}`,
    type: "deal",
    entityId: String(deal?.id ?? ""),
    title: deal?.title || "Deal today",
    subtitle: deal?.restaurantName || deal?.description || null,
    imageUrl: deal?.imageUrl || null,
    href: deal?.id ? `/deals/${deal.id}` : "/deals",
  };
}

export function adaptEventToSceneItem(event: any): ScoutSceneItem {
  return {
    id: `event-${String(event?.id ?? "")}`,
    type: "event",
    entityId: String(event?.id ?? ""),
    title: event?.title || event?.name || "Event",
    subtitle: event?.venueName || event?.locationName || null,
    imageUrl: event?.heroImageUrl || event?.imageUrl || null,
    href: event?.id ? `/events/${event.id}` : "/events",
  };
}

export function adaptMenuItemToSceneItem(menuItem: any): ScoutSceneItem {
  return {
    id: `menu-${String(menuItem?.id ?? "")}`,
    type: "menu_item",
    entityId: String(menuItem?.id ?? ""),
    title: menuItem?.name || "Menu item",
    subtitle: menuItem?.restaurantName || menuItem?.description || null,
    imageUrl: menuItem?.imageUrl || null,
    href: menuItem?.restaurantId ? `/restaurant/${menuItem.restaurantId}` : null,
    distanceMiles: toMiles(menuItem?.distanceMiles),
  };
}

export function adaptCommunityRecordToSceneItem(record: any): ScoutSceneItem {
  return {
    id: `community-${String(record?.id ?? record?.restaurantId ?? "")}`,
    type: "community",
    entityId: String(record?.restaurantId ?? record?.id ?? ""),
    title: record?.businessName || record?.name || "Community spot",
    subtitle: record?.reason || null,
    imageUrl: record?.coverImageUrl || record?.imageUrl || record?.logoUrl || null,
    href: record?.restaurantId ? `/restaurant/${record.restaurantId}` : record?.id ? `/restaurant/${record.id}` : null,
    distanceMiles: toMiles(record?.distanceMiles),
  };
}
