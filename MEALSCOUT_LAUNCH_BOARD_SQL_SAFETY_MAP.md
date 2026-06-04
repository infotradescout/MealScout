# MealScout Launch Board SQL Safety Map

This map locks down the Launch Board aggregation surface for cleanup/stabilization. It is not a feature plan and does not authorize metric redesign, query rewrites, data backfills, or new product features.

## 1. Launch Board Owner File

Owner file: `server/routes/admin/adminCoreOpsRoutes.ts`

Route: `GET /api/admin/launch-board`

Protection:

- The route is registered behind `isAuthenticated` and `isStaffOrAdmin`.
- The admin dashboard reads it from `client/src/pages/admin-dashboard.tsx` with query key `["/api/admin/launch-board", launchBoardCity]`.
- Future SQL changes must preserve existing response field names consumed by the admin dashboard and guarded by `node scripts/mealscout-one-market-launch-board.contract.test.ts`.

## 2. All Launch Board Metric Groups

Current metric groups:

- Profile coverage: `profilesTotal`, `claimableProfiles`, `claimedProfiles`, `profilesWithMenu`, `profilesWithSchedule`, `profilesWithContact`, `profilesWithPhotoLogo`.
- Active supply: `activeFoodTrucks`, `activeHosts`, `parkingPassListings`.
- Booking funnel: `bookingStarts`, `bookingConfirmations`, `parkingPassViews`, `parkingPassClicks`.
- Public engagement: `publicProfileViews`, `publicProfileActions`, `affiliateLinkOpens`.
- Claim pitch funnel: `claimPitchesCreated`, `claimPitchesSent`, `claimPitchesOpened`, `claimPitchesStarted`, `claimPitchesCompleted`, and related rates.
- Claim reconciliation: `claimedProfilesUpdatedAfterPitch`, `claimedProfilesWithMenuAfterPitch`, `claimedProfilesWithScheduleAfterPitch`, `claimedProfilesWithContactAfterPitch`, `claimedProfilesWithPhotoAfterPitch`, `claimToUsefulProfileRate`.
- Useful profile demand lift: useful/non-useful view, action, and booking-click rates and lifts.
- Booking intent lift: useful/non-useful booking intent rates, Parking Pass click totals, and booking-intent-to-booking conversion rates.
- Parking Pass leak diagnostics: `parkingPassNoListingLeak`, `parkingPassClickNoStartLeak`, `parkingPassStartNoConfirmLeak`, `parkingPassPaymentDisabledLeak`, `parkingPassHostCapacityLeak`, `parkingPassMissingHostCoordinateLeak`, `parkingPassMissingTruckProfileLeak`.
- Leak fix queue: `leakFixQueue`, `leakFixesOpen`, `leakFixesInProgress`, `leakFixesResolved`, `leakFixesImproved`, and `topLeakReason`.
- City options: distinct restaurant/host city options for the Launch Board city filter.

## 3. SQL Tables Used

Known tables and aliases used by Launch Board SQL:

- `restaurants` / raw SQL alias `r`: profile rows, contact fields, claim state, food-truck classification, city filtering.
- `users`: owner/user type claim statistics.
- `hosts` / raw SQL alias `h`: host supply, host contact/photo, Parking Pass host city filtering.
- `menu_items` / raw SQL alias `mi`, `mi2`: menu presence.
- `truck_manual_schedules` / raw SQL alias `tms`, `tms2`: manual truck schedule presence.
- `events` / raw SQL alias `e`: booked schedules and Parking Pass event/listing joins.
- `event_series`: active Parking Pass listings.
- `event_bookings`: Parking Pass booking starts and confirmations.
- `request_logs` / raw SQL alias `rl`, `rv`, `ra`, `rb`, `ri`, `rp`: public profile views/actions, booking intent, Parking Pass request logs, and leak fix outcome state.
- `affiliate_share_events`: affiliate link open counts.
- `truck_import_listings` / raw SQL alias `l`: claim pitch attribution and claim pitch status rollups.
- Parking Pass diagnostic joins also depend on event/host/listing columns already used by the owner route; do not add new tables without a safety-map update and contract coverage.

## 4. Approved Column References

Approved schema references:

