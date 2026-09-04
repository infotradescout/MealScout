# Facebook OAuth Multi-App Implementation — historical evidence

> Historical truth only. The multi-app flow described below is retired and must
> not be implemented or restored. MealScout now rejects cross-product OAuth;
> see `docs/MEALSCOUT_IDENTITY_BOUNDARY.md`.

**Status:** Retired historical design
**Date:** 2025-01-XX  
**Purpose:** Enable MealScout and TradeScout to share Facebook OAuth using TradeScout's Meta app

---

## Implementation Summary

MealScout now uses TradeScout's existing Facebook OAuth app instead of creating a separate Meta application. This avoids duplicate compliance workflows and leverages approved infrastructure.

---

## How It Works

### 1. **OAuth Flow with App Parameter**

Client initiates login with app context:
```typescript
// MealScout users:
window.location.href = '/api/auth/facebook?app=mealscout'

// TradeScout users:
window.location.href = '/api/auth/facebook?app=tradescout'
```

### 2. **Server Stores App Context in Session**

Route handler captures and validates app parameter:
```typescript
app.get('/api/auth/facebook', (req, res, next) => {
  const appContext = (req.query.app as string) || 'mealscout';
  
  if (appContext !== 'mealscout' && appContext !== 'tradescout') {
    return res.status(400).json({ error: 'Invalid app parameter' });
  }
  
  req.session.fbAppContext = appContext;
  next();
}, passport.authenticate('facebook', { scope: ['email', 'public_profile'] }));
```

### 3. **Passport Strategy Retrieves App Context**

Facebook strategy uses `passReqToCallback: true`:
```typescript
passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID,
  clientSecret: process.env.FACEBOOK_APP_SECRET,
  callbackURL: `${baseUrl}/api/auth/facebook/callback`,
  profileFields: ['id', 'displayName', 'emails', 'photos', 'first_name', 'last_name'],
  passReqToCallback: true // Access req.session.fbAppContext
}, async (req, accessToken, refreshToken, profile, done) => {
  const appContext = req.session?.fbAppContext || 'mealscout';
  const user = await storage.upsertUserByAuth('facebook', userData, 'customer', appContext);
  done(null, user);
}));
```

### 4. **Database Stores App Context**

Users table tracks which platform(s) the user has accessed:
```sql
ALTER TABLE users ADD COLUMN app_context VARCHAR(50) DEFAULT 'mealscout';
```

Values:
- `'mealscout'` - User signed up via MealScout
- `'tradescout'` - User signed up via TradeScout
- `'both'` - User has logged in to both platforms

Merging logic in `storage.ts`:
```typescript
const newAppContext = current.appContext && current.appContext !== appContext 
  ? 'both' 
  : appContext;
```

### 5. **Domain-Scoped Cookies Set on Callback**

Callback handler sets cookies for the correct domain:
```typescript
app.get('/api/auth/facebook/callback', 
  passport.authenticate('facebook'),
  (req, res) => {
    const appContext = req.session.fbAppContext || 'mealscout';
    
    const domainMap = {
      mealscout: '.mealscout.us',
      tradescout: '.thetradescout.com'
    };
    
    req.session.cookie.domain = domainMap[appContext];
    
    req.session.save((err) => {
      if (err) return res.redirect('/?error=session_error');
      
      const redirectUrls = {
        mealscout: '/?auth=success&t=' + Date.now(),
        tradescout: 'https://www.thetradescout.com/?auth=success&t=' + Date.now()
      };
      
      res.redirect(redirectUrls[appContext]);
    });
  }
);
```

---

## Files Modified

### 1. `server/unifiedAuth.ts`
- Added session type extension for `fbAppContext`
- Updated Facebook strategy to use `passReqToCallback: true`
- Modified `/api/auth/facebook` to capture `?app=` parameter
- Updated callback to set domain-scoped cookies
- Logs app context throughout flow

### 2. `server/storage.ts`
- Added `appContext` parameter to `upsertUserByAuth` (interface + implementation)
- Implemented app context merging logic (sets 'both' for cross-app users)
- All auth methods (Google, Facebook, TradeScout, Email) now track app context

### 3. `shared/schema.ts`
- Added `appContext: varchar('app_context', { length: 50 }).default('mealscout')`

### 4. `migrations/008_add_app_context.sql`
- Created migration to add `app_context` column
- Added index for efficient app-specific queries

### 5. `.github/copilot-instructions.md`
- Added CRITICAL section on shared Facebook auth
- Listed invariants to prevent regression
- Documented cookie domain mapping and database schema

### 6. `docs/SHARED_FACEBOOK_AUTH_ARCHITECTURE.md`
- Comprehensive architecture guide (2.5KB)
- Verification checklist
- DO/DON'T rules
- Rollback plan

---

## Environment Variables

Uses TradeScout's existing credentials:

```env
FACEBOOK_APP_ID=<TradeScout's App ID>
FACEBOOK_APP_SECRET=<TradeScout's App Secret>
PUBLIC_BASE_URL=https://mealscout.us
```

**DO NOT create new Facebook app for MealScout.**

---

## Testing Checklist

- [ ] Navigate to `/api/auth/facebook?app=mealscout`
- [ ] Verify session cookie domain is `.mealscout.us`
- [ ] Check database: `users.app_context` is `'mealscout'`
- [ ] Same user logs in via TradeScout
- [ ] Verify `app_context` updated to `'both'`
- [ ] Confirm user can access both platforms with same Facebook account

---

## Privacy Policy Update

Add this sentence to both MealScout and TradeScout privacy policies:

> MealScout and TradeScout share authentication infrastructure. Your login works across both platforms without separate registration.

---

## Rollback Plan

If issues arise:

1. Revert `server/unifiedAuth.ts` to remove app param handling
2. Revert `server/storage.ts` to remove appContext parameter
3. Drop migration: `DROP INDEX IF EXISTS idx_users_app_context; ALTER TABLE users DROP COLUMN app_context;`
4. Restore copilot-instructions.md to previous version

---

## Key Benefits

✅ **No duplicate Meta app** - Avoids months of compliance review  
✅ **Seamless cross-platform auth** - Users authenticated on both platforms  
✅ **Domain isolation** - Cookies scoped to correct domain  
✅ **User context tracking** - Database knows which platform(s) user accessed  
✅ **Governance protection** - Copilot instructions prevent regression  

---

## Maintenance Notes

**DO NOT:**
- Create separate Facebook app for MealScout
- Remove `?app=` parameter from OAuth flow
- Hardcode app context to 'mealscout'
- Change cookie domain mapping

**DO:**
- Preserve `req.session.fbAppContext` storage
- Maintain app context merging in `storage.ts`
- Keep session type declaration intact
- Follow architecture doc for any changes

---

## Related Documentation

- **Architecture:** `docs/SHARED_FACEBOOK_AUTH_ARCHITECTURE.md`
- **Migration:** `migrations/008_add_app_context.sql`
- **Governance:** `.github/copilot-instructions.md` (CRITICAL section)

---

**Deployed:** Ready for production  
**Migration Required:** Yes (run `008_add_app_context.sql`)  
**Breaking Changes:** None (backward compatible with default 'mealscout')
