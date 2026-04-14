# MealScout Codebase Patterns Overview

## 1. Backend Architecture (server/)

### Folder Structure
- **routes/**: 40+ route modules (e.g., `dealDiscoveryRoutes.ts`, `hostRoutes.ts`, `supplierMarketplaceRoutes.ts`)
- **services/**: Business logic modules (e.g., `parkingPassQuality.ts`, `hostOwnership.ts`, `openCallSeries.ts`)
- **storage/**: Repository pattern with `storage.ts` (IStorage interface) + specialized repos:
  - `analyticsRepository.ts` - metrics & recommendation tracking
  - `authTokensRepository.ts` - auth token ops
  - `restaurantsDealsRepository.ts` - restaurant/deal queries
  - `parkingPassRepository.ts` - parking pass data
- **bootstrap/**: Startup configuration & cron job registration
- **middleware/**: Auth (`unifiedAuth.ts`), rate limiting, anti-scrape
- **types/**: Shared TypeScript definitions

### API Endpoint Patterns
- **RESTful endpoints** with Express:
  - Routes registered via `registerXXXRoutes(app: Express)` functions
  - Authentication via `isAuthenticated` middleware
  - Error handling with 500/400/404 status codes
  - Example: `/api/deals/active`, `/api/deals/my-active`, `/api/stories/recommendation-status`
  
- **Main entry**: `routes.ts` calls `registerRoutes(app: Express)` which wires all route handlers
- **WebSocket support**: `websocket.ts` for real-time connections

### Database (Drizzle ORM)
- **Config**: `drizzle.config.ts` → PostgreSQL, schema at `shared/schema.ts`
- **Pattern**: Drizzle kit for type-safe queries
- **Migrations**: 90 SQL migrations in `migrations/` folder (versioned 0000_famous_deathbird.sql → 090_recommendation_interactions_and_uniques.sql)

---

## 2. Database Schema (shared/schema/)

### Modular Schema Organization
```
schema/
├── core.ts          → cities, sessions, ORDER_STATUS constants
├── users.ts         → user profiles, auth tokens
├── restaurants.ts   → restaurants, operating hours, food truck locations
├── deals.ts         → deals, deal claims, reviews
├── hosts.ts         → hosts, parking pass data, events
├── events.ts        → events table, event series
├── parkingPass.ts   → parking pass management
├── admin.ts         → admin-specific tables
├── suppliers.ts     → supplier marketplace tables
├── ordering.ts      → online menu & ordering
├── growth.ts        → growth tracking tables
├── misc.ts          → miscellaneous
└── legacy.ts        → 2500+ lines of all legacy tables & relations
```

### Key Data Models

#### Recommendations Ecosystem
- **`restaurantUserRecommendations`** – User-tagged restaurant favorites (via video stories or manual button)
- **`restaurantRecommendations`** – Tracked impression analytics (type: "homepage" | "search" | "nearby" | "personalized")
- **`videoStories`** – 15-second user videos with optional `restaurantId` tag (counts as recommendation)
- **Award calculations** (`awardCalculations.ts`):
  - **Golden Fork**: reviewCount ≥ 10, recommendations ≥ 5, influenceScore ≥ 100
  - **Influence Score Formula**: `(reviewCount × 10) + (weightedRecommendationScore × 15) + (favoritesCount × 5)`

#### User Engagement
- **`restaurantFavorites`** – Diner favorites (with count tracking in `users.recommendationCount`)
- **`restaurantFollows`** – Following businesses
- **`deals`** – Business promotional deals with claim tracking
- **`reviews`** – User reviews with helpful votes

#### Business Management
- **`businessStaffInvites`** – Staff team invitations with token-based acceptance
- **`businessStaffMemberships`** – Team member permissions (manageDeals, manageParkingPass, viewAnalytics, manageProfile)
- **`locationRequests`** + **`truckInterests`** – Demand signaling for new food truck locations

#### Supply Chain (Phase 5+)
- **`suppliers`**, **`supplierOrders`**, **`supplyDemands`** – B2B supplier marketplace
- **`supplyReceipts`** – Inventory tracking

---

## 3. API Patterns

### Route Registration Pattern
```typescript
// routes/dealDiscoveryRoutes.ts
export function registerDealDiscoveryRoutes(
  app: Express,
  { filterDealsByBusinessAccess, hasBusinessDistributionAccess }: DealDiscoveryRouteDependencies,
) {
  app.get("/api/deals/active", async (_req, res) => { /* ... */ });
  app.post("/api/deals/:id/claim", isAuthenticated, async (req, res) => { /* ... */ });
}
```

### Common Patterns
- **Dependency injection** for service operations (e.g., `filterDealsByBusinessAccess`)
- **Async/await** error handling with try-catch → 500 status on failure
- **Middleware chaining**: `isAuthenticated`, `isRestaurantOwner`, `verifyResourceOwnership`
- **Storage interface** injected via `DatabaseStorage` implementation
- **Zod schemas** for request validation

### Authentication
- **Unified auth** (`unifiedAuth.ts`): Passport.js + custom middleware
- **Auth methods**: Email/password, Google OAuth, Facebook OAuth, TradeScout SSO
- **Token storage**: Drizzle session table (IMPORTANT: don't drop it)

---

## 4. Frontend Architecture (client/src/)

### Page-Based Routing (Wouter)
- **Eager-loaded**: `home`, `login` (critical path)
- **Lazy-loaded**: 100+ pages (`restaurant-detail.tsx`, `admin-dashboard.tsx`, etc.)
- Location in `pages/` folder with 1:1 route mapping

### Dashboard Organization
```
pages/
├── admin/                    → Admin control center
├── restaurant-owner-dashboard.tsx
├── host-dashboard.tsx        → Parking pass mgmt
├── event-coordinator-dashboard.tsx
├── supplier-dashboard.tsx    → B2B marketplace
├── staff-dashboard.tsx
└── user-dashboard.tsx        → Diner profile
```

### Components (client/src/components/)
- **UI Library**: Shadcn/ui (Card, Button, Modal, Toast)
- **Patterns**:
  - **Card components** (RestaurantCard, DealCard) – stateless, take data props
  - **Modal/Dialog components** – BookingPaymentModal, VideoUploadModal
  - **Maps**: Dedicated `maps/` folder for geo features
  - **Supply chain**: `supply/` components for B2B features
  - **Admin**: Minimal, mostly at page level with inline components

### State Management
- **React Query** (TanStack Query) for server state (`lib/queryClient.ts`)
- **Context**: `useMealScoutContext()` for app-wide settings
- **Hooks**: `useAuth()`, `use-toast`, location notifications

### Query Patterns
```typescript
// Example: Fetch restaurants with TanStack Query
const { data: restaurants, isLoading } = useQuery({
  queryKey: ['restaurants', cityId],
  queryFn: () => fetchRestaurants(cityId)
});
```

### UI Styling
- **Tailwind CSS** with config at `client/tailwind.config.ts`
- **Dark mode support** (CSS variables: `--border-subtle`, `--background`, `--foreground`)
- **Responsive design**: Mobile-first via Tailwind breakpoints

---

## 5. Services & Business Logic Patterns

### Authorization Service Pattern
```typescript
// services/businessTeamAccess.ts
export async function getBusinessAccessContext(userId: string) {
  return {
    restaurantIds: [...],
    permissions: { manageDeals, manageParkingPass, viewAnalytics, manageProfile }
  };
}

