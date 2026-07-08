# MealScout UI — Served-State & Stale-Surface Audit (2026-07-06)

> Read-only truth/control lane. No runtime changes, no UI changes, no refactors, no deletions.
> Purpose: prove what production actually serves, find stale/dead/duplicate surfaces, locate the
> files that own the bad UI, and define a narrow first implementation lane.

---

## 1. Decision

**BLOCK UI implementation pending served-state truth confirmation by the operator.**

The repository-side truth is now mapped (routes, owners, deploy topology, token system). Three
facts still require live confirmation that only the operator can produce (deployed commit SHA,
which host serves human traffic, and production screenshots). Until those three are confirmed,
UI rebuild work must not start, because the largest Scout file in the repo
(`client/src/pages/explore-preview.tsx`) is **no longer routed** and polishing it would be wasted
or harmful effort.

> **Update (follow-up cleanup lane):** the §2 working-tree blockers were resolved. The in-progress
> recenter-button collision fix was committed as its own narrow bugfix lane
> (`58216f80`, `client/src/pages/explore-preview-v2.tsx`), and the stray `verify_owner_scout.mjs`
> debug script was removed. With the tree clean, this audit doc was then committed docs-only.
> Not pushed: `main` has `autoDeploy: true` (pushing would deploy), which is out of scope for a
> read-only truth lane.

---

## 2. Confirmed facts (repository truth)

| Fact | Value | Evidence |
|---|---|---|
| Active branch | `main` | `git rev-parse --abbrev-ref HEAD` |
| HEAD SHA | `3a18ed8d7e87d2eb7f143921b8b74d0b01505a06` | `git rev-parse HEAD` |
| HEAD synced with remote | `origin/main` = `origin/HEAD` at same SHA | `git log --oneline -1` |
| Remotes | `origin` → github.com/infotradescout/MealScout; `gitsafe-backup` (local mirror) | `git remote -v` |
| Working tree (at audit time) | **NOT clean**: `M client/src/pages/explore-preview-v2.tsx` (in-progress recenter-button fix), `?? verify_owner_scout.mjs` (untracked stray script) — **resolved in follow-up cleanup lane** (fix committed `58216f80`, stray script removed) | `git status --short` |
| Prior lane merged | claim-business + parking-pass work landed via PR #205 (`f3819442`) and is now in `main` | `git log --oneline -20` |
| Frontend host (inferred) | **Vercel** builds the SPA: `buildCommand: npm run build:client`, `outputDirectory: client/dist`; SPA fallback rewrite `/:path((?!assets/|static/).*)` → `/index.html` | [vercel.json](../../vercel.json) |
| Canonical domain | `www.mealscout.us` (redirect `mealscout.us` → `www.mealscout.us`) | [vercel.json](../../vercel.json) |
| API / SSR origin | **Render**: `mealscout.onrender.com`, `buildCommand: npm ci --include=dev && npm run build:platform`, `startCommand: npm run start` (`node dist/server/index.js`), `autoDeploy: true` | [render.yaml](../../render.yaml), [package.json](../../package.json) |
| API proxy | Vercel rewrites `/api/*` → `https://mealscout.onrender.com/api/$1` | [vercel.json](../../vercel.json) |
| SEO/bot SSR | Vercel rewrites bot/crawler + `?prerender` entity routes and `sitemap.xml`/`llms.txt`/`ai.txt` → Render | [vercel.json](../../vercel.json) |
| Production version marker | `GET /api/version` reports the deployed commit SHA (referenced repeatedly in ops docs) | grep `/api/version`; [docs/MEALSCOUT_LAUNCH_SURFACE_AUDIT.md](../MEALSCOUT_LAUNCH_SURFACE_AUDIT.md) |
| Health marker | `GET /api/health` (self-ping keep-warm every 4 min) | [KEEP_WARM_GUIDE.md](../../KEEP_WARM_GUIDE.md) |
| Tailwind config | Root `tailwind.config.ts` simply re-exports `client/tailwind.config.ts` — **not** a conflicting duplicate | [tailwind.config.ts](../../tailwind.config.ts) |
| Theme system | CSS-variable driven, `.theme-day` (warm cream `#f7f5f1`) and `.theme-night` (warm charcoal `#1c1a18`) | [client/src/index.css](../../client/src/index.css) |

