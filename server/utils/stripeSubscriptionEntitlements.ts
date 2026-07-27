export function shouldRevokeUserSubscriptionEntitlements(params: {
  currentSubscriptionId: string | null | undefined;
  eventSubscriptionId: string | null | undefined;
}): boolean {
  const eventSubscriptionId = String(params.eventSubscriptionId || "").trim();
  if (!eventSubscriptionId) return false;

  const currentSubscriptionId = String(params.currentSubscriptionId || "").trim();
  return !currentSubscriptionId || currentSubscriptionId === eventSubscriptionId;
}
