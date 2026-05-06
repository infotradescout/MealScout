# Restaurant/Bar Onboarding Stall — Investigation Report

**Subject case:** "Magpie User" (`maggiefunk74@gmail.com`, Restaurant/Bar), signed up 18h ago, stuck at setup 1/6 (only `emailVerified` is true).

**Scope:** Read-only investigation of the post-email-verify onboarding flow for non-food-truck business accounts (restaurants, bars, caterers, private chefs). No code changes here — diagnosis + prioritized fix plan only.

---

## How "setup x/6" is calculated

`server/routes/admin/adminCoreOpsRoutes.ts` ~L3225-3245 computes a 6-item checklist for every new owner:

| # | Field | Source | What unlocks it |
|---|---|---|---|
| 1 | `emailVerified` | `users.emailVerified` | User clicked the verify-email link |
| 2 | `hasBusiness` | `restaurants` count > 0 for this owner | User completed business-listing creation |
| 3 | `hasMenu` | At least one `menus` row exists | User created a menu (any source) |
| 4 | `hasItems` | At least one `menu_items` row exists | User added or imported menu items |
| 5 | `isVerified` | Any of their restaurants has `isVerified=true` | Admin manually verified the listing |
| 6 | `hasSubscription` | `users.stripeSubscriptionId` is set | User started a paid plan |

`stuck = score < 3 && createdAt > 6h ago`. So Magpie at 1/6 after 18h is correctly flagged.

**The real question is: why did they get to step 1 and stop?**

---

## Where Restaurants/Bars are sent after email verify

`client/src/pages/verify-email.tsx` ~L26-47, `getSignupPath()`:

```ts
if (accountType === "business") {
  if (businessType === "food_truck") {
    return "/truck-onboarding";          // ← dedicated, focused flow
  }
  if (businessType === "bar") {
    return "/customer-signup?role=business&businessType=bar";
  }
  if (businessType === "caterer") {
    return "/customer-signup?role=business&businessType=caterer";
  }
  if (businessType === "private_chef") {
    return "/customer-signup?role=business&businessType=private_chef";
  }
  return "/customer-signup?role=business";  // ← generic fallback (restaurants)
}
```

**This is the smoking gun.** Two architectural problems:

### Problem A — Asymmetric onboarding path

Food trucks get a dedicated `/truck-onboarding` page. Every other business type (restaurants, bars, caterers, private chefs) gets bounced into `/customer-signup` with a `role=business` query string. That is a customer-facing signup page being repurposed as a business onboarding step. Owner intent ("I am here to list my business") is not the page's primary affordance — the page was originally designed for diners signing up.

### Problem B — Verify-email never auto-redirects on success

Looking at `verify-email.tsx`, `nextPath = params.get("next") || "/"`. After the user clicks the verification link in their inbox, they land back on the site. If the email link was sent without `?next=...` populated (or the user opens it in a different browser where the original signup tab is gone), they go to `/` — the Welcome screen — NOT to `/customer-signup?role=business` or `/truck-onboarding`.

The user verifies their email, sees the Welcome screen, doesn't realize they need to keep going, and never returns. This matches the Magpie pattern exactly: verified email (step 1) ✓, no business listing created (step 2) ✗, stuck.

---

## Confirming Magpie's likely state in DB

Without DB access I can't query directly, but the symptoms predict:

| Field | Predicted value |
|---|---|
| `users.emailVerified` | `true` |
| `users.userType` | likely `restaurant_owner` or similar (the screenshot shows "Restaurant/Bar" pill) |
| `restaurants` rows where `ownerId = magpie` | **zero** |
| `users.stripeSubscriptionId` | `null` |

**This is not a bug — this is a UX gap.** The system is correctly recording that the user verified their email and never came back. There is no broken API call, no failed import, no insurance-proof rejection. They simply got dropped at the door.

---

## What "Needs insurance proof" means (separate concern)

`server/routes/insuranceVerificationRoutes.ts` exists but is **not** in Magpie's path. The "Needs insurance proof" badge in the admin UI is reserved for restaurants/businesses that have already created a listing AND that need insurance documents on file before the listing can be `isVerified`. Magpie hasn't created a listing, so this badge would not apply to them — it would apply later, after they complete step 2.

