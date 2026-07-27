# TradeScout ↔ MealScout Embed Contract (v1)

Status: Locked  
Owner: TradeScout (Parent OS)  
Applies To: All embedded access via /api/actions

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
- Responses must follow the documented contract: lists return `results` + `count`; objects return `data`.

## Rate Limiting & Safety
- `/api/actions` is rate-limited (see `API_ACTIONS.md`).
- Abusive patterns (scraping, mass contact) are out of contract and may be blocked.

## Change Control
- Versioned contract: v1 is locked. Changes require v2 with explicit opt-in.
- Backward-compatible additions must be documented in `API_ACTIONS.md` and announced before use.

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

For questions or changes, raise a versioned proposal; do not alter this document without a new version.