---

## 3. Unknowns (require operator/live verification — do NOT guess)

1. **UNKNOWN — actual deployed commit SHA in production.** Must be read live from
   `https://mealscout.onrender.com/api/version` (Render) and from the Vercel deployment's
   `VERCEL_GIT_COMMIT_SHA`. Repo HEAD is `3a18ed8d`; whether production is serving that exact SHA
   is unverified from inside the repo.
2. **UNKNOWN — which host serves human traffic at `www.mealscout.us`.** vercel.json strongly
   implies Vercel serves the SPA and proxies API to Render, but the live DNS/domain mapping cannot
   be confirmed from the repo.
3. **UNKNOWN — production visual state.** No production screenshots are in scope. Whether a given
   "bad UI" observation is production or a local/stale preview cannot be settled without a
   screenshot taken against `www.mealscout.us` with the `/api/version` SHA recorded at the same time.
4. **UNKNOWN — Vercel edge/CDN cache freshness.** Asset cache headers are `max-age=31536000,
   immutable` for `/assets/*` and `/static/*`; a stale HTML shell pointing at old hashed assets
   cannot be ruled out without a live check.
5. **UNKNOWN — Render deploy branch.** `render.yaml` does not pin a branch; the deploy branch is
   configured in the Render dashboard (assumed `main`, unconfirmed).

---

## 4. Route inventory (served-state map)

Legend for status: **LIVE** = routed + reachable; **REDIRECT** = routed but forwards elsewhere;
**DUPLICATE** = alias of a LIVE route; **DEAD** = imported but not routed; **STALE?** = reachable
but likely superseded; **UNKNOWN** = needs live confirmation.