The current admin UI shows the "Needs insurance proof" chip on Maggie Funk's card (Sweet Love food truck), not on Magpie. That's correct.

---

## Fix plan (prioritized)

### P0 — Auto-redirect after verify-email success

**File:** `client/src/pages/verify-email.tsx`

Currently `verify-email.tsx` is a passive "check your inbox" page. When the user clicks the verification link in their email, they hit `/api/auth/verify-email-callback?token=…` (or similar) which sets `emailVerified=true` and redirects them. That redirect today goes to `/` if no `next` param was carried through.

**Fix:**
1. When the verification link is generated server-side, ALWAYS embed the appropriate `next` path based on the user's signup intent (`accountType` + `businessType`). For restaurants/bars/caterers/private-chefs, that should be the same path returned by `getSignupPath()` in verify-email.tsx.
2. After successful verification on the server, if the user is `accountType === "business"` and has zero `restaurants` rows, redirect them to the appropriate onboarding URL even if `next` is missing from the link.
3. Show a one-time toast on landing: *"Email verified. Let's get your business listed — this takes about 3 minutes."* with a primary "Continue" button.

This alone would have caught Magpie before the 18h drop.

### P1 — Dedicated `/restaurant-onboarding` and `/bar-onboarding` pages

**New files:**
- `client/src/pages/restaurant-onboarding.tsx`
- `client/src/pages/bar-onboarding.tsx`
- (and the corresponding caterer / private-chef pages)

Each one is a focused single-purpose page that mirrors `/truck-onboarding`'s structure: name, address (with map confirmation), phone, hours, primary cuisine, primary photo. One screen, one purpose, one CTA. No diner-facing copy. No "are you a customer or a business?" branching.

Then update `verify-email.tsx getSignupPath()` to route bar/caterer/private-chef to their own pages instead of `/customer-signup?role=business&...`.

### P2 — Add a 24-hour onboarding nudge email

**Backend job:** find users where `userType in (restaurant_owner, bar_owner, caterer, private_chef)`, `emailVerified = true`, `restaurants count = 0`, `createdAt < now - 24h`. Send a single nudge email: *"Your account is ready — finish your listing to start getting discovered."* Cap at one email per user.

This catches anyone the P0 redirect missed (e.g. they cleared their browser).

### P3 — Admin "Resume their onboarding" action on stuck cards

**File:** `client/src/pages/AdminLaunchWeek.tsx` OwnerCard

Add a button on stuck cards: *"Send resume link"*. Clicking it dispatches a one-time magic-link email that auto-logs the user in and drops them directly on the appropriate onboarding page. Preserves admin-side ability to recover any stuck user manually.

---

## What I would NOT recommend

- **Do not gate verify-email behind a CAPTCHA or a second confirmation.** The flow is already at 1/6 → 18h drop. Adding friction makes it worse.
- **Do not require Stripe subscription before business listing creation.** The current checklist treats `hasSubscription` as step 6, after the listing exists. That's correct — keep it that way. Asking for payment before they've even seen what they get would tank conversions further.
- **Do not auto-create an empty restaurant row on email verify.** This would inflate the "1/6 → 2/6" metric without actually helping the user. Leave step 2 as a real action they have to take.

---

## Effort estimate

| Fix | Effort | Who |
|---|---|---|
| P0 — auto-redirect after verify | 1.5h | Server (token-link path) + 30 min FE (toast + redirect on landing) |
| P1 — dedicated onboarding pages | 4-6h | FE only — I can scaffold these following `/truck-onboarding`'s structure |
| P2 — 24h nudge email | 1.5h | Server (cron + sendgrid template) |
| P3 — admin resume-link action | 1h | FE button + one POST endpoint |

**Order I recommend:** P0 → P1 (just the restaurant + bar pages first since those are real signups) → P3 → P2.

---

## Standing by

Reply with:
- **"ship P0"** → I scaffold the FE changes for the verify-email redirect; backend token-link change goes to your dev with a precise patch.
- **"ship P0 + P1 (restaurant + bar)"** → above PLUS two new dedicated onboarding pages.
- **"all of it"** → I roll P0, P1 (4 pages), P3 into one PR; P2 goes to your dev as a written task.
- **"hold on Magpie, focus on import fixes"** → I park this report; current PR ships first; we revisit Magpie after the import fix is verified live.
