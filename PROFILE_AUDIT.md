# MealScout Profile System Audit

## What Already Exists

### Database Tables
- `users` - Has publicProfileSettings (jsonb), influenceScore, reviewCount, recommendationCount, hasGoldenFork
- `restaurants` - Has Google profile fields (just added: description, googlePlaceId, googleRating, etc.)
- `hosts` - Has Google profile fields (just added: description, googlePlaceId, googleRating, etc.)
- `restaurantFavorites` - User favorites for restaurants
- `restaurantFollows` - User follows for restaurants
- `restaurantUserRecommendations` - User recommendations for restaurants
- `restaurantRecommendations` - Feed-level recommendation tracking
- `reviews` - User reviews
- `hostReviews` - Host reviews
- `videoStories` - Video content
- `storyLikes` - Video likes
- `storyComments` - Video comments
- `storyViews` - Video views
- `menus` / `menuCategories` / `menuItems` / `menuItemVariants` / `menuItemModifiers` - Full menu system
- `claims` / `lisaClaims` - Business claiming system

### Frontend Pages
- `public-profile.tsx` - Public profile page with template presets (classic/story/bold/minimal), themes, sections
- `profile.tsx` - User profile page (settings hub)
- `user-dashboard.tsx` - User dashboard with tabs: recent, nearby, favorites, recommended, videos, share
- `restaurant-detail.tsx` - Restaurant detail page with deals, reviews, recommendations
- `location-detail.tsx` - Location detail page
- `menu-builder.tsx` - Menu builder for restaurants
- `online-menu.tsx` - Public menu view

### Routes
- `/p/:profileType/:profileId` - Public profile pages
- `/profile` - User profile settings
- `/profile/settings`, `/profile/notifications`, `/profile/addresses`, `/profile/payment`, `/profile/help`

## What Needs To Be Updated/Connected

### Business Profiles (Website Replacement)
- [ ] More food type options for restaurants/trucks
- [ ] More business type options for hosts (bar, brewery, restaurant, venue, etc.)
- [ ] Easy manual customization UI for business profiles
- [ ] Google Places auto-population integration (service built, needs frontend trigger)
- [ ] Business profile as full website replacement (hours, menu, photos, contact, reviews, deals)

### User Public Profiles (Recommendation Dashboard)
- [ ] Public user profile page showing: likes, follows, faves, recommendations
- [ ] Video recommendations section
- [ ] Community trust ranking display
- [ ] Separation of user profile (personal) vs business profile (business)

### Key Insight
Most of the data infrastructure exists. The main work is:
1. Connecting Google Places auto-population to the UI
2. Building better business profile editing UI
3. Creating a proper user public profile/recommendation dashboard
4. Making the separation between user and business profiles clear
