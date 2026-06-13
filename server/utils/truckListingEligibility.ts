type TruckLike = Record<string, any>;

const hasText = (value: unknown) => String(value ?? "").trim().length > 0;

export function hasTruckMenuSignal(truck: TruckLike): boolean {
  return Boolean(
    hasText(truck?.menuUrl) ||
      hasText(truck?.menuPdfUrl) ||
      hasText(truck?.menuImageUrl) ||
      Number(truck?.menuItemCount || 0) > 0 ||
      Number(truck?.publicMenuItemCount || 0) > 0,
  );
}

export function hasTruckScheduleSignal(truck: TruckLike): boolean {
  return Boolean(
    truck?.schedulePublished ||
      hasText(truck?.operatingHours) ||
      hasText(truck?.businessHours) ||
      hasText(truck?.hours) ||
      hasText(truck?.scheduleDescription) ||
      Number(truck?.upcomingPublicEventCount || 0) > 0 ||
      Number(truck?.upcomingEventCount || 0) > 0,
  );
}

export function isTruckDiscoverableForScout(truck: TruckLike): boolean {
  // Product rule:
  // - Menu/schedule absence must not hide otherwise eligible trucks.
  // - Missing menu/schedule is represented as an honest "none found" state.
  return Boolean(truck);
}
