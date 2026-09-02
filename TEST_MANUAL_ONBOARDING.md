# Manual User Onboarding - Testing Guide

## ✅ What's Implemented

### Backend (Complete)

1. **POST /api/admin/users/create** - Create user with temp password

   - Location: `server/adminRoutes.ts` lines 800-840
   - Generates random temp password
   - Sets `mustResetPassword = true`
   - Requires admin or staff permission
   - Returns temp password in response

2. **POST /api/admin/hosts/create** - Create host profile with geocoding

   - Location: `server/adminRoutes.ts` lines 842-876
   - Accepts lat/lng for map placement
   - Marks host as `isVerified = true` and `adminCreated = true`
   - Requires admin or staff permission

3. **DELETE /api/admin/users/:userId** - Delete user (super admin only)

   - Location: `server/adminRoutes.ts` lines 878-898
   - Prevents self-deletion
   - Super admin only
   - Logs audit event

4. **POST /api/auth/change-password** - Password change endpoint

   - Location: `server/unifiedAuth.ts` lines 982-1018
   - Validates old password
   - Hashes new password (bcrypt rounds: 12)
   - Clears `mustResetPassword` flag
   - Minimum password length: 8 characters

5. **GET /api/auth/user** - User info with password reset flag

   - Location: `server/routes.ts` lines 768-792
   - Returns `requiresPasswordReset: true` when `mustResetPassword` is set
   - Frontend uses this to redirect to change-password page

6. **Database Migration** - Host geocoding support
   - Location: `migrations/011_add_host_geocoding.sql`
   - Adds `latitude`, `longitude`, `adminCreated` to hosts table
   - Creates geospatial index
   - Migration script: `scripts/runHostGeocodingMigration.ts`

### Frontend (Complete)

1. **Admin Onboarding Tab**

   - Location: `client/src/pages/admin-dashboard.tsx` lines 1746-1807
   - Three cards: Create User, Create Host, Manage Host Locations
   - Uses existing components

2. **ManualUserCreation Component**

   - Location: `client/src/pages/admin-dashboard.tsx` lines 70-245
   - Form: email, firstName, lastName, phone, userType selector
   - Shows temp password after creation with copy button
   - User types: customer, restaurant_owner, staff, admin, super_admin

3. **ManualHostCreation Component**

   - Location: `client/src/pages/admin-dashboard.tsx` lines 248-450
   - Form: businessName, userId (optional), address, lat/lng, locationType, footTraffic
   - Geocode button: calls Nominatim API to get coordinates from address
   - Auto-fills lat/lng fields

4. **HostLocationManager Component**

   - Location: `client/src/pages/admin-dashboard.tsx` lines 452-600
   - View and update geocoded locations for existing hosts
   - Geocode addresses that don't have coordinates

5. **Change Password Page**

   - Location: `client/src/pages/change-password.tsx`
   - Form: currentPassword, newPassword, confirmPassword
   - Redirects based on userType after success:
     - restaurant_owner → /restaurant-owner-dashboard
     - admin/super_admin/staff → /admin-dashboard
     - customer → /map
   - Minimum password length: 8 characters
   - Route: /change-password (already wired in App.tsx)

6. **useAuth Hook - Password Reset Redirect**

   - Location: `client/src/hooks/useAuth.ts` lines 29-40
   - Checks `user.requiresPasswordReset`
   - Auto-redirects to /change-password if flag is true
   - Prevents access to other pages until password is changed

7. **Delete User UI**
   - Location: `client/src/pages/admin-dashboard.tsx` lines 2134-2165
   - "Danger Zone" section in user details dialog
   - Only visible to super_admin
   - Confirmation dialog before deletion
   - Mutation: lines 1034-1051

## 🧪 Testing the Flow

### Test 1: Create User with Temp Password

1. Log in as admin or staff
2. Go to Admin Dashboard → Onboarding tab
3. Fill out "Create User with Temp Password" form:
   - Email: test@example.com
   - First Name: Test
   - Last Name: User
   - Phone: (optional)
   - User Type: Customer
4. Click "Create User"
5. ✅ Expect: Yellow box appears with temp password and copy button
6. Copy the temp password

### Test 2: First Login with Temp Password

1. Log out
2. Log in with test@example.com and the temp password
3. ✅ Expect: Immediately redirected to /change-password page
4. Fill out the form:
   - Current Password: (temp password)
   - New Password: (8+ characters)
   - Confirm New Password: (same)
5. Click "Change Password"
6. ✅ Expect: Success message, then redirected to /map (for customer)

### Test 3: Create Host Profile with Geocoding

1. Log in as admin/staff
2. Go to Admin Dashboard → Onboarding tab
3. In "Create Host Profile" card:
   - Business Name: Joe's Pizza
   - User: (select the test user created above, or leave blank)
   - Address: 123 Main St, New York, NY 10001
   - Click "Geocode" button
   - ✅ Expect: Lat/Lng fields auto-fill
   - Location Type: Private Residence
   - Foot Traffic: Low
4. Click "Create Host"
5. ✅ Expect: Success toast
6. Go to /map page
7. ✅ Expect: Blue building icon appears at the geocoded location

### Test 4: Delete User (Super Admin Only)

1. Log in as super_admin
2. Go to Admin Dashboard → Users tab
3. Click "Details" on any user
4. Scroll to bottom
5. ✅ Expect: "Danger Zone" section visible (if super_admin)
6. Click "Delete User Permanently"
7. Confirm the dialog
8. ✅ Expect: User deleted, dialog closes, success toast

### Test 5: Staff Cannot Delete Users

1. Log in as staff or admin (not super_admin)
2. Go to Admin Dashboard → Users tab
3. Click "Details" on any user
4. Scroll to bottom
5. ✅ Expect: No "Danger Zone" section visible

## 🔐 Security & Permissions

- **Create User**: Admin or Staff
- **Create Host**: Admin or Staff
- **Delete User**: Super Admin ONLY
- **Change Password**: Any authenticated user (required for temp passwords)
- **Password Requirements**: Minimum 8 characters (backend enforced)
- **Temp Password**: Randomly generated, 16 characters, alphanumeric

## 📊 Audit Logging

All admin actions are logged via `logAudit()`:

- User creation: `admin_user_created`
- Host creation: `admin_host_created`
- User deletion: `admin_user_deleted`

Logs include:

- Admin user ID
- Action type
- Target resource type and ID
- IP address
- User agent
- Additional metadata

## 🗺️ Map Integration

Created hosts appear on the map with:

- Blue building icon (from lucide-react)
- Popup showing business name, address, location type
- Marked as `adminCreated = true` in database
- Marked as `isVerified = true` for immediate visibility

## 🚀 Deployment Checklist

- [x] Backend routes created
- [x] Frontend UI components created
- [x] Password reset flow implemented
- [x] useAuth hook auto-redirects
- [x] Database migration for geocoding
- [x] Storage layer `deleteUser` method
- [x] Audit logging for all actions
- [x] Super admin permissions enforced
- [x] Change password page wired to router
- [ ] Run migration: `node --import tsx scripts/runHostGeocodingMigration.ts`
- [ ] Test complete flow end-to-end
- [ ] Deploy backend to Render
- [ ] Deploy frontend to Vercel

## 💡 Notes

- Users created manually are marked with `mustResetPassword = true`
- Temp passwords are only shown once - admin must copy and share securely
- Password change is REQUIRED before accessing any other page
- Super admin can delete any user except themselves
- Hosts can be created without an associated user account
- Geocoding uses Nominatim (OpenStreetMap) - rate limited to 1 req/sec
- All coordinates stored as DECIMAL in database
