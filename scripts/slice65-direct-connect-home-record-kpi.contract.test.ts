import { readFileSync } from "fs";

const telemetryRoutes = readFileSync("server/telemetryRoutes.ts", "utf8");

const requiredEventSnippets = [
  '"direct_connect_request_started"',
  '"direct_connect_home_record_prompt_viewed"',
  '"direct_connect_home_record_link_selected"',
  '"direct_connect_home_record_create_selected"',
  '"direct_connect_home_record_skipped"',
  '"direct_connect_request_submitted_after_home_record_skip"',
  '"direct_connect_homeid_link_selected"',
];

for (const snippet of requiredEventSnippets) {
  if (!telemetryRoutes.includes(snippet)) {
    throw new Error(`Missing direct-connect KPI event visibility snippet: ${snippet}`);
  }
}

const requiredResponseSnippets = [
  "directConnectHomeRecord",
  "promptViewRateFromRequestStarted",
  "linkSelectRateFromPromptViewed",
  "createSelectRateFromPromptViewed",
  "skipRateFromPromptViewed",
  "submitAfterSkipRate",
  "requestAbandonmentAfterPromptRate",
];

for (const snippet of requiredResponseSnippets) {
  if (!telemetryRoutes.includes(snippet)) {
    throw new Error(`Missing direct-connect KPI response snippet: ${snippet}`);
  }
}

console.log("slice65-direct-connect-home-record-kpi.contract: PASS");
