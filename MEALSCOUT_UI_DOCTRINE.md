# MealScout UI Doctrine

Status: active doctrine for role, intent, attribution, and capability surfaces.

## Core Model

Affiliate is not a MealScout user role. Affiliate sharing is a universal attribution and campaign capability that can apply across multiple user authorities.

```text
User = identity
Role = authority
Intent = current job
Affiliate = attribution/campaign layer
```

UI surfaces are computed from:

```text
Surface =
Role authority
+ Current intent
+ Entity state
+ Affiliate attribution state
+ Trust/risk state
+ KPI/revenue priority
```

## Primary Authority Roles

| Role authority | Controls                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Visitor        | Public discovery, signup, login, referral capture, public actions                              |
| Truck Owner    | Claimed truck/business management, profile/menu/schedule repair, owner analytics               |
| Host           | Host location management, parking/location availability, host dashboard tools                  |
| Staff          | Staff operations surfaces and support workflows                                                |
| Admin          | Administrative oversight, moderation, user/business management, aggregate affiliate visibility |

## Universal Capabilities

| Capability        | Meaning                                                       | Role rule                                      |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| Affiliate sharing | User has or can obtain a share tag and generate tracked links | Capability state, not role authority           |
| Claim/update      | User can request or maintain entity facts when authorized     | Controlled by entity ownership and claim state |
| Save/follow       | User can keep track of public entities or food activity       | Available where identity/session supports it   |
| Report issue      | User can flag incorrect public facts or operational problems  | Guarded by trust/risk rules                    |
| Submit evidence   | User can contribute profile/menu/location evidence            | Guarded by moderation and entity state         |

## Product Matrix

| Product surface | Role authority                              | Intent priority                                                    | Affiliate/campaign layer                                                                 |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Public profile  | Visitor plus any authenticated role         | Find food, decide quickly, get directions/menu/order               | Preserve/share tracked URLs when share tag state exists                                  |
| Share Hub       | Any authenticated user with share tag state | Share public destinations with attribution                         | Disabled when affiliate tag cannot be resolved                                           |
| Owner dashboard | Truck Owner or linked business authority    | Repair profile, menu, hours, schedule, claim/update                | Share tools remain accessible as secondary capability                                    |
| Host dashboard  | Host authority                              | Manage host/location availability and truck activity               | Share tools can exist when tag state exists                                              |
| Admin user card | Admin authority                             | Manage identity, roles, settings, and supported affiliate settings | Aggregate visibility and supported edits only; role authority still controls permissions |
| Scout/discovery | Visitor plus authenticated users            | Find nearby food and save/follow/report                            | Referral capture is attribution metadata only                                            |

## Guardrails

- Do not model affiliate as a standalone role.
- Do not use `role=affiliate` signup or routing.
- Affiliate tools appear when affiliate capability or share/tag state exists.
- Every eligible internal link shared by an authenticated user can become an attributed share link.
- Affiliate attribution belongs to the sharer/session; destination ownership is not required.
- Destination validity is required: block external, protocol-relative, root, admin, staff, API, and `/ref` targets.
- Universal tracked share output uses `/<safe-internal-path>/<tag>` and keeps tracking separate from payout.
- Query-param refs such as `?ref=<tag>` remain accepted fallback ingestion for compatibility.
- Role authority controls permissions.
- Intent controls priority.
- Entity state controls warnings and repair prompts.
- Trust/risk state controls guardrails.
- Every authorized feature remains accessible even when it is not the primary action.

## Public Copy Guardrails

Protected copy rule:

- Do not change approved user-specific, brand-specific, campaign, legal, owner-provided, or business-provided language.
- `Follow the Flavor` is protected and must not be changed, removed, renamed, or rewritten.
- Do not perform broad string replacement across public copy.

Protected examples include:

- `Follow the Flavor`
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
- city and location names
- legal, privacy, and terms copy
- transactional, account, and security copy where exact wording matters
- approved onboarding copy
- approved marketing headlines

Protected-copy classification must happen before any public-copy edit:

1. Protected brand/user/legal/business language: do not change.
2. Public UX process/audit language: eligible for compression or removal.
3. Necessary trust qualifier: keep, but shorten and contextualize.
4. Internal/admin/operator copy: leave alone unless explicitly in scope.

Operating rule:

```text
Preserve brand voice.
Remove process voice.
```

Public-facing copy should:

- show the useful thing
- prefer food, place, time, action, and trust qualifier order
- keep trust qualifiers compact and attached to the content they qualify

Public-facing copy should not:

- explain the system when a button, label, menu item, image, schedule, or link can do the job
- make internal trust/process language the page personality
- flatten MealScout's approved voice into bland generic copy

Blunt rule:

```text
Cut the AI/process sludge.
Do not cut the brand voice.
Do not rewrite owner/user/business content.
```
