# MealScout Authenticated Production Smoke P2 Accounts And Secrets

Status: `BLOCKED_PENDING_EXTERNAL_CONFIGURATION`

P2 defines the approved smoke identities, production base URL inputs, secret handling rules, and read-only verification requirements needed before authenticated production smoke can run.

This artifact is documentation and contract coverage only. It does not contain credentials, cookies, passwords, tokens, production secret values, live session material, screenshots of secrets, or successful authenticated production smoke evidence.

Authenticated production smoke remains BLOCKED until an operator confirms the required accounts and env/secrets exist outside the repo.

## P2 Scope

P2 is complete only when the team has all of the following outside the repository:

- Dedicated customer smoke account.
- Dedicated owner smoke account.
- Dedicated admin or staff smoke account.
- Production base URLs for public and API surfaces.
- Cookie/login strategy for each authenticated role.
- Read-only database verification path.
- Confirmation that no credentials or production secrets are stored in committed files.

P2 does not authorize live authenticated smoke execution.

## Approved Customer Smoke Account Requirements

The customer smoke account must be a dedicated production identity used only for smoke verification.

Required external facts:

- `CUSTOMER_SMOKE_EMAIL`
- `CUSTOMER_SMOKE_USER_ID`
- `CUSTOMER_SMOKE_AUTH_STRATEGY`
- `CUSTOMER_SMOKE_COOKIE` or `CUSTOMER_SMOKE_PASSWORD`

Rules:

- Email must be smoke-only and not a real customer identity.
- Account must have notification preferences set to the safest available mode.
- Account must not own merchant, host, supplier, payout, or staff privileges.
- Customer smoke checks must be read-only unless a later gate approves reset/cleanup and notification isolation.
- Booking, claim, redeem, review, favorite/follow, message, public content, and notification-capable writes remain blocked.

## Approved Owner Smoke Account Requirements

The owner smoke account must be a dedicated production identity tied only to smoke business fixtures.

Required external facts:

- `OWNER_SMOKE_EMAIL`
- `OWNER_SMOKE_USER_ID`
- `OWNER_SMOKE_AUTH_STRATEGY`
- `OWNER_SMOKE_COOKIE` or `OWNER_SMOKE_PASSWORD`
- `OWNER_SMOKE_BUSINESS_ID`
- `OWNER_SMOKE_RESTAURANT_ID`
- `OWNER_SMOKE_SUBSCRIBED_RESTAURANT_ID`
- `OWNER_SMOKE_UNSUBSCRIBED_RESTAURANT_ID`

Rules:

- Owner account must not control real merchant content.
- Smoke business/profile records must contain durable smoke markers.
- Smoke business/profile records must be excluded from public discovery, maps, search, SEO feeds, Scout, recommendations, and aggregate public feeds before any smoke run.
- Owner smoke checks must be read-only until fixture quarantine, reset/cleanup dry-run, notification isolation, and payment no-op boundaries are approved.
- Profile, menu, schedule, image upload, order, payout, subscription, and external provider mutations remain blocked.

## Approved Admin Or Staff Smoke Account Requirements

The admin/staff smoke account must be a dedicated production identity for read-only route access checks.

Required external facts:

- `ADMIN_SMOKE_EMAIL`
- `ADMIN_SMOKE_USER_ID`
- `ADMIN_SMOKE_ROLE`
- `ADMIN_SMOKE_AUTH_STRATEGY`
- `ADMIN_SMOKE_COOKIE` or `ADMIN_SMOKE_PASSWORD`

Rules:

- Account must have only the minimum role required for approved read-only admin/staff smoke checks.
- Production admin user creation, manual provisioning, password reset, verification resend, import ingestion, evidence application, payout actions, moderation actions, subscription changes, and notification sends remain blocked.
- Admin/staff checks should use read-only endpoints or safe negative checks against nonexistent ids.

## Required Production Env And Secret Names

These names must be defined in Render env vars, local shell env, or an approved password manager before authenticated production smoke is unblocked. Values must never be committed.

Production base URLs:

- `SMOKE_PUBLIC_BASE_URL`
- `SMOKE_API_BASE_URL`
- `SMOKE_BASE_URL`
- `SMOKE_ORIGIN`
- `ADMIN_SMOKE_BASE_URL`
- `ADMIN_SMOKE_ORIGIN`

Customer smoke inputs:

- `CUSTOMER_SMOKE_EMAIL`
- `CUSTOMER_SMOKE_PASSWORD`
- `CUSTOMER_SMOKE_COOKIE`
- `CUSTOMER_SMOKE_USER_ID`
- `CUSTOMER_SMOKE_AUTH_STRATEGY`

Owner smoke inputs:

- `OWNER_SMOKE_EMAIL`
- `OWNER_SMOKE_PASSWORD`
- `OWNER_SMOKE_COOKIE`
- `OWNER_SMOKE_USER_ID`
- `OWNER_SMOKE_AUTH_STRATEGY`
- `OWNER_SMOKE_BUSINESS_ID`
- `OWNER_SMOKE_RESTAURANT_ID`
- `OWNER_SMOKE_SUBSCRIBED_RESTAURANT_ID`
- `OWNER_SMOKE_UNSUBSCRIBED_RESTAURANT_ID`
- `ORDERING_OWNER_EMAIL`
- `ORDERING_OWNER_PASSWORD`
- `ORDERING_OWNER_COOKIE`
- `ORDERING_SUBSCRIBED_RESTAURANT_ID`
- `ORDERING_UNSUBSCRIBED_RESTAURANT_ID`

