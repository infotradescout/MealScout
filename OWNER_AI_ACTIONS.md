# MealScout Owner AI Actions

MealScout Owner AI Actions is a model-neutral owner workflow. An owner can connect a compatible AI or automation tool they already have, free or paid, through the remote MealScout MCP tool and MealScout OAuth login. The AI can prepare a complete business update and, after the owner explicitly consents to that exact immutable revision in the AI chat, call MealScout to approve, apply, and publish it. A portable JSON packet remains available for AIs that cannot call remote tools.

The actual owner is always the source of consent; the signed-in AI may be the executor. OAuth binds the AI connection to one exact owner/business pair. A draft has no effect until the owner sees its exact values, descriptions, destinations, and images and approves that revision. Manually copied legacy bearer keys remain draft-only and cannot execute approval or publishing.

## Safety and execution order

1. The owner's AI discovers `/api/owner-ai/mcp`, starts OAuth authorization-code login with PKCE, and receives access only after the signed-in actual owner chooses a business that has at least one usable social publishing connection.
2. The AI reads that owner-scoped context and the current version fingerprints.
3. It creates a draft using an idempotency key. Nothing is mutated, hosted, queued, or published.
4. MealScout creates deterministic Facebook, Instagram, and X copy plus branded SVG previews. When the AI supplies platform-specific copy or an image, that exact selected alternative becomes the approval preview.
5. `prepare_mealscout_approval` returns the exact immutable packet, normalized plan, current values, social destinations, descriptions, generated social images, owner-supplied media descriptors, and a short-lived consent handle bound to that connection, owner, business, draft, revision, current values, image hashes, and content fingerprint. The AI calls `get_mealscout_media_preview` for every supplied logo, cover, gallery, menu, deal, or social image so the frozen bytes appear in the same chat.
6. The AI shows that complete revision and every generated or retrieved image in chat. The owner explicitly approves or declines it. Current MCP clients use an `input_required` confirmation; compatible older clients attest that explicit chat consent before the approval call. The owner may instead use the authenticated MealScout review page as a fallback.
7. `approve_mealscout_draft` rechecks the approval scope, consent handle, actual ownership, draft revision, expiry, every canonical version fingerprint, and each requested social connection before any canonical write.
8. Approved remote canonical media is validated against private-network/SSRF targets and re-hosted when Cloudinary is available.
9. One database transaction applies canonical MealScout changes with upsert/archive semantics and creates durable social intents.
10. After commit, MealScout rasterizes generated cards to public PNG and processes Facebook, Instagram, then X.
11. Each platform reports `posted`, `failed`, or `manual_required`. Social failure never rolls back the committed MealScout update.

An interrupted provider call is not blindly retried. After the publish lease expires, MealScout marks that platform `manual_required` because delivery is uncertain and a retry could duplicate a post.

A single durable draft-level lease preserves Facebook → Instagram → X ordering even if two owner requests arrive together. If the canonical commit succeeds but the request ends before all social intents finish, the owner can use **Continue approved posts**; this resumes only the already-approved queue rows and never reapplies canonical content.

The X adapter requires `tweet.write` and `media.write`, renews an expired OAuth token with the stored refresh token, uploads the approved image, and only then creates the post. Older X connections without `media.write` report `manual_required` and must be reconnected. If image upload fails, MealScout does not silently publish a text-only substitute.

## Owner lifecycle entry points

AI Control is part of the normal owner lifecycle, not an isolated power-user page:

- Public profile onboarding and invited-account setup introduce the model-neutral workflow before the owner reaches the dashboard.
- A business must be attached before AI Control can read context or create a draft. Owners without an attached business still continue through `/restaurant-signup`.
- After attachment, incomplete profile, profile-media, menu, or schedule continuation enters `/owner-ai?restaurantId=...&src=onboarding&focus=...`. Business-document verification remains a separate manual step.
- The user profile hub, account Settings **AI & apps** tab, business profile editor, and owner completion checklist all return to the same owner-scoped `/owner-ai` workspace.
- AI Control and Settings expose the minimum working-chain readiness in one place: signed-in MealScout owner, favorite AI connected through MealScout OAuth, and at least one usable social publishing account connected to MealScout.
- Manual profile, photo, menu, hours, and schedule tools remain available. The AI route is the primary one-surface option, not a requirement to use a particular model or a removal of manual controls.

Every entry preserves the selected `restaurantId`. Only the actual scoped owner may authorize an AI connection or give per-revision consent. After that consent, the OAuth/MCP AI can execute approval for only the exact revision it presented. Team permissions do not become owner consent authority.

