Status: `sitewide public copy cleanup doctrine packet`

# MealScout Sitewide Public Copy Cleanup - Protected Brand/User Language

## Decision

This is not a public-profile-only issue. It is a site-wide public UX copy problem.

MealScout has too much explanatory, process-heavy, AI-sounding text. Public pages should show useful food/business information and actions directly, while preserving approved brand, user, owner, and business language.

New rule:

```text
Show the useful thing.
Do not explain the system.
Do not narrate uncertainty unless needed.
Do not make internal trust/process language the page personality.
```

## Important Protected-Language Constraint

`Follow the Flavor` is protected and must not be changed, removed, renamed, or rewritten.

The same protected status applies to:

- MealScout brand and tagline language
- approved user-specific language
- approved brand or campaign language
- legal copy
- owner-provided wording
- business-provided wording

The cleanup must not flatten MealScout's voice. It should remove generic AI/process/audit language while preserving brand personality.

## Protected Copy Rule

Do not change:

- `Follow the Flavor`
- MealScout brand/tagline language
- truck names
- restaurant names
- dish names
- menu item names
- owner-submitted descriptions
- owner notes
- user-entered text
- profile-specific copy supplied by a business, owner, Knight, or user
- city names
- event names
- deal names
- legal, privacy, and terms copy
- transactional, account, or security copy where exact wording matters
- approved onboarding copy
- approved marketing headlines

This cleanup targets only generic explanatory/process-heavy public UX copy, especially AI-sounding or audit-style text such as:

- `what we know`
- `source evidence`
- `evidence-based profile`
- `owner confirmation pending`
- `profile was built from available source evidence`
- `we're still confirming`
- `generated`
- `confidence`
- `update pending` when used as dominant page personality

Before changing any phrase, classify it as:

1. Protected brand/user/legal/business language: do not change.
2. Public UX process/audit language: eligible for compression or removal.
3. Necessary trust qualifier: keep but shorten and contextualize.
4. Internal/admin/operator copy: leave alone unless specifically in scope.

Operating rule:

```text
Preserve brand voice.
Remove process voice.
```

Blunt rule:

```text
Cut the AI/process sludge.
Do not cut the brand voice.
Do not rewrite owner/user/business content.
```

## Sitewide Doctrine

MealScout is a food discovery product.

Every page should prioritize:

1. Food
2. Place
3. Time
4. Action
5. Trust qualifier

Never prioritize:

1. Process explanation
2. Internal evidence language
3. AI-sounding disclaimers
4. Repeated empty-state narration
5. Defensive badges everywhere

The app should only explain uncertainty at the exact point where it matters.

## Revised Lane Name

`MealScout Sitewide Public Copy Cleanup - Protected Brand/User Language`

## Codex Prompt

