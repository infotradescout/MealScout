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
