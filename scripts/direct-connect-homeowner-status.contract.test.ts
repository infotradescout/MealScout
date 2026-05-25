import {
  assert,
  findTokenHits,
  projectFiles,
} from "./directConnectContractUtils";

const files = projectFiles();

const homeownerAliasHits = findTokenHits(/allowedHomeownerActions/i, files);
const homeownerEventHits = findTokenHits(
  /(homeowner_viewed_request|homeowner_viewed_response|homeowner_ownership_upgraded)/i,
  files,
);

if (homeownerAliasHits.length > 0 || homeownerEventHits.length > 0) {
  const requesterCanonicalHits = findTokenHits(
    /(allowedRequesterActions|requester_viewed_request|requester_viewed_response|requester_ownership_upgraded)/i,
    files,
  );
  assert(
    requesterCanonicalHits.length > 0,
    "Homeowner compatibility alias/events exist without requester-first canonical terms",
  );
}

console.log(
  "direct-connect-homeowner-status.contract: PASS (homeowner compatibility is absent or requester-first compatible)",
);
