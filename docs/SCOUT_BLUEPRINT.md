# Scout Blueprint

Scout is becoming a reusable product primitive: a search/results/control surface where action chips, typed search, map context, result lanes, and reset state all update from the same controller.

This is not MealScout-specific. MealScout is one implementation. TradeScout is another implementation. Future apps can plug into the same scaffold with their own adapter, renderer, actions, lanes, trust rules, and product language.

## Product Verdict

Product PASS as a platform lane.

Why: the strongest MealScout interaction is no longer "a page"; it is a repeatable search-results pattern. Packaging it makes the same loop sellable and reusable for TradeScout, home services, local marketplaces, logistics, events, or any app where users need to pick the next best result fast.

## Technical Verdict

Technical PASS for the blueprint proof lane.

The package has a rendered demo shell and adapter proofs while remaining headless. It does not drag MealScout food assumptions into TradeScout, and it does not replace the live MealScout `/scout` route.

## Core Loop

1. User lands on Scout.
2. Scout shows default personal/local results.
3. User taps an action chip or types a query.
4. Results, lanes, and map markers update from the same state.
5. User opens a result or resets to default Scout with one action.

## What Is Generic

- `ScoutEntity`: any searchable thing.
- `ScoutAction`: chips or modes users can tap before typing.
- `ScoutLane`: grouped result shelves.
- `ScoutFeature`: optional modules that can be enabled/disabled per app.
- `ScoutMapMarker`: optional location/visual context.
- `ScoutSearchState`: query, active action, active lane, enabled features.
- `createScoutController`: derives filtered results, lanes, markers, result count, and reset state.
- `renderScoutDemoShell`: a minimal renderer proof for search state, actions, lanes, counts, map markers, reset affordance, and app-provided result rendering.

The core cannot contain app assumptions. It must not import MealScout, TradeScout, app routes, server code, schema code, theme files, product copy, auth rules, or chatbot behavior.

## What Apps Provide

- Domain data adapter from app records into `ScoutEntity`.
- Card renderers.
- Map renderer or visual canvas.
- Theme tokens.
- Empty states.
- Routes.
- Auth and permissions.
- Analytics.
- Product trust rules.

## Boundary Model

Core:

- owns state transitions, filtering, lane activation, result counts, marker derivation, and reset state
- accepts generic config and generic entities
- has no React dependency
- has no food, truck, contractor, route, profile, auth, or chatbot dependency

Adapter:

- translates product records into generic `ScoutEntity` objects
- stores domain meaning in `tags`, `signals`, and adapter-owned `payload`
- supplies app-specific actions, lanes, features, ranking, and marker customizations

Renderer:

- turns derived generic state into product UI
- owns cards, copy, visual treatment, map provider, route links, empty states, and trust labels
- can be React, static HTML, native mobile, or another app surface

## MealScout Adapter Proof

MealScout maps:

- trucks, restaurants, menu items, deals, events, hosts -> `ScoutEntity`
- chips like Trucks, Restaurants, Dishes, Deals -> `ScoutAction`
- rails like Food Trucks Today, Local Activity, Menu Highlights -> `ScoutLane`
- coordinates -> `ScoutMapMarker`

Food/truck/menu/schedule fields stay in adapter-owned metadata, tags, and signals. The core package does not import the MealScout app.

## TradeScout Adapter

TradeScout can map:

- businesses, helpers, jobs, requests, suppliers, inspections, follow-ups -> `ScoutEntity`
- chips like Urgent, Providers, Open Jobs, Suppliers, Follow-ups -> `ScoutAction`
- lanes like Best Next, Available Pros, Open Jobs, Supply Points -> `ScoutLane`
- service areas/job sites/supplier locations -> `ScoutMapMarker`

TradeScout-specific work coordination meaning stays in adapter metadata, tags, signals, and product-owned renderers. The generic package does not fake Direct Connect behavior.

## Future Platform Plug-In

1. Define the app record type.
2. Map records into `ScoutEntity`.
3. Define `ScoutBlueprintConfig` actions, lanes, features, ranking, and optional marker mapping.
4. Call `createScoutController` with app records and `ScoutSearchState`.
5. Render the derived state with the app renderer.
6. Keep product copy, trust rules, auth rules, route links, and visual system outside the core.

## Anti-Drift Rules

- Scout is search/results/control infrastructure, not a chatbot.
- Do not put food, truck, contractor, Direct Connect, profile, route, schema, auth, or theme assumptions in core.
- Do not replace live `/scout` until a separate product lane explicitly approves it.
- Do not make example data behave like production integration proof.
- Do not add framework architecture unless a working demo proof requires it.

## Packaging Rule

Do not sell a page full of app-specific assumptions. Sell the Scout controller, configuration contract, reference UI shell, and adapter examples.