// Used in routes for permission checks
const accessContext = await getBusinessAccessContext(req.user.id);
const hasAccess = accessContext.restaurantIds.includes(targetRestaurantId);
```

### Analytics Tracking
```typescript
// storage/analyticsRepository.ts
async trackRestaurantRecommendation({
  restaurantId, userId, sessionId, recommendationType, recommendationContext
}: RestaurantRecommendation): Promise<void>

async markRecommendationClicked(recommendationId: string): Promise<void>
```

### Service Modules (server/services/)
- **businessTeamAccess.ts** — Staff permissions & access control
- **hostOwnership.ts** — Parking pass owner verification
- **openCallSeries.ts** — Recurring event series logic
- **dateKeys.ts**, **timeIntent.ts** — Temporal utilities
- **premiumTrial.ts**, **cityTimeZone.ts** — Domain-specific logic

### Scheduled Jobs
- `featuredVideoCron.ts` — Video curation
- `parkingPassReminder.ts` — Slot reminders
- `storiesCronJobs.ts` — Story processing
- Registered via `registerSchedulers()` in bootstrap

---

## 6. Data Flow Examples

### Recommendation Flow
1. **User uploads video** (POST `/api/stories/upload`) → `videoStories` table
2. **User tags restaurant** → `restaurantId` set on video, counts as recommendation
3. **Analytics tracked** → `restaurantRecommendations` table with impression data
4. **User earns award** → `awardCalculations.getUserRecommendationCount()` tallies distinct restaurants
5. **Golden Fork check** → If meets criteria (10+ reviews, 5+ recs, 100+ influence), award granted

### Booking Flow
1. **Host/restaurant** creates/publishes event (POST `/api/events`)
2. **User clicks** booking button (POST `/api/bookings`) – requires auth
3. **Event acceptance logic** (`interestDecision.ts`) — Validates capacity & access
4. **Notification sent** to host & user

### Staff Team Access
1. **Owner invites staff** (POST `/api/business-team/invite`) – sends token-based link
2. **Staff accepts** (POST `/api/business-team/accept?token=...`) – joins team
3. **Permissions applied** (manageDeals, manageParkingPass, etc.)
4. **Dashboard access** restricted by `getBusinessAccessContext()`

---

## 7. Development Setup

### Build Configuration
- **Backend**: Express.js server (TypeScript)
- **Frontend**: Vite (vite.config.ts), React 18+
- **Package manager**: pnpm (pnpm-lock.yaml)
- **Schemas**: TypeScript generation via Drizzle Kit

### Environment Variables (drizzle.config.ts)
```
DATABASE_URL=postgresql://...  # Required for Drizzle
PUBLIC_BASE_URL=https://www.mealscout.us
NODE_ENV=production|development
SENTRY_DSN=...  # Optional error tracking
```

### Key Files
- `package.json` – monorepo structure (root + client/server shared)
- `tsconfig.json` – TypeScript config
- `tailwind.config.ts` – Tailwind design tokens
- `playwright.config.ts` – E2E test setup
- `capacitor.config.ts` – Mobile app config

---

## 8. Patterns Summary

| Layer | Pattern | Example |
|-------|---------|---------|
| **DB** | Drizzle ORM + migrations | `schema.ts` + 90 SQL files |
| **API** | Express + route registration | `registerDealDiscoveryRoutes()` |
| **Auth** | Middleware chain + Passport | `isAuthenticated`, `isRestaurantOwner` |
| **Services** | Async functions + repository | `businessTeamAccess.ts` |
| **Storage** | Interface + implementation | `IStorage` + `DatabaseStorage` |
| **Frontend** | Wouter routing + Lazy loading | `lazy(() => import("@/pages/..."))` |
| **State** | React Query + Context | `useQuery()` + `useMealScoutContext()` |
| **Components** | Stateless cards + modals | `RestaurantCard`, `BookingPaymentModal` |
| **Styling** | Tailwind + CSS variables | Dark mode, responsive breakpoints |

---

## Key Takeaways
1. **Modular backend**: Routes + services + storage repo pattern
2. **Type-safe DB**: Drizzle ORM with auto-generated migrations
3. **Recommendation system**: Multi-type tracking (video, manual, impressions) + scoring algorithm
4. **Business team management**: Role-based permissions via staff memberships
5. **Frontend-first UX**: Lazy loading, React Query caching, responsive design
6. **Scalable analytics**: Separate analytics repository for metrics tracking
