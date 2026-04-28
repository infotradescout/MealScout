# Moderation System Implementation - Phase 1 Complete

## Completed Components

### 1. Database Migration (091_moderation_and_trust_system.sql)
✅ Created comprehensive migration with:
- `recommendation_flags` table - User-reported recommendations  
- `profile_content_flags` table - User-reported business content
- `moderation_cases` table - Unified case tracking
- `moderation_resolutions` table - Moderator decisions
- `moderation_appeals` table - User appeals process
- Added user reputation fields:
  - `reporter_reputation_score` (default 100)
  - `flagged_count`
  - `upheld_against_count`
  - `false_flag_count`
- Comprehensive indexing for performance

### 2. Drizzle Schema Definition (shared/schema/moderation.ts)
✅ Complete typed schema with:
- All table definitions with proper relationships
- Full relations configuration for all tables
- Zod validation schemas for API inputs
- TypeScript type exports
- Reporter reputation tracking integrated

### 3. Backend Service (server/moderationService.ts)  
✅ Moderation service implementation:
- **Flag Creation**: `flagRecommendation()`, `flagProfileContent()`
- **Moderation Queue**: `getModerationQueue()` with filtering
- **Case Management**: `assignCase()`, `getCaseDetails()`
- **Resolution**: `resolveCase()` with reputation adjustments
- **Appeals**: `appealDecision()`
- **Reporter Reputation**: `getReporterReputation()` tracking
- **User History**: `getUserFlags()`

**Reputation Logic**:
- Valid flag: +5 reputation
- Invalid flag: -10 reputation
- Partial flag: +2 reputation
- Minimum score: 10

### 4. Backend Routes (server/moderationRoutes.ts)
✅ Complete API endpoints:

**User Endpoints**:
- `POST /api/recommendations/:recommendationId/flag` - File recommendation flag
- `POST /api/restaurants/:restaurantId/flag-content` - Flag profile content
- `GET /api/user/flags` - View user's flags and statuses
- `GET /api/user/reporter-reputation` - View reporter reputation score
- `POST /api/moderation/:resolutionId/appeal` - Appeal moderator decision

**Admin/Moderator Endpoints**:
- `GET /api/admin/moderation/queue` - View flagged content queue
- `GET /api/admin/moderation/:caseId` - View case details
- `POST /api/admin/moderation/:caseId/assign` - Assign case to moderator
- `POST /api/admin/moderation/:caseId/resolve` - Resolve case with decision

**Authorization**:
- Users: Can file flags, view own flags, appeal decisions
- Moderators: Can view queue, resolve cases
- Admins: Can assign cases + all moderator permissions

### 5. Routes Registration
✅ Integrated into main `server/routes.ts`:
- Added import: `registerModerationRoutes`
- Registered alongside admin routes in `registerRoutes()`

### 6. Schema Export Configuration
✅ Updated `shared/schema.ts`:
- Added: `export * from "./schema/moderation";`

### 7. User Table Extension
✅ Updated `shared/schema/legacy.ts`:
- Added reputation scoring fields to users table
- Integrated with existing award system

## Phase 1 Status: COMPLETE ✅

## API Specification

### Enums

**Flag Reasons - Recommendations**:
- `spam` - Duplicate or promotional content
- `inappropriate` - Offensive or harmful
- `misleading` - False or deceptive information
- `fake` - Not a genuine user recommendation  
- `off_topic` - Unrelated to the restaurant
- `abuse` - Harassment or abusive content

**Flag Reasons - Profile Content**:
- `false_info` - Factually incorrect information
- `inappropriate` - Offensive or violates policy
- `misleading` - Deceptive presentation
- `policy_violation` - Violates platform policy
- `spam` - Duplicate or promotional
- `abuse` - Harassment or abusive

**Profile Content Types**:
- `profile_description`
- `hours`
- `location`
- `contact`
- `images`
- `other`

**Resolution Outcomes**:
- `valid` - Flag is justified, action taken
- `invalid` - Flag is unjustified, dismissed  
- `partial` - Mixed validity

**Reason Codes**:
- `genuine_violation` - Clear breach of policy
- `reporter_error` - Flag lacks evidence
- `context_missing` - Need more information
- `borderline` - Borderline violation
- `insufficient_evidence` - Not enough proof

## Rate Limiting
- Flags: 5 per day per user
- Next: Implement duplicate detection

## Next Phase: UI & Guardrails
- Admin moderation dashboard
- Dispute queue filtering and bulk actions
- Duplicate flag detection  
- Reporter reputation weighting in similarity scoring
- Rate limit enforcement