- `truckManualSchedules.truckId` and SQL `truck_manual_schedules.truck_id` are valid for schedule-to-restaurant joins.
- `menuItems.restaurantId` and SQL `menu_items.restaurant_id` are valid for menu-to-restaurant joins.
- `restaurants.id`, `restaurants.ownerId`, `restaurants.city`, `restaurants.isActive`, `restaurants.isFoodTruck`, `restaurants.businessType`, `restaurants.phone`, `restaurants.websiteUrl`, `restaurants.logoUrl`, `restaurants.coverImageUrl`, `restaurants.claimedFromImportId`, `restaurants.updatedAt`, `restaurants.insuranceVerified`, and `restaurants.insuranceExpiresAt`.
- SQL alias `r.phone` and `r.website_url` are approved restaurant contact fields.
- Drizzle fields `restaurants.phone` and `restaurants.websiteUrl` are approved restaurant contact fields.
- `users.id` and `users.userType` are approved claim ownership references.
- `hosts.id`, `hosts.city`, `hosts.contactPhone`, `hosts.spotImageUrl`, `hosts.latitude`, `hosts.longitude`, and host payment/capacity fields already present in `server/routes/admin/adminCoreOpsRoutes.ts`.
- `events.id`, `events.hostId`, `events.eventType`, `events.bookedRestaurantId`, and Parking Pass schedule fields already present in `server/routes/admin/adminCoreOpsRoutes.ts`.
- `eventSeries.hostId`, `eventSeries.seriesType`, and `eventSeries.status`.
- `eventBookings.eventId` and `eventBookings.status`.
- `requestLogs.surface`, `requestLogs.eventType`, `requestLogs.entityType`, `requestLogs.entityId`, `requestLogs.metadata`, and `requestLogs.createdAt`.
- `affiliateShareEvents.destinationUrl`.
- `truckImportListings.id`, `truckImportListings.city`, and `truckImportListings.rawData`.

## 5. Known Forbidden Column References

Forbidden unless a schema/migration explicitly adds the column and this map plus contracts are updated:

- `truckManualSchedules.restaurantId`
- SQL `truck_manual_schedules.restaurant_id`
- SQL `tms.restaurant_id`
- SQL `tms2.restaurant_id`
- `restaurants.email`
- SQL `restaurants.email`
- SQL `r.email`
- Using restaurant email as a Launch Board contact field.

Correct alternatives:

- Use `truckManualSchedules.truckId` / `truck_manual_schedules.truck_id` for manual schedules.
- `truckManualSchedules.truckId` is valid; `truckManualSchedules.restaurantId` is forbidden until a migration/schema change adds it.
- Use `restaurants.phone` / `r.phone` and `restaurants.websiteUrl` / `r.website_url` for restaurant contact coverage.
- If owner email is needed for a separate future admin workflow, join through `restaurants.ownerId` to `users.id` and document that change separately; do not silently count `r.email`.

## 6. City Filter Rules

City filtering must specify the table alias used per query:

- Restaurant/profile metrics: use `restaurants.city` in Drizzle queries and `r.city` in raw SQL.
- Host/supply/Parking Pass listing metrics: use `hosts.city` in Drizzle queries and `h.city` when joining hosts.
- Event-backed Parking Pass request logs: use `events e` joined to `hosts h`, then filter on `h.city`.
- Claim pitch rollups from import listings: use `truckImportListings.city` in Drizzle queries and `l.city` in raw SQL.
- Leak fix outcomes: use `rl.metadata->>'marketCity'`.
- Parking Pass request logs may fall back to `rl.metadata->>'city'` only after restaurant/host/event entity city checks are preserved.
- Affiliate share events currently use `affiliateShareEvents.destinationUrl` city matching; treat this as a weak URL heuristic and do not mix it into table-backed city filters.
- City normalization must remain `lower(trim(coalesce(..., ''))) = cityKey`.

## 7. JSON/rawData Usage Rules

- `truckImportListings.rawData.claimPitch` is the JSON attribution/status source for Launch Board claim pitch funnel metrics.
- Raw SQL path `l.raw_data->'claimPitch'` is approved for claim reconciliation.
- Claim pitch fields used by Launch Board are `sentAt`, `pitchOpenedAt`, `claimStartedAt`, and `claimCompletedAt`.
- Do not rename claim pitch JSON keys during cleanup.
- Do not replace `truckImportListings.rawData.claimPitch` with a new relational table during cleanup unless a separate migration, backfill, docs update, and contract suite are explicitly approved.

