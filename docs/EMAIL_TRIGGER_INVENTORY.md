# Email Trigger Inventory

Last updated: 2026-05-15

This file tracks MealScout email sends by trigger class so optional notifications do not drift into spammy behavior. Global delivery is centralized in `server/emailService.ts`.

## Global Controls

- `EMAIL_NOTIFICATIONS_MODE=off|disabled|none` skips all email.
- `EMAIL_NOTIFICATIONS_MODE=account_only` only allows `account` category email.
- `marketing` category email is limited by `MARKETING_EMAIL_WINDOW_START_HOUR`, `MARKETING_EMAIL_WINDOW_END_HOUR`, and scheduler timezone settings.
- User-facing optional notifications should respect `accountSettings.notifications.channels.email` and the relevant topic through `server/utils/notificationPreferences.ts`.

## Account And Security

These are intentionally not marketing-gated beyond global provider/mode controls.

| Trigger | Recipient | Source | Guardrails |
| --- | --- | --- | --- |
| Email verification | Account user | `unifiedAuth.ts`, `restaurantSignupRoutes.ts`, `utils/emailVerification.ts`, admin resend route | `account` category |
| Password reset | Account user | `unifiedAuth.ts` | `account` category |
| Account setup invite | Manually created/imported user | `utils/accountSetup.ts`, admin/staff/truck import routes | `account` category |
| Admin signup notification | Internal admin email | `unifiedAuth.ts` | Internal recipient |

## Transactional Receipts

These confirm purchases or direct order state and should generally remain deliverable.

| Trigger | Recipient | Source | Guardrails |
| --- | --- | --- | --- |
| Parking Pass booking confirmation | Truck owner and host | `routes/stripeWebhookRoutes.ts` | Stripe webhook-driven |
| Pickup order confirmation/ready | Customer | `routes/pickupOrderRoutes.ts` | Ready notification has per-order sent flag; provider skips are logged as failed |
| Supplier accepted/delivery update | Buyer | `routes/suppliers/requestsRoutes.ts` | Respects `orderUpdates` email preference |

## Optional Product Notifications

These should respect user preferences and/or idempotency.

| Trigger | Recipient | Source | Guardrails |
| --- | --- | --- | --- |
| Nearby deal alert | Nearby users | `routes/dealRouteDependencies.ts` | `notifyUser`, `dealAlerts`, saved-address radius |
| Followed restaurant deal | Followers | `routes/dealRouteDependencies.ts` | `notifyUser`, `followedActivity` |
| Business contact message | Business owner | `routes/restaurantCoreRoutes.ts` | `notifyUser`, `businessMessages` |
| Support ticket and direct admin message | Super admin | `routes/supportRoutes.ts` | User action, `notifyUser`, `businessMessages`, internal/admin recipient |
| Booking request to truck | Truck owner | `routes/bookingRoutes.ts` | `businessMessages` preference |
| Truck interest in location request | Host/request owner | `emailNotifications.ts` | `businessMessages` preference |
| Location demand threshold crossed | Host and interested trucks | `routes/locationDemandRoutes.ts` | Fires only on first threshold crossing; host uses `businessMessages`, trucks use `nearbyEvents` |
| Location demand activation reminder | Location request owner | `services/locationDemandActivation.ts` | Step idempotency, max 100/run, `businessMessages`, marketing category |
| Event interest accepted/declined | Truck owner | `routes/hostInterestRoutes.ts`, `routes/hosts/eventsRoutes.ts` | `nearbyEvents` preference |
| Series cancellation | Affected truck owners and coordinator | `routes/openCallSeriesRoutes.ts` | Truck owner `nearbyEvents`; coordinator email/topic checks |
| Truck event/series matching | Truck owner | `truckEventMatchService.ts` | Idempotent telemetry, `nearbyEvents` preference |
| Unbooked event opportunity | Nearby truck owners | `eventNotificationCron.ts` | Event-level sent marker, host/truck coordinate radius, `nearbyEvents`; radius env `UNBOOKED_EVENT_NOTIFICATION_RADIUS_KM` |
| Supplier new request | Supplier | `routes/suppliers/requestsRoutes.ts` | `businessMessages` preference |
| Supply demand nudge | Supplier | `routes/supplierMarketplaceRoutes.ts` | Per supplier/item TTL, `businessMessages`, marketing category |

## Scheduled Marketing And Digests

| Trigger | Recipient | Source | Guardrails |
| --- | --- | --- | --- |
| Host weekly digest | Hosts | `digestService.ts` | One per host/week, `weeklyDigest` preference |
| Profile activity summary | Active business-profile operators | `bootstrap/registerSchedulers.ts` | One per user/month, `weeklyDigest` preference |
| Diner deals digest | Customers with saved address | `dinerDigestService.ts` | One per user/week, `weeklyDigest`, marketing category |
| Customer onboarding drip | Customers | `onboardingDripService.ts` | Day 3/day 7 idempotency, email opt-out, marketing category |
| Restaurant activation nudge | Restaurant owners without deals | `restaurantActivationService.ts` | Day 7/day 14 idempotency, email opt-out, marketing category |
| Pensacola food truck drip | Verified Pensacola truck owners | `services/pensacolaFoodTruckDrip.ts` | Feature flag, step idempotency, max 50/run, marketing category |
| Pensacola report lead magnet/drip | Report leads | `services/pensacolaReportLeadMagnet.ts`, `services/pensacolaReportDrip.ts` | Immediate cooldown, step idempotency, max 50/run, marketing category |
| Host partner lead magnet/drip | Host partner leads | `services/hostPartnerLeadMagnet.ts`, `services/hostPartnerLeadDrip.ts` | Immediate cooldown, step idempotency, max 50/run, marketing category |

## Admin And Ops

| Trigger | Recipient | Source | Guardrails |
| --- | --- | --- | --- |
| Admin broadcast | Filtered users | `routes/admin/adminCoreOpsRoutes.ts` | Opt-in-only by default, marketing category, default cap 250/request via `ADMIN_BROADCAST_MAX_RECIPIENTS` |
| Bug report | Internal admin email | `routes/analyticsRoutes.ts` | User action, internal recipient |
| Verification approval/rejection | Claim owner and internal mailbox | `routes/admin/verificationRoutes.ts` | Admin action |
| Food truck claim submitted | Internal mailbox | `routes/truckClaimRoutes.ts` | Internal recipient |
| Incident alerts | Incident recipients | `incidentManager.ts` | Env-configured internal recipients |
| Map watchdog alert | Ops recipients | `mapEndpointWatchdog.ts` | Ops alert |
| VAC pending review digest | Admin | `bootstrap/registerSchedulers.ts` | Daily only when pending reviews exist |
| Admin test email | Chosen admin recipient | `routes/adminManagementRoutes.ts` | Admin action |

## Policy Notes

- Optional user-facing email should not call `emailService.sendBasicEmail` directly without a clear preference/idempotency reason.
- Use `notifyUser` for new multi-channel product notifications.
- Keep account, security, payment receipts, and internal incident/ops messages separate from marketing controls unless the product requirement changes.
