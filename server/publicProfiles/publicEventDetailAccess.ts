const NON_PUBLIC_EVENT_STATUSES = new Set([
  "archived",
  "cancelled",
  "canceled",
  "closed",
  "completed",
  "deleted",
  "disabled",
  "draft",
  "expired",
  "inactive",
  "unavailable",
]);

export function canExposeAnonymousEventDetail(input: {
  requiresPayment: unknown;
  status: unknown;
  slotIsPublic: boolean;
}): boolean {
  if (Boolean(input.requiresPayment) || !input.slotIsPublic) return false;
  const status = String(input.status || "open")
    .trim()
    .toLowerCase();
  return !NON_PUBLIC_EVENT_STATUSES.has(status);
}