| Route | User purpose | Source file | Component | Status | Evidence | Visual problem (repo-side) | Risk if changed | Priority |
|---|---|---|---|---|---|---|---|---|
| `/` (guest) | Landing / first paint | `client/src/pages/welcome.tsx` | `Welcome` | LIVE | App.tsx L434 | Unknown until prod screenshot | Med (first impression) | **P1** |
| `/` (authed) | Redirect to Scout | — | `RedirectToScout` | REDIRECT | App.tsx L464-165 | n/a | Low | — |
| `/scout`, `/scout/:refTag` | **Primary public discovery** | `client/src/pages/explore-preview-v2.tsx` | `ScoutPageV2` | LIVE | App.tsx L435-438, 465-468 | Map overlay + dark cards (operator report) | **High** (core surface) | **P1** |
| `/directory`, `/directory/:refTag` | Discovery alias | `explore-preview-v2.tsx` | `ScoutPageV2` | DUPLICATE | App.tsx L437-438 | same as /scout | High | follows /scout |
| `/scout-v2` | Discovery alias | `explore-preview-v2.tsx` | `ScoutPageV2` | DUPLICATE | App.tsx L440,470 | same as /scout | Low | consider consolidating (later) |
| `/scout-prototype` | Old prototype | `client/src/pages/scout-prototype.tsx` | `ScoutPrototype` | STALE? (routed, reachable) | App.tsx L439,469 | prototype styling | Low | do-not-touch (deprecate later) |
| `/map`, `/trending` | Legacy map/trending | — | `RedirectToScout` | REDIRECT → /scout | App.tsx L283-284 | n/a (no standalone map surface) | Low | — |
| (old `/scout` owner) | Superseded discovery | `client/src/pages/explore-preview.tsx` | `ScoutPage` | **DEAD (imported, not routed)** | imported App.tsx L145; **no `<Route ... component={ScoutPage}>` exists** | N/A — not served | n/a | **DO NOT POLISH** |
| Public profiles: `/restaurant/:id`, `/truck/:slug`, `/bar/:slug`, `/location/:slug`, `/supplier/:slug`, `/p/:type/:id`, clean `/:businessSlug` | Business profile | `client/src/pages/public-profile.tsx` | `PublicProfilePage` | LIVE | App.tsx SharedPublicRoutes L300-345, L455-458 | Unknown until prod screenshot | **High** | **P2** |
| `/search` | Search results | `client/src/pages/search.tsx` | `Search` | LIVE | App.tsx L282 | Unknown | Med | **P3** |
| `/claim-business`, `/claim-truck` (+`/:refTag`) | Claim/update profile | `client/src/pages/claim-truck.tsx` | `ClaimTruckPage` | LIVE | App.tsx L443-448, 473-478 | Unknown | Med | **P4** |
| `/restaurant-signup` | Onboarding / claim target | `client/src/pages/restaurant-signup.tsx` | `RestaurantSignup` | LIVE | App.tsx L441,471 | Unknown | Med (funnel) | **P4** |
| `/login` | Login | `client/src/pages/login.tsx` | `Login` | LIVE (eager) | App.tsx L16, L440 | Unknown | Med | **P5** |
| `/customer-signup` (+`/:refTag`) | Consumer signup | `client/src/pages/customer-signup.tsx` | `CustomerSignup` | LIVE | App.tsx L441-442 | Unknown | Med | **P5** |
| Guest nav / header | Global navigation | `client/src/components/navigation.tsx` | `Navigation` | LIVE | App.tsx L8 | Unknown | High (global) | **P1 (with /scout)** |
| `/parking-pass` | Parking Pass (host+truck) | `client/src/pages/parking-pass.tsx` | `ParkingPassPage` | LIVE | App.tsx L344 | Verified functional (prior audit) | High | **P6** |
| `/admin/*` | Operator surfaces | `client/src/pages/admin-*`, `AdminControlCenter`, etc. | many | LIVE (authed) | App.tsx L487-520 | Cold admin panels acceptable | High | **P7 (last)** |

Note: the `/:businessSlug` catch-all at App.tsx L455-458 (guest) routes clean affiliate slugs to
`CleanPublicProfileRoute`; this makes accidental route collisions possible and should be treated
as high-risk when adding any new top-level public route.

---

## 5. UI system inventory & classification

Source of truth: [client/src/index.css](../../client/src/index.css) + [client/tailwind.config.ts](../../client/tailwind.config.ts).

| Element | Current state | Classification |
|---|---|---|
| Theme model | CSS-var driven day/night themes (`.theme-day`, `.theme-night`) | **Keep** |
| Day background | Warm cream `--bg-app: #f7f5f1`, layered warm gradient | **Keep** (matches "warm local" north star) |
| Night background | Warm charcoal `--bg-app: #1c1a18` | **Keep** |
| Night **card** color | `--bg-card: #111111` (near-black) — **colder/darker than the `#1c1a18` warm-charcoal app bg** | **Repair** (this is the "dead black card" the operator dislikes) |
| Primary accent | `--action-primary: #ff5a2f` / `#ff4d2e` (orange ember) | **Keep** (on-brand) |
| Accent hover | `--action-hover: #ff6b52` / `#ff7a45` | **Keep** |
| Radius | `--radius: 18px` (large, soft) | **Keep** (mobile-friendly) |
| Fonts | `Space Grotesk` (body), `Bebas Neue` (display) | **Keep** |
| Status/trust colors | success/warning/error tokens defined per theme | **Keep** |
| Deploy-verification hacks | `/* NUCLEAR CSS TEST */`, `/* Deploy trigger */` comments at top of index.css | **Delete candidate** (housekeeping, non-urgent) |
| Scout map overlay | Absolutely-positioned badges/buttons that recently collided (recenter vs "Live/Open" badge) | **Repair** (fix in progress in explore-preview-v2.tsx) |
| Food imagery usage | Present in Scout rails; density unknown until prod screenshot | **Unknown until production screenshot** |
| Empty-state patterns | Present but not inventoried per-surface | **Unknown until production screenshot** |
| Card/result card patterns | Multiple card treatments across Scout/profile | **Unknown until production screenshot** |

