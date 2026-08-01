# TradeScout ↔ MealScout Embed Contract (v1)

Status: Locked  
Owner: TradeScout (Parent OS)  
Applies To: All embedded access via /api/actions

## v1 Documentation Erratum — August 1, 2026

This explicitly reviewed compatibility erratum aligns the locked document with
the already deployed v1 wire contract. It makes no runtime, response-shape,
schema, service, or capability change and does not require client opt-in to a
new contract version.

- `FIND_DEALS`, `FIND_RESTAURANTS`, `GET_FOOD_TRUCKS`, and
  `GET_PARKING_PASS_SPOTS` return `success` + `data` (array) + `count`.
- `GET_RESTAURANT_DETAILS` returns `success` + `data` (object).
- A top-level `results` key is not part of these existing v1 success envelopes.

## Purpose
Guarantee a safe, deterministic integration when MealScout is embedded inside TradeScout (or transferred/sold) without weakening TradeScout Law.

## Authority & Auth
- Parent-gated: All calls require `Authorization: Bearer <MEALSCOUT_ACTION_TOKEN>` (or legacy `TRADESCOUT_API_TOKEN`) to `/api/actions`.
- End-user auth is not accepted on this endpoint. Tokens stay server-side only.
- Scope-limited: No other surfaces are in scope for embedding unless versioned separately.

## Action Surface (v1)
- Supported actions and parameters are defined in `API_ACTIONS.md` (authoritative list).
- No silent additions. Any new action or breaking change requires a new contract version.
- County/ledger/vault actions are **read-only**; writes remain governed by TradeScout only.

## Intent & Locality
- Each action carries an explicit intent (`discover_now`, `save`, `owner_manage`).
- Location-based actions require lat/lng and respect radius caps (e.g., `GET_FOOD_TRUCKS` max 50km; invalid coordinates rejected).
- No pay-to-play: ranking/visibility cannot be bought. Discovery is merit/relevance/proximity based.

## Data Integrity
- No fabricated availability, deals, locations, or hours. AI assistance cannot invent data.
- Responses must follow the documented v1 contract: existing public-discovery
  lists return `success` + `data` (array) + `count`, and
  `GET_RESTAURANT_DETAILS` returns `success` + `data` (object).

## Rate Limiting & Safety
- `/api/actions` is rate-limited (see `API_ACTIONS.md`).
- Abusive patterns (scraping, mass contact) are out of contract and may be blocked.

## Change Control
- Versioned contract: v1 is locked. New capabilities or breaking wire changes
  require a new contract version with explicit opt-in.
- Explicit factual or security errata may correct documentation drift without
  changing runtime behavior or expanding authority. They must be reviewed and
  mirrored in `API_ACTIONS.md`.

## Operational Guarantees (v1 scope)
- Authority boundary holds: TradeScout retains parent control; MealScout cannot escalate privileges.
- Locality enforced on discovery; actions remain deterministic and reversible.
- No schema or service inventions are allowed under this contract.

## Out of Scope (v1)
- Client-facing UI contracts
- Non-/api/actions surfaces
- Any ranking changes beyond documented rules

---

## 7. Affiliate Attribution (TradeScout-Governed)

**Authority:** TradeScout owns all affiliate earnings, payouts, and reporting.

**MealScout Role:**
- Accepts `affiliate_id` parameter from TradeScout surfaces
- Records affiliate events: views, clicks, conversions, signups
- Stores event context: deal, restaurant, truck, timestamp
- Provides read-only event query endpoint for TradeScout

**MealScout Does NOT:**
- Calculate commission amounts
- Process payouts or withdrawals
- Display earnings dashboards
- Manage affiliate balances

**Data Flow:**
1. TradeScout passes `affiliate_id` + `source=tradescout` to MealScout
2. MealScout logs attribution events to local DB
3. TradeScout queries `/api/affiliate-events` (authenticated) to pull events
4. TradeScout calculates earnings, manages payouts, displays reports

**Governance:**
- Affiliate attribution is read-only within MealScout
- TradeScout is sole source of truth for affiliate economics
- MealScout is instrumentation layer only

---

For capability or wire-format changes, raise a versioned proposal. A
non-capability-expanding documentation erratum must be labeled, explicitly
reviewed, and kept consistent with `API_ACTIONS.md` and the runtime contract.