Supplied remote images are never hotlinked into the approval browser. Draft creation fetches each image through MealScout's bounded public-host validator and stores its SHA-256 fingerprint in the inert draft. Draft responses expose authenticated MealScout preview URLs keyed to those fingerprints. The proxy rechecks owner access, hostname/IP safety on every redirect, raster type, response time, redirects, byte limits, and the frozen content hash. Approval repeats the same hash check before copying or publishing any image. If a URL changes or stops loading, approval is disabled and the owner must review a fresh draft. Logo, cover, gallery, menu-item, deal, and supplied social images receive preview descriptors. Supplied social media becomes the primary preview while the deterministic MealScout card remains available as `fallbackPreviewUrl`.

## OAuth/MCP connection

The primary connection is the remote MCP URL:

- `POST /api/owner-ai/mcp`

OAuth discovery and lifecycle routes:

- `GET /.well-known/oauth-protected-resource/api/owner-ai/mcp`
- `GET /.well-known/oauth-authorization-server`
- `GET /api/owner-ai/oauth/authorize/prepare`
- `POST /api/owner-ai/oauth/authorize`
- `POST /api/owner-ai/oauth/authorize/deny`
- `POST /api/owner-ai/oauth/token`
- `POST /api/owner-ai/oauth/revoke`
- `POST /api/owner-ai/oauth/register` as a backwards-compatible dynamic-client-registration path; Client ID Metadata Documents are preferred when the AI supports them.

Authorization requires PKCE `S256` and a resource indicator equal to the MealScout MCP URL. Access tokens last one hour. Refresh tokens last up to 90 days and rotate on every use. Revoking an OAuth access connection also revokes its linked refresh token.

An approved OAuth connection can receive:

- `owner_ai:context`
- `owner_ai:drafts:create`
- `owner_ai:drafts:read`
- `owner_ai:drafts:approve`

The approval scope does not provide standing permission to publish arbitrary content. Every execution requires the current exact-revision consent handle and explicit owner confirmation in chat. The approval tool applies the frozen revision and only its listed social posts.

## Legacy copied credentials

Create, list, and revoke a manually copied fallback credential while signed in:

- `POST /api/owner-ai/credentials`
- `GET /api/owner-ai/restaurants/:restaurantId/credentials`
- `POST /api/owner-ai/credentials/:credentialId/revoke`

The raw token is shown once. MealScout stores only a bcrypt hash plus an eight-character lookup prefix. The database row fixes the owner, restaurant, purpose, scopes, expiry, active state, and revocation state. Payload `userId` and `restaurantId` values are rejected by the strict packet schema and never establish identity.

Legacy copied-key scopes are deliberately limited to:

- `owner_ai:context`
- `owner_ai:drafts:create`
- `owner_ai:drafts:read`

Legacy copied keys have no approval scope or REST route for update, cancel, approve, apply, media hosting, queueing, or publishing. They cannot impersonate OAuth/MCP consent.

## Model-neutral routes

Public contracts:

- `GET /api/owner-ai/instructions`
- `GET /api/owner-ai/schema`
- `GET /api/owner-ai/openapi.json`

Remote tool contract:

- `POST /api/owner-ai/mcp`
- `get_mealscout_context`
- `create_mealscout_draft`
- `get_mealscout_draft_status`
- `prepare_mealscout_approval`
- `get_mealscout_media_preview`
- `approve_mealscout_draft`

Legacy copied-key routes:

- `GET /api/owner-ai/connector/context`
- `POST /api/owner-ai/connector/drafts`
- `GET /api/owner-ai/connector/drafts/:draftId`

The legacy status route returns safe canonical and per-platform outcomes only when the draft was created by that exact copied key for that exact owner/business attachment. It does not grant edit, cancel, approval, apply, or publishing authority. OAuth/MCP AIs use the MCP status and approval tools; copied-key clients remain draft-only.

For an AI without remote-tool support, the owner workspace's **Copy current context for any AI** button packages the same current facts, version fingerprints, contract links, and output shape for copy/paste. The paste box accepts either the canonical `{ "expectedVersions": ..., "packet": ... }` request or the inner packet shorthand. Because that AI cannot call MealScout, the owner completes the final fallback approval in MealScout.

Owner-session routes:

- `GET /api/owner-ai/restaurants/:restaurantId/context`
- `GET|POST /api/owner-ai/restaurants/:restaurantId/drafts`
- `GET|PATCH /api/owner-ai/drafts/:draftId`
- `POST /api/owner-ai/drafts/:draftId/cancel`
- `POST /api/owner-ai/drafts/:draftId/approve`
- `GET /api/owner-ai/drafts/:draftId/social-preview/:platform.svg`
- `GET /api/owner-ai/drafts/:draftId/media-preview/:assetKey`

