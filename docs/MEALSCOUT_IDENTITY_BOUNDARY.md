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

MealScout's working email, phone, Google, and Facebook authentication paths are
unchanged. Existing OAuth app-context behavior is also unchanged in this slice;
its redirect and cookie consumers require a separate finished-flow review.

Provider access-token columns and their active writers are not deleted here.
Their encryption, expiry, rotation, revocation, and consumer boundaries remain
a high-priority security evidence requirement.

## Ecosystem boundary

This makes one product-local owner clear. It does not declare MealScout,
TradeScout, or Infinity the canonical human-identity runtime for the ecosystem.
Cross-product identity may return only through an approved contract with
issuer, audience, algorithm, expiry, replay, link, unlink, collision, consent,
recovery, deletion, and audit behavior proved.

Nothing in this draft is merged, deployed, or live.
