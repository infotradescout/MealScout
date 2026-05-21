# MealScout Scout Plan

## Decision

Correct. What I gave you was the **real-data rule**, not the full build plan.

Here is the actual full plan to recreate the Scout page from the screenshot **1:1 visually**, while making it production-safe with **real MealScout data only**.

---

# MealScout Scout Page Full Build Plan

## Goal

Build the Scout page as a **map-first local food scene surface**.

It should feel like:

```text
A live board of what is happening around me:
food trucks, restaurants, dishes, events, deals, menus, local favorites, and under-scouted spots.
```

It should not feel like:

```text
Yelp clone
DoorDash clone
Google Maps clone
AI chatbot
restaurant list
dish leaderboard
promo board
```

---

# 1. Locked Product Rules

## Scout is a verb

Do not treat Scout as a character, chatbot, assistant, or AI entity.

Do not use:

```text
Ask Scout
Scout says
Scout recommends
AI pick
AI sparkle icon
```

Use:

```text
Scout
Search
Explore
Find
View
Route
Save
Filter
```

---

## Dishes are not above places

Dishes should get visibility, but they are **not the top-level hierarchy**.

Correct model:

```text
Scenes are the top-level navigation.
Dishes, places, trucks, events, deals, and menus are content inside scenes.
```

Wrong model:

```text
Dishes > Places > Food Trucks
```

---

## First screen must be broad discovery

The default Scout page should be a mixed local scene, not pure recommendations.

Default experience:

```text
For You / Today Around You
- food truck posted up
- community-liked dish
- restaurant open now
- deal today
- event tonight
- new menu item
- worth-discovering spot
```

The more specific the user gets, the more recommendation-based it becomes.

---

# 2. Visual Target

Use the last best screenshot as the target:

```text
food_and_places_discovery_app_interface.png
```

Mobile export:

```text
mealscout_scout_mobile_mockup_430w.png
```

The screenshot is the **layout and visual reference only**.

Do not copy fake content.

---

# 3. Hard Screenshot Corrections

Keep the visual direction, but change these:

```text
Replace profile image with MealScout logo icon only.
Remove “Ask Scout.”
Remove AI sparkle icon.
Do not add large MealScout text.
Do not add “Follow The Flavor.”
Do not render global nav inside this page.
Move/keep scene options directly under the map.
Use real nav from the existing app globally.
Use real backend data only.
```

---

# 4. Final Page Structure

The page should be built in this order:

```text
ScoutPage
├─ Map Hero
│  ├─ MealScout logo icon overlay
│  ├─ top-right alert/settings action
│  ├─ interactive food-scene pins
│  ├─ selected item floating card
│  └─ map utility controls
│
├─ Scene Options Bar
│  └─ For You, Community, Nearby Now, Food Trucks, Restaurants, Deals, Events, New Menus, Late Night, Worth Discovering
│
├─ Today Around You Feed
│  └─ mixed real-data cards
│
├─ Explore The Scene Tiles
│  └─ optional lower section
│
└─ Bottom Search / Intent Dock
   └─ opens search overlay
```

No local bottom nav inside this page unless your global nav requires a reserved safe area.

---

# 5. Component Plan

## 5.1 `ScoutPage`

### Purpose

Controls the entire Scout experience.

### Responsibilities

```text
- get user location
- load active scene
- load map pins
- load mixed feed
- load scene counts
- handle scene switching
- handle selected map item
- open search overlay
- pass real data to components
```

### State

```ts
type ScoutPageState = {
  activeSceneId: ScoutSceneId;
  selectedItemId: string | null;
  searchOpen: boolean;
  userLocation: GeoPoint | null;
  mapCenter: GeoPoint | null;
};
```

---

## 5.2 `ScoutMapHero`

### Purpose

Top hero map. This is the emotional and functional anchor.

### Must match screenshot

```text
- top of screen
- large visual area
- dark map
- orange roads/glow
- no hard boxed border
- pins visible
- selected card floating over map
- logo icon top-left
- action icon top-right
```

