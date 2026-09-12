# Marketplace production recovery — 12 September 2026

This is a set of targeted repairs on a preserved marketplace work branch,
not a production release or acceptance of the entire inherited implementation.
Draft [PR #376](https://github.com/infotradescout/MealScout/pull/376) is the review surface.
Lane: `critical-bug-fix`.

Application source reference: `5df8d2a919d826ada0e054ba4e56811f74b7b76a`.
The [validation manifest](evidence/production-recovery-2026-09-12/validation.json)
records individual results, log hashes and their dates. Later commits containing
only this report and its evidence do not change the application source.

## Scope and source

The recovery branch preserves the original unfinished marketplace, service-date,
notification, County Map, menu and migration work in `866b1e85`, then integrates
main at `6090296ef242cc6c0ce909860ebb6c1d1a2f8fb8`. The preserved work includes 120
source files; the entire inherited implementation has not had an independent review.
All 139 files in the original working-directory snapshot retained their original
SHA-256 values when checked on 12 September. Work was performed in an isolated worktree.

The separate calendar correction remains stacked in
[PR #375](https://github.com/infotradescout/MealScout/pull/375); this report does not
claim its changes are part of #376.

## Repairs

- Correct destination-charge settlement and cancellation accounting. A destination
  transfer contains the gross charge; an application fee is returned to the platform.
  Refund recovery now returns the fee before reversing the gross transfer. Stored
  plans with incompatible amounts require intervention before any provider effect.
  The stateful provider fixture models connected and platform balances, retry recovery,
  and partial refunds. Its balances explicitly exclude Stripe processing fees.
- Align public ordering status with operational readiness and use an honest
  unavailable message. Preserve ownership, payment and fulfillment checks.
- Reject unavailable parking-pass listings before generating fallback map pins.
  Verify both a visible active host and an absent deleted host in the expanded map.
  Restore readable overlays and usable fallback map controls. Default map tiles to
  OpenStreetMap with visible attribution; support an optional CARTO basemap key.
- Constrain mobile About cards, glossary and links so narrow layouts and fallback
  fonts do not push content beyond the page. Remove empty-query placeholder copy.
- Reject HTTP 503, SPA HTML, uninitialized checks, failed checks and stale watchdog
  evidence in critical-route smoke checks. Start periodic, non-overlapping watchdog
  probes without sending scheduled alert emails. Unproven health starts unavailable.
- Add missing financial, ordering, menu, dependency and smoke checks to CI. Repair
  obsolete test fixtures and assertions to follow the canonical booking service and
  venue-day filters without relaxing payment or visibility rules.
- Update vulnerable npm dependencies, including MapLibre, and adapt its imports.
  Remove the obsolete pnpm lockfile: CI, Render, Vercel and local documentation now
  consistently use root `npm ci` and `package-lock.json`. The empty client lockfile
  belongs to the dependency-free client manifest and is retained.
- Set Node 24 across package engines, local version files, CI and the Render blueprint.
  The local validation runtime is Node 24.14.1. The former Node 20 configuration is
  [end-of-life](https://nodejs.org/en/about/eol); Node 24 is supported by
  [Render](https://render.com/docs/node-version) and
  [Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

## Validation and limits

Validation ran on Windows with Node 24.14.1. Browser tests use a built client with
synthetic API responses and a synthetic publishable Stripe key. No live payments,
emails, production database mutations or application deployment were initiated by
these checks. GitHub's configured Vercel integration creates branch previews.

| Check | Result and scope |
| --- | --- |
| Root npm installation | Fresh isolated `npm ci` earlier in recovery; final `npm ci --ignore-scripts --dry-run` passes |
| Dependency advisory audit | Final `npm audit` reports zero known vulnerabilities across production and development dependencies |
| TypeScript and production build | `npm run check` and `npm run build` pass after final runtime and CSS changes |
| Browser journeys | Final matrix: 169/170 pass across desktop Chrome, Firefox, WebKit, mobile Chrome and mobile WebKit. The remaining supplier case could not load a local React asset (`ERR_CONNECTION_FAILED`); five consecutive focused reruns pass. The complete matrix is not reported as green. All About layout and map cases pass in this matrix. |
| Menu creation/LISA | 30 checks pass; built-client desktop/mobile retry, reload, receipt integrity and unavailable-storage cases pass with synthetic APIs |
| Marketplace and payment checks | Integrated marketplace, ordering truth, Stripe webhook safety, public-data boundary, SEO and Render migration-gate suites pass |
| PostgreSQL provider recovery | Full stateful suite passes on a fresh native PostgreSQL 16.14 fixture after applying migrations 090 and 142; external providers are simulated |
| Discovery and existing CI contracts | 25 remaining CI suites pass after repairing two stale assertions; capacity, parking host truth and County Map checks also pass |
| Critical-route failure detection | Seven behavior checks pass, including stale/uninitialized health and read-only scheduled refreshes |
| Mobile/store metadata | Mobile-readiness and strict store-metadata checks pass; these do not establish app-store acceptance |
| Independent financial challenge | Two concrete destination-settlement/refund findings were corrected and re-reviewed; this is not a full-branch review or live provider acceptance |

Earlier browser runs exposed real Safari overflow and a local-server connection
failure. The overflow repairs were retained; a focused five-run search repetition
passed. The final supplier trace also identifies a failed local asset connection,
before React initialized, rather than a tested role redirect. Its focused reruns
passed without changing the role routing or assertion. A clean whole-workflow run
on a stable CI host is still required; passing reruns do not erase the failed run.

Raw logs, screenshots, original-WIP snapshot and SHA-256 evidence are retained at
`D:\ms-production-recovery-20260909\evidence`. They are local evidence, not GitHub CI
results. No production success rates or latency measurements have been inferred
from fixture pass counts.

## Release blockers and next checks

1. GitHub Actions did not execute the candidate's CI job. Its annotation says:
   “The job was not started because your account is locked due to a billing issue.”
   Restore account execution and run the complete configured workflow on the reviewed
   candidate. The Vercel preview status does not replace backend or migration CI.
2. Docker's Linux engine is unavailable on this machine. Native PostgreSQL stateful
   proof does not establish the dedicated Docker/PostgreSQL-16 migration acceptance
   command or its concurrency and constraint checks. Run that gate before release.
3. Validate the financial path against an explicitly designated Stripe test environment
   and authenticated business journeys. The original large implementation and migration
   need human review beyond the bounded independent challenge performed here.
4. Inspect the target database's migration ledger before approving migration 142.
   Its deployed/applied state was not established. If an earlier form was applied,
   create and rehearse a forward migration; do not edit its recorded fingerprint or
   force an already-applied migration to replay.
5. Production Render still reports main `6090296e`. Its basic readiness check returns
   ready, but the stronger critical smoke correctly fails because the endpoint watchdog
   is still uninitialized. Public `/health/*` URLs return SPA HTML; health smoke now
   targets the backend host explicitly. Verify fresh endpoint probes and both frontend
   and backend revisions after an approved release.

The default branch's 102 open dependency alerts were observed before this candidate
was merged: 80 referenced the obsolete pnpm lock, 21 the old npm lock, and one the
manifest. A clean branch audit does not claim those default-branch alerts are closed.

## Review, metrics and rollback

Owner: `@infotradescout`. Non-author GitHub reviewer: unassigned. Scope is payment,
booking, discovery, health and mobile reliability plus preserved pre-existing work;
there is no new monetization design in these recovery fixes. This is not a pure refactor.

Before-release operational metrics remain unavailable. The metrics log records this
honestly; the after-deploy snapshot must be collected after release. Do not replace
auth, booking or payment rates with local fixture pass percentages.

Before releasing, capture deployed revisions and the migration ledger. A code rollback
does not undo provider money movements or new ledger rows. Pause affected writes and
recovery jobs before any financial rollback, reconcile provider effects, and use a
reviewed forward migration for applied schema corrections. Do not delete purchase,
refund or notification history to simulate rollback. This recovery has not merged or
promoted a production deployment.
