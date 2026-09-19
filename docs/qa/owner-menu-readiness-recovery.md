# Owner menu readiness recovery

Continuation of draft PR #380 from `ef8f6354d982df390d51df03ec18a69f1c50dd99` after claim-search continuity.

The owner menu previously accepted successful readiness responses without validating the fields it rendered. Invalid JSON or missing checks could crash the menu editor; wrongly typed booleans could display a misleading readiness state. A failed readiness read displayed an unavailable message without a retry action.

The view now validates the readiness fields it displays, treats malformed success responses as failed reads, and offers an accessible read-only retry. The menu remains editable while readiness is unavailable. Valid server-reported ready/blocked states and payout messages retain their existing behavior. The GET uses the query cancellation signal when its owning view changes. Server eligibility, claims, ownership, payments, Stripe activation, and ordering approval are unchanged.

## Proof

- Baseline compiled app: 104 scenarios, 90 passed and 14 failed, zero unintercepted API requests. The 14 failures were seven readiness failure variants at 1440px and 390px: HTTP 503, invalid JSON, missing checks, wrongly typed ordering/payment booleans, malformed checks, and malformed payout fields. The existing 86 scenarios and four valid-state scenarios passed.
- TypeScript and `build:client` passed. Existing chunk-size warnings remain unchanged in policy.
- Candidate compiled browser proof: all **104/104 scenarios passed**, zero unintercepted API requests. The suite completed in 127 seconds locally. Desktop/mobile recovery captures were inspected; the menu stays visible while ordering remains explicitly blocked by the server's setup state. Valid payout and payment-method fields are covered, and no owner write is sent by these journeys.
- Independent objector review of the bounded parser/cancellation/retry diff found no actionable issue. This review does not certify server eligibility or production/provider behavior.

The successful readiness fixtures follow `buildOrderingReadiness` in `server/routes/menuRoutes.ts`, including optional payment methods and payout fields. APIs and authenticated identities are synthetic. The global unintercepted-API assertion remains mandatory; no actual claim, reminder, provider activation, payment, or ordering write is performed.

Evidence: receiving task `C:/Users/flavo/Documents/Codex/2026-09-17/you/outputs/meal-readiness/`; command logs in `work/meal-readiness-*.log`. The browser harness serves `client/dist`, produced by `npm run build:client`. Do not substitute the platform build's `dist/public` output.

## Remaining transition

Hosted acceptance is still revision-specific. Previous PR #380 hosted proof does not certify this changed revision. GitHub CI's existing account billing lock remains distinct from code/test results. PR #381 is separate. Owner onboarding with actual data, provider readiness, production release, and live ordering are not proved by this UI slice.
