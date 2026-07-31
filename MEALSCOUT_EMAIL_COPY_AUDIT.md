# MealScout Email + Copy Audit

This audit is a cleanup/stabilization slice. It documents MealScout email templates, notification copy, scheduler emails, claim/setup/deal/booking/insurance/auth emails, and automated customer/owner-facing messages. It is not a product-feature plan.

## Global Copy Rules

- MealScout emails must never say `TradeScout` unless explicitly referring to a separate TradeScout product.
- Deals are optional.
- Deals may help visibility in the MealScout Deals feed.
- Deals are not required for discovery.
- A listing/profile can be useful without a deal.
- Do not claim “new customers” are guaranteed.
- Do not claim a deal is the single highest-leverage action.
- Do not imply one action is required unless the product actually gates on it.
- Insurance verification and email verification must be separate.
- Parking Pass booking requires non-expired stored insurance verification.
- All marketing/notification emails must include unsubscribe or notification settings language where applicable.

## Immediate Correction Status

| Template | File path | Status | Correction |
| --- | --- | --- | --- |
| Restaurant activation deal nudge | `server/restaurantActivationService.ts` | Corrected | Removed “One step left,” removed customer-guarantee framing, removed “single highest-leverage,” states deals are optional, mentions the MealScout Deals feed, and lists menu/photos/hours/schedule/contact as other improvement paths. |

## Email/Template Inventory

