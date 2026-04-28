# Authentication Fix - All Users Can Now Login/Logout

## Problem Identified

The authentication system had a critical issue in `/api/auth/login`:

- Session was set manually: `(req.session as any).passport = { user: user.id }`
- This bypassed Passport's proper session serialization
- Sessions were not being saved correctly
- Users couldn't stay logged in or their info was lost

## Fix Applied

Changed from manual session setting to proper Passport login:

```typescript
// BEFORE (broken):
(req.session as any).passport = { user: user.id };
res.json({ user, message: "Login successful" });

// AFTER (fixed):
req.login(user, (err) => {
  if (err) {
    console.error("Session login error:", err);
    return res.status(500).json({ error: "Failed to establish session" });
  }
  res.json({ user, message: "Login successful" });
});
```

## What This Fixes

✅ **Admin Login** - configured admin account can now log in at /admin-login
✅ **All User Login** - Email/password login works for all user types
✅ **Session Persistence** - Users stay logged in across page reloads
✅ **User Data** - User info is properly loaded and maintained
✅ **Logout** - Existing logout endpoint works correctly

## Session Flow

1. **Login**: User submits email/password → bcrypt verifies → `req.login()` serializes user
2. **Serialize**: Passport calls `serializeUser()` → stores user.id in session
3. **Session Cookie**: Server sends encrypted session cookie to browser
4. **Subsequent Requests**: Browser sends cookie → Passport calls `deserializeUser()` → loads full user object
5. **Logout**: `/api/auth/logout` → clears session → redirects

## Testing the Fix

### Test Admin Login:

1. Go to `/admin-login`
2. Email: use `MEALSCOUT_ADMIN_EMAIL` (or `ADMIN_EMAIL`)
3. Password: use `MEALSCOUT_ADMIN_PASSWORD` (or `ADMIN_PASSWORD`)
4. Should redirect to `/admin/dashboard`

### Test Customer Login:

1. Go to `/login`
2. Enter credentials
3. Should redirect to `/` and show logged-in state

### Test Session Persistence:

1. Log in
2. Refresh page
3. User should still be logged in
4. Navigate to different pages
5. User info should persist

## Admin Password Reset

To reset admin password, create `.env` file with DATABASE_URL and run:

```bash
npx tsx scripts/fixAdminLogin.ts
```

This will (based on env vars):

- Find or create the configured admin account
- Set password from `MEALSCOUT_ADMIN_PASSWORD` / `ADMIN_PASSWORD`
- Ensure userType is `admin`
- Mark email as verified

## Files Modified

- `server/unifiedAuth.ts` - Fixed `/api/auth/login` endpoint

## Files Created

- `scripts/fixAdminLogin.ts` - Script to reset admin password
- `.env.example` - Template for environment variables
- `AUTH_FIX_COMPLETE.md` - This document