### Props

```ts
type ScoutMapHeroProps = {
  center: GeoPoint;
  userLocation?: GeoPoint | null;
  pins: ScoutMapPin[];
  selectedPinId?: string | null;
  onPinSelect: (pinId: string) => void;
  onView: (itemId: string) => void;
  onRoute: (itemId: string) => void;
  onLocateMe: () => void;
};
```

### Map behavior

```text
- tapping pin selects it
- selected pin opens floating card
- route button opens directions
- view button opens detail page/drawer
- map pan/zoom can refresh visible results later
```

---

## 5.3 `SelectedMapCard`

### Purpose

Compact floating card over the map.

### Anatomy

```text
TYPE LABEL
Title
Source / business name
proof/status line
distance / area
[View] [Route]
```

### Example

```text
FOOD TRUCK
Taco Sisters
Posted up now · 0.7 mi
Open now

[View] [Route]
```

Or:

```text
DISH
Smash Burger
Local favorite · 1.1 mi
At Oak Street Grill

[View] [Route]
```

### Rules

```text
- Dish can route only through its business.
- Event can route only if event location exists.
- No fake proof.
- No fake distance.
- No AI language.
```

---

## 5.4 `SceneOptionsBar`

### Purpose

Primary browsing layer directly under map.

### Options

```text
For You
Community
Nearby Now
Food Trucks
Restaurants
Deals
Events
New Menus
Late Night
Worth Discovering
```

### Behavior

```text
- horizontal scroll
- active state in MealScout orange
- changing scene updates both map pins and feed
- count badges allowed only from real query counts
```

### Props

```ts
type SceneOptionsBarProps = {
  options: SceneOption[];
  activeSceneId: ScoutSceneId;
  onSceneChange: (sceneId: ScoutSceneId) => void;
};
```

---

## 5.5 `TodayAroundYouFeed`

### Purpose

Main feed beneath scene bar.

### Default title

```text
Today Around You
```

### Subtitle

```text
A live mix of what locals love, what's open, what's new, and what's nearby.
```

### Default feed composition

For `For You`, attempt to mix:

```text
1 food truck
1 restaurant
1 dish/menu item
1 event
1 deal
1 new menu item
1 worth-discovering item
```

Only render what exists.

Do not fake missing categories.

---

## 5.6 `ScoutFeedCard`

### Purpose

Reusable compact card for every content type.

### Anatomy

```text
thumbnail / fallback icon
type label
title
source name
status/proof label
distance/area/time
actions
```

### Actions

```text
View
Route
Save
```

Route only appears if routable.

Save only appears if save behavior exists.

---

## 5.7 `ScoutIntentDock`

### Purpose

Search without forcing users to tap the top of the screen.

### Position

Sticky near bottom, above global nav safe area.

### Placeholder

```text
Search food, places, trucks, events
```

### Rules

```text
- use normal search icon
- no AI sparkle
- no “Ask Scout”
- right side can be filter/sliders icon
- opens focused search overlay
```

---

## 5.8 `ScoutSearchOverlay`

### Purpose

Search and intent capture.

### Includes

```text
search input
quick intents
recent searches
grouped results
filters
```

### Quick intents

```text
Open now
Food trucks
Dinner
Late night
Coffee
Dessert
Deals
Live music
Family friendly
Worth discovering
```

### Result groups

```text
Places
Food Trucks
Dishes
Deals
Events
New Menus
```

### Search behavior rule

```text
Broad open = discovery mix.
Specific query = recommendation ranking.
```

Example:

```text
User opens Scout
→ broad mixed scene

User taps Food Trucks
→ truck-first, location/status weighted

User searches “tacos”
→ taco-relevant dishes, trucks, restaurants, deals, and events

User searches “family dinner”
→ more personalized, filtered, practical results
```

---

## 5.9 `ExploreSceneTiles`

### Purpose

Optional lower section for deeper discovery.

### Tiles

