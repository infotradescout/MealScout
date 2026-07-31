# Refactor Execution Discipline Protocol

Status: mandatory control; no refactor lane is active unless it is listed in
`REFACTOR_BOARD.md` with a named owner and named non-author reviewer.

## Locked lanes

Only these lanes may be activated during the current refactor program:

1. Storage seam extraction (`server/storage.ts`)
2. Admin domain split (`server/routes/adminManagementRoutes.ts`)
3. Event domain split (`server/routes/eventRoutes.ts`)

Adjacent product expansion may not ride with a refactor change.

## Thin-slice shipping rule

- One bounded module move per PR.
- Preserve public route, storage-interface, and response behavior.
- Freeze new features in every touched hot seam until the extraction is
  verified after merge.
- Name one owner and one non-author reviewer in the PR. Both confirm the
  rollback path before merge.
- Record before/after metrics in `REFACTOR_METRICS_LOG.md`.

## Required PR evidence

Every extraction PR must state:

- bounded seam and excluded scope;
- blast radius;
- owner and reviewer GitHub handles;
- rollback command or revert commit plan that can execute in minutes;
- parity checks run;
- protected flows verified;
- before/after hotspot size and touched-domain count.

## Mandatory parity checks

The owner and reviewer must verify, as applicable:

- authentication and ownership outcomes;
- profile-access and operational-readiness outcomes;
- booking and event state transitions;
- admin totals and telemetry counters.

If a protected flow lacks automated coverage, the PR must add coverage or stay
blocked. "Not tested" is not a passing result.

## Release decision

The change ships only when every answer is yes:

1. Does it reduce coupling in the named hot seam?
2. Does it preserve revenue-critical paths?
3. Does it reduce or hold operator support burden?
4. Can it be rolled back in minutes?

Mixed-purpose PRs, unnamed accountability, missing parity evidence, or an
unproven rollback keep the lane frozen.
