import assert from "node:assert/strict";
import test from "node:test";
import { booleanInput } from "../server/utils/booleanInput";
import { evaluateScoutcoinPolicy, type ScoutcoinTxType } from "../server/services/scoutcoinPolicy";

test("multipart preference inputs preserve opt-outs and reject ambiguous values", () => {
  for (const value of [false,"false"," FALSE ","0"]) assert.equal(booleanInput.parse(value),false);
  for (const value of [true,"true"," TRUE ","1"]) assert.equal(booleanInput.parse(value),true);
  for (const value of ["maybe","",null,2,{},[]]) assert.equal(booleanInput.safeParse(value).success,false);
  assert.equal(booleanInput.optional().parse(undefined),undefined);
});
test("disabled ScoutCoin cannot create or move value through any transaction type", () => {
  for (const txType of ["buy","send","receive","redeem","refund"] as ScoutcoinTxType[]) {
    const result=evaluateScoutcoinPolicy({txType,tokenStatus:"disabled",kycStatus:"verified",walletFrozen:false,
      amountAtomic:1n,maxTxAmountAtomic:100n,dailyTxAmountAtomic:100n,dailyUsedAtomic:0n,blockedJurisdictions:[],kycRequiredForBuySend:true});
    assert.equal(result.allowed,false);assert.equal(result.code,"token_disabled");
  }
});
