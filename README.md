# MealScout

MealScout powers food truck, host, and restaurant discovery, bookings, and admin tools.

What's here
- `client/` - web app UI
- `server/` - API + background services
- `shared/` - database schema + shared types
- `scripts/` - ops and verification scripts
- `archive/docs/` - completed implementation/testing/launch docs (historical reference)

Active docs and maintenance
- `MASTER_PLAN.md` - active planning and implementation context
- `ROUTES_MAP.md` - route and flow reference
- `TEST_MANUAL_ONBOARDING.md` - manual test and onboarding notes
- `BUILD_OUTPUTS.md` - generated output directories and cleanup expectations
- `BACKEND_HOTSPOTS.md` - current backend refactor seams and hotspot map
- `EMBED_CONTRACT.md` and `API_ACTIONS.md` - TradeScout integration (do not modify)

Local prerequisites
- Node.js 20-24
- Git
- Both `node`/`npm` and `git` available on your shell `PATH`

Quick start (dev)
```bash
npm install
npm run dev:server
npm run dev
```

Useful commands
```bash
npm run doctor
npm run check
npm run build
npm run test:flows:e2e
```

License
MIT

Build trigger: 2026-02-08
