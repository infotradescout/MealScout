# Focus Brief: Direct Connect + Onboarding + Request Routing + Messaging

Date: 2026-04-19
Owner: codex
Status: active execution focus

## Goal

Keep all near-term work constrained to the user journey where a business signs up, gets routed correctly, submits or receives requests, and can directly connect with counterparties.

## Core Lanes

1. Direct connect flows
2. User onboarding flows
3. Request routing and role routing
4. Messaging and notification reliability

## Direct Connect: Canonical Paths

### Event interest (truck -> host)

- Client trigger:
  - `client/src/pages/truck-discovery.tsx`
  - POST `"/api/events/:eventId/interests"`
- Server endpoint:
  - `server/routes/eventRoutes.ts`
- Host-side management:
  - `server/routes/hostInterestRoutes.ts`
  - PATCH `"/api/hosts/interests/:interestId/status"`
  - GET `"/api/hosts/events/:eventId/interests"`
- Persistence:
  - `eventInterests` schema in `shared/schema/legacy.ts`

### Location demand interest (truck -> demand location host lead)

- Client-facing flow:
  - `client/src/pages/truck-discovery.tsx` (market-facing CTA context)
- Server endpoints:
  - `server/routes/locationDemandRoutes.ts`
  - POST `"/api/location-requests"`
  - POST `"/api/location-requests/:id/interests"`
  - GET `"/api/location-requests/:id/summary"`
- Persistence:
  - `locationRequests`, `truckInterests` in `shared/schema/legacy.ts`

### Supplier request flow (buyer -> supplier)

- Client triggers:
  - `client/src/pages/supplier-detail.tsx`
  - `client/src/pages/supplier-dashboard.tsx`
- Server endpoints:
  - `server/routes/suppliers/requestsRoutes.ts`
  - POST `"/api/supplier-requests"`
  - POST `"/api/supplier-requests/import"`
  - GET `"/api/supplier-requests/mine"`
  - GET `"/api/supplier/requests"`
  - POST `"/api/supplier/requests/:requestId/accept"`
  - PATCH `"/api/supplier/requests/:requestId/delivery"`
- Persistence:
  - `supplierRequests`, `supplierRequestItems` in `shared/schema/legacy.ts`

## Onboarding: Canonical Paths

### Account setup

- Client:
  - `client/src/pages/account-setup.tsx`
- Server:
  - `server/routes/authAccountRoutes.ts` (token/account setup + auth user shape)

### Restaurant/food-truck onboarding

- Client:
  - `client/src/pages/restaurant-signup.tsx`
  - supports `businessType=food_truck` and `claim=1` deep links
- Server:
  - `server/routes/restaurantSignupRoutes.ts`
  - auto-promotion to `food_truck` when applicable

### Supplier onboarding

- Client:
  - `client/src/pages/supplier-dashboard.tsx`
- Server:
  - `server/routes/suppliers/onboardingRoutes.ts`
  - POST `"/api/supplier/profile/activate"`
  - POST `"/api/supplier/stripe/onboard"`
  - GET `"/api/supplier/stripe/status"`

## Request Routing: Canonical Paths

### Global route registration order

- `server/routes.ts`
  - registers auth, onboarding, demand, event, host, supplier modules

### User dashboard routing

- Client:
  - `client/src/pages/dashboard-router.tsx`
  - role-to-dashboard mapping by `userType` and fallback `roles`

### Auth/userType correction

- Server:
  - `server/routes/authAccountRoutes.ts`
  - includes auto-correction behavior for some `userType` mismatches

## Messaging Surface (Current State)

Current "direct connect messaging" is mostly event/request notes plus email notifications, not a full in-app thread/inbox model.

- Event interest message field:
  - `insertEventInterestSchema` and `eventInterests.message`
- Location demand interest message field:
  - `insertTruckInterestSchema` and `truckInterests.message`
- Supplier request note/instructions:
  - `supplierRequests.note`, `deliveryInstructions`
- Notification transport:
  - `server/emailService.ts`
  - `server/emailNotifications.ts`
  - multiple fire-and-forget email sends in route handlers

## Immediate Execution Backlog (Laser Focus)

1. Add end-to-end tests for the three direct-connect submissions:
   - event interest
   - location request interest
   - supplier request creation
2. Add role-routing tests for `/dashboard` redirects by `userType`.
3. Standardize request/interest response payload shapes (`message`, ids, status fields) across the three connect lanes.
4. Add a shared notification wrapper for connect-flow emails to reduce route-level duplication and make retries/telemetry consistent.
5. Add a "connect activity" read model endpoint for the current user (aggregated interests + supplier requests + statuses).

## Out of Scope For This Focus Window

- New schema redesign for a full chat/inbox system.
- Non-connect admin analytics enhancements.
- Unrelated refactor slices in storage domains not touching these flows.