## 8. Request Log Event Assumptions

Request log event assumptions:

- Public profile views use `surface = 'public_profile'` and `event_type = 'profile_view'`.
- Public profile actions use `surface = 'public_profile'` and `event_type = 'profile_action'`.
- Useful profile booking intent uses `event_type in ('booking_click', 'menu_click', 'directions_click', 'call_click')`.
- Parking Pass views use `event_type in ('parking_pass_view', 'parking_pass_listing_view')`.
- Parking Pass clicks use `event_type = 'parking_pass_click'`.
- Parking Pass request logs are scoped to `surface in ('public_profile', 'parking_pass')`.
- Leak fix outcomes use `surface = 'launch_board'` and `event_type = 'leak_fix_outcome'`.
- City filtering for request logs must resolve entity city through restaurant/host/event joins before relying on metadata fallback.

## 9. Insurance Verification Assumptions

- Launch Board may expose `insuranceVerified` / `insuranceExpiresAt` payload fields for admin user context, but the core Launch Board aggregation must not treat generic business verification as insurance eligibility.
- Parking Pass booking eligibility remains protected elsewhere by non-expired stored insurance verification.
- Do not add Launch Board SQL that infers booking eligibility from `restaurants.isVerified`, owner role, or email state.
- If Launch Board later counts insurance-ready trucks, the approved references are `restaurants.insuranceVerified = true` and non-expired `restaurants.insuranceExpiresAt`; update this map and `node scripts/admin-insurance-verification.contract.test.ts`.

## 10. Parking Pass Funnel/Leak Assumptions

- Parking Pass listings count published `eventSeries` rows with `seriesType = 'parking_pass'` and `status = 'published'`.
- Parking Pass booking starts count `eventBookings` joined through `events` where `events.eventType = 'parking_pass'`.
- Parking Pass booking confirmations count `eventBookings.status = 'confirmed'` on Parking Pass events.
- Parking Pass view/click funnel depends on `request_logs` event assumptions listed above.
- Leak reasons currently include `no_active_parking_pass_listing`, `click_no_booking_start`, `booking_start_no_confirmation`, `payment_disabled`, `host_capacity`, `missing_host_coordinates`, `missing_truck_profile`, and `none`.
- Leak fix types currently include `create_parking_pass_listing`, `enable_host_payments`, `add_host_coordinates`, `increase_or_open_capacity`, `complete_truck_profile`, `add_truck_schedule`, `follow_up_booking_start_no_confirm`, and `review_missing_active_hosts`.
- Do not change leak reason or fix type strings during SQL cleanup.

## 11. Required Validation Commands

Run after any Launch Board SQL or dashboard-facing Launch Board field change:

- `node scripts/mealscout-launch-board-sql-safety-map.contract.test.ts`
- `node scripts/mealscout-one-market-launch-board.contract.test.ts`
- `node scripts/mealscout-claim-pitch-flow.contract.test.ts`
- `node scripts/mealscout-claim-pitch-sent-tracking.contract.test.ts`
- `node scripts/admin-insurance-verification.contract.test.ts`
- `npm run gate:production`
- `npm run check`
- `npm run build`

## 12. Future SQL Change Checklist

Before changing Launch Board SQL:

- Confirm the owner file is still `server/routes/admin/adminCoreOpsRoutes.ts`.
- Confirm the changed metric group and response field names.
- Confirm every table alias used by the query.
- Confirm city filtering uses the correct alias: `restaurants.city`/`r.city`, `hosts.city`/`h.city`, `l.city`, or `rl.metadata->>'marketCity'` as appropriate.
- Confirm manual schedules use `truckManualSchedules.truckId` / `truck_manual_schedules.truck_id`, never `restaurant_id`.
- Confirm contact coverage uses `restaurants.phone`/`r.phone` and `restaurants.websiteUrl`/`r.website_url`, never `r.email`.
- Confirm claim pitch logic still reads `truckImportListings.rawData.claimPitch` / `l.raw_data->'claimPitch'`.
- Confirm request log surfaces and event types match this map.
- Confirm insurance assumptions do not bypass non-expired insurance verification.
- Confirm Parking Pass leak reason and fix type strings are unchanged.
- Run the required validation commands before commit.
