# Business Profile Import Export

This is the copy checklist for reusing MealScout's Google/Facebook business import in another project.

## Frontend files

Copy these files into the target app and adjust import aliases such as `@/components/ui/button` and `@/lib/queryClient` if the other project uses different paths.

- `client/src/components/BusinessProfileImport.tsx`
- `client/src/lib/facebook.ts`
- `client/src/hooks/use-toast.ts` or the target app's toast equivalent
- `client/src/lib/queryClient.ts` or replace `apiRequest` with the target app's API helper

## Shared import engine

Copy the whole shared module. It contains the portable provider/adaptor logic used by the backend Facebook import routes.

- `shared/business-profile-import/index.ts`
- `shared/business-profile-import/types/index.ts`
- `shared/business-profile-import/core/merge.ts`
- `shared/business-profile-import/providers/google.ts`
- `shared/business-profile-import/providers/facebook.ts`
- `shared/business-profile-import/adapters/mealscout.ts`
- Optional tests: `shared/business-profile-import/__tests__/`

## Backend files and routes

Copy or port the profile import routes from:

- `server/routes/profileRoutes.ts`

The reusable endpoints are:

- `GET /api/profiles/restaurant/:id`
- `GET /api/profiles/host/:id`
- `POST /api/profiles/restaurant/:id/populate`
- `POST /api/profiles/host/:id/populate`
- `POST /api/profiles/facebook/pages`
- `POST /api/profiles/restaurant/:id/populate-facebook`
- `POST /api/profiles/host/:id/populate-facebook`

Google import also depends on:

- `server/services/googleProfileService.ts`
- the target project's restaurant/host persistence adapter
- a photo/gallery table or equivalent storage for imported photos

## Environment variables

Set these in the target project:

- `VITE_FACEBOOK_APP_ID` for the browser SDK
- `FACEBOOK_APP_ID` for server-side Facebook Page requests
- `FACEBOOK_APP_SECRET` for server-side Facebook Page requests
- Google Places API key used by `googleProfileService.ts` in the target app

## Component usage

```tsx
import BusinessProfileImport from "@/components/BusinessProfileImport";

<BusinessProfileImport
  entityType="restaurant"
  entityId={restaurant.id}
  entityName={restaurant.name}
  entityAddress={restaurant.address}
  entityCity={restaurant.city}
  entityState={restaurant.state}
  onImportComplete={() => refetch()}
/>
```

Use `entityType="host"` for host/parking-location businesses.

## Porting notes

- Keep the browser Facebook login permission scope: `pages_show_list,pages_read_engagement,pages_read_user_content`.
- The backend must exchange/use the Page access token; do not call Facebook Page APIs directly from the browser beyond login/page selection.
- The current merge behavior is fill-empty, so imported data avoids overwriting existing manually edited profile fields unless the adapter is changed.
- Replace `MealScoutRestaurantAdapter` and `MealScoutHostAdapter` if the target app has different database field names.