Key token finding: the warm-vs-black inconsistency is **at the token level** (`--bg-card` in
`.theme-night`), which means a single, safe token change could warm every night-mode card at once
— a high-leverage, low-risk repair. **Not performed in this read-only lane.**

---

## 6. Stale / dead / duplicate / conflict findings

1. **DEAD CODE (high signal): `client/src/pages/explore-preview.tsx` (`ScoutPage`) is imported but
   not routed.** All `/scout`, `/directory`, `/scout-v2` routes now point to `ScoutPageV2`
   (`explore-preview-v2.tsx`). `ScoutPage` remains lazily imported at App.tsx L145 with zero
   `<Route>` usages. **Implication:** any "make Scout look better" effort spent in
   `explore-preview.tsx` is wasted — it is not served. Do not delete in this lane; flag for a
   later cleanup lane.
2. **STALE CONTRACT TESTS reference the old route wiring (RESOLVED 2026-07-08).** Several contract tests
   previously asserted `<Route path="/scout" component={ScoutPage} />` /
   `/directory/:refTag component={ScoutPage}`:
   - `scripts/mealscout-affiliate-referral-capture.contract.test.ts` (L89)
   - `scripts/mealscout-public-auth-route-boundary-audit.contract.test.ts` (L107)
   - `scripts/MEALSCOUT_REFERRAL_DOCTRINE.contract.test.ts` (L81)
   - `scripts/mealscout-referral-attribution-health.contract.test.ts` (L110)
   Because live routing now uses `ScoutPageV2`, these assertions were drifted. They now assert
   `ScoutPageV2` route ownership while preserving the same referral/auth route coverage.
3. **STALE DOCS (RESOLVED 2026-07-08):** `MEALSCOUT_ROUTE_MAP.md` and
   `MEALSCOUT_C7_OWNER_DASHBOARD_CONTEXT.md` now state `/scout` routes to `ScoutPageV2`
   (`client/src/pages/explore-preview-v2.tsx`).
4. **DUPLICATE DISCOVERY ALIASES:** `/scout`, `/directory`, `/scout-v2` all render the same
   `ScoutPageV2`. Not harmful, but three public aliases of one surface can dilute canonical URLs;
   revisit for SEO canonicalization later (not a UI-rebuild blocker).
5. **PROTOTYPE STILL REACHABLE:** `/scout-prototype` → `scout-prototype.tsx` remains routed and is
   referenced by multiple contract tests (`scout-*.contract.test.ts`). Treat as deprecated-but-live;
   do not touch during the UI rebuild.
6. **VERCEL/RENDER SERVING AMBIGUITY (see §3):** two builds of the frontend exist —
   Vercel `build:client` (client/dist, human traffic) and Render `build:platform` (dist/, API +
   bot SSR). A UI change only shows to humans once **Vercel** redeploys; verifying via
   `mealscout.onrender.com` directly can show a *different* build than `www.mealscout.us`.
7. **WORKING TREE NOT CLEAN (RESOLVED):** an in-progress `explore-preview-v2.tsx` edit
   (recenter-button collision fix) and an untracked `verify_owner_scout.mjs` were present. Both
   were resolved in the follow-up cleanup lane — the fix was committed on its own (`58216f80`) and
   the stray script was removed — clearing the way for this docs-only commit.

---

## 7. Recommended first implementation lane (after Gemini PASS)

