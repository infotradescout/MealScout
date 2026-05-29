import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateScoutcoinPolicy } from "../server/services/scoutcoinPolicy";

function testCannotBuyWhenDisabled() {
  const result = evaluateScoutcoinPolicy({
    txType: "buy",
    tokenStatus: "disabled",
    kycStatus: "verified",
    walletFrozen: false,
    amountAtomic: 1n,
    maxTxAmountAtomic: 0n,
    dailyTxAmountAtomic: 0n,
    dailyUsedAtomic: 0n,
    blockedJurisdictions: [],
    kycRequiredForBuySend: true,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "token_disabled");
}

function testCannotTransactWithoutKycForBuySend() {
  const result = evaluateScoutcoinPolicy({
    txType: "send",
    tokenStatus: "testnet",
    kycStatus: "pending",
    walletFrozen: false,
    amountAtomic: 1n,
    maxTxAmountAtomic: 0n,
    dailyTxAmountAtomic: 0n,
    dailyUsedAtomic: 0n,
    blockedJurisdictions: [],
    kycRequiredForBuySend: true,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "kyc_required");
}

function testFrozenWalletCannotTransact() {
  const result = evaluateScoutcoinPolicy({
    txType: "redeem",
    tokenStatus: "testnet",
    kycStatus: "verified",
    walletFrozen: true,
    amountAtomic: 1n,
    maxTxAmountAtomic: 0n,
    dailyTxAmountAtomic: 0n,
    dailyUsedAtomic: 0n,
    blockedJurisdictions: [],
    kycRequiredForBuySend: true,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "wallet_frozen");
}

function testAuditHookExistsForEveryMovement() {
  const routeSource = readFileSync(
    "server/routes/scoutcoinRoutes.ts",
    "utf8",
  );
  assert.ok(routeSource.includes("scoutcoin_transaction_recorded"));
  assert.ok(routeSource.includes("scoutcoin_transaction_blocked"));
}

function testNoInvestmentProfitLanguageInUi() {
  const uiSource = readFileSync("client/src/pages/scoutcoin.tsx", "utf8");
  const banned = ["profit", "guaranteed return", "investment", "moon"];
  for (const word of banned) {
    assert.equal(
      uiSource.toLowerCase().includes(word),
      false,
      `UI copy contains banned investment language: ${word}`,
    );
  }
}

function run() {
  testCannotBuyWhenDisabled();
  testCannotTransactWithoutKycForBuySend();
  testFrozenWalletCannotTransact();
  testAuditHookExistsForEveryMovement();
  testNoInvestmentProfitLanguageInUi();
  console.log("scoutcoin-architecture.contract: PASS");
}

run();
