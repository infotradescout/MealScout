# MEALSCOUT_GROWTH_LEDGER

## North Star

Verified local food intent actions per city per day.

## Canonical KPI Events

- `public_discovery_view`
- `public_profile_view`
- `public_profile_action`
- `claim_started`
- `claim_completed`
- `owner_profile_updated`
- `parking_pass_listing_created`
- `parking_pass_booking_started`
- `parking_pass_booking_confirmed`
- `affiliate_profile_link_opened`

## Funnel Targets

| Funnel Stage | Metric |
| --- | --- |
| Discovery | `public_discovery_view` |
| Profile Engagement | `public_profile_view`, `public_profile_action` |
| Owner Activation | `claim_started`, `claim_completed`, `owner_profile_updated` |
| Marketplace Activation | `parking_pass_listing_created`, `parking_pass_booking_started`, `parking_pass_booking_confirmed` |
| Distribution | `affiliate_profile_link_opened` |

## Weekly Operating Checklist

- Validate event tracking integrity for all canonical KPI events.
- Review top discovery cities and route traffic quality.
- Review claim invites sent, claim starts, and claim completions.
- Review owner profile update completion and stale profile backlog.
- Review Parking Pass listing starts, booking starts, and confirmations.
- Review affiliate link opens and downstream conversion.
- Review KPI regressions and create a priority hotfix list.