Admin/staff smoke inputs:

- `ADMIN_SMOKE_EMAIL`
- `ADMIN_SMOKE_PASSWORD`
- `ADMIN_SMOKE_COOKIE`
- `ADMIN_SMOKE_USER_ID`
- `ADMIN_SMOKE_ROLE`

Production app prerequisites:

- `DATABASE_URL`
- `SESSION_SECRET`
- `PUBLIC_BASE_URL`
- `SITEMAP_SITE_URL`
- `CLIENT_ORIGIN`
- `PROD_GATE_PUBLIC_BASE_URL`
- `PROD_GATE_API_BASE_URL`
- `STRIPE_SECRET_KEY`
- `VITE_STRIPE_PUBLIC_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `BREVO_API_KEY`

Read-only DB verification inputs:

- `PROD_READONLY_DATABASE_URL`
- `PROD_DB_READONLY_ROLE`
- `PROD_DB_READONLY_SSLMODE`
- `PROD_DB_VERIFY_MAX_ROWS`

Notification and payment controls:

- `EMAIL_NOTIFICATIONS_MODE`
- `SMS_NOTIFICATIONS_MODE`
- `SOCIAL_AUTOPUBLISH_ENABLED`
- `DRIP_CAMPAIGNS_ENABLED`
- `SCHEDULER_ENABLED`
- `MEALSCOUT_BYPASS_STRIPE`
- `MEALSCOUT_TEST_MODE`

## Credential Storage Rules

Allowed locations:

- Render environment variables.
- Local shell environment variables.
- Approved password manager records.
- Approved secret manager records.
- Temporary operator terminal session that is not logged into committed artifacts.

Forbidden committed locations:

- Markdown documents.
- JSON fixtures.
- TypeScript, JavaScript, shell, SQL, or config files.
- Screenshots or image evidence.
- Test snapshots.
- GitHub issue comments that will be copied into repo artifacts.
- `.env`, `.env.local`, `.env.production`, `.npmrc`, cookies files, HAR files, browser storage exports, or log files.

Forbidden secret material:

- Passwords.
- Session cookies.
- JWTs.
- API tokens.
- Stripe secret keys.
- Stripe webhook secrets.
- Brevo/API provider keys.
- Database connection strings.
- Production admin/staff credentials.
- Real customer, owner, merchant, host, supplier, or payout identities.

## Cookie And Login Secret Strategy

Each authenticated role must choose one approved strategy before live smoke:

- Cookie strategy: operator obtains a short-lived smoke-only session cookie outside the repo and exports it as the role-specific `*_SMOKE_COOKIE` env var.
- Login strategy: operator stores the smoke-only email/password outside the repo and exports them only in the local shell or deployment secret store.

Pass criteria:

- Cookie or password values are never printed, logged, screenshotted, or committed.
- Smoke runner redacts all credential-bearing env vars in output.
- Session material belongs only to the approved smoke identity for that role.
- Cookies expire or are rotated after the smoke window.

Fail criteria:

- Any credential value appears in the repo or evidence artifact.
- Any smoke runner accepts a non-smoke identity for authenticated production smoke.
- Any output echoes cookie, password, token, or production secret material.

## DB Read-Only Verification Path

P2 requires a production read-only verification path before authenticated production smoke is unblocked.

Required external facts:

- Read-only database URL or read-only database role.
- Network access path for the operator or CI environment.
- Query list limited to smoke fixture identity, fixture isolation, public exclusion, and no-side-effect verification.

Rules:

- Verification user must not have insert, update, delete, truncate, alter, drop, create, or execute privileges for mutating functions.
- Queries must be select-only and bounded.
- Evidence may include row ids, smoke markers, and boolean verification results.
- Evidence must not include passwords, cookies, tokens, connection strings, secret env values, or sensitive PII.

## Pass Criteria To Unblock Authenticated Production Smoke

Authenticated production smoke can move to P3 only after all P2 pass criteria are met:

- Customer smoke account is approved and externally documented.
- Owner smoke account and fixture business/profile ids are approved and externally documented.
- Admin/staff smoke account is approved and externally documented.
- Required production base URL env names are configured outside the repo.
- Required cookie/login strategy is selected for every role.
- Required production env/secret names are configured outside the repo.
- Read-only DB verification path is approved and externally documented.
- Forbidden credential storage scan passes.
- `docs/PROD_ROLLOUT_CHECKLIST.md` still blocks authenticated production smoke until P2 is complete.
- No live authenticated production smoke has been run or claimed by P2.

## Fail Criteria

P2 fails and authenticated production smoke remains blocked if any of these are true:

- Any required account is missing or not approved.
- Any required env/secret name is undefined in the external secret store.
- Any credential, cookie, password, token, database URL, or real production secret is committed.
- Any smoke account maps to a real customer, merchant, host, supplier, payout, or admin identity not dedicated to smoke.
- Owner smoke fixture quarantine is not proven.
- Read-only database verification is unavailable.
- Any live authenticated smoke run is attempted before P2 approval.

## Gate Decision

Decision: `BLOCKED`

P2 defines the requirements for smoke identities and secret handling. Authenticated production smoke must not run until operators confirm every P2 pass criterion outside the repo and record only non-secret evidence.
