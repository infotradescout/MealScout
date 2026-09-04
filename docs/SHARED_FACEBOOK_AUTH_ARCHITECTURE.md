# Shared Facebook Auth Architecture — historical evidence

**Date Created:** January 9, 2026  
**Status:** Retired
**Owner:** Historical evidence only

> This document records an earlier proposal. It is not governing architecture.
> MealScout now rejects cross-product OAuth and TradeScout owns its own sign-in;
> see `docs/MEALSCOUT_IDENTITY_BOUNDARY.md`.

---

## Purpose

MealScout uses **TradeScout's Facebook App** for OAuth authentication. This avoids:
- Separate Meta app approval process
- Duplicate privacy policies
- Independent compliance workflows

**One app, multiple contexts.** TradeScout's existing Facebook app handles auth for both platforms.

---

## Architecture Overview

### 1. Single Facebook App Configuration

**Environment Variables (NEVER CHANGE):**
```bash
FACEBOOK_APP_ID=<TradeScout's FB App ID>
FACEBOOK_APP_SECRET=<TradeScout's FB App Secret>
```

These credentials are shared across:
- TradeScout main app
- MealScout
- Any future Scout platforms

### 2. Multi-Context Flow

**Frontend Initiates:**
```
GET /api/auth/facebook?app=mealscout
GET /api/auth/facebook?app=tradescout
```

**Backend Handles:**
1. Store `app` param in session state
2. Redirect to Facebook with TradeScout branding
3. User grants permission (one time only, reused across apps)
4. Callback receives Facebook profile
5. Resolve or create user with `app_context`
6. Set domain-scoped cookie
7. Redirect to appropriate app

### 3. Cookie Domain Strategy

**MealScout Users:**
```javascript
res.cookie("session", token, {
  domain: ".mealscout.us",
  httpOnly: true,
  secure: true,
  sameSite: "none"
});
```

**TradeScout Users:**
```javascript
res.cookie("session", token, {
  domain: ".thetradescout.com",
  httpOnly: true,
  secure: true,
  sameSite: "none"
});
```

Identity is shared server-side via database; cookies remain domain-scoped client-side.

---

## Database Schema

### Users Table (Extended)

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS app_context TEXT DEFAULT 'mealscout';

-- Possible values: 'mealscout' | 'tradescout' | 'both'
-- Default 'mealscout' for existing MealScout users
```

**Why not a separate table?**
- Single user can access both apps
- Shared identity simplifies cross-platform features
- App context is metadata, not a separate entity

### Session Table

Passport sessions already exist. No changes needed.

---

## Implementation Rules

### ✅ DO

- Use TradeScout's FB App ID + Secret
- Accept `app` param in `/api/auth/facebook`
- Store `app_context` in session during OAuth
- Set domain-specific cookies on callback
- Allow users to exist in multiple app contexts

### ❌ DON'T

- Create a new Facebook app for MealScout
- Request additional scopes beyond `email` and `public_profile`
- Use different privacy policies per app
- Implement app-specific Facebook SDKs
- Hard-code callback URLs without dynamic app support

---

## Privacy Policy Compliance

**Required Language (TradeScout Privacy Policy):**

> TradeScout and affiliated Scout platforms, including MealScout, share authentication infrastructure and data processing systems. By using any Scout platform, you consent to shared identity management across the Scout ecosystem.

This single sentence satisfies Meta's requirement that users understand data sharing.

**MealScout Privacy Policy:**

> MealScout is operated by TradeScout and shares authentication systems with other Scout platforms. Your account credentials and profile data may be accessible across Scout services.

---

## Verification Checklist

After implementation, verify:

- [ ] Facebook popup shows **TradeScout** branding (not MealScout)
- [ ] Login works on MealScout without new permission prompt
- [ ] Callback hits MealScout backend route correctly
- [ ] Session cookie is set with `.mealscout.us` domain
- [ ] `/api/auth/user` returns 200 with user data
- [ ] No Meta warnings in browser console
- [ ] User can log in to both MealScout and TradeScout with same Facebook account

---

## Code Location

**Primary Implementation:** `server/unifiedAuth.ts`

**Key Functions:**
- `setupUnifiedAuth()` — Passport strategy configuration
- Facebook strategy callback — User resolution + app context logic
- `/api/auth/facebook` — Entry route with `app` param
- `/api/auth/facebook/callback` — OAuth callback handler

**Related Files:**
- `server/facebookAuth.ts` — Legacy file (deprecated after migration)
- `client/src/pages/login.tsx` — Frontend login button
- `shared/schema.ts` — User table schema with `app_context`

---

## Maintenance Notes

### When Adding a New Scout Platform

1. Add `app` param to frontend Facebook button:
   ```html
   <a href="/api/auth/facebook?app=newscout">Login with Facebook</a>
   ```

2. Add domain to cookie logic in `unifiedAuth.ts`:
   ```typescript
   const domainMap = {
     'mealscout': '.mealscout.us',
     'tradescout': '.thetradescout.com',
     'newscout': '.newscout.io'
   };
   ```

3. Update privacy policy to include new platform.

4. Done. No Facebook app changes needed.

### When Facebook App Settings Change

If TradeScout updates the Facebook app (scopes, permissions, etc.):
1. MealScout inherits changes automatically
2. Test OAuth flow on MealScout
3. Update privacy policy if new scopes added

---

## Why This Works (Meta Compliance)

**Meta's Requirements:**
1. Users must understand what data is shared ✅ (privacy policy)
2. OAuth callback must match registered domain ✅ (TradeScout's callback)
3. Branding must be consistent ✅ (TradeScout branding shown)
4. No unauthorized data usage ✅ (same privacy terms)

**Key Insight:**
Meta doesn't care if TradeScout operates multiple sub-brands. They care that:
- Users consent to data usage
- Callbacks are secure
- Privacy policies are clear

Using one app for multiple contexts is **compliant** and **recommended** for related services.

---

## Rollback Plan

If this breaks:

1. **Immediate:** Disable Facebook login on MealScout (set `FACEBOOK_APP_ID=""`)
2. **Investigate:** Check Meta app settings, callback URLs, session cookies
3. **Restore:** Revert to Google-only auth while debugging
4. **Long-term:** If unfixable, create separate FB app (not recommended)

---

## Contact

**Architecture Owner:** MealScout Engineering  
**Meta App Owner:** TradeScout Platform Team  
**Questions:** Escalate to TradeScout before making Facebook app changes

---

**Last Updated:** January 9, 2026  
**Next Review:** Q2 2026 (or when adding new Scout platform)
