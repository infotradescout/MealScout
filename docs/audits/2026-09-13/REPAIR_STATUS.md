# MealScout feature audit repair record

The audit covers 274 separately rated features at baseline commit `6090296ef242cc6c0ce909860ebb6c1d1a2f8fb8`. The accompanying `feature-baseline.json` preserves every rating, observed gap, and source. Scores use a 0–10 scale; the requested 100/100 target is 10/10. Repairing a defect does not automatically establish that an entire feature is complete or production-proven.

## Reviewed repair checkpoint

| Audit features | Concrete change | Verification and remaining limit |
| --- | --- | --- |
| MS-001, MS-006, MS-018, MS-020 | Explain the welcome page, provide remembered city/ZIP selection and device-location recovery, make the deal-price filter accurately describe its scope, show search failures with retry. | TypeScript and discovery source contracts pass. Browser preview remains required; Scout's other feed error handling is still separate. |
| MS-027, MS-034, MS-049 | Check favorite HTTP outcomes with rollback/cache refresh, use canonical open-state parsing, clean up obsolete page structured data. | Code reviewed; authenticated favorite persistence and browser metadata transitions still need served-state proof. |
| MS-031, MS-056, MS-059, MS-061, MS-069, MS-090, MS-122 | Remove internal ordering diagnostic copy from customer menus and repair Help, host-dashboard, and contact-help navigation. | Router/type/source checks pass. These changes do not enable checkout for ineligible merchants or validate support response times. |
| MS-074, MS-075, MS-080, MS-084–086, MS-109, MS-160 | Enforce ownership or active delegated menu authority, parent/category business relationships, explicit dollar/cent import units, null unknown prices, valid image indexes, and transactional CSV category/item insertion. | Price behavior tests and isolated menu permission/revocation tests pass. Import deduplication, complete review-before-insert flows, external AI extraction accuracy, and provider integrations remain open. |
| MS-116–118, MS-120 | Protect deal statistics with analytics permission; aggregate views and redeemed claims independently with consistent date windows. | Isolated PostgreSQL-compatible behavior test reconciles summary, trend, top-deal, and export values without revenue fanout. These are deal-redemption metrics, not all merchant sales. |
| MS-143 | Return aggregate matching route demand rather than other users' full itineraries. | Source review; live volume and route-attributed revenue measurement remain open. |
| MS-149 | Serialize event acceptance under the event lock and prohibit creating already-accepted interests. | Competing acceptances allow one seat; direct accepted insertion is rejected; retries do not consume extra capacity. PGlite does not establish real multi-connection production throughput. |
| MS-163–167 | Lock supplier request/order transitions, validate prices and fee arithmetic, prevent duplicate acceptance, block unpaid fulfillment and terminal reopening, synchronize delivery/order state, and guard provider-intent creation against cancellation and failed database commits. | Actual payment handler with PGlite and mocked Stripe proves rejection before provider calls, intent reuse, method-switch recovery, and terminal-state protection. Real Stripe settlement, refunds, inventory, and courier delivery remain unproved. |
| MS-169, MS-174 | Parse explicit multipart false values correctly and report unresolved shopping-plan items. | Input-policy tests pass; actual retailer inventory, unit normalization, and matching quality remain separate gaps. |
| MS-178, MS-192–193, MS-253 | Generate phone OTPs with cryptographic randomness; require an explicitly configured SMS sender; separate business approval from insurance verification and capture the actual policy expiry for the selected business. | TypeScript/source review. No SMS delivery or insurance-document authenticity claim; old production insurance records are not retrospectively validated. |
| MS-204 | Restrict moderation appeals to participants and make replay create one appeal. | Isolated database test passes. Content enforcement and repeated resolution reputation updates remain separate issues. |
| MS-248–250 | Stop simulated ScoutCoin value movement; disabled token state denies all value transaction types and the UI reports settlement unavailable. | Policy tests pass. A funded, reconciled custody/settlement product is still not implemented. |
| MS-268–272 | Fail closed on unconfigured metrics access, reject empty/stale watchdog results, add readiness routing/configuration, and prevent retries from overlapping a still-running timed-out job. | Queue behavior tests and independent watchdog reproduction pass. Hosting configuration must be applied and verified; the queue remains process-local and does not survive restarts. |

## Proof captured locally

- TypeScript: `npm run check` passed.
- Production client/server compilation: `npm run build:platform` passed.
- New repair suite: `npm run test:audit-repairs` passed 11 tests covering actual isolated database behavior, monetary parsing/policy, and queue lifetime.
- Supplier intent decision regression: `node --import tsx scripts/testSupplierPaymentIntentFlow.ts` passed 6/6.
- Existing menu creation behavior/integration suite passed, including delegated permission revocation and business ownership independent of account label.
- 29 existing CI command groups passed locally, including discovery/navigation/map/profile contracts, public data and SEO boundaries, recommendation guards, import contracts, and mobile/store source-readiness checks. TSX scripts were run with `node --import tsx` because this workspace prohibits the TSX CLI's temporary IPC socket. This is equivalent script execution, not a claim that GitHub CI ran.
- Independent review found and closed supplier fulfillment, capacity, menu category, watchdog, queue retry, fee calculation, cancellation, and provider-intent recovery defects. The verdict is limited to the reviewed code and isolated proofs.

Browser preview, booking/credit/affiliate review, migration proof, hosted CI, and deployment observations are recorded separately as they complete. Native source-readiness checks do not establish a signed install, store release, or real-device behavior.

## Confirmed release blocker

GitHub CI on the baseline did not execute any steps. The GitHub annotation for check `101811734615`, run [34143929134](https://github.com/infotradescout/MealScout/actions/runs/34143929134), says: “The job was not started because your account is locked due to a billing issue.” Account billing must be resolved before hosted CI can verify a release. Required checks must not be removed or bypassed to obtain a green result.

## Remaining acceptance work

The baseline file remains the complete 274-feature backlog. A 100/100 claim additionally requires demonstrated user journeys, correct production data, authorized provider/account setup, operational delivery, appropriate access boundaries, device/browser proof, and deployment/recovery evidence. In particular, the audit found intentionally unavailable or missing surfaces for native delivery, scheduled and cash checkout, completed/partial refunds, live POS synchronization, Order Again, background push, offline use, user self-deletion, and funded rewards/ScoutCoin settlement. Those features are not marked complete by this checkpoint.

No production database migration, real payment, refund, withdrawal payout, customer notification, social post, or production merge was performed for this checkpoint.
