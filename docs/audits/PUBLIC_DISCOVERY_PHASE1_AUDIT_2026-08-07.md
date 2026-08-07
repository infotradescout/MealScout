# Public Discovery Phase 1 Forensic Audit — 2026-08-07

**Scope of this packet:** MealScout repository + live production proof.  
**Other ecosystem products:** listed as `unknown` / `intentionally_private` / `out_of_repo` unless a local clone and live domain were inspected in this pass.  
**Base SHA inspected:** `756ab020a1abf7947a09e2a5472c4f50e79c63b2` (`origin/main`)  
**Branch:** `feature/public-discovery-contract-v1`  
**Merge/deploy:** not performed

## Classification key

| Label | Meaning |
|---|---|
| `pass` | Meets contract for that cell with live or repo evidence |
| `partial` | Foundation exists; material gaps remain |
| `blocked` | Hard contract failure |
| `intentionally_private` | Correctly kept private |
| `unknown` | Not inspected in this pass |

---

## MealScout matrix

| Dimension | Evidence | Status |
|---|---|---|
| Product / repo | `infotradescout/MealScout` | — |
| Official public domain | `https://www.mealscout.us` | `pass` |
| Platform hostname | `https://mealscout.onrender.com` (Render) | `pass` |
| Canonical-domain agreement | `/api/version` on both hosts reports commit `756ab020` / `RENDER_GIT_COMMIT`. Custom domain responses often show `Server: Vercel` (edge) while app version still reports Render — dual front-door, same commit. | `partial` |
| Render healthCheckPath | Empty on service `srv-d5escdh5pdvs73foo41g` | `partial` |
| robots.txt | Live `text/plain` 200; allows discovery prefixes; disallows `/admin`, `/dashboard`, `/api` (with limited `/api/public` exceptions); lists sitemap set + `llms.txt` | `pass` |
| llms.txt | Live `text/plain` 200 with product summary + priority URLs | `pass` |
| sitemap.xml | Live `application/xml` 200 (~148KB); not an HTML shell | `pass` (content-type) |
| sitemap-trucks.xml | Live XML; **845** `<loc>` entries sampled count | `partial` |
| First-response facts (bot) | GPTBot on claimed truck `3d-eats-tea` returns unique title, h1, description, JSON-LD `FoodTruck`, menu items, sameAs, `index,follow` | `pass` |
| First-response facts (browser UA) | Non-bot GET on same truck returns SPA `index.html` shell (7298 bytes, generic caching headers) — identity depends on JS for humans | `partial` |
| Thin/unclaimed in sitemap | `16-monkeys-concession` is in `sitemap-trucks.xml` but bot HTML has `noindex,follow` and default OG image | **`blocked`** |
| Unique titles/headings | Claimed prerender pages unique; generic shell title shared across `/admin` and `/dashboard` fetches | `partial` |
| Permanent addresses | `/truck/`, `/location/`, `/event/`, `/deal/`, `/bar/`, `/supplier/`, `/video/`, `/p/`, city/cuisine hubs exist in robots + routes | `pass` (architecture) |
| Structured vs visible | Claimed 3D Eats prerender JSON-LD matches visible name/area/menu highlights | `pass` (sample) |
| Thin listing gate | Unclaimed → `noindex` in `publicProfilePrerender.ts` | `pass` (code) / **`blocked`** (still sitemapped) |
| Protected routes | robots Disallow present; GPTBot `/admin` and `/dashboard` still return **homepage SPA shell** (`MealScout \| Discover Local Food Near You`) rather than 401/403/noindex interstitial | **`blocked`** |
| Training vs search crawler policy | Shared bot regex includes GPTBot/ChatGPT-User/Claude/etc.; no separate training deny policy documented in robots | `partial` |
| Source attribution | `utm_source` retained in query allowlist (`server/index.ts`); share/affiliate attribution exists; **no complete discovery→outcome event spine** named per contract (`discovery_landing` … `discovery_outcome_recorded`) observed as a single funnel | `partial` |
| Primary action | Prerender primary link often “Open profile”; secondary Scout/search links compete | `partial` |
| Freshness | Sitemap `lastmod` present; many truck lastmods clustered ~2026-07-06; claimed 3D Eats newer | `partial` |
| Live deploy matches repo tip | Yes — both domains `/api/version` → `756ab020` | `pass` |
| Overall MealScout discovery | Strong prerender/sitemap foundation; eligibility leak in sitemaps + soft protected routes | **`partial`** |

