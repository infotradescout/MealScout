# Front End UI QA Guide

Use this guide before user-facing releases and before refactors that can affect screens, routing, copy, forms, maps, menus, schedules, payments, onboarding, or dashboards.

## Coverage

Test the smallest complete user journey, not only the changed component.

Required coverage:

- Desktop viewport
- Mobile viewport
- Loading state
- Empty state
- Error state
- Authenticated/unauthenticated state when relevant
- Permission or ownership boundary when relevant
- Primary CTA path
- Back/cancel/retry path

## Visual Checks

Confirm:

- Text fits in buttons, cards, panels, tables, and nav.
- No overlapping content at mobile or desktop widths.
- Modals and dropdowns stay inside the viewport.
- Sticky/fixed UI does not hide primary actions.
- Disabled/loading states are clear.
- Error copy tells the user what happened and what to do next.
- Public pages do not expose private emails, secrets, internal ids beyond intended public ids, or owner-only controls.

## Interaction Checks

Confirm:

- Forms validate before submission.
- Submission cannot accidentally double-write.
- Cancel/back behavior returns to a sensible state.
- Links route to the expected page.
- External links open safely.
- Search/filter results are understandable when empty.
- Toasts or inline errors are visible and useful.

## Evidence

Record:

- URL/route tested
- Data fixture or production-safe record used
- Browser/device/viewport
- Screenshot or video path when visual behavior matters
- Any console/network errors
- PASS/FAIL and follow-up lane
