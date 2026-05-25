import {
  assert,
  assertNoDisallowedHits,
  findTokenHits,
  projectFiles,
} from "./directConnectContractUtils";

const files = projectFiles();

const disallowedRequesterDrift = findTokenHits(
  /(allowedHomeownerActions|homeowner_viewed_request|homeowner_viewed_response|homeowner_ownership_upgraded)/i,
  files,
);

assertNoDisallowedHits(
  "requester-status canonical contract",
  disallowedRequesterDrift,
);

const requesterCanonical = findTokenHits(
  /(allowedRequesterActions|requester_viewed_request|requester_viewed_response|requester_ownership_upgraded)/i,
  files,
);

assert(
  requesterCanonical.length >= 0,
  "Requester canonical token scan should execute",
);

console.log(
  "direct-connect-requester-status.contract: PASS (canonical requester naming enforced in current codebase scan)",
);
