# Food-Truck-First Expansion System

Date: 2026-04-26
Owner: Growth + Ops + Admin

## Objective
Build markets in a systematic sequence (Pensacola -> Gulf to Dallas -> East Coast to New Jersey -> radiate) with:
- food truck concentration as a top decision factor,
- explicit filtering to avoid fast-food-heavy or chain-dominant inventory,
- an internal admin directory for supplier ecosystem coverage (suppliers, commissary kitchens, delivery services, and related partners).

## 1) Market Selection Score (Truck-First)
Use a 100-point market score before launching a city.

### 1.1 Score Weights
- 35 points: Food truck concentration
- 20 points: Truck activity freshness (recent sessions/posts/schedules)
- 15 points: Independent/local ratio (non-chain concentration)
- 10 points: Demand signals (searches, waitlist, host/event requests)
- 10 points: Partner ecosystem readiness (suppliers/commissaries/delivery)
- 10 points: Operational readiness (team capacity + launch coverage)

### 1.2 Suggested Inputs
- Truck concentration:
  - active trucks per 100k population
  - active trucks per square mile in target service radius
- Activity freshness:
  - % trucks with activity in last 14 days
  - % trucks with valid next-7-day schedule
- Independent/local ratio:
  - % businesses not mapped to known chain blacklist
  - % trucks/restaurants with unique local branding
- Demand signals:
  - local user growth, map sessions, recommendations, deal interactions
- Partner readiness:
  - supplier count in city radius
  - commissary kitchen coverage
  - delivery partner availability

## 2) Fast-Food / Chain Exclusion Policy
Goal: keep onboarding and discovery focused on independent, local, truck-first ecosystem.

### 2.1 Default Exclude Rules
Exclude candidates if any of these apply:
- category indicates global/national fast-food chain,
- brand name matches chain blacklist,
- location belongs to known franchise parent brand,
- business model is primarily drive-thru fast-food with standardized national menu and no local operator identity.

### 2.2 Review Bucket (Manual)
Do not auto-exclude; send to review when:
- category is ambiguous,
- local independent has same name as known chain token,
- hybrid concept (bar + quick service) with local ownership.

### 2.3 Keep Rules (Truck/Independent Bias)
Always keep or prioritize when:
- businessType = food_truck,
- isFoodTruck = true,
- proven local independent with valid local signals (local socials, local website, community recommendations).

### 2.4 Data Hygiene
Store exclusion decisions with reason code:
- chain_blacklist_match
- category_fast_food
- franchise_network_match
- manual_exclude
- manual_allow_override

## 3) Launch Gates (City Must Pass Before Next)
Only move to next city in sequence when current city clears all gates for 2 consecutive weeks:
- Listing coverage >= 85%
- Claim rate >= 20%
- Active weekly businesses >= 10%
- Truck activity freshness >= 60%
- Independent/local ratio >= 70%

## 4) Expansion Sequence (Operational)
### 4.1 Wave A: Pensacola Core
Pensacola, Gulf Breeze, Milton, Navarre, Pace.

### 4.2 Wave B: Gulf Corridor to Dallas
Mobile -> Biloxi/Gulfport -> New Orleans -> Baton Rouge -> Lafayette -> Lake Charles -> Beaumont -> Houston -> Dallas/Fort Worth.

### 4.3 Wave C: East Coast to New Jersey
Jacksonville -> Savannah -> Charleston -> Myrtle Beach -> Wilmington -> Richmond -> DC -> Baltimore -> Philadelphia -> New Jersey.

### 4.4 Wave D: Radiate
Expand ring-by-ring from each established hub based on score/gates.

## 5) Admin Directory: Supplier Ecosystem
Create one internal directory taxonomy to support truck operators and growth ops.

### 5.1 Directory Entity Types
- supplier
- commissary_kitchen
- delivery_service
- packaging_provider
- fuel_service
- cold_storage
- maintenance_service
- permit_compliance_service

### 5.2 Core Fields (All Directory Entries)
- id
- entityType
- businessName
- city
- state
- latitude
- longitude
- contactPhone
- contactEmail
- websiteUrl
- serviceRadiusMiles
- servesFoodTrucks (boolean)
- isActive
- source (google/manual/partner/import)
- verificationStatus (unverified/verified/review)
- qualityScore (0-100)
- tags (json)
- notes (internal)
- createdAt, updatedAt

### 5.3 Entity-Specific Fields
- commissary_kitchen:
  - overnightParking
  - prepStations
  - greaseDisposal
  - monthlyRateRange
  - inspectionSupport
- delivery_service:
  - serviceTypes (last_mile/catering/bulk)
  - vehicleTypes (car/van/refrigerated)
  - slaWindow
  - insuranceVerified
- supplier:
  - categories (produce/protein/dry goods/beverage/packaging)
  - minimumOrderCents
  - deliveryFeeCents
  - acceptsOnlinePayments

### 5.4 Relationship Links
- link directory entities to target cities/markets
- link supplier entries to existing suppliers table where possible
- allow many-to-many tags for cuisine compatibility and truck size fit

## 6) Implementation Notes (Fit Current Codebase)
Current codebase already has supplier marketplace primitives and truck-centric data structures.

### 6.1 Reuse Existing Foundations
- Supplier profile and product/order tables exist in shared schema.
- Truck import and food-truck session/location structures exist.
- socialAutopostSettings can remain independent from market scoring.

### 6.2 New Additions Recommended
- Growth scoring service for city selection (server-side utility/service).
- Chain blacklist table/config with override workflow.
- Admin endpoints for directory CRUD and review queue.
- Admin dashboard module: "Market Expansion Ops" with:
  - city scorecards,
  - exclusion review queue,
  - directory coverage heatmap.

## 7) Weekly Operating Rhythm
- Monday: refresh city scores + shortlist next launch candidates.
- Tuesday: data ingest + exclusion review.
- Wednesday: claims + activation push.
- Thursday: partner directory enrichment (suppliers/commissaries/delivery).
- Friday: gate review and launch/no-launch decision.

## 8) Non-Negotiables
- No city expansion without gate pass.
- No fast-food chain flooding in core onboarding/discovery channels.
- Food truck concentration remains top weighted factor until national baseline is established.
- Keep manual override and audit trail for all exclusions.
