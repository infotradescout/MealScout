# Parking Pass compatibility cutover

This is the temporary first deployment of the PR380 application. Application files are byte-identical to candidate 9e53e0d9c36abdc659e0a5ca11b70ab36e1c7da6 (executed implementation source 215b6868bab791017fdbf8682e681c82a9d045e3). Migration142 is intentionally not part of this first deployment, so its canonical migrations are identical to production parent c10700e38d158f9b7378925a7cf3951b20fae9e1. No applied migration is removed or relabeled. No migration runner gate is bypassed.

First execute the compatibility proof against the retained all-history booking guard. The one temporary limitation is that a truck cannot rebook the same occurrence after cancellation; this must fail without altering terminal history or creating a payment. All other existing capacity, eligibility, uncertain-payment and cross-process replay assertions remain mandatory.

Deploy this compatibility revision before migration142. Confirm the original Render deployment is deactivated and its instance has terminated. A new deployment becoming live by itself is insufficient because Render overlaps instances. Only then restore the reviewed migration142 through PR380 and execute the canonical deploy migration runner. Retain source/deploy/old-instance evidence for both stages. Connected-provider and customer-payment acceptance remain separate evidence; fixture tests are not live Stripe acceptance.

Keep all previous proof receipts with their original source. This file is a rollout policy, not an execution receipt. No billing/protection setting changes are authorized here.
