# MealScout Authenticated Production Smoke P3 Runner

Status: `SCAFFOLDED_BLOCKED_UNTIL_EXPLICIT_ENABLE`

P3 defines the guarded authenticated production smoke runner and evidence capture path. It does not authorize live authenticated production smoke by itself.

The runner must fail closed unless an operator explicitly sets `PROD_AUTH_SMOKE_ENABLED=true` outside the repo.

## Purpose

P3 prevents accidental credential leakage, accidental production mutation, and false launch evidence while preparing the first authenticated production smoke run.

The runner is scoped to:

- login/session checks for approved smoke identities;
- read-only customer account checks;
- read-only owner fixture checks against quarantined smoke fixtures;
- read-only staff/admin route access checks;
- redacted evidence written to a local evidence directory.

## Required Env Vars

Every required env var must exist before the runner performs any network call:

- `PROD_AUTH_SMOKE_ENABLED`
- `SMOKE_BASE_URL`
- `SMOKE_ORIGIN`
- `SMOKE_CUSTOMER_EMAIL`
- `SMOKE_CUSTOMER_PASSWORD`
- `SMOKE_OWNER_EMAIL`
- `SMOKE_OWNER_PASSWORD`
- `SMOKE_OWNER_OWNED_FIXTURE_ID`
- `SMOKE_OWNER_UNOWNED_FIXTURE_ID`
- `SMOKE_ADMIN_EMAIL`
- `SMOKE_ADMIN_PASSWORD`

Optional env vars:

- `READONLY_DATABASE_URL`
- `SMOKE_EVIDENCE_DIR`
- `SMOKE_RUN_ID`

## Fail-Closed Execution Rule

The runner must refuse to execute unless:

```text
PROD_AUTH_SMOKE_ENABLED=true
```

If the flag is missing, false, misspelled, or any required env var is missing, the runner must stop before login and before any production network call.

## Credential Redaction Rule

The runner must never print or write:

- passwords;
- cookies;
- session ids;
- bearer tokens;
- JWTs;
- API keys;
- database URLs;
- Stripe secrets;
- Brevo/API provider secrets;
- production session material.

All evidence must pass through a redaction function before being written.

## Evidence Output Location

Default evidence directory:

```text
artifacts/production-smoke/authenticated/
```

Override with:

```text
SMOKE_EVIDENCE_DIR
```

Evidence filenames must include a smoke run id. If `SMOKE_RUN_ID` is absent, the runner may generate a timestamped local run id.

Evidence may include:

- run id;
- timestamp;
- base URL origin;
- role names;
- endpoint paths;
- HTTP statuses;
- pass/fail results;
- redacted error summaries.

Evidence must not include raw response bodies if those bodies may contain session or user-sensitive data.

## Customer Smoke Scope

Customer smoke is limited to:

- login using the approved customer smoke identity;
- `/api/auth/user` read-only session verification;
- role assertion that the account is a customer.

Customer smoke must not create bookings, claims, favorites, follows, reviews, messages, payments, orders, notifications, or public content.

## Owner Smoke Scope

Owner smoke is limited to:

- login using the approved owner smoke identity;
- `/api/auth/user` read-only session verification;
- `/api/restaurants/my` read-only owner fixture list;
- subscribed smoke fixture read checks;
- unsubscribed smoke fixture negative entitlement checks.

Owner smoke must use only:

- `SMOKE_OWNER_OWNED_FIXTURE_ID`
- `SMOKE_OWNER_UNOWNED_FIXTURE_ID`

Owner smoke must not edit profiles, menus, schedules, images, ordering state, subscriptions, Stripe objects, payouts, broadcasts, live locations, public discovery records, or notifications.

## Staff/Admin Smoke Scope

Staff/admin smoke is limited to:

- login using the approved staff/admin smoke identity;
- `/api/auth/user` read-only session verification;
- read-only staff/admin route access check such as `/api/admin/launch-board`.

Staff/admin smoke must not create users, approve/reject verification, apply profile evidence, run imports, force password resets, send password reset links, mutate subscriptions, mutate payouts, retry geocodes, publish messages, or trigger notifications.

## Forbidden Mutations

The P3 runner must not issue `POST`, `PUT`, `PATCH`, or `DELETE` requests except the approved login/session request to `/api/auth/login`.

The P3 runner must not touch:

- production signup or invite routes;
- admin manual provisioning routes;
- payment, payout, Stripe, or banking routes;
- notification, SMS, social, drip, digest, reminder, or webhook send routes;
- owner profile/menu/schedule/image mutation routes;
- customer booking/order/claim/review/favorite/follow mutation routes;
- imports, geocoding retries, evidence application, moderation decisions, or reset actions.

## Pass Evidence Criteria

P3 runner evidence can be considered passable only if:

- the runner was explicitly enabled;
- every required env var was present before the first network call;
- customer, owner, and staff/admin sections ran independently;
- all executed checks produced expected statuses;
- evidence was redacted;
- no forbidden mutation was attempted;
- no credential-bearing value appears in logs or evidence.

## Fail Evidence Criteria

P3 runner evidence fails if:

- `PROD_AUTH_SMOKE_ENABLED` is not exactly `true`;
- any required env var is missing;
- any credential, cookie, token, session, secret, or database URL appears in logs or evidence;
- a role uses an unapproved identity;
- a fixture id is missing or mismatched;
- any forbidden mutation is attempted;
- any check returns an unexpected status.

## Gate Decision

Decision: `SCAFFOLDED_BLOCKED`

Do not run live authenticated production smoke until the P3 runner contract passes, the operator explicitly enables `PROD_AUTH_SMOKE_ENABLED=true`, and evidence capture is reviewed before the first live run.