**Lane name: "MealScout Public Discovery Surface Rebuild — `/scout` (ScoutPageV2) only."**

- Target the single route a first-time user actually lands on for discovery: `/scout` →
  `explore-preview-v2.tsx`, plus the global `navigation.tsx` shell that frames it.
- First, land the highest-leverage, lowest-risk token repair: warm the night-mode card token
  (`--bg-card` in `.theme-night`) so cards stop reading as dead black. One change, whole-app
  consistency, easy to revert.
- Then refine only the Scout compact-map overlay + primary discovery cards on that one surface to
  match the north star (warm charcoal, food imagery, one primary action, short copy, clear
  "Open now / Menu / Schedule / Directions").
- **Do not** touch other routes until `/scout` looks correct in production (verified by screenshot
  + matching `/api/version` SHA).

---

## 8. Files that should be touched FIRST (next lane)

- `client/src/pages/explore-preview-v2.tsx` (the LIVE Scout surface)
- `client/src/components/navigation.tsx` (global shell around it)
- `client/src/index.css` (single night-mode `--bg-card` token repair; no structural CSS rewrite)

## 9. Files that MUST NOT be touched yet

- `client/src/pages/explore-preview.tsx` (DEAD — not served; do not polish, do not delete in a UI lane)
- `client/src/pages/scout-prototype.tsx` (deprecated-but-live; contract-test bound)
- All `server/**` (no runtime/API/auth/payment changes)
- `shared/schema/**` (no schema changes)
- `vercel.json`, `render.yaml`, deploy scripts (no deploy-topology changes)
- Any `scripts/*.contract.test.ts` (referral/auth drift is a separate, operator-decided lane)
- Public profile, search, claim, login/signup, admin surfaces (later priorities P2–P7)

---

## 10. Screenshot / production verification checklist (operator)

Perform these against **production** and record results before UI work starts:

- [ ] Open `https://mealscout.onrender.com/api/version` — record the reported commit SHA.
- [ ] Confirm that SHA matches repo `main` HEAD `3a18ed8d...` (or note the difference).
- [ ] In the Vercel dashboard, record the deployed `VERCEL_GIT_COMMIT_SHA` for `www.mealscout.us`.
- [ ] Confirm `www.mealscout.us` is served by Vercel (not Render) for human traffic.
- [ ] Load `www.mealscout.us/scout` on a real phone; screenshot the compact map + first cards.
- [ ] Load `www.mealscout.us/` (Welcome) on a phone; screenshot the first paint.
- [ ] Load one public profile (`/truck/...`) on a phone; screenshot.
- [ ] Hard-refresh (cache-bust) each and confirm the screenshots reflect the current SHA, not a
      cached shell.
- [ ] Note whether the "dead black card" appears in night mode specifically (confirms §5 token finding).
- [ ] Confirm `/scout-prototype` and any `explore-preview.tsx`-era screen are NOT what production serves.

## 11. Gemini audit checklist (objector)

- [ ] Confirm Claude stayed inside MealScout only and made no runtime/UI changes.
- [ ] Confirm branch/HEAD SHA and deploy topology (Vercel SPA + Render API/SSR) are correctly stated.
- [ ] Confirm the live/stale/dead/duplicate route table is backed by file:line evidence.
- [ ] Confirm confirmed-facts vs unknowns are cleanly separated (esp. deployed SHA, host mapping, screenshots).
- [ ] Confirm the DEAD `explore-preview.tsx` finding and the stale referral/auth contract-test drift are correctly characterized.
- [ ] Confirm the first lane is narrow (`/scout` + nav + one token), not a broad rewrite.
- [ ] Confirm no generic SaaS/dashboard assumptions were introduced.
- [ ] Confirm working capabilities are preserved (no deletions, no route rewrites).
- [ ] Verdict: PASS / PASS WITH CONDITIONS (list missing evidence) / BLOCK (state blocker + minimal repair).
