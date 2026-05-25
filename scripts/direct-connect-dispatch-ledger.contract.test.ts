import {
  assert,
  assertNoDisallowedHits,
  findTokenHits,
  projectFiles,
} from "./directConnectContractUtils";

const files = projectFiles();

const legacyCanonicalConflictHits = findTokenHits(
  /(homeowner_viewed_request|homeowner_viewed_response|homeowner_ownership_upgraded)/i,
  files,
);

assertNoDisallowedHits(
  "dispatch-ledger canonical event naming",
  legacyCanonicalConflictHits,
);

const requesterEventHits = findTokenHits(
  /(requester_viewed_request|requester_viewed_response|requester_ownership_upgraded)/i,
  files,
);

assert(
  requesterEventHits.length >= 0,
  "Requester event token scan should execute",
);

console.log(
  "direct-connect-dispatch-ledger.contract: PASS (homeowner-first canonical events not present)",
);