```text
Community
Food Trucks
Restaurants
Deals
Events
New Menus
Late Night
Worth Discovering
```

This should not compete with the main feed. It lives lower.

---

# 6. Data Contract

## Core geo type

```ts
type GeoPoint = {
  lat: number;
  lng: number;
};
```

## Scene IDs

```ts
type ScoutSceneId =
  | "for_you"
  | "community"
  | "nearby_now"
  | "food_trucks"
  | "restaurants"
  | "deals"
  | "events"
  | "new_menus"
  | "late_night"
  | "worth_discovering";
```

## Scene item types

```ts
type ScoutSceneItemType =
  | "food_truck"
  | "restaurant"
  | "dish"
  | "deal"
  | "event"
  | "new_menu"
  | "worth_discovering"
  | "community";
```

## Unified scene item

```ts
type ScoutSceneItem = {
  id: string;
  type: ScoutSceneItemType;

  title: string;
  sourceName?: string | null;
  description?: string | null;

  businessId?: string | null;
  menuItemId?: string | null;
  dealId?: string | null;
  eventId?: string | null;

  cuisineOrCategory?: string | null;
  neighborhood?: string | null;

  lat?: number | null;
  lng?: number | null;

  distanceMeters?: number | null;
  distanceLabel?: string | null;

  statusLabel?: string | null;
  proofLabel?: string | null;
  timeLabel?: string | null;

  imageUrl?: string | null;
  fallbackIcon?: string | null;

  isOpen?: boolean | null;
  canRoute: boolean;
  canSave: boolean;

  score?: number;
};
```

## Map pin

```ts
type ScoutMapPin = {
  id: string;
  itemId: string;
  type: ScoutSceneItemType;

  lat: number;
  lng: number;

  title: string;
  subtitle?: string | null;
  statusLabel?: string | null;
  distanceLabel?: string | null;

  isSelected?: boolean;
};
```

## Scene option

```ts
type SceneOption = {
  id: ScoutSceneId;
  label: string;
  icon: string;
  count?: number;
  enabled: boolean;
};
```

---

# 7. Real Data Sources Needed

The Scout page should hydrate from your existing backend where available.

## Business data

Required fields:

```text
business id
name
type/category
cuisine/category
lat/lng
address/service area
hours
open status
claimed/verified status
photos/logo
menu presence
profile updated date
```

Used for:

```text
restaurants
food trucks
bars
coffee
dessert
worth discovering
nearby now
```

---

## Menu item / dish data

Required fields:

```text
menu item id
business id
name
category
image
price only if real
created/updated date
availability
community activity if available
```

Used for:

```text
dish cards
new menu cards
community favorites
search results
```

---

## Food truck location/status data

Required fields:

```text
business id
current post-up location
lat/lng
start/end time
status
schedule
last updated
```

Used for:

```text
Food Trucks
Nearby Now
Today Around You
Map pins
```

Important:

Only use “Posted up now” when real current location/status exists.

---

## Deals data

Required fields:

```text
deal id
business id
title
description
valid_from
valid_until
status
redemption rules
```

Used for:

```text
Deals
Today Around You
Map pins
```

No fake discounts.

---

## Events data

Required fields:

```text
event id
title
business/venue id
start time
end time
location
lat/lng
category
```

Used for:

```text
Events
Today Around You
Late Night
Map pins
```

---

## Community activity data

Use any real data you have:

```text
saves
likes
favorites
orders
route clicks
menu clicks
shares
tips
recommendations
check-ins
repeat views
```

Used for:

```text
Community
community proof labels
favorite dishes
favorite places
ranking
```

Do not display proof labels unless the signal exists.

---

# 8. Ranking Plan

## Default `For You`

Purpose: balanced broad discovery.

Weights:

```text
Broad local scene coverage: 40%
Community proof: 25%
User relevance: 20%
Freshness/newness: 10%
Fair discovery: 5%
```

This means the first screen should feel wide, not trapped in a personalization bubble.

