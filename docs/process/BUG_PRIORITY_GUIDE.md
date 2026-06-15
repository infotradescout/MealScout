# Bug Priority Guide

Use priority to decide whether feature work pauses.

## Critical

User cannot complete a core workflow, money/payment/auth/security is at risk, private data leaks, production data is corrupted, or the app crashes on a primary route.

Action: stop feature work and fix immediately.

## High

Important workflow is blocked or badly confusing, but there is a workaround and no active security/payment/data-corruption risk.

Action: fix before expanding the affected product area.

## Medium

Workflow works but is clunky, inconsistent, slow, or missing an expected state.

Action: schedule after Critical/High items and before major refactor in the same area.

## Low

Cosmetic issue, minor copy issue, small polish gap, or internal-only nuisance.

Action: batch with cleanup or design polish.

## Not A Bug

Behavior is intentional, unsupported, or requires a product decision.

Action: document the decision or route to product.