## Idempotent draft creation

Connector draft requests require an `Idempotency-Key` header containing 8-200 safe characters. MealScout stores a SHA-256 fingerprint of that key with the connector ID and a hash of the validated request.

- Replaying the same key and same request returns the original inert draft with `idempotencyReplay: true`.
- Reusing the key with different content returns `409 IDEMPOTENCY_KEY_REUSED`.
- The unique connector/key database index closes concurrent retry races.

## Context bounds

Context never returns an unbounded business payload. The first response includes up to 25 menus, 500 categories, 1,000 items, 250 current/upcoming schedules, 250 active/current deals, and 25 historical schedule/deal rows. `contextBounds` supplies independent next offsets so a connector can retrieve every current editable record without repeating old history:

```text
GET /api/owner-ai/connector/context?menuOffset=25&menuCategoryOffset=500&menuItemOffset=1000&scheduleOffset=250&dealOffset=250
```

Version fingerprints cover the complete canonical restaurant/menu/schedule/deal state, not just the returned page. When `menuOffset` changes, category and item offsets apply to that returned menu page and should normally be reset to zero.

## Portable request example

```json
{
  "expectedVersions": {
    "restaurant": "from-context",
    "menus": "from-context",
    "schedules": "from-context",
    "deals": "from-context"
  },
  "packet": {
    "schemaVersion": "1.0",
    "intent": "Publish our Friday event, new taco price, logo, and social package",
    "source": {
      "tool": "the owner's existing AI"
    },
    "mediaRights": {
      "affirmed": true,
      "affirmation": "The restaurant owner confirms they own or have permission to use every supplied remote image."
    },
    "profile": {
      "description": "Fresh Gulf Coast tacos and rotating specials.",
      "logoUrl": "https://assets.example.com/logo.png"
    },
    "menus": [
      {
        "name": "Main Menu",
        "serviceType": "all",
        "categories": [
          {
            "name": "Tacos",
            "items": [
              {
                "name": "Gulf Shrimp Taco",
                "description": "Blackened shrimp, slaw, and lime crema",
                "priceCents": 1400,
                "imageUrl": "https://assets.example.com/shrimp-taco.jpg"
              }
            ]
          }
        ]
      }
    ],
    "schedules": [
      {
        "kind": "event_stop",
        "eventName": "Friday Night Market",
        "date": "2026-08-14",
        "startTime": "17:00",
        "endTime": "21:00",
        "locationName": "Downtown Market",
        "address": "100 Main St",
        "city": "Pensacola",
        "state": "FL"
      }
    ],
    "social": {
      "enabled": true,
      "platforms": ["facebook", "instagram", "x"],
      "headline": "Friday tacos downtown",
      "subheadline": "5-9 PM at Downtown Market"
    }
  }
}
```

If the packet contains any remote logo, cover, gallery, menu-item, deal, or social image, `mediaRights.affirmed` must be `true` and its affirmation is shown at approval. Packets using only MealScout's deterministic generated cards do not need this claim.

## Supported changes

- Profile name, description, phone, website, cuisine, address, city/state, and social profile links
- Public action links: external menu, online ordering, delivery, DoorDash, Uber Eats, Toast, Square, ChowNow, Grubhub, catering inquiry, and truck-booking inquiry
- Operating hours
- Menus, categories, items, prices, dietary/allergen metadata, and item images
- Logo, cover, and public gallery images
- Food-truck schedules and event stops with source/currentness metadata
- Deals and offers
- Platform-specific social copy, links, supplied image options, and deterministic branded image fallbacks

Archive operations deactivate or hide records. They never physically delete menu, category, item, schedule, deal, or media rows.

Public action links are merged into the canonical `socialAutopostSettings.publicActionLinks` object. The merge preserves gallery entries, social trigger/platform settings, and action links omitted from the packet.

## Deployment dependency

Run `migrations/123_owner_ai_action_drafts.sql` before enabling these routes against a database. OAuth/MCP approval requires `OWNER_AI_OAUTH_SECRET` or a sufficiently strong `SESSION_SECRET`. At least one supported social publisher must be configured and connected before an owner can authorize an AI. Generated social images require configured Cloudinary credentials. Without image hosting, the canonical MealScout transaction can still succeed when its own content does not require a hosted deal image, while affected social platforms report `manual_required` and publish nothing.
