# Business Profile Import SDK

A portable, provider-agnostic toolkit for importing business profile data from external platforms into any application. Built to be copied, forked, or published as an npm package.

## Overview

This SDK provides a unified interface for fetching business data from Google Places, Facebook Pages, and other providers. It normalizes all data into a common `UnifiedBusinessProfile` format, then uses adapters to map that data into your application's specific schema.

The architecture follows a three-layer pattern that keeps provider logic, normalization, and application mapping completely separated.

| Layer | Purpose | Files |
|-------|---------|-------|
| **Providers** | Fetch raw data from external APIs | `providers/google.ts`, `providers/facebook.ts` |
| **Core** | Normalize and merge profiles | `types/index.ts`, `core/merge.ts` |
| **Adapters** | Map unified profiles to your schema | `adapters/mealscout.ts` (example) |

## Quick Start

```typescript
import { ImportManager, GooglePlacesProvider, FacebookPagesProvider } from './business-profile-import';

// 1. Create the manager and register providers
const manager = new ImportManager();
manager.registerProvider(new GooglePlacesProvider({ apiKey: 'YOUR_KEY' }));
manager.registerProvider(new FacebookPagesProvider({
  appId: 'YOUR_APP_ID',
  appSecret: 'YOUR_APP_SECRET',
}));

// 2. Search for a business
const results = await manager.search({
  name: 'Taco Truck',
  city: 'Austin',
  state: 'TX',
});

// 3. Fetch a full profile
const profile = await manager.fetchProfile('google', 'ChIJ...');

// 4. Import from multiple providers and merge
const { merged } = await manager.importAndMerge([
  { providerId: 'google', externalId: 'ChIJ...' },
  { providerId: 'facebook', externalId: '123456789' },
]);
```

## Providers

### Google Places

Uses the Google Places API (New) to fetch comprehensive business data including descriptions, hours, photos (up to 20), ratings, menus, categories, phone, website, price level, and business status.

```typescript
const google = new GooglePlacesProvider({
  apiKey: 'YOUR_GOOGLE_MAPS_API_KEY',
  maxPhotos: 20,  // default: 20
});
```

### Facebook Pages

Uses the Facebook Graph API v19.0 to fetch page data. Requires Facebook OAuth with `pages_show_list` and `pages_read_engagement` permissions.

```typescript
const facebook = new FacebookPagesProvider({
  appId: 'YOUR_FACEBOOK_APP_ID',
  appSecret: 'YOUR_FACEBOOK_APP_SECRET',
  maxPhotos: 20,  // default: 20
});

// Step 1: Get OAuth URL for user to authorize
const oauthUrl = facebook.getOAuthUrl('https://yourapp.com/callback');

// Step 2: Exchange code for token
const { accessToken } = await facebook.exchangeCodeForToken(code, redirectUri);

// Step 3: List user's managed pages
const pages = await facebook.listUserPages(accessToken);

// Step 4: Fetch a specific page's profile
const profile = await facebook.fetchProfileWithToken(pages[0]);
```

## Unified Profile Format

All providers normalize data into `UnifiedBusinessProfile`:

```typescript
interface UnifiedBusinessProfile {
  source: { provider: string; externalId: string; importedAt: Date; rawPayload: any };
  name: string;
  description: string | null;
  category: string | null;
  subcategories: string[];
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  twitterUrl: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  photos: ImportedPhoto[];
  hours: BusinessHours | null;
  priceLevel: 1 | 2 | 3 | 4 | null;
  menuUrl: string | null;
  orderUrl: string | null;
  reservationUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  businessStatus: 'operational' | 'closed_temporarily' | 'closed_permanently' | 'unknown';
  amenities: Record<string, boolean>;
}
```

## Writing Your Own Adapter

To integrate with your application, implement the `ProfileAdapter` interface:

```typescript
import type { ProfileAdapter, UnifiedBusinessProfile } from './business-profile-import';

class MyAppAdapter implements ProfileAdapter<MyBusinessEntity> {
  mergeStrategy: 'fill_empty' | 'overwrite_all' | 'prefer_import' = 'fill_empty';

  toEntityUpdate(
    profile: UnifiedBusinessProfile,
    existing?: MyBusinessEntity,
  ): Record<string, unknown> {
    return {
      businessName: profile.name,
      bio: profile.description,
      phoneNumber: profile.phone,
      lat: profile.latitude,
      lng: profile.longitude,
      // ... map to your schema
    };
  }
}
```

## Merging Multiple Providers

When importing from both Google and Facebook, the merge engine combines data using configurable field-level preferences:

```typescript
import { mergeProfiles, DEFAULT_MERGE_PREFERENCE } from './business-profile-import';

const merged = mergeProfiles(
  [googleProfile, facebookProfile],
  {
    ...DEFAULT_MERGE_PREFERENCE,
    name: 'google',      // Prefer Google for the business name
    photos: 'combine',   // Combine photos from all providers
    hours: 'facebook',   // Prefer Facebook for hours
  },
);
```

## Photo Import

Photos are normalized into a common format with source attribution:

```typescript
interface ImportedPhoto {
  url: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  attribution: string | null;
  source: 'google' | 'facebook' | 'manual';
}
```

The SDK imports up to 20 photos per provider by default (configurable). The MealScout adapter includes a `toBusinessPhotoInserts()` helper that converts imported photos into database insert rows with a 50-photo-per-business limit.

## File Structure

```
business-profile-import/
  index.ts              # Barrel export + ImportManager orchestrator
  README.md             # This file
  types/
    index.ts            # All TypeScript interfaces and types
  core/
    merge.ts            # Profile merge engine
  providers/
    google.ts           # Google Places API provider
    facebook.ts         # Facebook Pages API provider
  adapters/
    mealscout.ts        # MealScout-specific adapter (example)
```

## License

MIT