---

## Scene-specific ranking

When user taps a scene:

```text
Scene match: 35%
Open/current status: 20%
Distance: 15%
Community proof: 15%
User relevance: 10%
Freshness/fair discovery: 5%
```

---

## Search ranking

When user searches:

```text
Query match: 40%
Open/current status: 20%
Distance: 15%
User relevance: 15%
Community proof: 10%
```

---

## Worth Discovering ranking

For businesses without deals/reviews/proof:

```text
profile completeness
menu completeness
verified hours
owner claimed
recently added
recently updated
photos added
menu added
open now
nearby
low recent exposure
category match
neighborhood coverage gap
```

Labels:

```text
New to MealScout
Fresh Menu Update
Owner Verified
Under-Scouted
Open Now Nearby
Menu Added
New Photos
Quiet Find
```

Forbidden labels unless proven:

```text
Popular
Trending
Most loved
Community favorite
Top rated
```

---

# 9. Feed Composition Logic

## Default For You feed

Algorithm:

```text
1. Pull candidates from each scene source.
2. Score each candidate.
3. Enforce diversity:
   - max 2 of same type in first 7 cards
   - max 1 card per business in first 7 cards unless user intent is specific
   - include worth-discovering if available
4. Sort with scoring + diversity constraints.
5. Remove cards missing required real data.
6. Render graceful empty states if too thin.
```

## Example first 7 card targets

```text
1. nearby/open food truck
2. community-supported place or dish
3. open restaurant nearby
4. worth-discovering spot
5. new menu item
6. event today/tonight
7. real active deal
```

Only if real.

---

# 10. Scene Behavior

## For You

Mixed feed and mixed pins.

Shows:

```text
what locals love
what is open
what is nearby
what is new
what is worth discovering
what is happening today
```

---

## Community

Community-driven content.

Shows:

```text
favorite places
favorite trucks
favorite dishes
saved menu items
locally active businesses
```

Does not mean only dishes.

---

## Nearby Now

Time/location-driven.

Shows:

```text
open now
posted-up trucks
currently active events
nearby businesses with verified hours
```

---

## Food Trucks

Truck-first.

Shows:

```text
posted-up trucks
scheduled trucks
truck menu highlights
truck deals/events when real
```

---

## Restaurants

Restaurant-first.

Shows:

```text
open restaurants
new/updated restaurants
menu highlights
community proof where real
```

---

## Deals

Deal-first.

Shows:

```text
active deal records only
business deals
dish/menu item deals
event deals
```

No fake deal copy.

---

## Events

Event-first.

Shows:

```text
today events
tonight events
upcoming events
venue-linked food events
live music if real event category exists
```

---

## New Menus

Fresh menu content.

Shows:

```text
new items
recently updated menus
new dish photos
seasonal menu changes if real
```

Suggested freshness window:

```text
14 days default
30 days if market is thin
```

---

## Late Night

Availability-driven.

Shows:

```text
open late restaurants
bars with food
food trucks posted late
late-night events
```

Only if hours support it.

---

## Worth Discovering

Cold-start discovery.

Shows:

```text
new
under-scouted
owner verified
fresh profile/menu updates
nearby but low exposure
coverage-gap businesses
```

---

# 11. Empty State Plan

You need strong empty states because early markets will be thin.

## Generic scene empty

```text
Nothing strong here yet.
Try another scene or widen your area.
```

Actions:

```text
Widen Area
Nearby Now
Worth Discovering
```

---

## Community empty

```text
Community favorites are still forming here.
Save places and dishes to help shape the local board.
```

Actions:

```text
Explore Nearby
Worth Discovering
```

---

## Deals empty

```text
No active deals nearby right now.
Check open spots or new menu drops.
```

Actions:

```text
Nearby Now
New Menus
```

---

## Food truck empty

```text
No trucks posted up nearby right now.
Check restaurants, events, or late-night options.
```

Actions:

```text
Restaurants
Events
```

---

## Search empty

