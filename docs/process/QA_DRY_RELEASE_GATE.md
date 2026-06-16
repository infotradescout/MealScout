# QA + DRY Release Gate

Status: Active operating layer.

Authority: Zachary's engineering guidance is accepted as release discipline for user-facing work. This gate is process-only and does not authorize broad runtime refactors.

## Required Sequence

1. QA current user-facing behavior.
2. Fix broken or confusing Critical/High UX issues.
3. Plan DRY/SRP cleanup only after stable behavior is documented.
4. Re-QA after cleanup.
5. Resume feature work only after the gate evidence is complete.

## QA Gate Rule

No user-facing merge is ready without QA evidence.

QA evidence must name:

- Product/repo and lane
- Baseline SHA and branch
- User journeys tested
- Viewports/devices covered
- Commands and smokes run
- Defects found, priority, and disposition
- Screenshots/video paths when visual behavior matters
- Final worktree status

## Refactor Gate Rule

No pure refactor merge is ready without behavior-parity evidence and re-QA.

Refactor evidence must name:

- Stable behavior being preserved
- Files/modules touched
- Behavior intentionally unchanged
- Contracts/tests proving parity
- Manual QA repeated after cleanup
- Rollback/split plan if parity fails

## Hard Boundaries

- Do not convert runtime code as part of this foundation lane.
- Do not touch oversized files until QA identifies the behavior to preserve.
- Do not collapse fetch/error handling until current UX and failure states are documented.
- Do not treat file counts or size claims as truth without repo inspection.
- Do not resume feature expansion while Critical/High UX defects remain open.

## Evidence Location

Use `docs/evidence/` for lane-specific proof packets and link them from release notes or review packets.
