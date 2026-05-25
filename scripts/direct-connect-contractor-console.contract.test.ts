import {
  assertNoDisallowedHits,
  findTokenHits,
  projectFiles,
} from "./directConnectContractUtils";

const files = projectFiles();

const contractorConsoleHomeownerDrift = findTokenHits(
  /homeowner/i,
  files.filter(
    (file) =>
      file.includes("client/src") &&
      /(contractor|directconnect|direct-connect|dispatch|request)/i.test(file),
  ),
);

assertNoDisallowedHits(
  "contractor-console homeowner naming drift",
  contractorConsoleHomeownerDrift,
);

console.log(
  "direct-connect-contractor-console.contract: PASS (no homeowner-only language drift in contractor/request surfaces)",
);