```text
Repo: infotradescout/MealScout

Lane:
MealScout Sitewide Public Copy Cleanup - Protected Brand/User Language

Starting point:
main after the Public Profile Trust Reconciliation PR state is reconciled.

Problem:
MealScout pages are covered in explanatory, process-heavy, AI-generated-sounding copy. This affects the whole site, not just public profiles. The product feels like an internal audit/reporting system instead of a consumer food discovery app.

User directive:
"We don't say what we know. We show what we know."
"This needs to apply across the entire site."
"Every page is covered in explanatory AI-generated bullshit."

Objective:
Identify and clean up sitewide explanatory/process copy patterns so MealScout pages show useful food/business information and actions directly.

Critical product rule:
MealScout is a food discovery product. Pages should feel like food pages with trust guardrails, not trust/audit pages with food fields.

Important protected-language constraint:
"Follow the Flavor" is protected and must not be changed, removed, renamed, or rewritten. The same applies to approved user-specific language, brand/campaign language, legal copy, and owner/business-provided wording. The cleanup must not flatten MealScout's voice. It should remove generic AI/process/audit language while preserving brand personality.

IMPORTANT PROTECTED COPY GUARDRAIL

Do not perform broad string replacement.

Do not change protected brand, user-specific, owner-specific, or legally sensitive language.

Protected examples include:
- "Follow the Flavor"
- MealScout brand/tagline language
- truck names
- restaurant names
- dish names
- menu item names
- owner-submitted descriptions
- owner notes
- profile-specific copy supplied by an owner, business, Knight, or user
- event names
- deal names
- city/location names
- legal/privacy/terms copy
- transactional/account/security copy
- approved onboarding or marketing headlines

The cleanup target is only generic app-generated explanatory/process copy on public consumer surfaces.

Examples of target copy:
- "what we know"
- "source evidence"
- "available source evidence"
- "profile was built"
- "we're still confirming"
- long repeated owner-confirmation disclaimers
- audit-style trust narration in heroes/cards
- repeated missing-data explanations

Do not remove all trust labels.
Compress and relocate them.

Acceptable compact labels:
- Community
- Unclaimed
- Menu preview
- No schedule posted
- Owner update
- Limited menu info

Do not:
- fabricate food, menu, schedule, location, open-now, verification, owner approval, popularity, ratings, deals, or events
- remove legally required copy
- remove necessary safety/trust qualifiers entirely
- mutate production data
- change schema
- create duplicate identities
- geocode anything
- change map/live-feed behavior
- change B2/internal intake
- change admin claiming backend
- change import tooling
- redesign the entire site broadly in one unsafe sweep

Before changing any phrase, classify it as:
1. Protected brand/user/legal/business language: do not change.
2. Public UX process/audit language: eligible for compression or removal.
3. Necessary trust qualifier: keep but shorten and contextualize.
4. Internal/admin/operator copy: leave alone unless specifically in scope.

Required implementation behavior:
1. Create or document a protected phrase allowlist before editing copy.
2. Search public consumer-facing components for target phrases.
3. Edit only generic app-authored explanatory copy.
4. Leave protected brand/user/owner-specific language untouched.
5. Add a focused contract test that:
   - blocks the worst audit/process phrases from key public surfaces
   - verifies "Follow the Flavor" is not removed or changed if present in public copy
   - does not scan docs/admin/internal files as if they were public UI
6. Do not do a repo-wide replace.
7. Do not modify content stored in data fixtures if it represents real truck/business/user content unless explicitly instructed.

Existing-state deep dive:
1. Search the repo for explanatory/process-heavy copy patterns, including:
   - "what we know"
   - "we know"
   - "community profile"
   - "community-submitted"
   - "evidence"
   - "source evidence"
   - "pending confirmation"
   - "owner confirmation"
   - "owner update pending"
   - "not confirmed"
   - "unverified"
   - "claim this"
   - "update pending"
   - "available source"
   - "limited info"
   - "profile was built"
   - "MealScout has not"
   - "we're still"
   - "AI"
   - "generated"
   - "confidence"
2. Inventory affected files and pages.
3. Separate necessary trust/legal/safety copy from bloated explanatory copy.
4. Identify the highest-impact user-facing surfaces first:
   - /scout
   - /truck/:slug
   - /p/truck/:id
   - restaurant/public profile routes
   - /food-trucks-today/:city
   - /claim-truck
   - /restaurant-signup
   - onboarding/free-profile flows
5. Implement a narrow first cleanup that removes or compresses the worst copy without breaking trust.

Copy rules:
- Replace "Here is what we know" with actual content sections.
- Replace long evidence disclaimers with compact inline labels.
- Replace repeated missing-data narration with one compact empty state.
- Trust labels should be short:
  - Community
  - Unclaimed
  - Menu preview
  - No schedule posted
  - Owner update
- Prefer buttons/actions over explanations:
  - View menu
  - Website
  - Call
  - Share
  - Add menu
  - Add schedule
  - Update profile
- Do not lead pages with audit/process copy.
- Do not repeat the same disclaimer across hero, section, and footer.
- Missing data should be handled where the missing data belongs.

Implementation target:
First pass should focus on the most visible consumer surfaces:
1. /scout cards and scene labels
2. public truck/profile pages
3. food-trucks-today route if affected
4. owner update/claim CTA copy where it appears on public surfaces

Allowed:
- copy cleanup
- section title cleanup
- empty-state cleanup
- CTA wording cleanup
- trust label compression
- tests that prevent "what we know" style copy from returning
- small layout adjustments only where required to support copy cleanup

Required test:
Add a contract test that blocks the worst sitewide phrases from key public surfaces/components.

Suggested forbidden phrases for public consumer surfaces:
- "what we know"
- "source evidence"
- "available source evidence"
- "profile was built"
- "we're still confirming"
- "owner confirmation pending" in hero/top-level copy
- "evidence-based profile" in hero/top-level copy
- "AI generated" or "generated" in user-facing copy unless explicitly part of an admin/internal tool

Important:
Some internal docs/admin tools may still use evidence/process language. Do not break admin/operator workflows. The cleanup target is public/consumer-facing UX.

Validation:
- git diff --check
- npm run check
- focused sitewide show-dont-tell copy contract test
- existing scout tests
- existing public profile tests
- smoke:
  - /scout
  - /truck/blessed-berry-bowls--e77ac77a-c432-42d0-ac0f-22c48b6306c9
  - /truck/creativbowls--75dd470e-2692-4579-bde0-a64dcc3f6fcb
  - /p/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb
  - /food-trucks-today/pensacola if route exists
- final worktree clean

Final response required:
- branch
- base SHA
- final commit SHA
- files changed
- protected phrases preserved
- user/owner-specific copy untouched
- affected public surfaces found
- worst phrases removed/compressed
- copy rules added
- visible before/after examples
- validation results
- smoke results
- whether production data changed
- confirmation that no fake data, schema mutation, duplicate identity creation, geocode, map/live-feed behavior, B2/internal intake, admin claiming backend, or import tooling changed
```

## Operating Call

This is a product-wide rule, not a one-off cleanup.

From now on, any MealScout lane that adds public copy must pass this filter:

```text
Would a normal hungry user care about this sentence?
Does it show food/place/time/action?
Can it be replaced by a button, label, menu item, image, schedule, or link?
Is this internal process language leaking into the product?
```

If the answer is yes, cut it.
