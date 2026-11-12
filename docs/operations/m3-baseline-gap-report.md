# GARH JAISAL CAFE — M3 BASELINE / GAP REPORT

## M2 prerequisite status
PR #5 is still open and unmerged. Latest observed head: `a53c246e17c610cd23eef0e49f14d65dbfe95685`; base `main`: `3c7f8dd5811e93159e83188bd8b94c046a29052b`.
Its latest CI run (43161527159) failed in Playwright E2E shard 3/4:
- `frontend/e2e/server-app-ordering.spec.ts:153`: KOT recovery test timed out clicking “Send to kitchen”.
- `frontend/e2e/server-app-ordering.spec.ts:197`: offline test timed out waiting for `navigator.serviceWorker.controller`.
Build/lint, native Electron tests, core test shards and the other Playwright shards passed. No owner review comments or submitted reviews were present at inspection.
M3 changes must not be based on the unmerged M2 branch. This branch is intentionally created from current `main` only.

## Existing functionality — focused classification

| Domain | Status | Existing contract / gap to validate |
|---|---|---|
| Cash sessions | READY | `cash_sessions`, open/current/close APIs, opening float, expected cash, counted cash and variance; authorization and own-shift rules in `main/routes/cash-sessions.ts`. |
| Drawer movements | READY | Pay-in, pay-out, safe-drop, immutable movement history with authorized void and reason; `main/routes/cash-closures.ts`, `main/services/cash-drawer-movements.ts`. |
| Day close | READY | Immutable `cash_closures` day snapshot; concurrency guard and half-open business-day windows. |
| Bill settlement | READY | Existing bill/payment line allocation, split payments, settlement idempotency and order lifecycle gates in `main/routes/bills.ts`; tests include `bills-settlement-idempotency`, split checks, integration payments. |
| Refunds / corrections | READY | Refund idempotency, manager/owner PIN gate, immutable refund records and payment-method correction authorization; `main/routes/refunds.ts`. |
| Daily reports | PARTIALLY READY | X/Z reports and CSV/XLSX/HTML export exist. Need one representative-day reconciliation proving settled bills, payment lines, refund attribution, tax, discounts and cash all reconcile. |
| Product/category reports | READY | Sales/top products/category-oriented projections exist in `main/routes/reports.ts`; must exclude cancelled/void/refunded items consistently. |
| Currency/tax | READY | Tenant currency, minor-unit factor, Decimal/tax engine, tax snapshots and configurable tax packs exist. India profile and receipt/report parity need focused owner configuration validation; never hardcode GST or rewrite historical invoices. |
| Inventory ledger | PARTIALLY READY | Product inventory movements and stock adjustment services exist. Need confirm exact link to fulfilled item transitions and restore idempotency, including refunds/cancellations. |
| Recipes | PARTIALLY READY | Recipe definitions and recipe_depletion/recipe_restore service exist. Need validate only actual fulfilled lifecycle consumes stock, with retries/refunds not duplicating movements. |
| Suppliers / purchasing | READY | Supplies CRUD and receive movements with purchase unit cost and stock update exist. Confirm UI/ledger traces actual received qty/cost. |
| Wastage / stock adjustments | READY | Manual movement types include adjustment and waste; service requires reason. Verify authorization and reporting trace. |
| Expenses | READY | Expense workflow, payments, reversal/replacement and cash integration services exist. |

## Smallest practical M3 implementation
Do not add a parallel financial engine or inventory schema. First compare existing X/Z and management report calculations against the canonical bill/payment/refund records and the day-close snapshot. Add a narrow integration/reconciliation test fixture using synthetic data for:
1. INR 5,000 opening float; cash/card/UPI and split tender across settled bills; one authorized discount; one refund/correction.
2. Verify expected drawer cash uses cash payment lines and cash refunds by the cash-out business timestamp, without adding gross refunds twice.
3. Compare X/Z and export aggregates with settled payment lines, refund ledger, bill tax snapshots, business-day half-open timezone boundaries and unpaid bill exclusion.
4. Receive supplies at actual cost, deplete via a fulfilled recipe lifecycle, cancel/restore once, and record separate reasoned wastage.
5. Assert ledger deltas are idempotent and movement reason/actor remain traceable.

Potential inconsistency to investigate before changing code: `reports.ts` contains multiple sales aggregates, and some daily summary/insight formulas net refunds by `refunds.created_at` while financial report documentation explicitly says refunds are attributed to bill date for one summary. Cash day-close deliberately attributes cash refunds by cash-out timestamp. M3 must name the attribution convention for each report and avoid mixing them.

## Owner validation boundary
Never run the representative fixture against a production owner database. Use the existing isolated test database/fixtures. Owner local operational testing is required after PR completion. This report does not claim legal GST compliance; accountant/legal validation remains necessary.
