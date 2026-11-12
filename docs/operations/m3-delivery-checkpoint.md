# GARH JAISAL CAFE — M3 DELIVERY CHECKPOINT

## Prerequisite
M2 PR #5 remains open and unmerged. Its latest observed CI run 43161527159 failed two Playwright cases in shard 3/4. M3 branch is isolated from current main SHA 3c7f8dd5811e93159e83188bd8b94c046a29052b; it is not based on M2 and does not touch M2 features.

## MILESTONE
M3 baseline and first reconciliation contract prepared. **Not complete**: production-facing daily report integration and inventory lifecycle validation remain pending after the M2 gate.

## EXISTING FEATURES REUSED
Cash sessions, drawer movements, immutable day closures, X/Z reports and exports, bill settlement and split tenders, refunds/idempotency, configurable tax snapshots, INR minor-unit helpers, inventory movements, recipe depletion/restore, supplier receiving, reasoned wastage, and expense payments.

## GAPS FOUND
The focused gap classification and recommended smallest implementation are recorded in `docs/operations/m3-baseline-gap-report.md`. Key gap: report aggregate conventions differ across views (refund attribution to cash-out date vs original bill date). This needs an explicit per-report reconciliation contract, not another financial engine.

## IMPLEMENTATION
- Added the M3 baseline/gap report.
- Added an isolated synthetic INR daily reconciliation contract covering ₹5,000 opening float, cash/card/UPI, split tender arithmetic, refund once-only handling, configurable decimal tax precision, half-open IST business day, unpaid bill exclusion and distinct inventory lifecycle movements.
- Added one focused npm test script.
- No migrations, new dependencies, production data writes, POS/mobile changes, or CI workflow changes.

## FILES CHANGED
- `docs/operations/m3-baseline-gap-report.md`
- `tests/m3-daily-operations-reconciliation.test.ts`
- `package.json` (one focused script only)

## TARGETED TESTS EXECUTED
Not executed locally. The environment cannot resolve github.com, so clone/dependency install was unavailable. The focused test is committed for GitHub Actions/owner execution. No test pass is claimed.

## PR LINK
Will be opened after repository-side verification / baseline gate; no PR is opened yet in this checkpoint.

## OWNER TEST INSTRUCTIONS
1. Complete and merge M2 PR #5 only after its KOT recovery and service-worker controller E2E failures are corrected.
2. On merge, rebase/recreate this M3 work from the resulting main (do not merge M2 into this branch by hand).
3. Run `npm run test:m3-daily-operations-reconciliation` with the repository's normal Node 22 toolchain.
4. Do not run the fixture against a hotel production DB; it is synthetic only.
5. Review the stated refund attribution conventions with the manager/accountant before relying on totals for bookkeeping.

## FINANCIAL / STOCK RISKS
- A report must not mix payment-line collection date, bill date and refund cash-out date without labeling attribution.
- Do not treat unpaid/part-paid invoices as settled sales in the settled-sales total.
- Never rewrite historical tax snapshots when current tax settings change.
- Test refund/correction combinations against payment lines to prevent double subtraction.
- Recipe consumption is not production-safe until fulfilment transition, cancellation, restore, retries and refunded-item lifecycle have been validated against the existing ledger.
- Do not claim GST legal compliance; accountant/legal validation remains required.
