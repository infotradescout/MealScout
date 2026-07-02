# Site Drift Sweep — Pass 1 (2026-07-01)

Owner-facing summary: an automated + manual walkthrough of the app's highest-traffic
surfaces (first-time visitor, all 9 signup paths, login, search, deals, core marketing
pages), looking for places where something *technically works* but doesn't match
product intent — the "80% correct, 20% drift" pattern. This is Pass 1: the anonymous
discovery + signup entry points. Logged-in consumer flows, business dashboards, and
admin are later passes (see plan).

Method: Playwright crawl of 24 logged-out routes (mobile viewport, real backend,
seeded local DB), one browser context per page, capturing screenshots, visible text,
console errors, and failed network requests. Raw data: `results.json` (scratch, not
committed). Findings below were then verified by reading the actual source.

## Findings, ranked by user impact

### 1. `/map` and `/trending` no longer exist as real pages — both silently show Scout instead
**Severity: high — a removed feature, not a bug in the traditional sense**

Both routes are hard-wired to `RedirectToScout` in `client/src/App.tsx` (lines
325-326 for guests, 515-516 for logged-in users). Visiting either one renders
byte-for-byte the same content as `/scout`. Meanwhile the repo's own existing
smoke test (`scripts/public-sitewide-copy-cleanup.browser-smoke.mjs`) still expects
`/map` to show "Nearby Food Map" / "Open Scout" text and `/trending` to show
"What's hot" — text that doesn't exist anywhere in the live app anymore. That test
is currently failing on main (confirmed by running it directly).

This means either: (a) a dedicated Map and Trending experience used to exist and was
intentionally retired in favor of Scout, and the redirect is correct but the old
test was never updated — or (b) the redirect was an unintentional simplification
that quietly dropped two features nav links may still promise. **This needs an
owner decision**, not a code fix: keep the redirect (and delete/update the stale
test), or restore dedicated pages.

### 2. Two different signup UIs exist for the same "start a restaurant/truck/bar business" journey
**Severity: high — duplicated, inconsistent implementation (matches the "should be shared" concern)**

- `/restaurant-signup` (direct route) renders a "STEP 2 OF 2 — BUSINESS ACCOUNT" screen with its own copy and layout.
- `/customer-signup?role=business&businessType=restaurant` (the path new users actually take from the role picker) renders a completely different-looking screen ("BUSINESS TYPE: Restaurant / Food Truck (Claim) / Bar / Caterer / Private Chef" chooser).

