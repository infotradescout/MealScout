# MealScout Owner Add-On Best Practices

Start here first:
Owners should complete the Universal Regular User Guide before using owner tools. Your MealScout account includes regular user features plus business-owner tools.

Primary dependency:
See `docs/MEALSCOUT_UNIVERSAL_USER_BEST_PRACTICES.md` first.

## Table of Contents
- [1. Owner Basics](#1-owner-basics)
- [2. Owner Onboarding](#2-owner-onboarding)
- [3. Create or Claim Business](#3-create-or-claim-business)
- [4. Business Basics](#4-business-basics)
- [5. Business Type Setup](#5-business-type-setup)
- [6. Business Location and Service Area](#6-business-location-and-service-area)
- [7. Owner Menu Management](#7-owner-menu-management)
- [8. Schedule and Live Status](#8-schedule-and-live-status)
- [9. Deals and Promotions](#9-deals-and-promotions)
- [10. Events](#10-events)
- [11. Host / Parking Pass](#11-host--parking-pass)
- [12. Owner Messaging](#12-owner-messaging)
- [13. Recommendations / Reviews / Activity](#13-recommendations--reviews--activity)
- [14. Verification and Trust](#14-verification-and-trust)
- [15. Payments / Stripe](#15-payments--stripe)
- [16. Owner Dashboard](#16-owner-dashboard)
- [17. Owner Best Practices](#17-owner-best-practices)
- [18. Owner Troubleshooting](#18-owner-troubleshooting)
- [19. Owner Support](#19-owner-support)

## 1. Owner Basics

### Flow name
Understand Owner Tools vs Personal Profile

Who this is for:
Food truck owners, restaurant owners, bar owners, hosts, and event organizers.

When to use this:
Before doing business setup.

Before you start:
You should already know universal user flows.

Click-by-click instructions:
1. Open your personal account at `/profile`.
2. Confirm personal settings in `/profile/settings`.
3. Open owner surfaces like `/restaurant-owner-dashboard`, `/host/dashboard`, or `/event-coordinator/dashboard` based on role.
4. Keep personal profile and business profile updates in the correct screen.

What success looks like:
You understand that owner tools are add-ons to a regular user account.

Common mistakes:
Trying to edit business settings inside personal profile only.

What to do if something breaks:
Return to the matching dashboard route for your business role.

Support path:
Share your role and dashboard URL in support email.

## 2. Owner Onboarding

### Flow name
Complete Owner Onboarding and Resume Later

Who this is for:
Any account switching into business ownership workflows.

When to use this:
First-time owner setup and incomplete setup recovery.

Before you start:
Account should be verified and logged in.

Click-by-click instructions:
1. Start from `/customer-signup?role=business` (or host/event role paths).
2. Continue to role setup routes such as `/restaurant-signup`, `/host-signup`, or `/event-coordinator/dashboard?setup=onboarding`.
3. If interrupted, return to the same route and resume form completion.
4. Confirm final handoff through `/post-verification` or role dashboard.

What success looks like:
You land in the correct owner dashboard with setup complete.

Common mistakes:
Switching role paths mid-setup.

What to do if something breaks:
Use the original setup route and same account email.

Support path:
Include setup route and last completed step.

## 3. Create or Claim Business

### Flow name
Create or Claim a Business Surface

Who this is for:
Owners connecting business identity to account.

When to use this:
During initial business setup.

Before you start:
Choose correct business type first.

Click-by-click instructions:
1. Start business setup at `/restaurant-signup` (or `/claim-truck` for food truck claim flow).
2. Enter business identity details and continue setup.
3. Attach setup to your logged-in account.
4. Verify business appears in owner dashboard context.

What success looks like:
Business is linked to your account and visible in owner tools.

Common mistakes:
Using multiple emails across claim and setup flows.

What to do if something breaks:
Retry with one account session and one business path.

Support path:
Send business name, account email, and role path used.

## 4. Business Basics

### Flow name
Complete Business Basic Information

Who this is for:
All business owners.

When to use this:
After business profile creation.

Before you start:
Have business contact details ready.

Click-by-click instructions:
1. Open `/restaurant-signup` or business setup surface.
2. Add business name, description, and contact details.
3. Add photos/logo if available in your flow.
4. Save and confirm visibility from your dashboard.

What success looks like:
Business identity is complete and understandable to users.

Common mistakes:
Leaving contact fields blank.

What to do if something breaks:
Refresh and retry section-by-section.

Support path:
Share which field is failing to save.

## 5. Business Type Setup

### Flow name
Set the Correct Business Type

Who this is for:
Owners choosing category-specific setup.

When to use this:
At initial onboarding.

Before you start:
Know your operating model.

Click-by-click instructions:
1. Choose business type in signup route (`food_truck`, `restaurant`, `bar`, `caterer`, `private_chef`) from `/customer-signup?role=business`.
2. Continue to `/restaurant-signup` with selected type.
3. For host flows, use `/host-signup` and `/host/dashboard`.
4. For event organizers, use `/event-coordinator/dashboard`.

What success looks like:
Your dashboard and tooling match your business type.

Common mistakes:
Choosing the wrong business type and continuing.

What to do if something breaks:
Stop and contact support before publishing profile.

Support path:
Provide current and desired business type.

## 6. Business Location and Service Area

### Flow name
Set Accurate Location and Service Area

Who this is for:
Business owners who need local visibility.

When to use this:
During setup and whenever operating area changes.

Before you start:
Have full address and city/state ready.

Click-by-click instructions:
1. Enter location in business setup and confirm map alignment.
2. Validate visibility on `/map` and `/scout`.
3. For hosts, confirm address and coordinates in `/host/dashboard`.
4. Update coverage if city/area changes.

What success looks like:
Customers find the business in the correct local area.

Common mistakes:
Incorrect pin placement causing low discovery.

What to do if something breaks:
Re-save address and recheck map.

Support path:
Send address and screenshot showing wrong map position.

## 7. Owner Menu Management

### Flow name
Build and Maintain Menu Content

Who this is for:
Business owners with menu-based services.

When to use this:
Setup and routine updates.

Before you start:
Prepare menu categories, items, and prices.

Click-by-click instructions:
1. Open `/menu-builder` from owner navigation.
2. Add menu sections and items.
3. Update price and availability as needed.
4. Confirm public view at `/menu/:restaurantId`.

What success looks like:
Customers see current items and prices.

Common mistakes:
Forgetting to update unavailable items.

What to do if something breaks:
Save small edits first, then larger updates.

Support path:
Share menu section and item that failed to update.

## 8. Schedule and Live Status

### Flow name
Manage Hours, Live Status, and Schedule

Who this is for:
Owners with changing daily operations.

When to use this:
Anytime hours or live status changes.

Before you start:
Know today and weekly operating windows.

Click-by-click instructions:
1. Open owner dashboard (`/restaurant-owner-dashboard` or `/host/dashboard`).
2. Update schedule/hours in available controls.
3. Set live status only while actively operating.
4. Turn off live status when closed to prevent stale info.

What success looks like:
Public status aligns with real-world availability.

Common mistakes:
Leaving live status on after closing.

What to do if something breaks:
Toggle status off/on and refresh dashboard.

Support path:
Include dashboard screenshot and business name.

## 9. Deals and Promotions

### Flow name
Create and Manage Deals

Who this is for:
Owners running promotions.

When to use this:
Launching or updating specials.

Before you start:
Have clear offer terms and timing.

Click-by-click instructions:
1. Open `/deal-creation`.
2. Publish the deal and verify it appears in `/deals/featured`.
3. Edit via `/deal-edit/:dealId` when updates are needed.
4. Review public deal detail at `/deal/:id`.

What success looks like:
Deal is visible, accurate, and time-relevant.

Common mistakes:
Publishing with unclear expiration details.

What to do if something breaks:
Reopen deal detail and verify required fields.

Support path:
Send deal URL and current status.

## 10. Events

### Flow name
Manage Event Participation or Event Posting

Who this is for:
Event coordinators, hosts, and businesses joining events.

When to use this:
Planning event visibility and participation.

Before you start:
Confirm role permissions for events.

Click-by-click instructions:
1. Browse events at `/events`.
2. Open your role dashboard (`/event-coordinator/dashboard` or owner routes).
3. Create/post event when `Post Event` is available.
4. Reopen `/event/:slug` to verify event visibility.

What success looks like:
Events are published and visible to the right audience.

Common mistakes:
Editing event details without rechecking public page.

What to do if something breaks:
Refresh dashboard and retry submission.

Support path:
Include event name and route used.

## 11. Host / Parking Pass

### Flow name
Create and Manage Parking Pass Listings

Who this is for:
Hosts/property owners and food trucks booking slots.

When to use this:
Setting up truck parking opportunities.

Before you start:
Prepare address, schedule, and capacity details.

Click-by-click instructions:
1. Open `/parking-pass` and review listing/bookable options.
2. For host controls, open `/host/dashboard` and `/parking-pass-manage` if routed from your account.
3. Add availability windows and capacity details.
4. Confirm listing appears publicly and is bookable.

What success looks like:
Parking pass data is accurate and visible.

Common mistakes:
Publishing with missing hours or pricing context.

What to do if something breaks:
Reopen listing, save again, and verify Stripe readiness if required.

Support path:
Send listing ID/address and issue description.

## 12. Owner Messaging

### Flow name
Respond to Owner Messages

Who this is for:
Owners handling inbound customer communication.

When to use this:
When messaging UI exists.

Before you start:
Confirm chat routes are active.

Click-by-click instructions:
1. Planned / not currently available: no dedicated owner inbox route is currently mapped in app routes.
2. Use support-safe contact methods and profile contact details.
3. Keep replies professional and avoid sensitive personal data.
4. Monitor for future in-app messaging release notes.

What success looks like:
You use safe contact channels while waiting for inbox rollout.

Common mistakes:
Expecting a built-in conversation inbox today.

What to do if something breaks:
Route users to support email with clear context.

Support path:
Use `/profile/help` for issue escalation.

## 13. Recommendations / Reviews / Activity

### Flow name
Track Engagement Signals

Who this is for:
Owners monitoring visibility and social proof.

When to use this:
Weekly optimization reviews.

Before you start:
Have access to dashboard and profile pages.

Click-by-click instructions:
1. Review owner dashboard surfaces (`/restaurant-owner-dashboard`).
2. Check visible engagement surfaces like saves/recommendations if present.
3. Use `/video` and profile recommendation actions to keep activity fresh.
4. Update content based on user interactions.

What success looks like:
Owner profile reflects current activity and trust signals.

Common mistakes:
Ignoring stale media and outdated highlights.

What to do if something breaks:
Reload dashboard and verify account role access.

Support path:
Share which engagement panel is missing.

## 14. Verification and Trust

### Flow name
Complete and Monitor Verification Status

Who this is for:
Owners needing trust and visibility readiness.

When to use this:
During onboarding and status updates.

Before you start:
Prepare requested business identity details.

Click-by-click instructions:
1. Follow verification handoff from `/post-verification`.
2. Complete required business setup routes.
3. Check dashboard status indicators for pending/approved progress.
4. Update requested details if verification requires changes.

What success looks like:
Business is in good standing for visibility and operations.

Common mistakes:
Skipping verification-related prompts.

What to do if something breaks:
Resubmit required info and recheck status screens.

Support path:
Include current verification state and account email.

## 15. Payments / Stripe

### Flow name
Set Up Payment Readiness

Who this is for:
Owners and hosts receiving payouts or charging customers.

When to use this:
Before accepting paid bookings/orders.

Before you start:
Have payout/business identity info ready.

Click-by-click instructions:
1. Open payment/profile tools such as `/profile/payment` (role-limited visibility).
2. For host payouts, check `/host/dashboard` Stripe/connect readiness indicators.
3. Complete required Stripe onboarding steps when prompted.
4. Verify payment readiness before publishing paid offers.

What success looks like:
Payment and payout status is ready for live operations.

Common mistakes:
Launching paid flows before Stripe readiness completes.

What to do if something breaks:
Refresh status and retry payout/onboarding actions.

Support path:
Provide business name and current Stripe status message.

## 16. Owner Dashboard

### Flow name
Run Daily Operations from Dashboard

Who this is for:
All owner-role accounts.

When to use this:
Daily operations check-in.

Before you start:
Use your role-appropriate dashboard route.

Click-by-click instructions:
1. Open `/restaurant-owner-dashboard`, `/host/dashboard`, or `/event-coordinator/dashboard`.
2. Review setup completeness and activity.
3. Update stale profile/menu/hours/deals items.
4. Confirm public surfaces after updates (`/scout`, `/map`, `/deals/featured`).

What success looks like:
Business data is current and discoverable.

Common mistakes:
Updating dashboard data without checking public visibility.

What to do if something breaks:
Save one section at a time and retest.

Support path:
Include dashboard route and failing panel name.

## 17. Owner Best Practices

### Flow name
Maintain a High-Trust Owner Presence

Who this is for:
All owners.

When to use this:
Ongoing weekly operations.

Before you start:
Set a routine update cadence.

Click-by-click instructions:
1. Keep hours and live status accurate.
2. Keep menu and pricing fresh.
3. Use real photos and clear descriptions.
4. Keep deals/events/location info current and remove stale items quickly.

What success looks like:
Customers see accurate, trustworthy business information.

Common mistakes:
Letting old content remain published.

What to do if something breaks:
Audit all public owner surfaces and republish updates.

Support path:
Ask support for a visibility review checklist.

## 18. Owner Troubleshooting

### Flow name
Resolve Common Owner-Side Issues

Who this is for:
Owners with setup or visibility problems.

When to use this:
When business data is missing, wrong, or not updating.

Before you start:
Identify exact failing route/screen.

Click-by-click instructions:
1. Business not showing: verify dashboard save state and map location.
2. Wrong business type: confirm signup role/type parameters used.
3. Menu not visible: recheck `/menu-builder` then `/menu/:restaurantId`.
4. Payments/verification stuck: re-open `/host/dashboard`, `/profile/payment`, and `/post-verification` context.

What success looks like:
You isolate the broken part and provide exact diagnostics.

Common mistakes:
Reporting issues without route/path context.

What to do if something breaks:
Collect screenshots and retry with one browser/device first.

Support path:
Send account email, business name, route, and screenshot.

## 19. Owner Support

### Flow name
Escalate Owner Issues to Support

Who this is for:
All business-owner roles.

When to use this:
After owner troubleshooting steps fail.

Before you start:
Gather complete issue packet.

Click-by-click instructions:
1. Open `/profile/help`.
2. Select `Email Support`.
3. Include account email, business name, phone number, screenshot, and issue description.
4. Add device/browser and exact route path where issue occurred.

What success looks like:
Support can reproduce and resolve owner issue quickly.

Common mistakes:
Not including business name or route path.

What to do if something breaks:
Resend with missing context.

Support path:
Use `info.mealscout@gmail.com` from Help & Support.
