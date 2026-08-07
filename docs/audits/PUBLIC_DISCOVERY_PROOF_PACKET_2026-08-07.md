# Public Discovery Proof Packet — 2026-08-07

## Branch

`feature/public-discovery-contract-v1` (MealScout)  
Base: `756ab020`  
**Do not merge. Do not deploy.**

## Delivered this pass

| Artifact | Path |
|---|---|
| Contract v1 | `docs/governance/PUBLIC_DISCOVERY_CONTRACT_V1.md` |
| Phase 1 audit | `docs/audits/PUBLIC_DISCOVERY_PHASE1_AUDIT_2026-08-07.md` |
| Contract test | `scripts/public-discovery-contract-v1.contract.test.ts` |
| npm script | `npm run test:public-discovery-contract` |

## Database changes

None.

## Repositories changed

- MealScout only (this branch).

## Ecosystem products

Not cloned/audited live in this pass except MealScout. Matrix marks them `unknown` or `intentionally_private` by policy.

## Expected live-test failures (documented blockers)

With `PUBLIC_DISCOVERY_LIVE=1`:

1. Sitemap contains noindex truck URLs.
2. `/admin` and `/dashboard` return homepage SPA shell to GPTBot.

Offline test must still PASS.

## Next implementation slices (not started)

1. Exclude noindex/unclaimed/synthetic entities from all sitemaps.
2. Serve non-homepage responses for disallowed routes (403/404/noindex interstitial).
3. Wire discovery attribution event spine through landing → action → outcome.
4. Re-run live contract test to green before any indexing policy expansion.

## Rollback

Delete branch or revert its commits. No production flags changed.
