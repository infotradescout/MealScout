# MealScout combined recovery acceptance — 13 September 2026

Application source: `74f6db262d211891d4de2bbb3b5d883a4924b33c`.
Base recovery: `12bf5eeea29675921ae22299d6057d0075ddb0ec` from PR #376.
Calendar source: `581ca028669ff89385df66864f2244dbd3f74224` from PR #375.

The calendar correction is now combined with the current recovery branch. Its
original four-file change applied cleanly by cherry-pick; it does not alter the
payment, schema, access, or notification owners. Independent review of that delta,
the date helper, and its tests found no blocking issue. The original inherited
recovery source remains preserved.

## Executed in this run

Runtime: Linux, Node 24.19.0, fresh root `npm ci`.

| Check | Current result |
| --- | --- |
| TypeScript and production client/server build | Passed |
| Parking calendar actual-component rendering | 6 passed, including Chicago/Los Angeles UTC rollover, Tokyo/Kiritimati, DST and UTC |
| Critical health behavior | 7 passed; stale, uninitialized and degraded checks still fail |
| Ordering, integrated marketplace and Stripe webhook safety suites | Passed |
| Menu/LISA creation and request recovery | 30 passed, including fresh in-memory PGlite integration fixtures |
| Additional configured CI contract commands | 27 passed; includes map, profile, public-data, SEO, signup, availability and evidence review contracts |
| Production dependency advisory audit | Zero known vulnerabilities in this run |
| Mobile readiness and strict store metadata | 20 and 19 checks passed respectively |
| Whitespace/diff check | Passed |

The 27 remaining contract commands used the same source scripts through
`node --import tsx` where their npm alias invokes the tsx CLI. The CLI's Unix
socket initialization is prohibited in this runtime, including inside the writable
workspace; loading tsx through Node avoids that unused CLI service. Test assertions
and application source were not weakened.

This run used synthetic data and simulated providers. It performed no production
database writes, provider charges/refunds, customer messaging, or deployment.

## Gates still open

- Native PostgreSQL 16 acceptance could not run here. Docker is absent; the runtime
  runs as root and attempting to use the existing unprivileged user fails with
  `cannot set groups: Operation not permitted`. No system permissions or database
  root check was changed. PGlite menu proof is not native concurrency proof.
- No browser page was verified in this run. The standard Playwright download timed
  out or returned a gateway error. An npm-packaged Chromium binary could report its
  version, but both ordinary and documented serverless launch configurations exited
  with SIGTRAP before opening a page. No browser assertions ran or were bypassed.
- The September 12 report retains its historical 170-browser and native PostgreSQL
  evidence at its stated revisions. Those results do not become fresh acceptance
  of this combined candidate merely because the calendar change is small.
- The inherited 120-file implementation still needs full independent review, the
  deployed migration 142 ledger must be checked, and designated Stripe test plus
  authenticated business journeys need acceptance before production release.
- GitHub CI and final frontend/backend production revision checks remain required.

## Evidence retention

Current command logs and hashes are recorded in
`docs/evidence/combined-recovery-2026-09-13/validation.json`.
Local logs are retained in the active workspace and are identified there. This is
current local evidence, not a claim that hosted CI or the earlier Windows disk was
accessed. The report commit itself changes documentation only.

