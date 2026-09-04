# Menu creation and the local LISA record

Menu creation now commits the menu and its attributed LISA creation observation in
one database transaction. The result is a local record, not delivery to another
product, permission to share, or proof that a menu has been published.

## Request and retry contract

- The authenticated menu manager submits a UUID `Idempotency-Key`.
- `POST /api/owner/menus/create` and the existing `POST /api/owner/menus` use the same
  transaction service and existing route gates. Missing or invalid keys fail
  before any write. Current ownership is rechecked inside the transaction, even
  for a replay.
- The UUID identifies both the menu and its creation observation in their
  respective tables. A matching retry returns the existing menu and record;
  reusing a key for different work or a different actor is rejected.
- A failed observation insert rolls back the menu. An uncertain commit response
  returns a retryable error, not an unsupported completion or rollback claim.
- Deleting a menu does not delete its creation observation. A later replay will
  not resurrect the deleted menu.

The browser retains each unfinished request separately, scoped to the actor,
business, and submitted input fingerprint. It stores only identifiers and a
fingerprint in session storage, not menu text. Editing A to B and then retrying A
preserves both retry identities. A reload in the same tab can recover the identity
when the same input is submitted again; restoring draft text is outside this
change. Closing the tab, clearing storage, or using a separate tab can lose that
browser identity. API callers must likewise retain and reuse their request key.

Failures appear inside the still-open creation dialog so the recovery instruction
is not obscured by the modal backdrop. Completion requires a matching menu ID,
business ID, record ID, and `recorded`
status. Only then does the browser clear that request's retry identity. An
intentional subsequent creation receives a new key and may use the same name.

New clients use the `/create` URL so a mixed-version deployment cannot route them
to the old exact-URL creation handler. An old server may return an error or SPA
HTML; neither is accepted as a creation receipt. Old clients talking to the new
server must refresh to supply the required key. Deploy client and server together.

## Record semantics and reuse

The observation uses the existing `lisa_claim` table and its required `claimValue`
field. Its type is `menu_created`, not `menu_published`. It contains explicit
creation facts: business, menu name, service type, active flag, creation timestamp,
schema version, and request fingerprint. The actor and menu IDs remain attributed
in their existing columns. This does not record consent, change access rights,
publish externally, or copy an unrestricted request snapshot.

No new database table or migration is required. Both the historical UUID-based
LISA table from migration 009 and the current varchar model are tested. The generic
response cache and best-effort claim emitter are intentionally not used: neither
provides a single durable transaction for this operation. Historical missing or
misclassified observations are not backfilled by this repair.

## Verification and limits

Run `npm run test:menu-lisa` after installing the locked development dependencies.
The focused suite uses fresh in-memory PGlite PostgreSQL instances and request
helper tests; it never reads a database URL or contacts production. It reproduces
the old missing-`claim_value` failure, checks rollback and retry recovery, simulates
a lost commit acknowledgment, checks attribution and current ownership, and tests
deletion, input changes, duplicate requests, and exact completion receipts.

After building the client, `npm run test:menu-lisa:browser` exercises the rendered
desktop and narrow-screen client with synthetic API responses. It checks visible
failure recovery, the A-to-B-to-A retry sequence, reload followed by retry,
malformed response rejection, and safe failure when storage is unavailable. It
blocks non-local requests and does not start the real application server or touch
an account or database. It requires the project's Playwright Chromium runtime.

PGlite serializes a single engine connection. Overlapping calls are covered, but
native multi-connection load, real authenticated HTTP/browser integration, a full
production migration rehearsal, and deployed behavior are separate verification
gates. This local repair does not establish cross-product LISA delivery or
production readiness.
