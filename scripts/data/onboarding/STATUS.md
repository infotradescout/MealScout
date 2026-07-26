# Real-account profile completion — historical status tracker

> Truth correction (2026-07-26): these are historical working notes, not
> current production proof. The canonical cohort contains all 11 accounts
> listed below, including 3D Eats. Historical 5/5-style scores do not prove a
> current schedule, public route, menu count, or live production state.
> Production baseline capture remains blocked until
> `captureCuratedProfileCohortBaseline.ts` is run against the authorized
> production database and its ignored `backups/` output is reviewed. No
> production evidence snapshot is committed here.

Working through the 11 real accounts flagged incomplete in the 2026-07-14
completeness audit (excluding "N/A" [deleted], Giles/Levon's Lamb
[disregarded as stale], 3-D Eats [structural, admin-managed]). Plan: get
each to 5/5 with real curated data, then send owners a "Profile 2.0" review
link to confirm/correct everything in one pass — so open questions below
don't need to block progress now, just need to survive until that review.

## Done

- **All Gas No Brakes Reloaded** — historical 5/5-style pass. Logo + 3 menu items (real Cloudinary
  photos) + weekly hours + 4 dated schedule stops + socials. Still don't
  have their actual food menu (wings/egg rolls) with prices, only the
  retail sauce line from their Shopify store — flag for owner review. The
  July 15-18 stops are expired and do not prove a current schedule.

## In progress

- **Around The Table Catrring** — 3/5 (was 2/5; hours-format bug fixed).
  Have: description, address (310 Market St, Kingston, PA), phone, hours
  (Mon-Thu 11-7, Sun 12-6, closed Fri/Sat), website/IG/FB links.
  Still need: real menu items + prices (screenshot), logo/cover photo.
  **Flag for owner review:** account is tagged `businessType: food_truck` /
  `isFoodTruck: true`, but everything found points to a fixed-location
  kitchen (310 Market St), not a roaming truck — confirm with owner whether
  that flag is correct, since it changes whether "schedule" should even
  apply to this account.

- **CREATIVBOWLS** — still 1/4 (description/socials set, but none of the
  scored fields). This is a genuinely roaming food trailer — "hours vary,
  new weekly schedule posted to Facebook every Sunday" per their own posts,
  so a fixed `operatingHours` block would misrepresent them the same way
  the user flagged earlier. This is really a `truck_manual_schedules` gap,
  not an hours gap — same systemic mismatch, worth fixing in the
  completeness *model* eventually, not just this account.
  **Flag for owner review:** on-file address (591 Templehill St.) doesn't
  match their current "home location" found via search (5722 Stewart St,
  Milton, FL 32570) — didn't overwrite, needs owner confirmation.
  Still need: real menu items + prices, logo/cover, current week's schedule
  (all screenshot-only, Facebook/Instagram block scraping same as others).

- **Jays Southern Cuisine** — still 1/4 (description only). Confirmed real
  via DoorDash listing (soul food, "Jay's Cracked Wingz," pork chops,
  chicken strip dinners, philly cheesesteak fries) at 5271 Stewart St,
  Milton FL — same Stewart St food-truck-park area as CreativBowls (5722)
  and an unrelated "EATS" truck (5722) also found nearby, so that street
  looks like a shared truck lot, not each business's individual address.
  **Flag for owner review:** on-file address is "6476 Robin Ave" — didn't
  overwrite with the DoorDash address since I'm not sure which is current.
  Also found a "Big Jay's Southern Cuisine" Facebook page that might be the
  same business under a slightly different name — didn't attach it since
  I couldn't confirm the match (Facebook blocks scraping the About page).
  Still need everything else: menu + prices, logo/cover, hours pattern —
  screenshots needed.

- **Pie Faced** — still 2/5 (description/website/FB set). The 2026-07-26
  public audit observed 24 public menu items, correcting the prior claim of
  29; the production baseline must reconcile the stored/public counts. Established truck,
  Fort Walton Beach, since 2018, pizza + sandwiches + desserts.
  Still need: photos, hours, schedule — all screenshot-only, Square site
  didn't render for fetching and Facebook blocked as usual.

- **Sweet Love** — was 2/5, hours-format bug fixed (Mon-Sat 11-7, same
  malformed-shape bug as Around The Table). Already had a real description
  and cover photo on file (from their own Square site) — those were fine,
  didn't touch them. Husband-and-wife lactose-free soft serve truck,
  Pensacola, does parties/festivals/catering.
  Still need: menu items + prices (soft serve, milkshakes, sundaes, root
  beer floats, dairy-free options — confirmed categories, no prices found;
  StreetFoodFinder/Square both blocked scraping), logo, current schedule.

- **The Spot Tavern** — was 1/4, hours + description + phone + city/state
  set (confirmed real: dive bar in Milton FL since 2015, Tue-Sat 12pm-2:30am,
  Sun 12pm-12am, closed Mon — note this uses genuine overnight hours,
  close-time-before-open, which the schema explicitly supports).
  Also noteworthy: same street address (5271 Stewart St) as Jay's Southern
  Cuisine — likely the truck operates out of/parks at this bar's lot.
  **Flag for owner review:** multiple sources describe this as a dive bar
  with very limited food ("chips and candy," one reviewer noted minimal
  food options) — a formal "menu" may not really apply here the way it
  does for a restaurant. Didn't fabricate menu items; needs owner
  confirmation on whether they even want a food menu listed. Still need
  photos regardless.