```text
No matches for that yet.
Try a broader search or explore the local scene.
```

Actions:

```text
Clear Search
Worth Discovering
Nearby Now
```

---

# 12. Visual Design Contract

## Color system

```text
background: dark espresso / charcoal
card background: glassy near-black
primary accent: MealScout orange
text: warm off-white
muted text: warm gray
border: low-opacity charcoal/orange
selected state: strong orange fill or outline
```

## Orange usage

Orange should be visible in:

```text
selected scene
active map pin
selected map card CTA
search dock border/focus
important labels
route/action highlights
```

Do not wash the whole UI in orange. It should guide action.

---

## Map style

```text
dark map
orange road glow
subtle building/street detail
pins readable
map fades into content
no hard rectangle
no radar
```

## Cards

```text
rounded
compact
horizontal
thumbnail left
text center
actions right/bottom
type label visible
not oversized promo blocks
```

## Scene bar

```text
under map
horizontal scroll
big enough to tap
active orange
icons + labels
not cramped tiny chips
```

## Search dock

```text
bottom sticky
rounded pill
orange border/accent
normal search icon
filter icon optional
no AI symbol
```

---

# 13. Backend/API Plan

Create or adapt one Scout endpoint.

## Recommended endpoint

```http
GET /api/scout
```

Query params:

```text
lat
lng
radius
scene
q
time
limit
```

Example:

```http
GET /api/scout?lat=30.5044&lng=-90.4612&radius=10&scene=for_you&limit=30
```

Response:

```ts
type ScoutResponse = {
  scene: ScoutSceneId;
  location: {
    lat: number;
    lng: number;
    radiusMiles: number;
    label?: string;
  };
  options: SceneOption[];
  mapPins: ScoutMapPin[];
  selectedItem?: ScoutSceneItem | null;
  feedItems: ScoutSceneItem[];
  emptyState?: {
    title: string;
    message: string;
    actions: {
      label: string;
      sceneId?: ScoutSceneId;
      action?: string;
    }[];
  };
};
```

## Search endpoint

Either use same endpoint with `q`, or separate:

```http
GET /api/scout/search?q=tacos&lat=...&lng=...
```

Return grouped results:

```ts
type ScoutSearchResponse = {
  query: string;
  groups: {
    type: "places" | "food_trucks" | "dishes" | "deals" | "events" | "new_menus";
    label: string;
    items: ScoutSceneItem[];
  }[];
};
```

---

# 14. Frontend File Plan

Use your actual repo structure, but this is the clean split:

```text
client/src/pages/scout/ScoutPage.tsx

client/src/components/scout/ScoutMapHero.tsx
client/src/components/scout/SelectedMapCard.tsx
client/src/components/scout/MapControls.tsx
client/src/components/scout/SceneOptionsBar.tsx
client/src/components/scout/TodayAroundYouFeed.tsx
client/src/components/scout/ScoutFeedCard.tsx
client/src/components/scout/ScoutIntentDock.tsx
client/src/components/scout/ScoutSearchOverlay.tsx
client/src/components/scout/ExploreSceneTiles.tsx
client/src/components/scout/ScoutEmptyState.tsx

client/src/lib/scout/scoutTypes.ts
client/src/lib/scout/scoutApi.ts
client/src/lib/scout/scoutLabels.ts
client/src/lib/scout/scoutRanking.ts
client/src/lib/scout/scoutFormatters.ts
```

Backend if needed:

```text
server/routes/scout.ts
server/services/scoutSceneService.ts
server/services/scoutRankingService.ts
server/services/scoutDiscoveryService.ts
server/services/scoutMapService.ts
```

---

# 15. Build Phases

## Phase 1: Visual shell

KPI:

```text
The page visually matches the screenshot structure.
```

Build:

```text
Map hero
logo overlay
scene bar under map
Today Around You section
mixed card layout
bottom search dock
no global nav duplication
```

Use real data only. If real endpoint is not ready, wire to existing real endpoints or show empty states.

