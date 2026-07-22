# Hotspot Ownership Matrix

No lane below is active by default. Replace the owner/reviewer requirement with
actual GitHub handles in `REFACTOR_BOARD.md` before moving a lane to In Progress.
This avoids inventing permanent owners when no maintainer has accepted the work.

| Hotspot | Governed lane | Required owner | Required reviewer | Rollback method | Protected flows | Success metrics | Freeze status |
|---|---|---|---|---|---|---|---|
| `server/storage.ts` | Storage seam extraction | Named PR assignee accountable for storage blast radius | Named non-author maintainer | Revert the single extraction commit/PR; retain the prior `IStorage` delegation path | Auth/ownership reads, subscription state, booking/event persistence, admin totals | Hotspot lines reduced; one domain per PR; gate pass rate; 7-day regressions; rollbacks; incident diagnosis time | Frozen until named in board |
| `server/routes/adminManagementRoutes.ts` | Admin domain split | Named PR assignee accountable for admin route composition | Named non-author maintainer | Revert the bounded route-registration extraction and restore prior registration order | Admin auth, totals, telemetry, moderation and user operations | Hotspot lines reduced; route parity; one domain per PR; gate pass rate; 7-day regressions; rollbacks | Frozen until named in board |
| `server/routes/eventRoutes.ts` | Event domain split | Named PR assignee accountable for event lifecycle blast radius | Named non-author maintainer | Revert the bounded event-module extraction; preserve prior schema and route contract | Event creation/publish, occurrence generation, booking state, cancellation, truck notifications | Hotspot lines reduced; event state-transition parity; one domain per PR; gate pass rate; 7-day regressions; rollbacks | Frozen until named in board |

## Activation rule

An activation row in `REFACTOR_BOARD.md` must include the lane, bounded slice,
owner handle, reviewer handle, rollback reference, and start date. Until then,
the table is a control contract—not a claim that work is underway.
