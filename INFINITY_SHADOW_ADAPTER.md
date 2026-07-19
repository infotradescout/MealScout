# Infinity shadow adapter

MealScout continues to own its current referral capture and commission behavior.
The adapter only mirrors non-PII attribution touches and signup evidence into
Infinity for compatibility comparison. It does not read or write commission,
wallet, credit, withdrawal, or payment state.

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