| Email/template name | File path | Audience | Trigger | Current purpose | CTA | Risk classification | Required correction | Allowed claims | Disallowed claims | Validation/test coverage needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Base delivery wrapper | `server/emailService.ts` | All recipients | All service email sends | Shared provider, footer, delivery mode, audit | N/A | Accurate | Keep MealScout sender only | MealScout sender and account context | TradeScout branding in MealScout email | `scripts/mealscout-email-copy-audit.contract.test.ts` |
| Customer welcome | `server/emailService.ts`, `server/emailNotifications.ts` | Customers | Signup/account creation | Introduce discovery/deals/favorites | Explore/start using MealScout | Needs customer-specific review | Avoid exclusive/guaranteed deal claims if unsupported by market | Customers can discover food, deals, profiles, trucks | Guaranteed savings, guaranteed deal inventory | Email copy audit contract plus future customer email copy test |
| Business welcome | `server/emailService.ts` | Restaurant/truck owners | Signup/account creation | Introduce business dashboard and setup | Complete setup / dashboard | Misleading-risk | Ensure deals are one optional path, not mandatory activation | Profile/menu/photos/hours/contact and optional deals help discovery | “Must create a deal,” guaranteed new customers | Email copy audit contract |
| Admin access | `server/emailService.ts` | Admin/staff | Admin account creation | Explain admin dashboard access | Admin dashboard | Accurate/internal | No public marketing claims | Admin access created | Public customer claims | Existing account/admin checks |
| Password reset | `server/emailService.ts`, `server/unifiedAuth.ts` | Account users | Forgot password | Reset password | Reset password | Accurate | Keep account/security only | Password reset request and expiry | Marketing claims | Existing auth flow plus audit inventory |
| Email verification | `server/emailService.ts`, `server/utils/emailVerification.ts`, `server/routes/admin/userAdminRoutes.ts` | Account users | Signup/admin resend | Verify email ownership | Verify email | Accurate | Keep separate from insurance verification | Email verification confirms email ownership | Insurance/booking eligibility claims | `scripts/admin-insurance-verification.contract.test.ts` |
| Account setup invite | `server/emailService.ts`, `server/utils/accountSetup.ts` | Admin-created/imported users | Admin/staff invite | Complete account setup | Complete setup | Accurate | Keep role-specific copy factual | Invited user can complete setup | Guaranteed activation/outcomes | Email copy audit contract |
| Restaurant activation nudge | `server/restaurantActivationService.ts` | Restaurant/truck owners | Day 7/day 14 no-deal marketing nudge | Optional deal prompt | Open dashboard | Corrected | Done in this slice | Deals optional; deals can help Deals feed visibility; profile fields also help discovery | TradeScout, required deal, guaranteed customers, single highest-leverage | `scripts/mealscout-email-copy-audit.contract.test.ts` |
| Diner deals digest | `server/dinerDigestService.ts` | Customers | Weekly digest | Send local deal digest | View deals | Needs unsubscribe/settings review | Ensure settings/unsubscribe language remains present | Deals may be available nearby | Guaranteed deals/savings | `scripts/auditEmailTriggers.ts` plus copy audit |
| Host weekly digest | `server/digestService.ts` | Hosts | Weekly digest | Summarize host activity | Dashboard | Accurate-risk | Confirm settings language in future pass | Summary of observed activity | Guaranteed bookings | Trigger inventory and future copy test |
| Profile activity summary | `server/emailService.ts`, `server/bootstrap/registerSchedulers.ts` | Active business-profile operators | Monthly scheduler | Summarize profile activity | Dashboard | Accurate | Keep usage factual | Stops, live-location usage, reports completed | Guaranteed revenue/customers | Scheduler inventory |
| Parking Pass completion reminder | `server/parkingPassReminder.ts`, `server/emailService.ts` | Hosts | Monthly/incomplete host setup | Nudge host setup completion | Complete Parking Pass setup | Accurate-risk | Keep setup requirements factual | Host can complete profile/listing/payment setup | Guaranteed bookings | Production gate plus future Parking Pass fixture plan |
| Parking Pass booking confirmation | `server/emailService.ts`, `server/routes/stripeWebhookRoutes.ts` | Truck owner/host | Stripe webhook / booking confirmation | Confirm booking/payment | View booking/dashboard | Accurate | Keep transactional; do not add marketing claims | Booking/payment status | Booking eligibility changes or unsupported guarantees | Stripe/webhook tests |
| Booking request to truck | `server/routes/bookingRoutes.ts` | Truck owner | Host/customer booking request | Notify truck of request | View/respond | Accurate | Keep request vs confirmation distinct | A request was made | Booking guaranteed until confirmed | Booking contracts |
| Deal claimed notification | `server/emailNotifications.ts` | Business owner | Customer claims deal | Notify owner of claimed deal | View claims | Accurate-risk | Avoid “new customer” guarantee | A deal was claimed | Customer will visit / revenue guaranteed | Email copy audit inventory |
| Nearby/followed deal alerts | `server/routes/dealRouteDependencies.ts`, `server/productNotifications.ts` | Customers | Deal notifications | Notify matching users/followers | View deal | Needs settings review | Preserve preference checks | A deal is available or followed restaurant activity happened | Guaranteed savings | `scripts/auditEmailTriggers.ts` |
| Golden Fork award | `server/emailNotifications.ts` | Customers/reviewers | Award event | Award/badge notification | View profile | Overclaiming-risk | Verify ranking/badge claims in future award slice | Award earned if data supports it | “Appears first” unless ranking actually enforces it | Future award-copy contract |
| Golden Plate award | `server/emailNotifications.ts` | Restaurant owners | Award event | Award/badge notification | Dashboard | Overclaiming-risk | Verify search-order/permanence claims before enabling broadly | Award based on current scoring | Permanent award/search-first unless product guarantees it | Future award-copy contract |
| Truck interest in location request | `server/emailNotifications.ts` | Hosts/request owners | Truck interest | Tell host a truck is interested | Coordinate directly | Accurate | Keep “does not broker/guarantee bookings” language | Truck expressed interest | Booking guaranteed | Existing notification preference checks |
| Unbooked event opportunity | `server/eventNotificationCron.ts` | Nearby truck owners | Hourly scheduler | Notify nearby trucks about unbooked event | View/express interest | Accurate-risk | Keep opportunity language non-guaranteed | Opportunity exists; express interest | Spot secured/booking guaranteed | Scheduler/trigger inventory |
| Location demand activation | `server/services/locationDemandActivation.ts`, `server/routes/locationDemandRoutes.ts` | Hosts/trucks | Threshold crossing/drip | Alert/nudge location demand | Open request/profile | Accurate-risk | Keep threshold language factual | Demand threshold crossed | Guaranteed booking/conversion | Trigger inventory |
| Onboarding drip | `server/onboardingDripService.ts` | Customers | Day 3/day 7 scheduler | Encourage discovery/referral | Explore/share | Needs unsubscribe/settings review | Ensure opt-out/settings language | Explore/share MealScout | Guaranteed savings/customers | Trigger inventory |
| Host partner lead magnet/drip | `server/services/hostPartnerLeadMagnet.ts`, `server/services/hostPartnerLeadDrip.ts` | Hosts/leads | Lead/drip | Host partner onboarding | View host tools | Needs host-specific review | Keep hosting claims factual | A location can explore hosting | Guaranteed bookings/revenue | Trigger inventory |
| Pensacola food truck/report drips | `server/services/pensacolaFoodTruckDrip.ts`, `server/services/pensacolaReportDrip.ts`, `server/services/pensacolaReportLeadMagnet.ts` | Food trucks/report leads | Feature-flagged drip/lead magnet | Localized operator outreach | View report/tools | Needs truck-specific review | Keep local-market claims sourced | Report/tooling information | Guaranteed sales/customers | Trigger inventory |
| Admin broadcast | `server/routes/admin/adminCoreOpsRoutes.ts` | Filtered users | Admin action | Admin-composed email | Admin-defined | Dangerous | Requires admin discipline; default excludes protected users | Only admin-entered approved copy | Unapproved marketing/claims | Admin guard docs and future fixture plan |
| Verification approval/rejection | `server/routes/admin/verificationRoutes.ts` | Claim/business users | Admin verification action | Status notification | Review dashboard | Accurate | Keep insurance/email verification separate | Verification action outcome | Parking Pass eligibility unless insurance satisfied | `scripts/admin-insurance-verification.contract.test.ts` |
| Subscription link/admin setup | `server/routes/admin/userAdminRoutes.ts` | Business users | Admin action | Subscription/setup action | Subscribe/setup | Accurate-risk | Keep pricing/action factual | Link to subscription/setup | Guaranteed activation | Email copy audit inventory |
| Supplier/order notifications | `server/routes/suppliers/requestsRoutes.ts`, `server/routes/supplierMarketplaceRoutes.ts`, `server/routes/pickupOrderRoutes.ts` | Suppliers/buyers/customers | Request/order lifecycle | Supply/order status | View/respond | Accurate | Keep status-only | Request/order status | Guaranteed fulfillment until accepted/paid | Existing order/supplier tests |
| Ops/internal alerts | `server/incidentManager.ts`, `server/mapEndpointWatchdog.ts`, `server/bootstrap/registerSchedulers.ts` | Admin/ops | System alerts/digests | Internal operational visibility | Review admin/ops | Accurate/internal | No customer marketing claims | Internal state facts | Public-facing claims | Repo doctor/build |