### Proven causes (MealScout)

1. **Sitemap includes noindex entities** — eligibility for robots meta and sitemap membership diverge (`publicProfilePrerender` vs `seoRoutes` sitemap queries).
2. **Protected routes fall through to SPA homepage** for crawlers — Disallow is policy-only, not enforcement.

### Likely contributors

1. Dual Vercel edge + Render origin complicates “one official door” operational mental model (currently same commit).
2. Browser UA receives SPA shell; discovery quality for humans without JS is weaker than bot path.
3. Attribution is fragmented (UTM keep + share refs + owner analytics) rather than one discovery funnel.

### Supporting factors

- Server prerender for bots is real and content-rich for claimed profiles.
- `llms.txt` / multi-sitemap architecture matches the intended foundation described in the mission brief.
- Claimed incomplete listings are intended to stay noindex (code path exists).

### Unknowns

- Exact fraction of sitemap URLs that are `noindex` vs `index`.
- Whether Google/OpenAI deep-page coverage gap is caused mainly by noindex density, canonical confusion, or thin content.
- Full ChatGPT human referral → MealScout conversion instrumentation in production analytics.
- Ecosystem products outside this repository (see matrix below).

---

## Ecosystem readiness matrix (this pass)

| System | Discovery position | Status this pass | Required action |
|---|---|---|---|
| JW Stone | Confirmed ChatGPT referral control fixture (external) | `unknown` (not in this repo) | Keep as reference fixture; do not clone visuals |
| TradeScout / profiles | Out of this worktree | `unknown` | Separate Phase 1 in TradeScout repo |
| HomeID | Private by default | `intentionally_private` (policy) | Education + owner-approved shares only |
| HomeScout | Out of repo | `unknown` | Separate audit |
| TradeComp | Out of repo | `unknown` | Separate audit |
| ScoutFitters | Out of repo | `unknown` | Separate audit |
| AutoID / MarineID / RVID / EquipID | Out of repo | `unknown` | Education + owner-approved only |
| **MealScout** | Strong foundation; weak eligibility enforcement | **`partial`** | Fix sitemap eligibility; harden protected routes; finish attribution spine |
| Sway | Out of repo | `unknown` | Populate real entities; keep Live Rooms ≠ Self-Production |
| Skill Gaming World | Private preview | `intentionally_private` (policy) | Keep noindex; separate education surface later |
| 30Aplus | Out of repo | `unknown` | Focused read-only audit |
| AutoBott / NewsFilter | Internal | `intentionally_private` (policy) | Keep internal blocked |

---

## Live addresses that must be re-verified after any future deploy

- `https://www.mealscout.us/robots.txt`
- `https://www.mealscout.us/llms.txt`
- `https://www.mealscout.us/sitemap.xml`
- `https://www.mealscout.us/sitemap-trucks.xml`
- Claimed sample: `https://www.mealscout.us/truck/3d-eats-tea--95c4e656-f3cc-46ab-ae18-53f549cecfd1`
- Thin sample currently sitemapped: `https://www.mealscout.us/truck/16-monkeys-concession--cbd132ee-7bcf-4bee-9150-ed8b9918919d`
- Protected: `https://www.mealscout.us/admin`, `https://www.mealscout.us/dashboard`
- Version markers: `https://www.mealscout.us/api/version`, `https://mealscout.onrender.com/api/version`

## Privacy review (MealScout sample)

- No private credentials observed in prerender samples.
- Thin listing exposed public phone in JSON-LD for an unclaimed/noindex truck — review whether phone should appear when `noindex`.
- Admin/dashboard returned public marketing shell, not private data (soft failure, not a data leak).

## Canonical-domain review

- Prefer `https://www.mealscout.us` in robots/sitemaps/canonicals (already).
- Keep Render hostname as deploy/platform alias; avoid indexing competing hostnames.
- Empty Render `healthCheckPath` remains an ops gap (release matrix), not a crawler fact gap.

## Attribution review

- UTM params retained for clients.
- Missing unified discovery event names and end-to-end outcome binding required by Contract v1 §9.

## Rollback

- This branch is documentation + contract tests only until implementation slices land.
- Discard branch or revert commits; no production indexing flag flipped in this packet.
