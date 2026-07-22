export type ParkingPassTopTab = "book" | "schedule" | "host";

export type ParkingPassHostToolsTab = "listings" | "location" | "payments";

export type ParkingPassOwnerNavigation = {
  topTab: ParkingPassTopTab;
  hostToolsTab: ParkingPassHostToolsTab;
  requestedTruckId: string;
};

export function parseParkingPassOwnerNavigation(
  search: string,
): ParkingPassOwnerNavigation {
  const params = new URLSearchParams(search);
  const setup = String(params.get("setup") || params.get("tab") || "")
    .trim()
    .toLowerCase();

  if (setup === "schedule" || setup === "truck") {
    return {
      topTab: "schedule",
      hostToolsTab: "listings",
      requestedTruckId: String(params.get("truckId") || "").trim(),
    };
  }

  if (setup === "location" || setup === "payments" || setup === "host") {
    return {
      topTab: "host",
      hostToolsTab:
        setup === "location"
          ? "location"
          : setup === "payments"
            ? "payments"
            : "listings",
      requestedTruckId: String(params.get("truckId") || "").trim(),
    };
  }

  return {
    topTab: "book",
    hostToolsTab: "listings",
    requestedTruckId: String(params.get("truckId") || "").trim(),
  };
}

export function selectRequestedAccessibleTruck<T extends { id?: unknown }>(
  accessibleTrucks: readonly T[],
  requestedTruckId: string,
): T | null {
  if (accessibleTrucks.length === 0) return null;
  const requestedId = String(requestedTruckId || "").trim();
  return (
    accessibleTrucks.find((truck) => String(truck.id) === requestedId) ||
    accessibleTrucks[0]
  );
}

export function reconcileParkingPassTopTab(input: {
  currentTab: ParkingPassTopTab;
  accessIsLoading: boolean;
  availableTabs: readonly ParkingPassTopTab[];
  canUseTruckSide: boolean;
  canUseHostSide: boolean;
}): ParkingPassTopTab {
  // The accessible-business query resolves after the URL is parsed. Preserve
  // that URL intent until access is known instead of prematurely falling back
  // to the public booking tab.
  if (input.accessIsLoading) return input.currentTab;

  const preferred: ParkingPassTopTab = input.canUseHostSide
    ? input.canUseTruckSide
      ? "book"
      : "host"
    : "book";
  return input.availableTabs.includes(input.currentTab)
    ? input.currentTab
    : preferred;
}
