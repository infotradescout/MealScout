/**
 * Backward-compatible command name. Recurring profile checkout is retired, so
 * the money-button proof now validates the separate Parking Pass transaction,
 * including the PaymentIntent total and platform-fee split.
 */
await import("./smokeParkingPassStripeFlow");
