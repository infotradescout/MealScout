# MealScout Free API Growth Playbook

This document captures a practical 1-by-1 rollout plan for free or free-tier APIs that support MealScout's core goals:
- Acquire restaurant owners and food truck owners
- Add host locations with usable parking
- Increase recurring bookings and monthly revenue

## 1) Google Business Profile API
- What it does: Sync business info, hours, photos, posts, and reviews.
- Why it helps: Onboarding is faster and business data is more trustworthy.
- First implementation:
  - Add `Connect Google Business Profile` in owner dashboard.
  - Autofill MealScout profile fields from Google data.
  - Show `last synced` status.
- KPI: Owner signup completion rate, profile publish rate.

## 2) US Census Geocoding API (Free)
- What it does: Free US address geocoding + normalization.
- Why it helps: Better map accuracy for trucks, hosts, and events.
- First implementation:
  - Use Census as primary geocoder for US addresses.
  - Save normalized address and confidence signal.
  - Queue low-confidence records for review.
- KPI: Geocode success rate, map pin error rate.

## 3) OpenStreetMap Nominatim (Fallback)
- What it does: Open geocoding/search fallback.
- Why it helps: Backup path when primary geocoder fails.
- First implementation:
  - Use only when Census fails.
  - Add strict request throttling and caching.
  - Avoid uncached high-volume traffic.
- KPI: Fallback success rate, geocoding failover recovery.

## 4) openrouteservice
- What it does: Routing, ETA, and drive-time zones.
- Why it helps: Match trucks and hosts by travel time, not just straight-line distance.
- First implementation:
  - Compute 15/30 minute drive-time matches.
  - Add travel-time score to booking recommendations.
- KPI: Booking acceptance rate.

## 5) National Weather Service API (US, Free)
- What it does: Official weather alerts and forecast feeds.
- Why it helps: Reduces weather-day cancellations and no-shows.
- First implementation:
  - Daily weather risk checks for upcoming events.
  - Trigger host/truck alerts when risk crosses threshold.
- KPI: Weather-day cancellation rate.

## 6) OpenWeather (Free Tier)
- What it does: Forecast data for demand prediction.
- Why it helps: Suggests better time slots for higher turnout.
- First implementation:
  - Add weather-adjusted demand score in scheduling UI.
  - Recommend top upcoming slots by forecast + demand.
- KPI: Bookings per published slot.

## 7) Brevo API (Already in stack)
- What it does: Email/SMS lifecycle automation.
- Why it helps: Hands-off activation and reactivation.
- First implementation:
  - 3 drips:
    - Owner activation: D0, D2, D7
    - Host activation: D0, D3, D10
    - Booking rescue: abandoned setup follow-up
- KPI: Drip-to-booking conversion rate.

## 8) Twilio Lookup
- What it does: Phone validation + normalization.
- Why it helps: Improves SMS deliverability and reduces wasted outreach.
- First implementation:
  - Validate phone during lead capture.
  - Normalize to E.164 before SMS send.
- KPI: SMS delivery success rate.

## 9) Google Maps Platform (Free threshold + paid overages)
- What it does: High-quality place lookup, geocoding, and enrichment.
- Why it helps: Better data quality for ambiguous business records.
- First implementation:
  - Reserve paid enrichment calls for high-value, low-confidence records.
  - Trigger enrichment only on low-confidence addresses.
- KPI: Enriched lead close rate.

## 10) Stripe APIs
- What it does: Transaction payments, deposits, and payouts.
- Why it helps: Safely moves money when customers order or book.
- First implementation:
  - Add booking deposits.
  - Add payout status visibility.
- KPI: Paid booking count and reconciled payout rate.

---

## Suggested Rollout Order (30 days)
1. Census Geocoder + Nominatim fallback
2. Brevo drip automation hardening
3. Google Business Profile connection
4. openrouteservice matching score
5. NWS weather alerts
6. Twilio Lookup validation
7. OpenWeather demand scoring
8. Stripe expansion (deposits/monthlies)
9. Google Maps premium enrichment
