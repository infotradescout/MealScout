# MealScout Navigation Contract

## Purpose
One unified, role-aware six-slot operating rail across surfaces. No separate Scout-only nav.

## Fixed slots
1. `Scout` (always slot 1)
2. Lane-specific
3. Lane-specific
4. Lane-specific (or `Dashboard` fallback)
5. `Share` (always slot 5)
6. `More` (always slot 6)

## Global rules
- Use real existing routes only.
- Do not duplicate destinations in the six-slot rail.
- Guests must not be routed into authenticated-only pages.
- Dashboard is the combined personal + business command center.
- Saved/favorites belong inside Dashboard, not as a global pillar.
- Profile/account lives in More unless lane-primary needs differ.
- Reference screenshots can influence visual style only, never route logic.
- Hardcoded Scout consumer rail is forbidden (`Scout / Map / Deals / Saved / You`).

## Lane map
- Guest: `Scout / Video / Events / Join / Share / More`
- Customer: `Scout / Video / Events / Dashboard / Share / More`
- Food Truck: `Scout / Parking / Orders / Kitchen / Share / More`
- Restaurant: `Scout / Orders / Kitchen / Dashboard / Share / More`
- Host: `Scout / Parking / Video / Dashboard / Share / More`
- Event Coordinator: `Scout / Events / Requests / Dashboard / Share / More`
- Supplier: `Scout / Orders / Products / Dashboard / Share / More`
- Admin/Staff: `Scout / Dashboard / Control / Reports(or Staff fallback) / Share / More`

## Priority rules
- Food truck: `Orders` outranks `Kitchen`.
- Food truck dashboard can be in More because Parking/Orders/Kitchen are higher-frequency.
- Host: Parking includes spots, bookings, availability, pricing, blackout dates.
- Host earnings/payout status belong in Dashboard.
- Events are available to all users via shared event portal and may be in More for host lane.

## More menu principles
- Preserve lane-specific operational depth without overloading the six-slot bar.
- Keep `Report Bug` last or visually separated.
- Keep core operational actions in primary rail; secondary/admin tools in More.