Both eventually feed into the same business-account outcome, built and styled independently. This is exactly the "40 different button types" pattern — two parallel implementations of one flow that should share one component. Candidate for Phase 2 consolidation (with a before/after feature-parity check, per the plan's guardrail).

### 3. Signup role labels are inconsistently generated — copy proof of the drift pattern
**Severity: medium — cosmetic but symptomatic**

In `client/src/pages/customer-signup.tsx` (~line 1093), the "SELECTED PATH" label is
built as:
```js
businessSubType === "food_truck" ? "Food truck owner" : `${businessSubType.replace("_", " ")} owner`
```
Food truck gets a hand-written label; every other type gets an auto-generated one.
Live results: "Food truck owner", "restaurant owner", "bar owner", "caterer owner" —
but "Private chef" (no "owner" suffix, capitalized differently) comes from a separate
branch not covered by this line. Four near-identical labels, three different code
paths generating them. Low user-facing harm on its own, but it's a concrete example
of the exact problem described: many small copy paths instead of one shared source
of truth for role display names.

### 4. `/search` page has a real (silent) data-fetching bug
**Severity: medium — functional bug, not just copy**

Console shows 5 repeated React Query warnings on every load of `/search`:
`"[[\"/api/deals/featured\"]]: No queryFn was passed as an option, and no default
queryFn was found."` The page still renders (falls back to an empty state), so a
user wouldn't see a crash — but the "0 deals found" empty state may be a fetch
failure disguised as "no deals available," not an accurate empty state. Worth a
real fix, not just a copy tweak.

### 5. `/host-signup` is a live, orphaned dead end
**Severity: low — unreachable through normal navigation, but a landmine if linked externally**

No `<Link>` or `href` anywhere in the client code points to `/host-signup` directly
(confirmed via grep) — the only real path to host signup is
`/customer-signup?role=host`, which works fine and is well-populated. But the direct
route is still live and renders almost nothing ("Sign in to continue", 180 characters,
no form). If an old marketing email, ad, or bookmark points here, a prospective host
hits a wall. Low priority, but cheap to fix (redirect it to the working flow) once
in Phase 2.

### 6. Confirmed dead files (safe to remove later, zero feature risk)
- `client/src/pages/home-north-star.tsx` — not imported anywhere in the app.
- `client/src/pages/restaurant-detail.tsx` — not imported anywhere in the app.
- `client/src/pages/EmptyCountyExperience.tsx` — imported (lazy) in `App.tsx` but never attached to a route; a dead import.
- `client/src/components/Untitled-1.json` — not code at all; a 7,466-line TypeScript language-server symbol cache accidentally committed, with absolute file paths pointing to a different developer's machine (`C:\Users\trob4\...`). Should be deleted immediately — it's inert but shouldn't be in the repo.

### 7. Everything else in Pass 1 checked out clean
`/`, `/scout`, `/deals`, `/login`, `/forgot-password`, `/claim-truck`, `/about`,
`/how-it-works`, `/faq`, `/contact`, and all 9 signup entry points load, render
real content, and have no console errors beyond the expected single 401 from the
logged-out auth check (harmless, present on every page by design).

## Duplication inventory (for Phase 2 planning, not fixed yet)

- **Route duplication**: `client/src/App.tsx` defines the same ~170 routes twice —
  once for guests (lines ~307-475), once for logged-in users (lines ~477-721) —
  almost entirely identical component mappings, gated only by auth state. Real
  structural consolidation candidate, but higher risk; per the plan this should be
  its own dedicated PR with an exact before/after route-list diff, not bundled into
  a content fix.
- **Signup UI duplication**: see finding #2 above.
- **Button/CTA styling**: the original `welcome.tsx` bug (PR #175) showed the pattern —
  one-off inline Tailwind class strings repeated per button instead of the shared
  `client/src/components/ui/button.tsx` primitive. Not yet quantified across the
  whole app; Phase 2 should grep for repeated long className strings on `<button>`/
  `<Link>` elements as a proxy for "should be the shared Button component."

## Next steps (Pass 1)

Queued the two clear, low-risk cleanup candidates (dead files, junk artifact) to
`docs/refactor/REFACTOR_BOARD.md`. The `/map`/`/trending` question was resolved by
the owner (intentional redirect) — the stale smoke test was fixed to match.
Findings #2–#4 are candidates for Phase 2 surface-by-surface fixes.

---

# Pass 2 — Logged-in consumer surfaces (2026-07-01)

Method: created a fresh test diner account through the real signup form, verified
its email directly in the local dev database (BREVO isn't configured locally, so
the verification email couldn't send — this is a local-dev-only gap; the flow
itself, including the hard "you must verify before logging in" gate, was confirmed
working end to end), then logged in and crawled the logged-in-only consumer pages
with a saved session.

## Findings, ranked by user impact

### 1. ScoutCoin is a fully-built feature that is completely non-functional server-side
**Severity: high — a real, confusing broken feature shown to every logged-in user**

`/scoutcoin` renders a complete wallet UI — balance, Buy, Send, Redeem, transaction
history — but all four of its backend endpoints return `500 Internal Server Error`:
`/api/scoutcoin/config`, `/api/scoutcoin/wallet`, `/api/scoutcoin/transactions`,
`/api/business-access/me` (each called twice — a separate minor inefficiency).
The page doesn't show an error or "coming soon" state; it just displays "Balance: 0
atomic" and disabled-looking buttons, which reads as "this feature exists but isn't
enabled for me" rather than "this is broken." Anyone who finds it (it's in the main
nav under "More") gets a confusing, dead experience. Needs an owner decision: finish
wiring the backend, or hide the nav entry and route until it's ready.

### 2. `/share-hub` is essentially a blank page for logged-in users
**Severity: high**

Body content is 28 characters — just the bottom nav bar, nothing else. Even the
basic `/api/auth/user` check (which succeeds everywhere else in the app) returns
`500` specifically on this page. This looks like an incomplete or broken page
reachable from the main nav.

### 3. The dashboard router silently fails and falls back to Scout, masking a server error
**Severity: medium**

`/dashboard` (meant to route each logged-in user to their role-appropriate
dashboard) calls `/api/public/resolve-business/dashboard`, which returns `500`
twice, then silently falls back to showing `/scout`. For a diner account (no
business to resolve) this fallback is probably reasonable — but it should be a
clean "no business dashboard for this account" response, not a server error being
swallowed. Worth a backend fix so real failures don't hide behind the same fallback.

### 4. Parking Pass shows a `503` on subscription status
**Severity: low-medium — may be intentional gating, needs confirmation**

`/api/subscription/status` returns `503 Service Unavailable` when a diner visits
`/parking-pass`. The page still renders correctly (explains only food trucks can
book). Possibly an intentional "no active subscription" response using the wrong
status code (503 usually means "service is down," not "you're not subscribed") —
worth a quick check.

### 5. Everything else in Pass 2 is solid
`/scout`, `/favorites`, `/orders`, `/user-dashboard`, `/profile`,
`/profile/settings`, `/profile/addresses`, `/profile/payment`, `/profile/help` all
render real, correct, error-free content with sensible empty states ("No favorite
restaurants yet," "No active claims," etc.) — this part of the app is in good shape.

## Next steps (Pass 2)

Pass 3 (not yet run): business operator dashboards (Restaurant, Truck, Host,
Supplier) — requires creating and verifying a test business account the same way.

---

# Pass 3 — Business signup + dashboards (2026-07-01, partial)

Method: attempted to create a real restaurant business account through both
business-signup entry points found in Pass 1, to reach the restaurant owner
dashboard.

## Findings, ranked by user impact

### 1. CRITICAL: Business profile creation is completely broken — likely blocking all new restaurant/truck/bar/caterer/private-chef signups
**Severity: critical — appears to affect production, not just local dev**

Root cause fully confirmed, in `client/src/pages/restaurant-signup.tsx`:

- The account-creation step (`/customer-signup?role=business&businessType=...`)
  has **no terms-acceptance checkbox in the UI at all**, yet the server endpoint
  it calls (`/api/auth/restaurant/register`) unconditionally rejects the request
  with `400 "You must accept the terms"` unless `acceptTerms === true` is sent.
  Confirmed via network trace: the client payload never includes `acceptTerms`.
  **Nobody can create a business account through the primary "Sign up" → role
  picker path that most new users take.**

- The older, still-live `/restaurant-signup` direct route *does* have a working
  terms checkbox for account creation, and that step succeeds. But the very next
  step — actually creating the business profile itself (used by both brand-new
  users and existing users adding a business) — is **also broken**, for a
  different reason: in `createRestaurantMutation`'s `mutationFn` (lines ~556-583
  for signed-in users, ~603-620 for new registrations), the `restaurantData`
  object sent to `POST /api/restaurants/signup` is manually rebuilt field by
  field (`name`, `address`, `city`, `state`, `phone`, `businessType`,
  `cuisineType`, `description`, `websiteUrl`, `instagramUrl`, `facebookPageUrl`,
  `amenities`) and **`acceptTerms` is never included**, even though the user
  checks the box and the form state correctly shows it as checked. The server
  (`server/routes/restaurantSignupRoutes.ts:84`, `if (restaurantData?.acceptTerms
  !== true)`) expects it nested inside `restaurantData` and always sees it
  missing, so it always 400s with `"You must accept the terms"` — confirmed via
  direct request-payload capture, not just the response.

Net effect: **every path to creating a business profile in the app is currently
broken.** A real restaurant/food truck/bar/caterer/private chef owner cannot
complete signup no matter which entry point they use. This was not testable
against production directly, but the client code is the same bundle regardless
of environment — this needs urgent verification against the live site.

**Fix is small and precise**: add `acceptTerms: true`/`data.acceptTerms` into
both `restaurantData` object literals in `createRestaurantMutation` (lines
~565-582 and ~603-619), and add a real terms checkbox (or send
`acceptTerms: true` outright, matching however the product intends consent to
work) to the `/customer-signup?role=business` flow before it calls
`/api/auth/restaurant/register`.

Restaurant/truck signup is blocked by the critical bug above, but the **host**
signup path is a separate, independent flow (`/api/auth/customer/register` →
`/api/hosts`, not `/api/auth/restaurant/register` / `/api/restaurants/signup`),
so it was tested successfully.

### 2. Host signup and dashboard work well overall, with one shared bug and one visible on-page error
**Severity: medium**

Created and verified a real host account end to end: `/customer-signup?role=host`
→ email verification → `/host-signup` profile form (business name, address,
city, state, location type, contact info) → `POST /api/hosts` succeeded (201) →
redirected to `/host/dashboard`.

The dashboard itself is rich and functional: a 3/4-complete onboarding checklist
(Location done, Availability created, Bookings, Payouts), live Stripe payout
setup tracking, host earnings, payout history, a demand queue, and a working
availability-slot builder with a real parking pass already showing as
"published." This part of the app is in solid shape.

Two issues:
- The same `/api/public/resolve-business/...` endpoint that 500s for diners on
  `/dashboard` (Pass 2, finding #3) also 500s here (`/api/public/resolve-business/host`)
  — confirms this is a general bug in that endpoint, not diner-specific.
- A **"PROFILE NOT FOUND" error message renders directly on the host dashboard
  page**, visible to the host user, likely tied to the same failing endpoint or
  the `402 Payment Required` on `/api/events?hostId=...` (which may be
  intentional — events could be gated behind an active plan — but the visible
  "Profile Not Found" text on an otherwise working dashboard is a real, jarring
  bug regardless of cause).

### 3. Supplier signup and dashboard work well, with the same recurring resolve-business bug
**Severity: medium**

Supplier signup is a separate flow (`/api/auth/supplier/register`, no `acceptTerms`
requirement server-side) and worked end to end: `/customer-signup?role=supplier` →
email verification → login → `/supplier/dashboard`. The dashboard itself is rich
and functional — onboarding checklist (Profile, Products, Delivery, Payments),
product add form, delivery settings, online payment settings, bulk product
import, and portals for delivery/requests/products/orders all render correctly.

Same recurring issue: the **"PROFILE NOT FOUND" error renders at the top of the
supplier dashboard too** — now confirmed on **three account types** (diner, host,
supplier), tied to the same `/api/public/resolve-business/*` 500. A new related
500 also appeared here: `/api/supplier/stripe/status` fails, though the page
still shows a reasonable "Payouts setup: Not connected" fallback.

### 4. Truck-claim search and request flow works; final profile-creation step untested
**Severity: informational**

Tested with a working diner account: `/claim-truck` search (`GET
/api/truck-claims/public-search`) returns real, live results with working
"Claim" / "Request setup" buttons. Clicking "Claim" correctly routes into
`/restaurant-signup?businessType=food_truck&claim=1&q=...` to create the truck's
business profile. Whether this specific path hits the same `acceptTerms`
omission bug as finding #1 (Pass 3) was not conclusively verified — the code for
this branch (`createRestaurantMutation`, food-truck-claim case) forwards the raw
form data rather than the manually-reconstructed object used by the two broken
paths, so it may not be affected, but this needs a real click-through test once
the critical bug is otherwise fixed.

## Next steps (Pass 3)

Restaurant dashboard remains untested — blocked by the critical signup bug
above. Once fixed: create a real restaurant account and crawl its dashboard,
and confirm whether the truck-claim profile-creation step is affected by the
same bug or not.

---

# Pass 4 — Remaining marketing/legal/support pages (2026-07-01)

Crawled the remaining logged-out pages not covered in Pass 1: Terms of Service,
Privacy Policy, Data Deletion, Moderation Policy, all four "For X" business
landing pages (Restaurants/Bars/Hosts/Events), Compare pages, Hiring, Install,
Sitemap, Status, Video, Events (public), Parking Pass (logged-out), and Share
Hub (logged-out).

## Findings

### 1. Sitemap page has a React key-duplication bug
**Severity: low-medium — cosmetic/technical, but a real code defect**

`/sitemap` throws 13 duplicate "two children with the same key" React warnings
for the same set of dynamic city/category links (e.g.
`/food-trucks/pensacola/cocktails`, `/food-trucks/milton/other`) — meaning the
sitemap's list of dynamic local landing pages is being rendered with duplicate,
non-unique keys, most likely from the same data appearing in more than one
generated section. Traced to `client/src/pages/sitemap.tsx:27`. This can cause
React to silently drop or duplicate list items, so the visible sitemap may not
be fully accurate.

### 2. `resolve-business` 500 confirmed on a 4th surface
`/hiring` also calls the same broken `/api/public/resolve-business/hiring`
endpoint and gets a 500 — now confirmed across diner, host, supplier, and
`/hiring` (4 surfaces). Reinforces that this is a systemic bug in one shared
endpoint/hook, not isolated to any single account type or page.

### 3. `/video` may be showing less than intended for logged-out visitors
**Severity: low — needs a product decision, not clearly a bug**

The page markets itself as "CRITIC FEED — COMMUNITY POWERED" but a logged-out
visitor sees almost nothing (102 characters: just a sign-in prompt), and
`/api/stories/feed?page=0` is fetched twice, both returning 401. If the intent
is "browse the critic feed publicly, sign in to post," this is broken/gated
too aggressively; if video content is meant to be members-only, this is
working as intended. Worth a quick confirmation.

### 4. Everything else is clean
Terms of Service, Privacy Policy, Data Deletion, Moderation Policy, all four
"For X" business landing pages, both Compare pages, Install, Status, Events
(public), and Parking Pass (logged-out) all rendered real content with no
errors beyond the expected single 401 auth check. Share Hub logged-out
correctly explains "Sign in to generate share links" — confirming the broken,
near-blank version found in Pass 2 was specifically a logged-in-state bug.

## Sweep status: complete for now

All planned surfaces have been swept at least once: anonymous discovery, all
signup entry points, logged-in consumer flows, host + supplier signup and
dashboards, truck-claim search, and all remaining marketing/legal/support
pages. Remaining known gaps: the restaurant dashboard (blocked by the critical
bug), and deep interaction testing within business dashboards (e.g., actually
creating a deal, menu item, or booking) rather than just confirming the page
renders.
