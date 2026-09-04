# MealScout identity boundary

Status: Draft convergence slice  
Authority: Infinity System Convergence Standard

## Canonical product owner

`server/unifiedAuth.ts` is the only MealScout owner for session configuration,
Passport strategies, sign-in, registration, logout, password recovery, and
route-level authentication middleware.

`server/routes.ts` registers that owner once through `setupUnifiedAuth(app)`.
The server entry point installs the one exported session middleware before route
registration.

## Drift removed

- Removed the unreachable `server/facebookAuth.ts` and
  `server/restaurantAuth.ts` stacks. Neither was imported or registered.
- Removed the dormant `/api/auth/tradescout/sso` endpoint. Organization-wide
  search found no TradeScout issuer or caller; all references were inside
  MealScout's own proposed SDK and documentation.
- Removed the unconsumed embedded-app wrapper, its package export map, its
  separate library build, and the documentation that claimed the integration
  already existed.
- Removed the `tradescout` write branch from `upsertUserByAuth`, including its
  silent normalized-email account linking and role translation.

## Preserved evidence and active behavior

The nullable `users.tradescoutId` column remains as dormant historical evidence
until stored-data reconciliation proves whether any row contains a value. No
active authentication path writes it in this draft.

MealScout's email, phone, Google, and Facebook entry points remain product-local.
Google and Facebook now resolve login by provider subject. A matching email is
collision evidence and cannot silently attach a provider to an existing row.

The dormant cross-product OAuth app context is rejected at the MealScout entry
points. TradeScout owns its own provider login and session.

Provider access-token columns remain as stored-data migration evidence, but
active sign-in no longer writes tokens to user rows. Repository search found no
runtime consumer requiring those login tokens. Existing values must be measured
and retired through an explicit data migration rather than erased by this code
change.

## OAuth decisions

| Provider subject | Email | Result |
| --- | --- | --- |
| Existing row | Same row or no row | Sign in to that provider row |
| No row | Existing row | Stop; authenticated linking is required |
| One row | Different row | Stop; identity collision review is required |
| No row | No row | Create a MealScout-local account |
| Disabled provider or email row | Any | Stop; recovery or support is required |

Rejected outcomes return a constrained error code to the active login or
business-signup surface. No token, provider ID, role, or app-context write occurs
for those outcomes.

## Ecosystem boundary

This makes one product-local owner clear. It does not declare MealScout,
TradeScout, or Infinity the canonical human-identity runtime for the ecosystem.
Cross-product identity may return only through an approved contract with
issuer, audience, algorithm, expiry, replay, link, unlink, collision, consent,
recovery, deletion, and audit behavior proved.

Nothing in this draft is merged, deployed, or live.
