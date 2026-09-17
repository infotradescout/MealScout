# Customer menu continuity

Base: `abe74889fc57ece1c8e0dbd77c74a78e44c408c3`, PR #380.
Owner: `docs/product/MEALSCOUT_END_TO_END_FLOW_UX_MATRIX.md`.

## Implemented behavior
- Menu reads retain HTTP status, reject malformed payloads and consume query cancellation with a 15-second deadline. Failed reads are not described as unpublished menus.
- Retry menu remains on the current route and preserves the existing browser cart. Access denied, missing, temporarily unavailable and successfully empty menus remain distinct.
- Profile-selected menu identity passes into the full menu. Menu tabs update the URL without discarding other query fields; reload retains the selection.
- A menu that disappears falls back to a currently published menu with an explicit notice; no cart is cleared by that fallback.
- Public menu view state is keyed to merchant identity. Browser-history changes discard obsolete item dialogs instead of keeping another merchant's selection.
- Menu return paths preserve the originating typed public profile, approved attribution and section. External, unrelated and other-merchant destinations are rejected; token/code parameters are removed. Clean business aliases without an embedded entity ID continue to use the existing generated profile fallback.
- Existing dish cards retain their dark design, but business, category, distance and description text use explicit light colors instead of opacity-based classes that inherited dark text. Recommendation targets are at least 44px.

## Acceptance
The existing `public-profile-browser.cjs` runner includes `customer-menu-journeys.cjs` and `scout-menu-card-journeys.cjs`; its global no-unintercepted-API assertion remains mandatory.
Journeys cover the uninterrupted Scout → profile → selected menu → cart → reload → profile → Scout loop, exact typed-profile return, nonempty cart recovery, menu selection, merchant changes, access errors, empty menus and browse-only menus.
Card checks measure actual browser-computed text/background contrast, verify the action target, and follow the card's real profile link.
The baseline menu suite reproduced sixteen failed customer cases. The independent card baseline measured four text roles at approximately 1.07:1 against the existing dark surface.
Evidence: `.qa-evidence/customer-menu-continuity/`, including retained baseline, candidate, final and contrast receipts. Tests execute the actual compiled app with synthetic API/auth records; they do not establish live payments or production release.

## Protected boundaries
No price calculation, payment endpoint, fee, eligibility rule, provider setting, ownership rule, active-menu publication rule or cart storage key changed. Signed modifier price adjustments and unpriced browse-only items remain supported.
Keep PR #381 separate. Preserve migration 142 deployment order, legacy-worker drain, retained history and request tombstones. Do not claim this frontend acceptance replaces native/provider transaction acceptance or a complete live merchant onboarding walkthrough.

## Observed local checkpoint
Final compiled browser suite: 66/66 scenarios with zero unintercepted API requests. Final helper/affected-contract run and full TypeScript exited 0. Both actual desktop/mobile dish-card captures were inspected. The minimum measured text contrast is 12.26:1, versus the 1.07:1 baseline.
These are isolated frontend results. The PR must retain its own exact-head hosted acceptance before being described as preview-verified.

## Actual deployed dish-to-profile defect and repair
The real-data guest walk-through on 722f86f5 failed on both desktop and mobile: Ahi tuna poke linked to a restaurant profile that did not exist, while the same screen correctly linked its owner, The Florida Kitchen Island Cuisine, as a truck. A public response trace confirmed that trending.items omitted owner classification, while trending.places in the same response contained the matching exact ID with businessType=food_truck and isFoodTruck=true. The observed truck link reached the real profile and its published menu; the menu explicitly stated online pickup ordering is not currently available. No ordering activation occurred.
The canonical Scout model now joins only missing owner-classification fields from matching public place IDs in the same response. Price, availability, verification and publication fields are not copied. Dish profile path construction preserves the resulting canonical business type. No extra backend request or public authorization relaxation was added.
The regression uses an untyped trending dish plus a separately typed truck owner, with an actual 404 for the wrong fixture profile type. Both viewport cases failed before the repair and passed afterward. Final local compiled suite: 68/68 plus the unchanged zero-unintercepted-API guard; full TypeScript and build exited0. Five additional helper cases cover matching identity, wrong-owner rejection, non-mutation, preserved explicit fields and empty inputs.
The actual deployed guest dish→profile→menu→profile→Scout loop still requires verification at the next exact candidate; do not substitute the intermediate 24-stage hosted result for this proof.
