# Infinity shadow adapter

MealScout continues to own its current referral capture, commission behavior,
and profile mutation. The adapter mirrors non-PII attribution touches, signup
evidence, and preview-only Selective Inheritance evaluations into Infinity for
compatibility comparison. It does not read or write commission, wallet, credit,
withdrawal, payment, ordering, or live-availability state.

Set `INFINITY_API_URL`, `INFINITY_API_KEY`, `INFINITY_TENANT_ID`, and
`INFINITY_PROGRAM_ID` to enable it. Missing configuration disables delivery.
Requests time out after 1.5 seconds, fail open, and run outside the user-facing
success path. Production endpoints must use HTTPS.

The mirrored payload allowlists an internal partner reference, a validated
affiliate tag, its carrier, a query-free canonical route, event type, and
opaque restaurant/route hashes. Raw query strings are never forwarded. Unknown
parameters and query values such as tokens, emails, phone numbers, authorization
codes, and login codes are discarded before the payload is built. Email- or
phone-like path segments are redacted as a second boundary. The adapter also
excludes IP address, user agent, payment value, and commission percentage.

Selective Inheritance uses Infinity's shared policy/evidence contract. MealScout
declares its own food-business field allowlist. Protected or unknown fields are
removed before delivery. Menu, schedule, identity, and media candidates still
require verified evidence and remain previews until a separate MealScout
owner/admin action applies them. A current authoritative Screen Pass can support
an allowed field, but cannot bypass policy or authorize a mutation.
