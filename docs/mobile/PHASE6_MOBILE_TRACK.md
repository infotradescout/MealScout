# Phase 6 Mobile App Track

Execution order follows `MASTER_PLAN.md`:

## 1) Wrapper Strategy (Capacitor Fast-Track)

- Keep web app as source of truth.
- Use Capacitor wrapper first, avoid full rewrite unless measured blockers appear.
- Root config scaffold: `capacitor.config.ts`.
- Native scaffolds:
  - `android/`
  - `ios/`

Standard local flow:

```bash
npm run cap:prepare
```

Platform-specific first-time setup:

```bash
npm run cap:add:android
npm run cap:add:ios
```

## 2) Mobile Readiness Validation

Run:

```bash
npm run check:mobile-readiness
```

Current validation coverage:

- PWA manifest and service worker presence.
- Native Android/iOS scaffold presence.
- Install route and install page availability.
- Router auth/session loading guard.
- Core deep-link routes remain registered.
- Geolocation runtime usage is present.
- Push notification preference controls are present.

Runtime deep-link smoke:

```bash
# PowerShell
$env:SMOKE_BASE_URL="http://127.0.0.1:5000"; npm run smoke:mobile-deeplinks

# bash/zsh
SMOKE_BASE_URL=http://127.0.0.1:5000 npm run smoke:mobile-deeplinks

# auto-start backend and run smoke
npm run smoke:mobile-deeplinks:with-server
```

CI enforcement:

- `.github/workflows/ci.yml` runs:
  - `npm run check`
  - `npm run check:mobile-readiness`
  - `STRICT_STORE_METADATA=true npm run check:store-readiness`

## 3) Store Readiness Checklist

Use this before TestFlight/Internal testing submission:

- App name, icon set, splash assets finalized.
- Privacy policy/data safety text reviewed and published.
- Screenshots captured for phone form factors.
- Build + smoke pass for iOS and Android wrappers.
- Auth/session sign-in persistence verified after app restart.
- Deep-link entry checks run for:
  - `/deal/:id`
  - `/event/:slug`
  - `/menu/:restaurantId`
  - `/checkout/:restaurantId`
- Geolocation permission flow verified:
  - first prompt
  - denied -> recovery UX
  - granted -> expected behavior
- Push settings toggles verified and reflected in UX.

## 4) Promote to Submission

- Internal build -> limited external testing -> full submission.
- Record issues by severity and route; fix regressions before widening rollout.
