# MealScout Hotspot Ownership Matrix

Status: Active
Scope: lane-storage, lane-admin, lane-events
Last Updated: 2026-04-24

## Ownership Model

Required roles per hotspot:
- Owner: accountable for extraction execution and blast-radius declaration
- Reviewer: accountable for parity verification and rollback readiness
- Fallback owner: accountable when primary owner is unavailable

Assignment rule:
- Owner and reviewer cannot be the same person.

## Active Hotspot Matrix

| Lane ID | Hotspot | Primary Files | Owner | Reviewer | Fallback Owner | Blast Radius Domains | Protected Flows | Rollback Unit | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lane-storage | Storage seam extraction | server/storage.ts | Repo Owner | Assigned Reviewer | Assigned Backup | auth, booking, analytics, subscription gate | auth, booking, payments, ordering gate | single slice revert | active |
| lane-admin | Admin domain split | server/routes/adminManagementRoutes.ts | Repo Owner | Assigned Reviewer | Assigned Backup | admin policy, moderation, telemetry, overrides | admin stats, verification outcomes, policy actions | single slice revert | active |
| lane-events | Event domain split | server/routes/eventRoutes.ts | Repo Owner | Assigned Reviewer | Assigned Backup | hosts, events, capacity, booking, visibility, notifications | event booking, event visibility, event status transitions | single slice revert | active |

## Mandatory Slice Record Template

Use this template in each PR for these lanes:

- Lane ID:
- Slice ID:
- Hotspot file target:
- Owner:
- Reviewer:
- Fallback owner:
- Blast radius:
- Expected unchanged behaviors:
- Required checks run:
- Metrics log entries added:
- Rollback command or plan:

## Parity Coverage By Lane

| Lane ID | Must-Pass Parity Checks |
| --- | --- |
| lane-storage | auth lookup parity, ownership check parity, subscription gate parity, booking query parity, analytics count parity |
| lane-admin | admin count parity, verification action parity, moderation policy parity, telemetry write parity |
| lane-events | event create and update parity, capacity transition parity, booking linkage parity, visibility and status parity |

## Escalation Triggers

Escalate immediately if any occurs:
- Protected flow regression in production or staging
- Unexpected policy behavior change in admin actions
- Metrics drift that cannot be explained by traffic variance
- Missing rollback path for an active slice

Escalation action:
- Freeze new merges in impacted lane
- Stabilize and verify parity
- Log incident note in board and metrics artifacts

## Current Lane Backlog Seeds

Initial seed slices for planning:
- lane-storage-s1: extract subscription and ownership checks into dedicated repository boundary
- lane-admin-s1: split admin policy actions from telemetry and diagnostics actions
- lane-events-s1: isolate event state transition handlers from read endpoints

These seeds are planning starters and must be finalized in the refactor board before execution.
