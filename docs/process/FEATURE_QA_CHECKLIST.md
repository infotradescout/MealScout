# Feature QA Checklist

Use this checklist for any feature, bug fix, or public-facing data lane.

## Intake

- [ ] Repo and product lane named
- [ ] Baseline SHA recorded
- [ ] User-facing behavior described
- [ ] Data mutation posture stated
- [ ] Email/payment/public exposure posture stated
- [ ] Known guardrails listed

## Local Validation

- [ ] `npm run check`
- [ ] Relevant contract tests
- [ ] Relevant build command when frontend/server output changes
- [ ] `git diff --check`

## Manual QA

- [ ] Happy path
- [ ] Empty/missing-data path
- [ ] Error path
- [ ] Mobile viewport
- [ ] Desktop viewport
- [ ] Auth/permission boundary if relevant
- [ ] No private data leakage
- [ ] No accidental email/payment/live mutation

## Release Evidence

- [ ] Evidence artifact or review packet created
- [ ] Files changed listed
- [ ] Commands and results listed
- [ ] Screenshots/video linked when visual
- [ ] Open defects prioritized
- [ ] Final git status recorded

