export type SupplierPaymentMethod = "ach" | "card";

export type ExistingSupplierIntent = {
  status: string | null | undefined;
  amount: number | null | undefined;
  metadataPaymentMethod?: string | null | undefined;
  paymentMethodTypes?: string[] | null | undefined;
};

export type SupplierIntentDecision = "reuse" | "recreate" | "cancel_and_recreate" | "conflict";

const CANCELLABLE_STATUSES = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "requires_capture",
]);

export function decideSupplierIntentHandling(input: {
  intent: ExistingSupplierIntent;
  paymentMethod: SupplierPaymentMethod;
  chargeAmountCents: number;
}): SupplierIntentDecision {
  const { intent, paymentMethod, chargeAmountCents } = input;

  const status = String(intent.status || "").trim();
  if (!status || status === "succeeded") return "conflict";
  if (status === "canceled") return "recreate";

  const expectedType = paymentMethod === "ach" ? "us_bank_account" : "card";
  const methodFromMetadata = String(intent.metadataPaymentMethod || "").trim();
  const methods = Array.isArray(intent.paymentMethodTypes) ? intent.paymentMethodTypes : [];
  const methodMatches = methodFromMetadata === paymentMethod || methods.includes(expectedType);
  const amountMatches = Math.max(0, Number(intent.amount || 0) || 0) === chargeAmountCents;

  if (methodMatches && amountMatches) {
    return "reuse";
  }

  if (CANCELLABLE_STATUSES.has(status)) {
    return "cancel_and_recreate";
  }

  return "conflict";
}
