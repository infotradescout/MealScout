# MealScout User-Type Playbook Template

Use this template for future guides:
- Customer Playbook
- Food Truck Owner Add-On
- Restaurant Owner Add-On
- Bar Owner Add-On
- Host Add-On
- Event Organizer Add-On
- Admin Ops Add-On

## Guide Purpose
- Define what this user type can do today in MealScout.
- Use only real routes, labels, and active features.
- Keep language non-technical and user-friendly.

## Inherited Universal User Flows
Start with this statement:
`This playbook inherits all flows from docs/MEALSCOUT_UNIVERSAL_USER_BEST_PRACTICES.md. Complete those first.`

Then list inherited sections:
- Getting Started
- Account Creation and Login
- Personal Profile
- Location and Local Area
- Scout Home Base
- Map and Discovery
- Search
- Business Profiles
- Menus
- Saves/Favorites/Follows
- Recommendations/Likes
- Deals
- Events
- Messaging status
- Sharing
- Notifications and Preferences
- Troubleshooting
- Support

## Add-On User Type Flows
For each add-on flow, use this exact format:

### Flow name

Who this is for:

When to use this:

Before you start:

Click-by-click instructions:
1.
2.
3.
4.

What success looks like:

Common mistakes:

What to do if something breaks:

Support path:

## Required Flow Format Rules
- Every active flow must map to a real route in `client/src/App.tsx`.
- Every user-visible label must match current UI text.
- Keep steps actionable and short.
- Do not include implementation details.

## Planned / Not Available Labeling Rules
Use this exact label when needed:
`Planned / not currently available.`

Apply this label when:
- No active route exists.
- Feature exists only in docs or planning notes.
- UI controls are not currently shipped.

Never describe planned flow as active.

## Support Section Format
Use this support checklist at the end of every playbook:
- account email
- user type
- page route/path where issue happened
- screenshot or short screen recording
- device and browser/app version
- expected result vs actual result

## Future User Type Checklist
Before publishing a new playbook, verify:
1. Universal guide inheritance statement included.
2. Add-on flows only (no duplicate universal basics unless role-specific nuance is required).
3. Route list verified against `client/src/App.tsx`.
4. Labels verified against current UI components.
5. Planned items clearly labeled.
6. Help page search index updated to include this playbook.
7. Last reviewed date added at top of guide.
