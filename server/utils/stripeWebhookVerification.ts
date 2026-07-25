// Pure decision function for Stripe webhook signature-verification policy,
// extracted so it can be unit tested without an Express request/response, a
// live Stripe client, or a database connection.
//
// Default behavior:
// - development: require Stripe signature verification unless the operator
//   explicitly opts out with STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED=true (fast
//   local iteration). This is opt-in so a misconfigured NODE_ENV cannot
//   silently accept unsigned payloads.
// - non-development: always require Stripe signature verification.
// STRIPE_WEBHOOK_FORCE_VERIFY=true forces verification even when the dev
// opt-out is set.
export type StripeWebhookVerificationMode =
  | "accept_unsigned_dev"
  | "verify_signature";

export function decideStripeWebhookVerificationMode(env: {
  nodeEnv: string | undefined;
  forceVerify: boolean;
  allowUnsignedDev: boolean;
}): StripeWebhookVerificationMode {
  const acceptUnsignedDevPayload =
    env.nodeEnv === "development" && env.allowUnsignedDev && !env.forceVerify;
  return acceptUnsignedDevPayload ? "accept_unsigned_dev" : "verify_signature";
}
