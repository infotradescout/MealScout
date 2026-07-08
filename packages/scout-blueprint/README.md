# Scout Blueprint

Scout Blueprint is a domain-neutral search-results scaffold for apps.

It packages the pattern behind MealScout's live Scout page without food-specific assumptions: a map/visual canvas, action chips, typed search, result lanes, result cards, feature modules, reset behavior, and adapters that let each product define what "nearby", "best", "open", "urgent", or "recommended" means.

## Product Contract

Scout is for users who need to make a next choice quickly:

- search or tap an action
- see the result set update immediately
- see map/visual context update from the same state
- inspect grouped results
- reset to the default personal/local Scout state with one action

## Package Shape

The blueprint is headless. It does not ship MealScout styling or food copy.

- `ScoutBlueprintConfig` defines product terms, actions, lanes, and features.
- `ScoutEntity` is the generic result record.
- `ScoutSearchState` is the query/action/lane/map state.
- `createScoutController` derives results, map markers, active lanes, and reset state.
- `renderScoutDemoShell` proves the derived state can render search, actions, lanes, counts, markers, reset behavior, and app-provided result cards without a product-specific UI.
- `mapMealScoutRecordToScoutEntity` proves food/truck/menu/schedule fields can stay inside an adapter boundary.
- `mapTradeScoutRecordToScoutEntity` proves business/helper/job/supplier/follow-up fields can stay inside an adapter boundary.
- Product apps provide renderers for cards, map markers, nav, and empty states.

## Boundary Rules

Core owns generic state, filtering, lanes, counts, markers, and reset behavior.

Adapters own product records, product metadata, actions, lanes, ranking, and marker customization.

Renderers own UI, copy, route links, visual style, trust labels, auth-aware affordances, and map provider details.

## App Examples

MealScout:

- entities: trucks, restaurants, dishes, deals, events
- actions: trucks, restaurants, dishes, deals, events, community
- map: food/truck/deal/event pins

TradeScout:

- entities: businesses, helpers, jobs, requests, suppliers, inspections, follow-ups
- actions: urgent, providers, open jobs, estimates, suppliers, follow-ups
- map: service areas, active job sites, available pros, supply points

## Do Not Bake In

- food terminology
- route names
- backend endpoints
- auth rules
- visual theme
- map provider
- card layouts
- app navigation
- chatbot behavior
- Direct Connect behavior

Those are adapters.

## Smoke Proof

Run the rendered shell proof with:

```bash
npx tsx packages/scout-blueprint/src/demoSmoke.ts
```
