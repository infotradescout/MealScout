Status: Controlled soft launch checklist for operator use only.

# MealScout Controlled Soft Launch Operator Checklist — 2026-06-18

## Launch Status

- MealScout is in controlled soft launch posture.
- Launch-blocking issues already cleared:
  - public truck schedule-state contradiction
  - Free Profile signup/legal gate
  - production `/api/version` marker accuracy
- Do not reopen those blockers unless live regression evidence appears.

## Invite Group

Use a small controlled group only:

- trusted truck owners already aware this is an early rollout
- a small number of internal or close partner testers
- operators able to report exact route, screenshot, and time of issue

Avoid:

- broad public promotion
- claims that all truck content is complete
- large-volume invites before daily review stays stable

## Signup Smoke Checklist

Run before inviting a new batch of users:

- Open `https://www.mealscout.us/restaurant-signup?businessType=food_truck`
- Confirm `Terms of Service` is visible
- Confirm `Privacy Policy` is visible
- Confirm both links open correctly
- Confirm `Continue with Google` does not proceed until terms are accepted
- Confirm the free-profile create-account path does not surface raw technical errors
- Confirm missing-field errors are human-readable

If an authenticated owner session is available:

- Confirm authenticated profile creation still requires terms acceptance where expected
- Confirm the owner does not dead-end after signup/auth handoff

## Scout/Profile Smoke Checklist

Run at least once per day during the controlled launch:

- Open `/scout` on mobile and desktop
- Open visible truck cards from Scout
- Confirm public profile pages load without blank pages or broken hero sections
- Confirm truck CTAs are usable and not dead
- Confirm no raw JSON or raw technical errors are visible

Check these truck profiles specifically:

- `3D Eats & Tea`
- `Sweet Love`
- `All Gas No Brakes Reloaded`
- `CREATIVBOWLS`
- `Jays Southern Cuisine`

For those profiles, confirm:

- `No schedule posted` appears when no real current/upcoming rows exist
- `Schedule posted` does not appear at the same time as `No schedule posted`
- `View schedule` does not appear without actual schedule rows

## Truck Content Watchlist

Watch for normal content gaps that are not launch blockers by themselves:

- missing or incomplete menus
- missing logos, covers, or avatars
- incomplete social links
- incomplete business descriptions
- trucks that have no real current schedule rows yet

Treat those as onboarding/content completion work unless they create user-facing deception or broken UX.

## Issue Triage Rules

Treat as a real launch issue when any of the following happens:

- signup cannot complete on the intended path
- terms/privacy is missing or unenforced
- a public profile lies about schedule availability
- a main CTA is dead or misleading
- a page is blank, broken, or crashes
- raw technical errors are visible to users

When reporting an issue, capture:

- exact URL
- device or viewport
- whether the user was signed in
- screenshot
- timestamp
- whether the issue is repeatable

## Rollback Or Blocker Criteria

Count as rollback/blocker candidates:

- signup/legal gate regression
- schedule-state contradiction regression
- broken public profile rendering on core truck pages
- dead-end owner onboarding flow
- broad blank-page or raw-error regression on core routes

If one of those appears live and is repeatable:

- pause new invites
- verify against current production behavior
- route to narrow fix only

## Normal Post-Launch Work

Do not treat these alone as launch blockers:

- incomplete truck content
- profiles needing richer menus, photos, or descriptions
- trucks without current schedule rows
- content cleanup or business onboarding follow-up
- operator requests for polish that do not affect truthful core flows

## Daily Operator Review Checklist

At the start of each launch day:

- Confirm `/api/version` is reachable
- Confirm the reported commit metadata is present
- Re-run the signup smoke checklist
- Re-run the five-profile schedule-state smoke
- Check Scout and at least a few public profile routes on mobile

During the day:

- Log user-reported issues with route, screenshot, and timestamp
- Separate blockers from content gaps
- Fix only user-facing issues that break truthful or usable core flows

At the end of the day:

- Review all issues opened that day
- Mark which were blockers, which were content work, and which were operator questions
- Decide whether the next invite batch should stay the same, expand slightly, or pause

## Scope Note

- This checklist is docs-only.
- No runtime code changed in this lane.
- No production data changed in this lane.
- This checklist does not create a new blocker by itself.