---

## Phase 2: Unified Scout data adapter

KPI:

```text
Every component uses one normalized ScoutSceneItem shape.
```

Build:

```text
business mapper
menu item mapper
event mapper
deal mapper
food truck mapper
worth discovering mapper
distance formatter
status formatter
proof label resolver
```

---

## Phase 3: Scene switching

KPI:

```text
Scene bar updates both map pins and feed.
```

Build:

```text
For You
Community
Nearby Now
Food Trucks
Restaurants
Deals
Events
New Menus
Late Night
Worth Discovering
```

---

## Phase 4: Real search

KPI:

```text
User can search from bottom dock and get grouped real results.
```

Build:

```text
overlay
quick intents
grouped results
query ranking
empty state
```

---

## Phase 5: Ranking and fairness

KPI:

```text
Known favorites get exposure without burying new/quiet businesses.
```

Build:

```text
default mixed ranking
scene-specific ranking
search ranking
worth discovering ranking
diversity caps
exposure fairness
no fake proof labels
```

---

## Phase 6: Polish and acceptance

KPI:

```text
Scout feels alive, broad, useful, and premium on first open.
```

Validate:

```text
mobile spacing
tap targets
map/feed sync
empty states
loading states
real data only
no fake screenshot text
no AI language
no nav duplication
```

---

# 16. Acceptance Checklist

The build passes only if:

```text
Map is the top hero.
Map feels seamless, not boxed.
MealScout logo icon replaces profile photo.
No large MealScout text.
No tagline.
No Ask Scout.
No AI sparkle icon.
No global nav is recreated.
Scene options sit directly under the map.
Scene options update map and feed.
Search dock sits near bottom above global nav safe area.
Search uses normal search language.
Today Around You uses mixed local scene content.
Dishes appear naturally but do not dominate hierarchy.
Food trucks, restaurants, deals, events, new menus, and worth-discovering content all have valid lanes.
Businesses without reviews/deals can appear in Worth Discovering.
All visible data is real backend data.
No fake business names.
No fake dishes.
No fake deals.
No fake events.
No fake distances.
No fake ratings.
No fake community proof.
No fake counts.
Empty states appear when real data is missing.
```

---

# 17. AI Coding Agent Prompt

Use this as the final implementation prompt:

