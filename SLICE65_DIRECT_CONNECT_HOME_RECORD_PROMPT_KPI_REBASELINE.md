# Slice 65 — Direct Connect Home Record Prompt KPI Re-baseline

Date: 2026-05-31  
Status: PASS (measurement visibility implemented)  
Live re-baseline: Pending production traffic window

## Scope Completed

- Confirmed KPI aggregation route: `GET /api/admin/telemetry/funnel`
- Added explicit visibility for Slice 64 Direct Connect Home Record events in funnel response.
- Added contract test coverage for event visibility + response fields.

## Events Included

- `direct_connect_request_started`
- `direct_connect_home_record_prompt_viewed`
- `direct_connect_home_record_link_selected`
- `direct_connect_home_record_create_selected`
- `direct_connect_home_record_skipped`
- `direct_connect_request_submitted_after_home_record_skip`
- `direct_connect_homeid_link_selected`

## KPI Fields (from `/api/admin/telemetry/funnel`)

Counts:
- `directConnectHomeRecord.counts.requestStarted`
- `directConnectHomeRecord.counts.promptViewed`
- `directConnectHomeRecord.counts.linkSelected`
- `directConnectHomeRecord.counts.createSelected`
- `directConnectHomeRecord.counts.skipped`
- `directConnectHomeRecord.counts.submittedAfterSkip`
- `directConnectHomeRecord.counts.homeIdLinkSelected`

Rates:
- `promptViewRateFromRequestStarted`
- `linkSelectRateFromPromptViewed`
- `createSelectRateFromPromptViewed`
- `skipRateFromPromptViewed`
- `submitAfterSkipRate`
- `requestAbandonmentAfterPromptRate`

## Decision Rules

1. If prompt view rate is low vs request started: improve prompt placement/render reliability.
2. If prompt view is healthy but link/create are low: improve value framing + CTA hierarchy.
3. If skip is high and submit-after-skip is also high: keep safe skip path and treat as non-failure.
4. If prompt lowers overall request submission: reduce friction or soften prompt placement.
5. If link/create increase without submission loss: mark Slice 64 effective and move to next weakest step.

## Current Read

- The route now emits the required counters/rates for Slice 64 behavior.
- This slice does not redesign Direct Connect UX.
- Final effectiveness call requires post-deploy event volume.
