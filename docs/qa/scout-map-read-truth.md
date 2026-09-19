# Scout map-provider and core discovery read truth

## Scope and source
Continue PR #380 from `1dbd635630d88d53c719cbb84b6f4318992c427d` under `docs/product/MEALSCOUT_END_TO_END_FLOW_UX_MATRIX.md`. Keep PR #381 and production release separate.
Map implementation: `da5a0585`; core read-state implementation: `2f4e14fe`.

## Provider finding and remaining configuration
CARTO's official guidance now requires a project basemap key: https://carto.com/basemaps/apikey/ (checked September 17, 2026). Anonymous raster tiles can display an API-key-required watermark; image loading is not provider authorization.
Both existing CARTO consumers now use a validated copy of their current styles with `VITE_CARTO_BASEMAPS_API_KEY` appended as the documented `key` query parameter. Tile templates, source identity, attribution and existing appearance remain. No alternate provider or shared key was substituted.
Missing configuration does not request anonymous tiles. The existing clickable pin fallback explicitly says that the street map is unavailable and pin positions are approximate. Configured provider errors are recoverable with Retry street map. Map construction errors and absent WebGL fail safely.
The preview project's environment-name listing did not show a CARTO key; an existing-key email search returned no matches. This does not prove that the owner has no key anywhere. **A dedicated authorized project key still must be issued/configured and verified against actual provider tiles.** No key, account, commercial agreement, billing or provider setting was created/changed by this slice. Google Maps remains the existing separate full-map provider; a Google key is not a CARTO credential.

## Discovery finding and repair
Anonymous direct GETs to both the public site and its Render backend returned HTTP 200 with an empty restaurant array for `/api/restaurants/nearby/30.4213/-87.2169?radius=25`. This establishes the response for that area/time, not why supply is absent or whether all business records are empty.
The public map runtime reported a browser Google Maps credential, no map ID, and no authorized server credential. Values were not printed or copied into source. A separate preview trace ended at Vercel login; it is **not** application/provider response evidence.
Core truck, featured-restaurant and public-nearby-restaurant reads no longer convert unsuccessful/malformed responses into empty collections. They retain status, are bounded/cancellable, reject invalid row identities, expose loading/unavailable/partial states and offer read-only retry on the current route. Data from a failed core read is not displayed as current availability. Successfully read results from other core sources stay usable.
Empty-market/low-coverage assertions are suppressed while these core reads are unresolved; a genuine successful empty response remains the existing explicit empty-market surface. Its blank-query quotation was corrected. Optional deals/events/other sources are not all covered by this slice; do not generalize core read acceptance to every discovery endpoint.

## Tests observed before hosted integration
- CARTO helper: 14 cases; core-feed reader: 22 cases. Existing 41 profile/journey cases retained. Combined new state stage: 77 cases. The existing map truth contract passed separately.
- Actual React/MapLibre: 12 cases across active/legacy maps, desktop/mobile, missing/configured/denied credentials, pin action, and retry. Passed on Windows Chrome and pinned Linux Chromium 143 with intercepted provider responses. These are not live CARTO-key acceptance.
- Compiled profile/Scout browser: 42 cases, including the previous 34 and eight core discovery recovery/partial/empty cases. The global zero-unintercepted-API guard remains part of suite acceptance. All 42 passed locally.
- Old compiled UI failed the newly authored outage/partial cases. A newly authored true-empty selector initially expected an intermediate label; it was corrected to the already-rendered canonical empty-market surface after inspection. Earlier failures are retained, not relabeled as application defects or passes.
- Actual frontend builds and full TypeScript completed successfully. Final hosted result must be observed for the published head; 24 configured stages is not 24 passing stages.

## Evidence and release boundary
Evidence root: `.qa-evidence/scout-map-read-truth/`; retains successful Linux/Windows provider-component runs, old/core-candidate/final browser receipts and source/build logs. A bad initial PNG fixture was replaced with a browser-encoded tile; no provider assertion was removed.
No production mutation, migrations, customer action, charges, messages, permission change, or publication-eligibility relaxation occurred. Preserve migration 142 ordering, legacy-worker drain, terminal history and earlier request tombstones. The accepted predecessor preview remains evidence only for its own source.

Actual compiled mobile outage and desktop true-empty captures were inspected after the 42-case run. They clearly distinguish unavailable core reads from successful empty responses; no generated mockup was substituted. Full final typecheck exited 0 and 78 combined checks passed (77 state/helper cases plus the existing map truth contract).
