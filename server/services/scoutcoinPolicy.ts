export type ScoutcoinTxType =
  | "buy"
  | "send"
  | "receive"
  | "redeem"
  | "refund"
  | "admin_freeze";

export type ScoutcoinStatus = "disabled" | "testnet" | "mainnet";

export type ScoutcoinPolicyInput = {
  txType: ScoutcoinTxType;
  tokenStatus: ScoutcoinStatus;
  kycStatus: string | null | undefined;
  walletFrozen: boolean;
  amountAtomic: bigint;
  maxTxAmountAtomic: bigint;
  dailyTxAmountAtomic: bigint;
  dailyUsedAtomic: bigint;
  jurisdictionCode?: string | null;
  blockedJurisdictions: string[];
  kycRequiredForBuySend: boolean;
};

export type ScoutcoinPolicyResult = {
  allowed: boolean;
  code: string;
  reason: string;
};

export function evaluateScoutcoinPolicy(
  input: ScoutcoinPolicyInput,
): ScoutcoinPolicyResult {
  const {
    txType,
    tokenStatus,
    kycStatus,
    walletFrozen,
    amountAtomic,
    maxTxAmountAtomic,
    dailyTxAmountAtomic,
    dailyUsedAtomic,
    jurisdictionCode,
    blockedJurisdictions,
    kycRequiredForBuySend,
  } = input;

  if (walletFrozen) {
    return {
      allowed: false,
      code: "wallet_frozen",
      reason: "This wallet is frozen.",
    };
  }

  if (txType === "buy" && tokenStatus === "disabled") {
    return {
      allowed: false,
      code: "token_disabled",
      reason: "ScoutCoin buying is disabled.",
    };
  }

  const normalizedJurisdiction = String(jurisdictionCode || "")
    .trim()
    .toUpperCase();
  const blocked = new Set(
    (blockedJurisdictions || []).map((value) =>
      String(value || "").trim().toUpperCase(),
    ),
  );
  if (normalizedJurisdiction && blocked.has(normalizedJurisdiction)) {
    return {
      allowed: false,
      code: "jurisdiction_blocked",
      reason: "ScoutCoin actions are blocked in this jurisdiction.",
    };
  }

  if (
    kycRequiredForBuySend &&
    (txType === "buy" || txType === "send") &&
    kycStatus !== "verified"
  ) {
    return {
      allowed: false,
      code: "kyc_required",
      reason: "KYC verification is required for this action.",
    };
  }

  if (maxTxAmountAtomic > 0n && amountAtomic > maxTxAmountAtomic) {
    return {
      allowed: false,
      code: "tx_limit_exceeded",
      reason: "Transaction amount exceeds the configured per-transaction limit.",
    };
  }

  if (
    dailyTxAmountAtomic > 0n &&
    dailyUsedAtomic + amountAtomic > dailyTxAmountAtomic
  ) {
    return {
      allowed: false,
      code: "daily_limit_exceeded",
      reason: "Daily transaction limit exceeded.",
    };
  }

  return {
    allowed: true,
    code: "ok",
    reason: "Allowed",
  };
}
