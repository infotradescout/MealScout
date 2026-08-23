import type Stripe from "stripe";

export type PickupTransferReversalResult = {
  transferGroups: string[];
  transferAmountCents: number;
  reversedAmountCents: number;
  currentMerchantNetCents: number;
  targetMerchantNetCents: number;
};

export async function reversePickupOrderTransfers(input: {
  stripe: Stripe;
  orderId: string;
  paymentIntentTransferGroup?: string | null;
  localTransferGroup?: string | null;
  desiredReversalCents?: number;
  customerFinancialLossCents?: number;
  orderTotalCents?: number;
  idempotencyScope: string;
  reversalMetadata?: Record<string, string>;
}): Promise<PickupTransferReversalResult> {
  const orderId = String(input.orderId || "").trim();
  if (!orderId) throw new Error("Pickup order ID is required for reversal");
  const transferGroups = [
    ...new Set(
      [input.paymentIntentTransferGroup, input.localTransferGroup]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];
  const transfersById = new Map<string, Stripe.Transfer>();

  for (const transferGroup of transferGroups) {
    let startingAfter: string | undefined;
    do {
      const transfers = await input.stripe.transfers.list({
        transfer_group: transferGroup,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const transfer of transfers.data) {
        const boundOrderId = String(
          transfer.metadata?.pickupOrderId || "",
        ).trim();
        if (boundOrderId !== orderId) {
          throw new Error(
            `Stripe transfer ${transfer.id} is not bound to pickup order ${orderId}.`,
          );
        }
        transfersById.set(transfer.id, transfer);
      }
      const lastTransfer = transfers.data.at(-1);
      startingAfter = transfers.has_more ? lastTransfer?.id : undefined;
      if (transfers.has_more && !startingAfter) {
        throw new Error(
          `Stripe transfer group ${transferGroup} could not be fully paginated.`,
        );
      }
    } while (startingAfter);
  }

  const transfers = [...transfersById.values()];
  const originalTransfers = transfers.filter(
    (transfer) =>
      !String(transfer.metadata?.disputeReinstatementFor || "").trim(),
  );
  const reinstatementTransfers = transfers.filter((transfer) =>
    String(transfer.metadata?.disputeReinstatementFor || "").trim(),
  );
  const transferAmountCents = originalTransfers.reduce(
    (total, transfer) => total + Math.max(0, Number(transfer.amount) || 0),
    0,
  );
  let reversedAmountCents = transfers.reduce(
    (total, transfer) =>
      total + Math.max(0, Number(transfer.amount_reversed) || 0),
    0,
  );
  let currentMerchantNetCents = transfers.reduce(
    (total, transfer) =>
      total +
      Math.max(
        0,
        Number(transfer.amount) - Number(transfer.amount_reversed || 0),
      ),
    0,
  );
  const requested = Number(input.desiredReversalCents);
  const customerFinancialLossCents = Number(input.customerFinancialLossCents);
  const orderTotalCents = Number(input.orderTotalCents);
  const desiredReversalCents =
    Number.isSafeInteger(customerFinancialLossCents) &&
    customerFinancialLossCents >= 0 &&
    Number.isSafeInteger(orderTotalCents) &&
    orderTotalCents > 0
      ? Math.min(
          transferAmountCents,
          Math.ceil(
            (transferAmountCents * customerFinancialLossCents) /
              orderTotalCents,
          ),
        )
      : Number.isSafeInteger(requested)
        ? Math.min(transferAmountCents, Math.max(0, requested))
        : transferAmountCents;
  const targetMerchantNetCents = Math.max(
    0,
    transferAmountCents - desiredReversalCents,
  );
  let remaining = Math.max(0, currentMerchantNetCents - targetMerchantNetCents);

  // Dispute-win reinstatements are credits, not a second base settlement.
  // Reverse those credits first, then any still-net original settlement, until
  // the merchant's actual net equals the customer-loss-adjusted target.
  for (const transfer of [...reinstatementTransfers, ...originalTransfers]) {
    if (remaining <= 0) break;
    const reversibleAmount = Math.max(
      0,
      Number(transfer.amount) - Number(transfer.amount_reversed),
    );
    if (transfer.reversed || reversibleAmount <= 0) continue;
    const amount = Math.min(reversibleAmount, remaining);
    const reversal = await input.stripe.transfers.createReversal(
      transfer.id,
      {
        amount,
        metadata: {
          pickupOrderId: orderId,
          reversalScope: input.idempotencyScope,
          ...(input.reversalMetadata || {}),
        },
      },
      {
        idempotencyKey: `pickup-order:${orderId}:${input.idempotencyScope}:transfer:${transfer.id}:reversal`,
      },
    );
    if (Number(reversal.amount) !== amount) {
      throw new Error(
        `Stripe reversal ${reversal.id} returned ${reversal.amount} cents; ${amount} cents were required for pickup order ${orderId}.`,
      );
    }
    reversedAmountCents += amount;
    currentMerchantNetCents -= amount;
    remaining -= amount;
  }

  if (currentMerchantNetCents > targetMerchantNetCents) {
    throw new Error(
      `Pickup order ${orderId} merchant net reversal is incomplete (${currentMerchantNetCents}/${targetMerchantNetCents} cents).`,
    );
  }

  return {
    transferGroups,
    transferAmountCents,
    reversedAmountCents,
    currentMerchantNetCents,
    targetMerchantNetCents,
  };
}

export async function reinstatePickupOrderDisputeTransfers(input: {
  stripe: Stripe;
  orderId: string;
  disputeId: string;
  transferGroups: Array<string | null | undefined>;
  customerFinancialLossCents: number;
  orderTotalCents: number;
}): Promise<number> {
  const transferGroups = [
    ...new Set(
      input.transferGroups
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];
  const transfersById = new Map<string, Stripe.Transfer>();
  const originalTransfers = new Map<string, Stripe.Transfer>();
  for (const transferGroup of transferGroups) {
    let startingAfter: string | undefined;
    do {
      const page = await input.stripe.transfers.list({
        transfer_group: transferGroup,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const transfer of page.data) {
        if (
          String(transfer.metadata?.pickupOrderId || "").trim() !==
          input.orderId
        ) {
          throw new Error(
            `Stripe transfer ${transfer.id} is not bound to pickup order ${input.orderId}.`,
          );
        }
        transfersById.set(transfer.id, transfer);
        if (!String(transfer.metadata?.disputeReinstatementFor || "").trim()) {
          originalTransfers.set(transfer.id, transfer);
        }
      }
      const lastTransfer = page.data.at(-1);
      startingAfter = page.has_more ? lastTransfer?.id : undefined;
      if (page.has_more && !startingAfter) {
        throw new Error(
          `Stripe transfer group ${transferGroup} could not be fully paginated.`,
        );
      }
    } while (startingAfter);
  }

  const originalTransferAmountCents = [...originalTransfers.values()].reduce(
    (total, transfer) => total + Math.max(0, Number(transfer.amount) || 0),
    0,
  );
  if (
    !Number.isSafeInteger(input.orderTotalCents) ||
    input.orderTotalCents <= 0 ||
    !Number.isSafeInteger(input.customerFinancialLossCents) ||
    input.customerFinancialLossCents < 0
  ) {
    throw new Error(
      `Pickup order ${input.orderId} has invalid dispute reinstatement amounts.`,
    );
  }
  const customerFinancialLossCents = Math.min(
    input.orderTotalCents,
    Math.max(0, input.customerFinancialLossCents),
  );
  const targetMerchantNetCents = Math.max(
    0,
    originalTransferAmountCents -
      Math.ceil(
        (originalTransferAmountCents * customerFinancialLossCents) /
          input.orderTotalCents,
      ),
  );
  const currentMerchantNetCents = [...transfersById.values()].reduce(
    (total, transfer) =>
      total +
      Math.max(
        0,
        Number(transfer.amount) - Number(transfer.amount_reversed || 0),
      ),
    0,
  );
  let remainingReinstatementCents = Math.max(
    0,
    targetMerchantNetCents - currentMerchantNetCents,
  );
  let reinstatedCents = 0;
  for (const transfer of originalTransfers.values()) {
    if (remainingReinstatementCents <= 0) break;
    let reversalStartingAfter: string | undefined;
    let disputeReversedCents = 0;
    do {
      const page = await input.stripe.transfers.listReversals(transfer.id, {
        limit: 100,
        ...(reversalStartingAfter
          ? { starting_after: reversalStartingAfter }
          : {}),
      });
      disputeReversedCents += page.data
        .filter(
          (reversal) =>
            String(reversal.metadata?.stripeDisputeId || "").trim() ===
            input.disputeId,
        )
        .reduce(
          (total, reversal) =>
            total + Math.max(0, Number(reversal.amount) || 0),
          0,
        );
      const lastReversal = page.data.at(-1);
      reversalStartingAfter = page.has_more ? lastReversal?.id : undefined;
      if (page.has_more && !reversalStartingAfter) {
        throw new Error(
          `Stripe reversals for transfer ${transfer.id} could not be fully paginated.`,
        );
      }
    } while (reversalStartingAfter);

    if (disputeReversedCents <= 0) continue;
    const destination =
      typeof transfer.destination === "string"
        ? transfer.destination
        : String(transfer.destination?.id || "").trim();
    if (!destination) {
      throw new Error(
        `Stripe transfer ${transfer.id} has no connected-account destination.`,
      );
    }
    const reinstatementAmountCents = Math.min(
      disputeReversedCents,
      remainingReinstatementCents,
    );
    await input.stripe.transfers.create(
      {
        amount: reinstatementAmountCents,
        currency: transfer.currency,
        destination,
        transfer_group: transfer.transfer_group || undefined,
        metadata: {
          pickupOrderId: input.orderId,
          disputeReinstatementFor: input.disputeId,
          originalTransferId: transfer.id,
        },
      },
      {
        idempotencyKey: `pickup-order:${input.orderId}:dispute:${input.disputeId}:reinstate:${transfer.id}`,
      },
    );
    reinstatedCents += reinstatementAmountCents;
    remainingReinstatementCents -= reinstatementAmountCents;
  }
  if (remainingReinstatementCents > 0) {
    throw new Error(
      `Pickup order ${input.orderId} dispute reinstatement is incomplete (${remainingReinstatementCents} cents remain).`,
    );
  }
  return reinstatedCents;
}
