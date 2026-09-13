export function canCoordinateEvent(input: {
  actorUserId: string;
  eventType: string | null | undefined;
  eventCoordinatorUserId?: string | null;
  seriesCoordinatorUserId?: string | null;
}) {
  const actorUserId = String(input.actorUserId || "").trim();
  if (!actorUserId || input.eventType === "parking_pass") return false;
  return [input.eventCoordinatorUserId, input.seriesCoordinatorUserId].some(
    (candidate) => String(candidate || "").trim() === actorUserId,
  );
}

export function eventParticipationMutationKeys(
  requestId: string,
  bookingId: string,
) {
  const stableRequestId = String(requestId || "").trim();
  const stableBookingId = String(bookingId || "").trim();
  if (stableRequestId.length < 8 || !stableBookingId) {
    throw new Error("Stable event-mutation and booking IDs are required.");
  }
  return {
    cancellationRequestId: `${stableRequestId}:cancel:${stableBookingId}`,
    correctionIdempotencyKey: `${stableRequestId}:correction:${stableBookingId}`,
  };
}

export function shouldCorrectPaidParticipation(input: {
  bookingStatus: string | null | undefined;
  purchaseStatus: string | null | undefined;
  settlementStatus: string | null | undefined;
  arrivalStartAt?: Date | null;
  now: Date;
}) {
  return (
    isSettledPaidParticipation(input) &&
    (!input.arrivalStartAt ||
      input.arrivalStartAt.getTime() > input.now.getTime())
  );
}

export function isSettledPaidParticipation(input: {
  bookingStatus: string | null | undefined;
  purchaseStatus: string | null | undefined;
  settlementStatus: string | null | undefined;
}) {
  return (
    input.bookingStatus === "confirmed" &&
    ["confirmed", "partially_cancelled", "partially_refunded"].includes(
      String(input.purchaseStatus || "").trim(),
    ) &&
    ["transferred_to_connect", "partially_reversed"].includes(
      String(input.settlementStatus || "").trim(),
    )
  );
}
