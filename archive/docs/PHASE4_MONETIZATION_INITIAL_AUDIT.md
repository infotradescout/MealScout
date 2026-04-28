# Phase 4: Monetization & Payments - Initial Audit

## Objective

Validate Stripe infrastructure readiness, host onboarding status, and parking pass checkout flow.

## Current Status: Pre-Audit

### Role-Based Access Control ✅ VERIFIED

| Role              | Parking Pass | Events | Create Rest | Create Host | Admin |
| ----------------- | ------------ | ------ | ----------- | ----------- | ----- |
| customer          | ✓ book       | ○ view | ✗           | ✗           | ✗     |
| food_truck        | ✓ book       | ○ view | ✗           | ✗           | ✗     |
| restaurant_owner  | ○ view       | ○ view | ✓           | ✗           | ✗     |
| host              | ○ view       | ✓ post | ✗           | ✓           | ✗     |
| event_coordinator | ✗            | ✓ post | ✗           | ✗           | ✗     |
| staff             | ✓ view       | ✓ view | ✓           | ✓           | ✓     |
| admin             | ✓ view       | ✓ view | ✓           | ✓           | ✓     |

### Navigation Role Gates ✅ VERIFIED

- Parking Pass nav only shows for: admin, staff, food_truck, restaurant_owner, or has host profile
- Events nav shows for: host users and coordinators
- Admin panel hidden from non-staff users
- Staff gets access to all flows (support/testing)

### User Role Distribution (29 Active Users)

- Hosts: 10 (100% have created locations)
- Staff: 6
- Restaurant Owners: 3 (100% own restaurants)
- Customers: 3
- Suppliers: 2
- Food Trucks: 2
- Event Coordinators: 1 (0 events yet)
- Admin: 1
- Super Admin: 1

## Phase 4 Validation Checklist

### 1. Stripe Host Onboarding

- [ ] Host status lifecycle validation (pending → complete → charges/payouts enabled)
- [ ] Connect account creation and onboarding link generation
- [ ] Webhook handling for onboarding updates
- [ ] UI state display (pending badge, completion status)

### 2. Parking Pass Checkout Flow

- [ ] Parking intent creation with correct pricing (daily/weekly/monthly)
- [ ] Parking pass booking without duplication
- [ ] Hold cancellation on abandoned checkout
- [ ] Confirmation email to guest and host

### 3. Payment Status Tracking

- [ ] Host balance accuracy (pending/held/settled breakdown)
- [ ] Weekly settlement batch execution
- [ ] Payout webhook handling from Stripe
- [ ] Dispute window (7-day) enforcement

### 4. Locked Pricing & Balance

- [ ] Pricing lock-in for annual subscribers
- [ ] No double-charging on retries
- [ ] Affiliation split calculation (if enabled)
- [ ] Concurrent request handling (race condition test)

## Audit Scripts

### auditRoleCapabilities.ts

- Validates user role distribution
- Checks capability alignment (e.g., restaurant_owners can create restaurants)
- Verifies event coordinator role usage

### auditAuthGates.ts (Ready for dev server)

- Tests auth gate endpoints (401/403 responses)
- Validates public vs protected routes
- Checks admin-only endpoint access

## Next Steps

1. **Create Stripe onboarding audit script** - Check Stripe account status for all hosts
2. **Create parking pass booking flow script** - Test end-to-end booking
3. **Validate settlement logic** - Verify weekly settlement batch behavior
4. **Test concurrency** - Ensure no race conditions on balance updates

## Notes

- No video stories uploaded yet (content baseline clean)
- 0 events posted yet (coordinators not activated)
- 1002 restaurant preseed successfully validates preseed data strategy
- Navigation gates correctly enforce role visibility rules
