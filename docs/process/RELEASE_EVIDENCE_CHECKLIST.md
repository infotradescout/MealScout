# Release Evidence Checklist

Every release or review packet should include enough evidence for another engineer to reconstruct the decision.

## Required Fields

- Product/repo
- Lane
- Branch
- Baseline SHA
- Final SHA
- Files changed
- Runtime/data mutation posture
- Public exposure posture
- Email/payment posture
- Validation commands and results
- Manual QA coverage
- Known residual risk
- Final git status

## User-Facing Merge Requirement

User-facing work must include QA evidence before merge/release approval.

Minimum evidence:

- route or screen coverage
- at least one mobile and one desktop check when UI changes
- defect list with priority
- confirmation no unrelated lane work is mixed in

## Refactor Merge Requirement

Pure refactors must include behavior-parity evidence and re-QA.

Minimum evidence:

- behavior intentionally preserved
- tests/contracts proving parity
- user journey rechecked after refactor
- rollback/split plan
