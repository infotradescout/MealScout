const LOCATION_TYPE_LABELS: Record<string, string> = {
  office: "Office / Corporate",
  retail: "Retail / Shopping Center",
  church: "Church / Community",
  warehouse: "Warehouse / Industrial",
  school: "School / Campus",
  other: "Other",
};

export function getLocationTypeLabel(locationType?: string | null): string {
  const normalized = String(locationType || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "Other";
  return (
    LOCATION_TYPE_LABELS[normalized] ||
    normalized
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}
