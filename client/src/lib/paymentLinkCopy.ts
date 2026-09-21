export type PaymentLinkCopyResult = "copied" | "manual";

/** A denied or unavailable clipboard must leave a usable manual-copy path. */
export async function copyPaymentLink(
  url: string,
  clipboard?: { writeText: (text: string) => Promise<void> } | null,
): Promise<PaymentLinkCopyResult> {
  if (!url || !clipboard || typeof clipboard.writeText !== "function") {
    return "manual";
  }
  try {
    // Keep the complete URL, including return/attribution parameters.
    await clipboard.writeText(url);
    return "copied";
  } catch {
    return "manual";
  }
}
