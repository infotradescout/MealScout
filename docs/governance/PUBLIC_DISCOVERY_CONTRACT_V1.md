# Public Discovery Contract v1

**Status:** Draft — MealScout feature branch only  
**Version:** 1.0.0-draft  
**Date:** 2026-08-07  
**Authority:** Ecosystem discovery standard; JW Stone is the behavioral reference fixture, not a visual template.  
**Non-goals:** Pay-to-play ranking, lead selling, guessed city/service pages, exposing private records to improve SEO.

This contract applies per product. Do not mix MealScout, TradeScout, Sway, HomeScout, or other brand data models.

---

## 1. Public eligibility

A page may be public and indexable only when all of the following hold:

1. It represents a real, verified-or-owner-claimed public entity or approved education surface.
2. It has one official name, one permanent canonical URL, one clear category, and a useful plain-English description.
3. It has verified service/operating area when location is part of the public offer.
4. It has a current public image (entity-specific when available; never a private asset).
5. It exposes a visible last-updated or last-verified date when freshness matters.
6. Thin imported, unclaimed, synthetic, placeholder, demo, or incomplete records are **not** indexable.
7. Private identifiers, vault documents, wallets, eligibility, admin, and account surfaces remain private.

## 2. Private-data exclusions

Never publish by default:

- Account, admin, dashboard, vendor, or staff surfaces
- Payment, wallet, or credential material
- Unowned/unclaimed inventory treated as authoritative
- Personal phone numbers when Direct Connect / in-product contact is the approved path (TradeScout rule; MealScout follows its own contact policy without exposing private owner phones for SEO)
- Exact private storage locations, serials, or ownership documents (ID products)

## 3. Required first-response facts

For crawler and share-preview user agents, the **first HTTP response body** must contain, without depending on client JavaScript:

- Unique `<title>`
- Real `<h1>`
- Concise summary
- Entity name and type
- Location or service area when public
- Relevant categories
- Relevant products/services/menu items/events/listings (or an honest empty state that is still entity-specific)
- Permanent links to related public pages
- Exactly one primary action (or clearly labeled primary + secondary)

An empty application shell (`<div id="root">` with generic site title) is a **hard failure** for an eligible public discovery page.

## 4. Permanent-address rules

One permanent URL per real public intent (business, menu, dish, event, deal, supplier, video, city/cuisine hub grounded in real inventory, etc.).

Client-only filter state must not be the only address for a public entity.

Custom domains and platform hostnames must agree on the canonical host and path.

## 5. Structured-information rules

Eligible pages must emit JSON-LD (or equivalent) matching the visible entity type (`FoodTruck`, `Restaurant`, `FoodEstablishment`, `Event`, `Menu`, `Offer`, etc.).

Structured facts and visible facts must agree. Do not invent cuisine, address, or menu items for schema.

## 6. Sitemap rules

- Sitemaps must return `application/xml` (or sitemap index XML), never an HTML application shell.
- Every sitemap URL must be eligible for indexing (`index,follow` or product-equivalent).
- No private, missing, redirect-loops, duplicate, thin, placeholder, noindex, or unsuccessful URLs.
- Canonical host in sitemap locs must match the official public domain.

## 7. Crawler rules

Publish:

- Routes crawlers may inspect
- Routes crawlers must not inspect
- Separate search-discovery vs training-crawler policy where the product supports it
- Valid robots / ai / llms instruction documents with correct content types

Protected routes must not return a generic marketing shell that looks like a successful public homepage to a crawler. Prefer `404`/`401`/`403` or an explicit noindex interstitial that is not the homepage shell.

UA self-identification alone is not proof of a verified crawler. Record claimed UA separately from verified crawler traffic when verification exists.

## 8. Freshness

Eligible deep pages should expose last-updated / last-verified when the entity changes. Stale lastmod in sitemaps without corresponding page freshness weakens trust.

## 9. Attribution requirements

Preserve first discovery source through the journey:

| Event | Meaning |
|---|---|
| `discovery_landing` | First attributed land |
| `discovery_entity_view` | Public entity viewed |
| `discovery_primary_action` | Primary CTA |
| `discovery_phone_click` | Public phone click when permitted |
| `discovery_request_started` | Start a Request / MealScout equivalent start |
| `discovery_request_sent` | Submission |
| `discovery_connection_accepted` | Acceptance |
| `discovery_outcome_recorded` | Completed outcome / revenue when appropriate |

Survive navigation, return visits, auth, and cross-device continuation after authentication.

Optional offline field: “How did you find us?” — must not overwrite stronger recorded attribution.

## 10. Conversion-action requirements

Every public page has **one** primary human action.

MealScout primary actions (pick one per page type):

- View menu
- View schedule / location
- Order / pickup option when live
- Open public profile action (follow/favorite only as secondary)

Do not present five competing primary buttons.

## 11. Live production proof

Before treating a surface as discovery-ready:

1. Official public domain returns success with correct content type
2. Crawler receives successful first-response facts
3. Canonical URL correct
4. Present in sitemap iff indexable
5. Not accidentally blocked
6. Protected routes remain blocked / non-indexable and non-homepaged
7. Source tag survives the visit when provided
8. Action recorded
9. No private information appears

## 12. Rollback

- Revert the feature branch commit(s) introducing contract tests or renderer changes
- Restore prior robots/sitemap registration if a change ships
- Do not “fix” discovery by widening indexing to thin pages

## Success metric

Not “indexed page count.”

`Eligible page → verified crawler visit → ChatGPT-tagged human visit → entity view → primary action → accepted connection → completed outcome → measurable value`

JW Stone is the control example for business+inventory discovery behavior.
