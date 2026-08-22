import { isPublicDiscoveryEligibleEntity } from "@shared/publicDiscoveryIntegrity";

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
  eventType: unknown;
  requiresPayment: unknown;
  status: unknown;
  slotIsPublic: boolean;
}): boolean {
  if (
    String(input.eventType || "").trim().toLowerCase() === "private_event" ||
    Boolean(input.requiresPayment) ||
    !input.slotIsPublic
  ) {
    return false;
  }
  const status = String(input.status || "open")
    .trim()
    .toLowerCase();
  return !NON_PUBLIC_EVENT_STATUSES.has(status);
}

export function canExposeAuthorizedPaidEventDetail(input: {
  eventType: unknown;
  requiresPayment: unknown;
  status: unknown;
  slotIsBookable: boolean;
}): boolean {
  const eventType = String(input.eventType || "")
    .trim()
    .toLowerCase();
  const status = String(input.status || "open")
    .trim()
    .toLowerCase();
  return (
    eventType === "parking_pass" &&
    Boolean(input.requiresPayment) &&
    status === "open" &&
    input.slotIsBookable
  );
}

export function canExposeAnonymousEventListItem(input: {
  eventType: unknown;
  requiresPayment: unknown;
  status: unknown;
  eventName: unknown;
  hostName: unknown;
}): boolean {
  const eventName = String(input.eventName || "").trim();
  const hostName = String(input.hostName || "").trim();
  if (!eventName || !hostName) return false;

  return (
    canExposeAnonymousEventDetail({
      eventType: input.eventType,
      requiresPayment: input.requiresPayment,
      status: input.status,
      slotIsPublic: true,
    }) &&
    isPublicDiscoveryEligibleEntity({ name: eventName, isActive: true }) &&
    isPublicDiscoveryEligibleEntity({ name: hostName, isActive: true })
  );
}

export function canExposeAnonymousEventFeedItem(input: {
  eventType: unknown;
  requiresPayment: unknown;
  status: unknown;
  eventName: unknown;
  hostName: unknown;
  slotIsPublic: boolean;
  hasPublicConfirmedTruck: boolean;
  ended: boolean;
}): boolean {
  if (!input.hasPublicConfirmedTruck || input.ended) return false;
  return (
    canExposeAnonymousEventListItem(input) &&
    canExposeAnonymousEventDetail({
      eventType: input.eventType,
      requiresPayment: input.requiresPayment,
      status: input.status,
      slotIsPublic: input.slotIsPublic,
    })
  );
}
