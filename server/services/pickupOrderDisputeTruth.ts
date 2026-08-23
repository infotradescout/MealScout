import type Stripe from "stripe";

function disputePaymentIntentId(dispute: {
  payment_intent?: string | { id?: string | null } | null;
}) {
  const paymentIntent = dispute.payment_intent;
  return typeof paymentIntent === "string"
    ? paymentIntent.trim()
    : String(paymentIntent?.id || "").trim();
}

/**
 * Webhook payloads can arrive out of order. Treat them as a signal to fetch
 * Stripe's current dispute object, while requiring the immutable financial
 * identity in the signal and current object to match exactly.
 */
export async function retrieveAuthoritativePickupOrderDispute(input: {
  stripe: Stripe;
  webhookDispute: Stripe.Dispute;
}): Promise<Stripe.Dispute> {
  const webhookDisputeId = String(input.webhookDispute.id || "").trim();
  if (!webhookDisputeId) {
    throw new Error("Stripe dispute webhook is missing an ID.");
  }

  const authoritativeDispute =
    await input.stripe.disputes.retrieve(webhookDisputeId);
  const webhookPaymentIntentId = disputePaymentIntentId(input.webhookDispute);
  const authoritativePaymentIntentId =
    disputePaymentIntentId(authoritativeDispute);
  const webhookAmount = Number(input.webhookDispute.amount);
  const authoritativeAmount = Number(authoritativeDispute.amount);
  const webhookCurrency = String(input.webhookDispute.currency || "")
    .trim()
    .toLowerCase();
  const authoritativeCurrency = String(authoritativeDispute.currency || "")
    .trim()
    .toLowerCase();

  if (
    authoritativeDispute.id !== webhookDisputeId ||
    !webhookPaymentIntentId ||
    authoritativePaymentIntentId !== webhookPaymentIntentId ||
    !Number.isSafeInteger(webhookAmount) ||
    webhookAmount <= 0 ||
    authoritativeAmount !== webhookAmount ||
    !webhookCurrency ||
    authoritativeCurrency !== webhookCurrency
  ) {
    throw new Error(
      `Stripe dispute ${webhookDisputeId} changed immutable payment identity.`,
    );
  }

  return authoritativeDispute;
}

export function pickupDisputePaymentIntentId(
  dispute: Pick<Stripe.Dispute, "payment_intent">,
) {
  return disputePaymentIntentId(dispute);
}
