# Parking Pass request durability

Scope: the existing Parking Pass booking endpoint only. This is not a claim of atomicity across PostgreSQL, Stripe, webhooks, and fulfillment.

## Implemented boundary

The route authenticates before using its durable request guard. Admission uses the existing migration-058 unique index on scope, account identity, and request key. Failure to read/write that store returns an unavailable outcome; there is no process-memory fallback for Parking Pass.

The handler's JSON response is serialized and saved before it is acknowledged. A retry with the same account, route, key, and canonical request body can replay that saved status/body. Replay rechecks current truck-management permission. A changed request body is rejected.

A processing lock expiring does not establish that the first operation failed. An unresolved record is therefore never taken over by another request. Recovery may return a known receipt, a still-processing response, or an explicit reconciliation-required response. It does not silently re-run a potentially financial operation.

Expired Parking Pass rows become payload-free tombstones. Cleanup removes the replay body and status after expiration, but retains the identity/hash so that an old request cannot become a fresh operation. Other scopes retain their prior cleanup behavior. The client already has a shorter 23-hour replay window; server-side records protect against older clients and manual replays too.

Stripe intent creation additionally receives an opaque key derived from account, route, and request identity. Existing intent parameters, prices, fees, transfer destinations, metadata, and confirmation behavior are not modified.

The existing-booking query now combines listing ID, truck ID, and pending/confirmed status in one AND expression. It uses the materialized event ID. Multiple chained WHERE calls previously replaced earlier filters in the installed query builder.

## Failure-injection evidence

`node scripts/qa/parking-durability.integration.test.mjs` uses actual middleware, actual Express HTTP, the actual migration-058 table/index, and fresh PGlite. Two separately loaded middleware instances share that database. Auth/permission decisions, downstream actions, and a minimal booking-query table are explicit fixtures. No Stripe call or production database is used.

It checks concurrent duplicate admission, delayed/failed receipt persistence, lost insert/commit acknowledgement, disconnected clients, changed payloads, revoked access, account separation, expired locks/records, response redaction, original status replay, and the real booking-query expression. A provider-call fixture checks the unchanged parameters and stable opaque request key.

## Release and remaining recovery work

Verify migration 058 and its unique index on the target database before release. Missing durable storage deliberately prevents booking creation rather than allowing an unsafe fallback. Deploy the guard and cleanup changes together; drain old workers because an old worker still running lease-takeover logic is outside the new guarantee.

An unresolved admitted operation may still have left a hold, an unlinked Stripe intent, or no side effect. This guard prevents automatic re-execution; it does not reconstruct those outcomes. Automated reconciliation from persisted hold/intent evidence remains a separate release requirement. Preserve the request reference and use the existing schedule/support review path rather than inventing a confirmed/failed outcome.

A stable provider key is supplementary, not indefinite provider retention or proof of real Stripe execution. Actual Stripe sandbox/webhook testing and native PostgreSQL multi-process/capacity/insurance tests remain required. The test's two middleware instances are not separate operating-system processes and PGlite does not prove deployed PostgreSQL isolation or load characteristics.

Other endpoints still use the general idempotency middleware. Its JSONB response-capture query now explicitly types the parameter, and asynchronous persistence failures are caught rather than becoming unhandled rejections. Actual SQL/HTTP tests cover that repair. Those endpoints retain their prior fallback and lease-retry policies; they have NOT gained the stronger Parking Pass guarantees.

Pending tombstone retention is intentionally conservative. Before bulk archival or account-data deletion, define how old request keys will continue to be rejected; deleting records casually restores the possibility of replay as new work. Never retain replay secrets indefinitely to preserve duplicate detection.

The UI/UX flow matrix remains unfinished. This backend increment does not complete discovery, all onboarding/claim paths, host/supplier/coordinator workflows, or cross-browser/native visual acceptance. No production release is implied by a passing isolated test suite.