- **Blessed Berry Bowls** — was 3/5, now has description, phone, address
  (1922 Creighton Rd, Ferry Pass FL — corrected from just "Pensacola, FL"),
  Facebook, and hours. Only Wed 12-5pm is a confirmed fixed slot (Yelp
  shows everything else closed) — this is another "hours vary, check
  Facebook" truck. Set only the one real confirmed slot rather than
  guessing at the rest.
  Still need: current weekly schedule (dated stops), logo.

- **MOROCCO'S TACO'S** — now 3/4 (up from 2/4, then corrected from 1/4).
  Found their real logo, truck photo, and printed menu board (with actual
  prices) via a food-truck directory (foodtruckarmy.com) that wasn't
  scrape-blocked. Full 19-item priced menu now in, split into 6 real
  categories (Sahara Street Tacos, Tacones and Burritos, Delights, Sides,
  Desserts, Drinks) — added 17 new items onto the 2 the owner had already
  entered themselves, without duplicating those two.
  Phone corrected to +1 561-927-5729 (matches the number printed on their
  own menu photo — overrides the number from their website, which appears
  to be stale).
  **Flag for owner review:** their own 2 pre-existing items have prices
  $1 higher than the printed menu photo (Casablanca Beef: $16 in-app vs
  $15 on menu photo; Harrisa Shrimp: $17 vs $16) — didn't touch their
  existing entries, but worth them confirming which price is current.
  **Flag for owner review — still no hours:** both Yelp and their own
  site claim "open 24 hours daily," which is almost certainly a
  mis-set/default listing rather than real walk-up hours (probably means
  "always bookable for catering"). Left hours blank rather than publish
  something that would show them as "open now" on the map at 3am with
  nobody there.
  Still need: real hours, from the owner directly.

- **3D Eats & Tea** — admin verification and the guarded menu/logo apply lane
  are now recorded in the repository. This still does not prove the current
  production database state or a current schedule. An older Facebook
  weekly-schedule post (Drive Thru @ 3200 Pace Blvd Mon-Sat 11-5, "3-D
  Eats X" @ 6881 US 98 Tue-Sat 11-8, MessHaul @ The Tristan Tue 5-7, plus
  Thu/Fri event spots) but user confirmed (2026-07-15) it's likely an old
  post, not current. Also 6881 US 98 E is hard-coded in
  `server/utils/truckLocationSemantics.ts` as
  `THREE_D_EATS_STATIC_ADMIN_ADDRESS` — explicitly walled off from ever
  being used as this truck's customer-facing map location by a prior
  session's work on this exact account (reason unknown to this session).
  Didn't touch schedule at all rather than risk publishing stale data or
  overriding that guardrail. Needs current dated stops directly from the
  owner via the eventual review link.

- **The Florida Kitchen Island Cuisine** — canonical verified ID
  `f1ed3d1d-3ea8-4f54-85b9-af48d1d884e0` currently competes with active
  imported duplicate `7e36413b-6396-454e-a3c2-e93c00bad2bf`; route and
  dependency reconciliation is required before content mutation. Already
  has correct-format hours (Mon-Fri 11-4, closed weekends), 1 menu item,
  cover photo. Only "schedule" is missing. No usable current schedule info
  found via search (not listed in any of the major Pensacola food-truck
  directories checked) — needs the owner directly via the review link.

## Historical first pass across all 11 accounts

Every account on the original list was touched at least once. This is not a
production-completion claim. None
were force-completed with guessed or stale data — remaining gaps are
either genuinely owner-only info (menu prices, current schedules, logo/
cover photos — all blocked by Facebook/Instagram/Square/DoorDash/Toast/
Yelp/zmenu/StreetFoodFinder scraping walls) or open questions flagged
above for the owner to resolve via the Profile 2.0 review link.

## Systemic findings (not business-specific, for later follow-up)

- Food-truck schedule UI is effectively orphaned in the app (wrong redirect
  in `parking-pass-manage.tsx`, no working deep link anywhere) + gated by a
  premium/trial paywall on the write endpoint.
- Operating hours form is buried inside a tab literally labeled "Food
  Truck," conflated in the UI copy with the separate manual-schedule concept.
- `client/src/lib/dishCategoryPhoto.ts`'s keyword-fallback image picker has
  no category for retail/merchandise items (sauces, bottled goods) and can
  false-positive against unrelated categories (e.g. "sweet" in "Sweet Chili
  Sauce" matched the dessert rule). Worked around per-business by always
  supplying a real photo, but the underlying matching bug still exists for
  any future business without one.
- Cloudinary was never configured on Render (production) until this
  session — real owner-facing photo uploads were almost certainly broken
  (503) the whole time. Now fixed pending your manual confirmation.
- `ADMIN_LEAD_IMPORT_API_KEY` (Render + Vercel), stray `n` (Render),
  `GOOGLE_MAPS_MAP_ID`/`REQUIRE_PHONE_VERIFICATION`/
  `VITE_REQUIRE_PHONE_VERIFICATION` (Vercel) — confirmed unused, safe to
  delete whenever convenient.
