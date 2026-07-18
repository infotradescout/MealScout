# Infinity shadow adapter

MealScout continues to own its current referral capture and commission behavior.
The adapter only mirrors non-PII attribution touches and signup evidence into
Infinity for compatibility comparison. It does not read or write commission,
wallet, credit, withdrawal, or payment state.

Set `INFINITY_API_URL`, `INFINITY_API_KEY`, `INFINITY_TENANT_ID`, and
`INFINITY_PROGRAM_ID` to enable it. Missing configuration disables delivery.
Requests time out after 1.5 seconds, fail open, and run outside the user-facing
success path. Production endpoints must use HTTPS.

The mirrored payload includes an internal partner reference, affiliate tag,
route, event type, and opaque restaurant/route hashes. It excludes IP address,
user agent, email, payment value, and commission percentage.
