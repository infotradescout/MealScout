/**
 * Retired compatibility entry point.
 *
 * Never recreate recurring profile-subscription rows. To stop and retire old
 * Stripe records, use `npm run billing:retire-legacy-subscriptions` and review
 * its dry-run output before using `--apply`.
 */

console.error(
  "backfillRestaurantSubscriptions is retired: recurring profile billing must not be restored.",
);
process.exitCode = 1;
