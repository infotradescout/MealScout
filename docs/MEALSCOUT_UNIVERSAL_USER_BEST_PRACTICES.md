# MealScout Universal Regular User Best Practices

This guide applies to every MealScout account type:
- regular customers/users
- food truck owners
- restaurant owners
- bar owners
- hosts/property owners
- event organizers
- admins

Every account starts as a regular user and should understand these flows first.

## Table of Contents
- [1. Getting Started](#1-getting-started)
- [2. Account Creation and Login](#2-account-creation-and-login)
- [3. Personal Profile](#3-personal-profile)
- [4. Location and Local Area](#4-location-and-local-area)
- [5. Scout Home Base](#5-scout-home-base)
- [6. Map and Discovery](#6-map-and-discovery)
- [7. Search](#7-search)
- [8. Business Profiles](#8-business-profiles)
- [9. Menus](#9-menus)
- [10. Saves, Favorites, and Follows](#10-saves-favorites-and-follows)
- [11. Recommendations and Likes](#11-recommendations-and-likes)
- [12. Deals](#12-deals)
- [13. Events](#13-events)
- [14. Messaging](#14-messaging)
- [15. Sharing](#15-sharing)
- [16. Notifications and Preferences](#16-notifications-and-preferences)
- [17. Troubleshooting for Regular Users](#17-troubleshooting-for-regular-users)
- [18. Support](#18-support)

## 1. Getting Started

### Flow name
Get Started With MealScout

Who this is for:
All MealScout users.

When to use this:
When you first join MealScout or return after a long break.

Before you start:
You should have internet access and your city location services enabled on your device.

Click-by-click instructions:
1. Open MealScout and go to `/scout`.
2. Use `Scout`, `Map`, and `Search` to discover local food trucks, restaurants, and bars.
3. Open `/deals/featured` to see `Time-Sensitive Specials Nearby`.
4. Open `/events` to browse upcoming events and food truck opportunities.

What success looks like:
You can find local food spots, events, and offers from the main navigation.

Common mistakes:
Starting in only one page and missing nearby options in `Map` and `Search`.

What to do if something breaks:
Refresh the page, confirm location access is on, then try `/scout` again.

Support path:
Go to `/profile/help` and choose `Email Support`.

## 2. Account Creation and Login

### Flow name
Create Account, Verify Email, and Log In

Who this is for:
Anyone creating a MealScout account.

When to use this:
First sign-up, returning login, or account recovery.

Before you start:
Prepare your email, phone number, and a strong password.

Click-by-click instructions:
1. Open `/customer-signup` and choose your account path (`Diner`, `Food Truck`, `Restaurant`, `Bar`, `Host`, `Event Organizer`, or `Supplier`).
2. Submit your details and watch for the verification flow via `/post-verification?status=check-email`.
3. Open the verification email and complete verification.
4. Log in at `/login` using `Log In` and your selected method.

What success looks like:
You are logged in and redirected to your next setup or `/scout`.

Common mistakes:
Using a different email for login than the one used in signup.

What to do if something breaks:
Use `Resend verification` from `/login` or recover access at `/forgot-password` then `/reset-password`.

Support path:
From `/profile/help`, include your account email and what step failed.

## 3. Personal Profile

### Flow name
Set Up and Maintain Your Personal Profile

Who this is for:
All logged-in users.

When to use this:
After first login and anytime your account details change.

Before you start:
Log in and open your profile.

Click-by-click instructions:
1. Go to `/profile`.
2. Review `Profile` details (name, email, role badge).
3. Open `Settings` at `/profile/settings` to update account settings.
4. Use `Sign Out` in `/profile` when needed.

What success looks like:
Your personal profile details are current and you can sign in/out reliably.

Common mistakes:
Confusing personal account settings with business profile setup.

What to do if something breaks:
Try logging out and back in, then reopen `/profile/settings`.

Support path:
Use `/profile/help` and include a screenshot of the profile area.

## 4. Location and Local Area

### Flow name
Set and Correct Local Area

Who this is for:
Users who want accurate nearby food results.

When to use this:
When results look far away or irrelevant.

Before you start:
Allow browser or app location access.

Click-by-click instructions:
1. Open `/scout` and confirm local content loads.
2. Open `/map` and use the location-center control (`Center on location`).
3. Move to `/search` and adjust filters/radius.
4. Recheck nearby listings in `/deals/featured` and `/events`.

What success looks like:
Nearby results are aligned with your real area.

Common mistakes:
Location permissions blocked at device or browser level.

What to do if something breaks:
Enable location permissions, refresh, and retry `/map`.

Support path:
Send support your city plus a screenshot of the incorrect map area.

## 5. Scout Home Base

### Flow name
Use Scout as Your Home Base

Who this is for:
All users exploring local food quickly.

When to use this:
Daily browsing and local discovery.

Before you start:
Be logged in for personalized surfaces.

Click-by-click instructions:
1. Tap `Scout` in navigation to open `/scout`.
2. Browse live and local sections on the Scout screen.
3. Open a spot from Scout to view its profile.
4. Use bottom navigation (`Scout`, `Saved`, `Deals`, `Share`, `Profile`) to switch tasks.

What success looks like:
You can jump from discovery to details without losing context.

Common mistakes:
Using only one tab and missing updated local sections.

What to do if something breaks:
Return to `/scout`, then hard refresh and retry.

Support path:
Share your device and browser with support.

## 6. Map and Discovery

### Flow name
Find Nearby Food on the Map

Who this is for:
Users who prefer visual location browsing.

When to use this:
When choosing where to eat based on distance.

Before you start:
Location services should be on.

Click-by-click instructions:
1. Open `/map`.
2. Use map controls (`Zoom in`, `Zoom out`, `Center on location`).
3. Tap a pin to view details and open the related profile.
4. Use list/cards on map surfaces to compare nearby options.

What success looks like:
You can open businesses from map pins and view offers near you.

Common mistakes:
Not centering map before browsing results.

What to do if something breaks:
Reload `/map`, then test network and location permission.

Support path:
Send a screenshot of the map issue and your current city.

## 7. Search

### Flow name
Search for Food, Businesses, and Menu Items

Who this is for:
Users who want fast keyword discovery.

When to use this:
When you know what you want to eat or where you want to go.

Before you start:
Open the search screen.

Click-by-click instructions:
1. Go to `/search`.
2. Enter keywords in `Search`.
3. Use category and filter tools like `Sort` and `Filter` when available.
4. Open matching deal/business results and save what you like.

What success looks like:
Search returns useful businesses, deals, and local options.

Common mistakes:
Searching too broadly without filters.

What to do if something breaks:
Clear filters, retry with shorter keywords, then refresh page.

Support path:
Send your search term and screenshot of results.

## 8. Business Profiles

### Flow name
Review Business Profiles and Key Details

Who this is for:
Users evaluating a place before visiting.

When to use this:
Before choosing a location, menu, or deal.

Before you start:
Open any profile from Scout, Search, Map, or Deals.

Click-by-click instructions:
1. Open a business profile via `/restaurant/:id`, `/truck/:slug`, or `/bar/:slug`.
2. Review profile summary, location, and available offers.
3. Open related menu surface via `/menu/:restaurantId` when available.
4. Return to discovery pages if details are missing or outdated.

What success looks like:
You can decide quickly whether to visit, save, or share the place.

Common mistakes:
Assuming old profile information is current without checking date/context.

What to do if something breaks:
Refresh the profile and reopen from Scout or Search.

Support path:
Report the profile URL and what data looks stale.

## 9. Menus

### Flow name
Browse Menus and Items

Who this is for:
Users comparing items before visiting or ordering.

When to use this:
When deciding what to eat.

Before you start:
Open a business that has an online menu.

Click-by-click instructions:
1. Open `/menu/:restaurantId` from a business profile.
2. Browse categories and item listings.
3. Search for item names from `/search` when needed.
4. Continue to checkout via `/checkout/:restaurantId` if ordering is enabled.

What success looks like:
You can view categories, item names, and next actions.

Common mistakes:
Expecting every business to have complete menu data.

What to do if something breaks:
Return to profile and retry menu page.

Support path:
Share the restaurant page and missing menu section screenshot.

## 10. Saves, Favorites, and Follows

### Flow name
Save and Manage Favorites

Who this is for:
Users who want quick return access to top spots.

When to use this:
When you want to track preferred places.

Before you start:
Be logged in.

Click-by-click instructions:
1. Save items from Scout/Search/profile surfaces when save controls are available.
2. Open `/favorites`.
3. Review saved places and remove items you no longer want.
4. Reopen saved places directly from the saved list.

What success looks like:
Your `Saved` area reflects current favorites.

Common mistakes:
Expecting saved state before login.

What to do if something breaks:
Log out/in and recheck `/favorites`.

Support path:
Provide the place name and when it was saved.

## 11. Recommendations and Likes

### Flow name
Use Recommendations to Help Local Discovery

Who this is for:
Users sharing helpful local food signals.

When to use this:
After a positive food experience.

Before you start:
Make sure you are on a business or video surface.

Click-by-click instructions:
1. Open `/video` and use recommendation content like `Post a Video Recommendation` from `/profile`.
2. Open business profiles and use available engagement actions.
3. Save/favorite places to reinforce your local feed.
4. Return to `/scout` to see discovery impact.

What success looks like:
You can contribute recommendation signals for local discovery.

Common mistakes:
Posting low-detail content with no location context.

What to do if something breaks:
Retry from `/video` and check your account is logged in.

Support path:
Share the content URL and the action that failed.

## 12. Deals

### Flow name
Find and Use Deals

Who this is for:
Users looking for active local promotions.

When to use this:
Before buying food from a nearby spot.

Before you start:
Turn on location for best ranking.

Click-by-click instructions:
1. Open `/deals/featured` (`Time-Sensitive Specials Nearby`).
2. Use `Sort` and `Filter`.
3. Open a deal detail page at `/deal/:id`.
4. Save or claim deals where available, then track in your account surfaces.

What success looks like:
You can find active offers and open full deal details.

Common mistakes:
Trying expired or city-mismatched offers.

What to do if something breaks:
Refresh, then re-open from featured deals.

Support path:
Send deal URL, city, and issue screenshot.

## 13. Events

### Flow name
Browse and Follow Event Opportunities

Who this is for:
Users and businesses exploring local food events.

When to use this:
When planning where to eat or participate.

Before you start:
Open the events screen.

Click-by-click instructions:
1. Go to `/events`.
2. Review `Find Food Trucks at Events` listings.
3. Open individual event detail pages at `/event/:slug`.
4. For public browsing, use `/events/public` if routed there.

What success looks like:
You can browse upcoming events and open full details.

Common mistakes:
Assuming all event actions are available to every role.

What to do if something breaks:
Refresh and retry event list, then check account role.

Support path:
Include the event link and what action was unavailable.

## 14. Messaging

### Flow name
Message a Business

Who this is for:
Users wanting direct conversation in-app.

When to use this:
When messaging/chat is available.

Before you start:
Messaging routes must exist in app navigation.

Click-by-click instructions:
1. Planned / not currently available: no dedicated `/messages`, `/chat`, or `/inbox` route is present in current app routes.
2. Use profile/support channels instead for urgent contact.
3. Use public business contact details when available on profiles.
4. Return to this guide when messaging routes are released.

What success looks like:
You understand current messaging status and alternatives.

Common mistakes:
Searching for an in-app inbox that is not shipped yet.

What to do if something breaks:
Use `/profile/help` and email support.

Support path:
Ask support for current approved contact method for the business.

## 15. Sharing

### Flow name
Share Local Food Spots

Who this is for:
Users sharing discoveries with friends and local groups.

When to use this:
When you find a spot, deal, or event worth sharing.

Before you start:
Open the item you want to share.

Click-by-click instructions:
1. Open `/share-hub` from navigation (`Share`).
2. Use page-level share actions (for example `Share` controls where available).
3. Copy and send links to business, deal, or event pages.
4. Reopen shared links to confirm they load correctly.

What success looks like:
Shared links open to the intended MealScout page.

Common mistakes:
Sharing links before confirming location/context.

What to do if something breaks:
Re-copy the link from the source page and retry.

Support path:
Send the broken shared URL to support.

## 16. Notifications and Preferences

### Flow name
Manage Notifications and User Preferences

Who this is for:
All logged-in users.

When to use this:
Anytime you need to tune alerts or account behavior.

Before you start:
Open your profile menu.

Click-by-click instructions:
1. Go to `/profile`.
2. Open `Notifications` at `/profile/notifications`.
3. Open `Settings` at `/profile/settings`.
4. Save changes and test by triggering a normal app action.

What success looks like:
Your account preferences are updated and retained.

Common mistakes:
Changing settings but leaving page before save completes.

What to do if something breaks:
Refresh and reapply one change at a time.

Support path:
Include your account email and exact setting path.

## 17. Troubleshooting for Regular Users

### Flow name
Troubleshoot Common User Issues

Who this is for:
All regular users.

When to use this:
Anytime a core flow fails.

Before you start:
Know the exact page where issue happened.

Click-by-click instructions:
1. Login issue: retry `/login` and, if needed, `/forgot-password`.
2. Verification issue: use resend verification from `/login`.
3. Location/map issue: reopen `/map`, re-enable location access.
4. Discovery/content issue: check `/scout`, `/search`, `/favorites`, `/deals/featured`, and `/events`.

What success looks like:
You identify whether issue is auth, location, or content-specific.

Common mistakes:
Reporting "app broken" without page/step details.

What to do if something breaks:
Capture screenshot, page URL, and timestamp before contacting support.

Support path:
Use `/profile/help` with complete troubleshooting details.

## 18. Support

### Flow name
Contact MealScout Support Effectively

Who this is for:
Any user who needs help.

When to use this:
After basic troubleshooting.

Before you start:
Gather account and issue details.

Click-by-click instructions:
1. Open `/profile/help`.
2. Tap `Email Support`.
3. Include account email, screenshot, device/browser, and page path.
4. Add a short, clear description of what you expected vs what happened.

What success looks like:
Support can reproduce and resolve your issue faster.

Common mistakes:
Sending reports without screenshot or route/page details.

What to do if something breaks:
Resend with the missing details listed above.

Support path:
Use `info.mealscout@gmail.com` from `/profile/help`.
