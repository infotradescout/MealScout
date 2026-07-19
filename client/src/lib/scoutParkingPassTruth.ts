export type ScoutParkingInventoryStatus = "available" | "scheduled" | null;

export type ScoutParkingPassInventory = {
  status?: string | null;
  hardCapEnabled?: boolean | null;
  maxTrucks?: number | null;
  spotCount?: number | null;
  bookedSpots?: number | null;
  availableSpotNumbers?: number[] | null;
  hostPriceCents?: number | null;
  breakfastPriceCents?: number | null;
  lunchPriceCents?: number | null;
  dinnerPriceCents?: number | null;
  dailyPriceCents?: number | null;
  weeklyPriceCents?: number | null;
  monthlyPriceCents?: number | null;
};

const unavailableStatuses = new Set([
  "archived",
  "cancelled",
  "canceled",
  "closed",
  "deleted",
  "draft",
  "expired",
  "inactive",
  "unavailable",
]);

export function hasVerifiedParkingPassPrice(
  listing: ScoutParkingPassInventory,
): boolean {
  return [
    listing.hostPriceCents,
    listing.breakfastPriceCents,
    listing.lunchPriceCents,
    listing.dinnerPriceCents,
    listing.dailyPriceCents,
    listing.weeklyPriceCents,
    listing.monthlyPriceCents,
  ].some((value) => Number.isFinite(Number(value)) && Number(value) > 0);
}

export function hasVerifiedParkingPassCapacity(
  listing: ScoutParkingPassInventory,
): boolean {
  // Explicit legacy no-cap inventory remains bookable. Newly synced inventory
  // is hard-capped by default on the server.
  if (!Boolean(listing.hardCapEnabled)) return true;
  if (Array.isArray(listing.availableSpotNumbers)) {
    return listing.availableSpotNumbers.length > 0;
  }
  const capacity = Number(listing.spotCount ?? listing.maxTrucks ?? 0);
  const booked = Number(listing.bookedSpots ?? 0);
  return (
    Number.isFinite(capacity) &&
    capacity > 0 &&
    Number.isFinite(booked) &&
    booked < capacity
  );
}

export function getScoutParkingInventoryStatus(
  listing: ScoutParkingPassInventory,
  windowActive: boolean,
): Exclude<ScoutParkingInventoryStatus, null> {
  const status = String(listing.status || "open").trim().toLowerCase();
  const verifiedBookable =
    !unavailableStatuses.has(status) &&
    windowActive &&
    hasVerifiedParkingPassPrice(listing) &&
    hasVerifiedParkingPassCapacity(listing);
  return verifiedBookable ? "available" : "scheduled";
}

export function getScoutHostParkingCopy(
  status: "available" | "occupied" | "scheduled" | null | undefined,
): { badge: string; description: string } {
  if (status === "occupied") {
    return {
      badge: "Truck parked",
      description: "A food truck is currently parked at this host location.",
    };
  }
  if (status === "available") {
    return {
      badge: "Parking Pass available",
      description: "Verified active Parking Pass inventory is available to book.",
    };
  }
  if (status === "scheduled") {
    return {
      badge: "Watch availability",
      description: "This host has Parking Pass inventory, but it is not active right now.",
    };
  }
  return {
    badge: "Host location",
    description: "Route-planning host location. No verified active Parking Pass inventory.",
  };
}
