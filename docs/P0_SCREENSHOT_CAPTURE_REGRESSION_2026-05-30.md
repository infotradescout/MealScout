# P0 Bug — Screenshot Capture Regression

Date opened: 2026-05-30
Priority: P0
Status: Open

## Problem
Users cannot take screenshots inside MealScout.

## Goal
Screenshots must work everywhere in the web app for users, reps, admins, QA, and support.

## Scope
- Find whether screenshot blocking is caused by browser/device policy, PWA wrapper, native app shell, CSS/JS overlay, or security flag.
- Remove any capture/screenshot blocking behavior.
- Do not touch auth/session.
- Do not touch booking/payment.
- Do not continue long-press/help work until this is resolved.

## Validation Criteria
- Android Chrome screenshot works on `/scout`.
- Android Chrome screenshot works on public profile.
- Screenshot works while logged in.
- Screenshot works while logged out.
- No "screenshots not allowed" message.
- `npm run check` passes.
- `npm run build` passes.

## Immediate Actions Completed
1. Long-press help patch held and excluded from commit.
   - Command used:
     - `git stash push -m "hold long-press help failed approach" -- client/src/components/long-press-help.tsx`
2. Started targeted scan for screenshot/capture blocking and wrapper flags.

## Initial Triage Findings
- Repo contains a native wrapper path via Capacitor:
  - `@capacitor/*` packages and scripts are present in `package.json`.
  - `android/` project exists and is wired through Capacitor.
- No `FLAG_SECURE` or Android secure-window flag usage found in source scan:
  - No matches for `FLAG_SECURE`, `WindowManager.LayoutParams`, `setFlags`, `addFlags`, or `setSecure` in `android`, `ios`, `client`, `server`, `shared`.
- Android main activity is default BridgeActivity with no custom secure-window code:
  - `android/app/src/main/java/us/mealscout/app/MainActivity.java`
- Android manifest activity configuration has no secure-window attributes:
  - `android/app/src/main/AndroidManifest.xml`
- In active web source, no context-menu blocking handlers were found after long-press patch was stashed.

## What To Check Next
1. Runtime context split (critical):
   - Reproduce on pure Chrome at `https://mealscout.us` vs installed app/webview wrapper.
   - If issue appears only in wrapper, inspect Capacitor plugins and native window flags at runtime.
2. Device/policy constraints:
   - Verify Incognito state, work profile, MDM/work policy, and browser capture permissions.
3. PWA mode:
   - Reproduce in browser tab vs installed PWA shell to isolate shell-specific behavior.
4. Overlay/capture side effects:
   - Review any full-screen overlays or pointer-event layers that may trigger OEM capture protections.

## Runtime Isolation Matrix (Execute First)
Use this exact matrix before any diagnostic/native logging patch.

1. Pure Chrome browser
   - URL: `https://mealscout.us`
   - Logged out screenshot: PASS/FAIL
   - Logged in screenshot: PASS/FAIL
   - Route tested:
   - Result message if blocked:

2. Chrome incognito
   - URL: `https://mealscout.us`
   - Screenshot: PASS/FAIL
   - Result message if blocked:

3. Installed PWA / Add-to-home-screen app
   - Screenshot: PASS/FAIL
   - Result message if blocked:

4. Capacitor/native app shell
   - Screenshot: PASS/FAIL
   - Result message if blocked:

5. Different browser if available
   - Browser:
   - Screenshot: PASS/FAIL
   - Result message if blocked:

6. Device/work profile check
   - Personal profile or work profile:
   - Screenshot works in other websites/apps: YES/NO

## Interpretation Gates
- Fails only in Capacitor/native app:
  - Inspect Android activity/window flags and plugins.
- Fails only in installed PWA:
  - Inspect manifest/display mode/browser install behavior.
- Fails in Chrome for all websites:
  - Device/work-profile/security policy.
- Fails only on `mealscout.us` in pure Chrome:
  - Hidden web-layer issue still exists; inspect overlays, event handlers, CSS, or browser permissions.

## Diagnostic Patch Rule
Do not add Android diagnostic/native logging until failure is isolated to Capacitor/native shell:
- Pure Chrome: PASS
- Installed PWA: PASS
- Capacitor/native shell: FAIL

## Constraints
- No auth/session changes.
- No booking/payment changes.
- Long-press/help work stays paused until this P0 is closed.

## Note
For pure Chrome browsing at `mealscout.us`, normal web code should not be able to block Android hardware screenshot combos directly. If the "screenshots not allowed" message appears, wrapper/device policy causes are the highest-probability path.
