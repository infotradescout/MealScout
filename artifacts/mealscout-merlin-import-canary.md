# MealScout Merlin Import Canary

repo: infotradescout/MealScout
commit: c36823251d9c252d3aa3f8dedce6e1a0a587cea5
short_sha: c3682325
source: Merlin evidence_seed export
data_direction: Merlin -> MealScout only

## Result

rows_received: 7
rows_accepted: 2
rows_quarantined: 1
rows_rejected: 3
duplicates_suppressed: 1
claim_escalations: 0
verification_escalations: 0
owner_escalations: 0
affiliate_escalations: 0

## Quarantine Reasons

{
  "review_required": 1
}

## Decisions

- row=1 action=accepted reason=safe_evidence_seed name=Canary Pupusa Truck
- row=2 action=duplicate_suppressed reason=duplicate_target_profile_id name=Canary Pupusa Truck Duplicate
- row=3 action=accepted reason=safe_evidence_seed name=Canary Admin Unattributed
- row=4 action=rejected reason=import_decision_blocked name=Canary Blocked Truck
- row=5 action=quarantined reason=review_required name=Canary Review Truck
- row=6 action=rejected reason=invalid_safety_flags name=Canary Unsafe Origin
- row=7 action=rejected reason=admin_unattributed_affiliate_attribution name=Canary Bad Affiliate