```text
You are implementing the MealScout Scout page.

Goal:
Recreate the attached mobile screenshot as closely as possible in layout, spacing, visual hierarchy, and interaction pattern, while using real MealScout backend data only.

Reference screenshot:
food_and_places_discovery_app_interface.png
Mobile reference:
mealscout_scout_mobile_mockup_430w.png

Do not reinterpret the design.
Do not create a new design.
Do not make it a Yelp, DoorDash, or Google Maps clone.
Do not hardcode fake screenshot content.

Hard corrections from the screenshot:
- Replace the profile photo with the MealScout logo icon only.
- Do not show large MealScout text.
- Do not show “Follow The Flavor.”
- Do not show “Ask Scout.”
- Do not use an AI sparkle icon.
- Do not render global nav; the app already has global navigation.
- Keep scene options directly under the map.
- Use a bottom search/intent dock with placeholder: “Search food, places, trucks, events”.

Product rule:
Scout is a verb/action layer, not a chatbot/entity.
Dishes are content inside scenes, not a hierarchy above places, food trucks, restaurants, deals, or events.
Default Scout should be a broad discovery mix, not pure recommendations.
The more specific the user gets through scene selection or search, the more recommendation-based the experience becomes.

Page layout:
1. Full-width seamless dark map hero at the top.
2. MealScout logo icon top-left over map.
3. Settings/alerts action top-right over map if supported.
4. Interactive map pins for real local scene items.
5. Floating selected-item card over map.
6. Scene options bar directly under map:
   For You, Community, Nearby Now, Food Trucks, Restaurants, Deals, Events, New Menus, Late Night, Worth Discovering.
7. Main feed:
   Title: Today Around You
   Subtitle: A live mix of what locals love, what's open, what's new, and what's nearby.
8. Mixed feed cards for:
   food trucks, dishes/menu items, restaurants, deals, events, new menus, worth-discovering spots.
9. Bottom search/intent dock above global nav safe area.
10. Optional Explore the Scene tiles lower on the page.

Visual style:
- dark espresso/charcoal base
- strong MealScout orange accents
- warm off-white text
- glassy dark cards
- rounded corners
- subtle borders
- active selected states in orange
- secondary colors only for category labels/pins
- no radar rings
- no hard rectangular map box

Data rules:
All rendered data must come from real backend records.
Do not invent:
- businesses
- dishes
- deals
- events
- prices
- distances
- ratings
- specials
- community proof
- counts
- map pins

If data is missing:
- do not fake it
- use fallback icon/image
- use graceful empty state
- omit unsupported action/label

Required normalized item shape:
Create or reuse a ScoutSceneItem type with:
id, type, title, sourceName, businessId, menuItemId, dealId, eventId, category, lat, lng, distance, statusLabel, proofLabel, timeLabel, imageUrl, isOpen, canRoute, canSave.

Scene behavior:
For You should create a mixed local scene feed from real records:
- food truck if available
- restaurant if available
- dish/menu item if available
- deal if available
- event if available
- new menu item if available
- worth-discovering spot if available

Community should include favorite places, trucks, dishes, and locally active items.
Nearby Now should prioritize open/current nearby items.
Food Trucks should prioritize posted-up/scheduled trucks.
Restaurants should prioritize real restaurant records.
Deals should show active deal records only.
Events should show real event records only.
New Menus should show recently created/updated menu items.
Late Night should use real hours/status.
Worth Discovering should surface real low-proof/new/underexposed businesses using honest labels.

Worth Discovering valid labels:
New to MealScout, Fresh Menu Update, Owner Verified, Under-Scouted, Open Now Nearby, Menu Added, New Photos, Quiet Find.

Forbidden labels unless real proof exists:
Popular, Trending, Most Loved, Community Favorite, Top Rated.

Ranking:
Default For You:
- broad local scene coverage
- community proof
- user relevance
- freshness
- fair discovery

Specific scene:
- scene match
- open/current status
- distance
- community proof
- user relevance
- freshness/fair discovery

Search:
- query match
- open/current status
- distance
- user relevance
- community proof

Fairness:
- do not let one business dominate every lane
- do not show more than two of the same type in the first visible feed unless the scene requires it
- do not bury new businesses only because they lack reviews/deals
- do not label low-proof items as favorites

Deliverables:
- componentized implementation
- real-data hydration
- loading states
- empty states
- map/feed scene sync
- bottom search overlay
- no fake production data
- TypeScript/check/test pass
```

---

# 18. Best AI Tools For This Task

```text
Cursor / Codex:
Best for implementing the componentized React/TypeScript page.

v0 / Lovable:
Best for quickly producing component scaffolding, but must be constrained by the screenshot and real-data contract.

Mapbox:
Best for branded seamless dark map styling.

Supabase/Postgres:
Best for scene queries, ranking, and unified Scout data views.

Image generation:
Only useful for visual exploration. Do not use it as implementation truth.

Playwright:
Best for visual regression checks against the screenshot.

Percy / Chromatic:
Best if you want repeatable screenshot comparison.
```

---

## Final KPI

This Scout page wins when the first screen makes a regular user think:

```text
There is food activity around me.
I can browse the local scene broadly.
I can get specific fast.
I can see what locals like.
I can find trucks, restaurants, dishes, deals, events, and new menus.
New or quiet places still have a fair path to visibility.
I can view, route, or save immediately.
```

That is the full plan.


## Reference Screenshots
- Primary reference screenshot: c:/Users/flavo/Downloads/food_and_places_discovery_app_interface (1).png`n- Visual layout reference only; do not copy fake data, wording, or nav labels from the image.

