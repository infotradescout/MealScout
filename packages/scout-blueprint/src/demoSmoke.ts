import {
  applyScoutAction,
  createDefaultScoutState,
  createScoutController,
} from "./controller";
import { escapeScoutDemoHtml, renderScoutDemoShell } from "./demoShell";
import {
  mealScoutAdapterProofConfig,
  mealScoutAdapterProofRecords,
  mapMealScoutRecordToScoutEntity,
} from "./mealScoutAdapterProof";
import {
  mapTradeScoutRecordToScoutEntity,
  tradeScoutAdapterProofRecords,
  tradeScoutBlueprintConfig,
} from "./tradeScoutExample";

const mealScoutEntities = mealScoutAdapterProofRecords.map(
  mapMealScoutRecordToScoutEntity,
);

const mealScoutState = applyScoutAction(
  mealScoutAdapterProofConfig,
  createDefaultScoutState(mealScoutAdapterProofConfig),
  "trucks",
);
const mealScoutDerived = createScoutController(
  mealScoutAdapterProofConfig,
  mealScoutEntities,
  mealScoutState,
);
const mealScoutHtml = renderScoutDemoShell(
  mealScoutAdapterProofConfig,
  mealScoutDerived,
  {
    renderResult(entity) {
      return `<article data-renderer="mealscout-proof"><h3>${escapeScoutDemoHtml(entity.title)}</h3><p>${escapeScoutDemoHtml(entity.subtitle ?? entity.kind)}</p></article>`;
    },
  },
);

assertIncludes(mealScoutHtml, 'data-scout-action="trucks"');
assertIncludes(mealScoutHtml, 'data-scout-result-count="1"');
assertIncludes(mealScoutHtml, 'data-scout-marker="marker:truck-1"');
assertIncludes(mealScoutHtml, 'data-scout-reset="true"');
assertIncludes(mealScoutHtml, 'data-renderer="mealscout-proof"');

const tradeScoutEntities = tradeScoutAdapterProofRecords.map(
  mapTradeScoutRecordToScoutEntity,
);

const defaultTradeState = createDefaultScoutState(tradeScoutBlueprintConfig);
const defaultTradeDerived = createScoutController(
  tradeScoutBlueprintConfig,
  tradeScoutEntities,
  defaultTradeState,
);
assertEqual(defaultTradeDerived.state.activeActionId, "urgent");
assertNonEmpty(
  defaultTradeDerived.primaryItems,
  "Default TradeScout urgent state should not be emptied by soft boosts.",
);
assertIncludes(
  defaultTradeDerived.primaryItems.map((entity) => entity.id).join(","),
  "business-1",
);

const urgentTradeState = applyScoutAction(
  tradeScoutBlueprintConfig,
  createDefaultScoutState(tradeScoutBlueprintConfig),
  "urgent",
);
const urgentTradeDerived = createScoutController(
  tradeScoutBlueprintConfig,
  tradeScoutEntities,
  urgentTradeState,
);
assertNonEmpty(
  urgentTradeDerived.primaryItems,
  "Urgent action should not require every boost word to match.",
);

const followupsTradeState = applyScoutAction(
  tradeScoutBlueprintConfig,
  createDefaultScoutState(tradeScoutBlueprintConfig),
  "followups",
);
const followupsTradeDerived = createScoutController(
  tradeScoutBlueprintConfig,
  tradeScoutEntities,
  followupsTradeState,
);
assertNonEmpty(
  followupsTradeDerived.primaryItems,
  "Follow-ups action should not require every boost word to match.",
);
assertIncludes(
  followupsTradeDerived.primaryItems.map((entity) => entity.id).join(","),
  "follow-up-1",
);

const explicitSearchState = {
  ...createDefaultScoutState(tradeScoutBlueprintConfig),
  query: "materials",
};
const explicitSearchDerived = createScoutController(
  tradeScoutBlueprintConfig,
  tradeScoutEntities,
  explicitSearchState,
);
assertEqual(explicitSearchDerived.resultCount, 1);
assertEqual(explicitSearchDerived.primaryItems[0]?.id, "supplier-1");

const tradeState = applyScoutAction(
  tradeScoutBlueprintConfig,
  createDefaultScoutState(tradeScoutBlueprintConfig),
  "contractors",
);
const tradeDerived = createScoutController(
  tradeScoutBlueprintConfig,
  tradeScoutEntities,
  tradeState,
);
const tradeHtml = renderScoutDemoShell(tradeScoutBlueprintConfig, tradeDerived, {
  renderResult(entity) {
    return `<article data-renderer="tradescout-proof"><h3>${escapeScoutDemoHtml(entity.title)}</h3><p>${escapeScoutDemoHtml(entity.kind)}</p></article>`;
  },
});

assertIncludes(tradeHtml, 'data-scout-action="contractors"');
assertIncludes(tradeHtml, 'data-scout-result-count="1"');
assertIncludes(tradeHtml, 'data-scout-marker="marker:business-1"');
assertIncludes(tradeHtml, 'data-renderer="tradescout-proof"');

console.log("scout-blueprint demo smoke: PASS");

function assertIncludes(source: string, snippet: string): void {
  if (!source.includes(snippet)) {
    throw new Error(`Missing demo shell proof snippet: ${snippet}`);
  }
}

function assertEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertNonEmpty(items: unknown[], label: string): void {
  if (items.length === 0) {
    throw new Error(label);
  }
}