## Allowed Claims

- “Your MealScout business listing is live” when the user has a live listing/profile.
- “Deals are optional.”
- “Adding a deal can help your business appear in the MealScout Deals feed.”
- “Menu, photos, hours, schedule, and contact info can improve discovery.”
- “Parking Pass booking requires non-expired stored insurance verification.”
- “Email verification confirms email ownership.”
- “This is a request/opportunity/notification” when the event is not confirmed.
- “Update notification settings” or equivalent unsubscribe/settings language for marketing or optional notification emails.

## Disallowed Claims

- “Hey TradeScout!” in a MealScout email.
- “The only thing standing between you and new customers is your first deal.”
- “Adding one deal is the single highest-leverage thing you can do right now.”
- “Deal required” or “must create a deal” framing for discovery.
- Guaranteed new customers, revenue, bookings, profile views, search rank, or award permanence unless the product actually guarantees it.
- Combining email verification with insurance verification.
- Implying Parking Pass booking is available without non-expired stored insurance verification.

## Correction Status

- `server/restaurantActivationService.ts`: corrected in Slice C5A.
- `server/emailService.ts` business welcome: flagged for future owner-copy tightening; current C5A guard focuses on the production screenshot copy and hard-prohibited phrases.
- Award emails in `server/emailNotifications.ts`: flagged for future award-copy review because “appears first” and permanence claims need product-policy confirmation.
- Optional marketing/drip emails: flagged for future unsubscribe/settings copy review by trigger class.

## Validation

- `node scripts/mealscout-email-copy-audit.contract.test.ts`
- `node scripts/repoDoctor.mjs`
- `npm run gate:production`
- `npm run check`
- `npm run build`
