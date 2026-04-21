# MealScout Priority List

This checklist tracks the highest-leverage improvements for making the repo easier to work on safely and quickly.

- Canonical execution sequence: [`MEALSCOUT_DE_RISK_ORDER.md`](./MEALSCOUT_DE_RISK_ORDER.md)

- [x] 1. Fix onboarding accuracy in `README.md` so it only references docs that actually exist and sets realistic local expectations.
- [x] 2. Resolve package-management drift between the root [`package.json`](./package.json) and [`client/package.json`](./client/package.json).
- [x] 3. Add a reliable repo health command path for verification (`check`, linting, and a documented baseline workflow).
- [x] 4. Clean up tracked temp/generated artifacts and document which build outputs are intentional.
- [x] 5. Identify and carve safer seams around backend hotspot files such as `server/routes.ts` and `server/storage.ts`.

## Current Laser Focus (2026-04-19)

- Focus brief: [`docs/FOCUS_DIRECT_CONNECT_ONBOARDING_ROUTING_MESSAGING_2026-04-19.md`](./docs/FOCUS_DIRECT_CONNECT_ONBOARDING_ROUTING_MESSAGING_2026-04-19.md)
- Active lanes:
  - direct connect flows
  - onboarding flow reliability
  - role/request routing correctness
  - connect-flow messaging and notifications
