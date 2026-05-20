# MealScout Visual Target Interpreter

Purpose: prevent pixel-copy implementations that break MealScout structure, data, roles, or behavior.

## Required workflow (always)
1. Inspect the target image/mockup.
2. Inspect the current real page code for the target route.
3. Inspect the current real screenshot for that page (if available).
4. Produce a **Target-to-Real-Page Mapping** before writing code.
5. Implement only after the mapping is complete.
6. Capture post-change screenshots.
7. Compare target vs actual and patch visual mismatches without changing product logic.

## Hard rule
Do not implement from pixels alone. Every visual region must map to a real MealScout feature, component, data source, or explicit static UI element before code changes are allowed.

## Mapping format (required)
Create one row per visible target region.

| target_region_name | visual_description | real_mealscout_feature | existing_file_or_component | data_source_or_api | user_role_or_lane | action_behavior | empty_state_behavior | implementation_instruction | risk_if_misread |
|---|---|---|---|---|---|---|---|---|---|

Fields:
- `target_region_name`: exact region label from target (or precise inferred name).
- `visual_description`: what is visible (layout, hierarchy, density, emphasis).
- `real_mealscout_feature`: feature meaning in MealScout terms.
- `existing_file_or_component`: exact file/component path.
- `data_source_or_api`: query key/endpoint/local state backing region.
- `user_role_or_lane`: consumer, food_truck, host, hybrid, staff/admin.
- `action_behavior`: what taps/clicks do in current app.
- `empty_state_behavior`: current fallback when no data.
- `implementation_instruction`: style/structure change to apply without behavior drift.
- `risk_if_misread`: concrete regression risk (auth, booking, payments, misleading status, etc).

## Required region coverage checklist
At minimum evaluate these regions when present:
- map surface
- recommendation card
- truck card
- restaurant card
- Parking Pass host spot card
- filter chips
- bottom navigation
- CTA button
- empty state
- rail heading
- status badge
- menu/deal/event module

## Execution sequence
1. Build mapping table.
2. Mark each region as `mapped`, `partially_mapped`, or `unmappable`.
3. List unmappable regions with reason:
- missing component
- missing data source
- would require fake data
- conflicts with role/permission model
4. Define minimal file edit set (allowed files only).
5. Implement.
6. Run `npm run check`.
7. Capture screenshots for requested viewports.
8. Report remaining target mismatches.

## Guardrails
- Keep route/auth/role behavior unchanged unless task explicitly includes behavior changes.
- Never invent verification/status/timestamp data.
- Never bypass capability checks for operational actions.
- Keep Parking Pass and Scout role-lane boundaries intact.
- If a target region cannot be safely mapped, pause and state the blocking mismatch explicitly.

## Deliverable template in PR/response
1. Mapping table.
2. File change list.
3. Constraints respected.
4. Screenshot comparison summary.
5. Remaining mismatches and why.
