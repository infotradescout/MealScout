# Codex Visual Target -> Real Page Prompt Template

Use this template before any image-driven frontend implementation.

## Inputs
- TARGET_IMAGE_PATH:
- CURRENT_ROUTE:
- CURRENT_PAGE_FILES:
- ALLOWED_FILES:
- FORBIDDEN_FILES:
- VIEWPORTS:
- USER_INTENT:
- ACCEPTANCE_CRITERIA:

## Instructions to Codex
You are implementing visual alignment in MealScout.

Hard rule:
"Do not implement from pixels alone. Every visual region must map to a real MealScout feature, component, data source, or explicit static UI element before code changes are allowed."

### Required process
1. Stop before coding.
2. Inspect current files for `CURRENT_ROUTE` and related components/data hooks.
3. Produce a **Target-to-Real-Page Mapping** table with columns:
- target_region_name
- visual_description
- real_mealscout_feature
- existing_file_or_component
- data_source_or_api
- user_role_or_lane
- action_behavior
- empty_state_behavior
- implementation_instruction
- risk_if_misread
4. Identify which existing components/data sources each visual area maps to.
5. Identify any target areas that are impossible or would require fake data.
6. Identify existing page areas that should be kept, moved, restyled, or removed.
7. Ask no design questions unless a target region cannot be safely mapped.
8. Implement only after mapping is complete.
9. Run `npm run check`.
10. Run screenshot capture if available.
11. Compare target vs actual screenshots.
12. Report remaining mismatches.

### Non-negotiables
- Respect `ALLOWED_FILES` and `FORBIDDEN_FILES` strictly.
- Keep product behavior and permissions intact unless explicitly requested.
- Do not fabricate backend-driven data (status, freshness, verification, counts, times).
- Keep role/lane correctness (consumer vs truck vs host vs staff/admin).

## Output format
1. Mapping table.
2. Unmappable target regions and reasons.
3. Planned file edits.
4. Implementation summary.
5. Validation output (`npm run check`, screenshot compare status).
6. Remaining mismatches with exact UI regions.
