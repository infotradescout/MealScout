# Parking Pass request reconciliation

This extends the request-admission guard; it does not replace it or authorize repeating an uncertain operation.

## Reconciliation path

The booking handler records a versioned checkpoint inside the same SQL transaction as its new holds. A failed checkpoint rolls the holds back. The checkpoint contains exact hold IDs, ownership, dates, slots, locked prices, fees, credits, promo amounts, transfer destination and an opaque provider request key. It contains no payment client secret.

An authenticated retry with the same request body can reconcile a stale processing record. Current truck-management permission is checked before the recovery read and before disclosure. The database evaluates expiry and active-processing deadlines, avoiding driver-specific timestamp interpretation. Active original work is not taken over.

Recovery first checks the precise hold rows. It retrieves their recorded payment intent; when the link was lost, it searches only for the opaque request metadata and retrieves the single candidate again. Empty, multiple, partial or failed search results are not evidence that no payment exists. No new intent is created by recovery.

Provider ownership metadata, amount, currency, slots, booking days, original fee/credit/promo data and destination must match. A transaction locks and rechecks the holds before repairing only their missing intent linkage. Deleted or incompatible records are never recreated, repriced or confirmed.

An unpaid intent can return its original checkout only while its pending holds are within the existing configured hold lifetime and current booking eligibility passes. Already processing, capture-pending or succeeded intents instead return a status-navigation response without a client secret. Confirmed/credited outcomes are taken from all matching hold rows, not inferred from a redirect flag.

The reconstructed response is persisted before acknowledgement. A post-hold HTTP error keeps its checkpoint rather than discarding evidence; a retry may recover a verified result without re-running the booking handler. Pre-hold errors without evidence retain their previous recorded-response behavior. Losing client authentication or permission does not discard the browser's existing request ID.

## Isolation and verification

The integration test executes the actual recovery service, middleware, Express loopback HTTP, migration 058 and model-column-derived event-booking table against fresh PGlite. Provider reads, authentication and the downstream operation are explicit fixtures. SQL transactions and reconstructed receipt persistence are real within that database; this is not native PostgreSQL multi-process or live Stripe/webhook proof.

The separate navigation test executes the real modal recovery branch with a navigation sink. Existing React component and built-frontend browser suites remain separate evidence. Tests do not publish fake businesses, contact payment providers, send messages or use production data.

## Remaining boundaries and rollout

Older processing records without checkpoints stay unresolved. A crash before provider creation cannot be distinguished from an as-yet-unsearchable creation, so recovery must not create a replacement. Missing/deleted holds, unsupported payment states and conflicting evidence require review. Cross-device recovery and automatic whole-page discovery of saved client requests are not implemented here.

This change adds no migration; it uses migration 058 and its unique index. Preserve request tombstones and deploy with the durable guard, checkpoint writer and cleanup behavior together. Drain legacy workers before accepting these guarantees. No migration or production rollout is performed by the tests.

The existing pending-hold expiration scheduler still requires separate review: its cancellation projection uses `paymentIntentId`, while the model exposes `stripePaymentIntentId`, and it deletes expired pending holds. This increment does not repair that scheduler or prove the complete payment-to-webhook-to-schedule chain.

Per the user's instruction, validation proceeds through local and preview execution; GitHub Actions is not being investigated or used as a stopping condition. Existing workflow configuration is unchanged.
