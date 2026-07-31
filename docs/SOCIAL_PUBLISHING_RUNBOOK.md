# MealScout Social Publishing Runbook

MealScout owner publishing uses OAuth connections owned by each restaurant/truck.
Do not use one global MealScout account for owner posts.

## Required Environment

Set these in production and staging:

```txt
PUBLIC_BASE_URL=https://www.mealscout.us
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
X_CLIENT_ID=...
X_CLIENT_SECRET=... # optional for public PKCE clients, recommended for confidential web apps
SOCIAL_QUEUE_PROCESSOR_ENABLED=true
```

`APP_BASE_URL` is accepted as a fallback, but `PUBLIC_BASE_URL` should be the
canonical public URL used in provider dashboards.

## Provider Callback URLs

Use the same public base URL the app is deployed on.

```txt
Meta OAuth redirect:
https://www.mealscout.us/api/social-connections/meta/callback

X OAuth redirect:
https://www.mealscout.us/api/social-connections/x/callback
```

For staging, replace the host with the staging domain and register those
callbacks separately.

## Meta Permissions

The app requests:

```txt
pages_show_list
pages_read_engagement
pages_manage_posts
instagram_basic
instagram_content_publish
```

Facebook publishing connects to a Page. Instagram publishing requires that Page
to have an Instagram Business account attached.

## X Scopes

The app requests:

```txt
tweet.read tweet.write users.read offline.access
```

`tweet.write` must be approved/enabled for real publishing.

## Owner Smoke Test

1. Log in as a food truck owner with a claimed profile.
2. Open `/parking-pass?tab=schedule`.
3. In Social share prompts, connect Facebook, Instagram, and/or X.
4. Confirm each card changes from `Manual` to `Connected`.
5. Trigger a one-tap share from a live stop, booking prompt, or deal prompt.
6. Confirm `social_post_queue.status` moves from `pending` to `posted`, or to
   `manual_required` when a provider cannot publish that media type.
7. Confirm the post appears on the owner-connected account, not a MealScout
   global account.

## Failure Meanings

- `Setup`: required provider env vars are missing.
- `Manual`: no owner OAuth connection exists; MealScout falls back to share
  handoff.
- `manual_required`: the selected provider cannot publish the requested post
  automatically, commonly Instagram without an image.
- `failed`: a provider rejected the post or token; reconnect the account and
  retry.
