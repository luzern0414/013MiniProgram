# Merchant desktop implementation report

Date: 2026-10-20. Status: **DONE_WITH_CONCERNS** (local implementation; coordinator review and remaining browser checks in progress).

## Four distinct states

| State | Evidence |
| --- | --- |
| Implemented | Vue 3 desktop app and eight functional API-backed sections under `apps/merchant-web`. No static business arrays or generated success responses. |
| Running | Coordinator opened the development app at `http://127.0.0.1:5173`, signed in using the isolated development identity, and exercised the real API at port 3000. |
| Tested | Six behavior tests and Vue typecheck/production build pass. Coordinator browser + SQL verification of product, inventory, order, cash payment, transitions and persistence recorded below. Independent review and further CMS/permission/responsive/failure checks remain coordinator-owned at this report revision. |
| Production verified | **No.** No production deployment or real merchant identity/WeChat/payment integration has been verified. Production build intentionally hides development login. |

## Source boundaries and design

- `src/App.vue`: authenticated shell, real authorized store selector, development-environment login guard, eight navigation destinations, session expiry handling.
- `src/Dashboard.vue`: real Shanghai-business-day overview, latest orders and working shortcuts.
- `src/Products.vue`: actual searchable/filterable products, categories, create/edit, multiple initial SKUs, separate price/available-stock updates, availability control; owner-only management UI.
- `src/Cashier.vue`: catalog selection, SKU/modifier picker, quantity validation, dine-in table or pickup, notes, server quote, idempotent order creation, cash received/change, cash retry and next order.
- `src/Orders.vue`: status filters/paging/detail/events, state-appropriate transitions, unpaid cancellation, cash collection. Unsupported refund/payment operations are not offered.
- `src/Tables.vue`: actual table status/capacity/code; no fictitious editing capability.
- `src/People.vue`: real member search, masked contact details, balances/points, owner-authorized staff list.
- `src/StoreSettings.vue`: real store patch, clerk营业-state-only control, paged real audit log.
- `src/PageEditor.vue`: save draft, publish expected version, real public published preview, separate current-draft preview, version-conflict error and reload.
- `src/api.ts`: API envelope, 15s timeout, safe error mapping, bearer session, order idempotency header. No automatic write retry.
- `src/ui.ts`, `StateBlock.vue`, `Feedback.vue`, `Modal.vue`: loading, empty/error/retry, success and submit lock, keyboard focus trap/restore/Escape.
- `src/domain.mjs`, `src/domain.test.mjs`: exact integer-cent conversion, safe copy, environment guard, valid order actions, uncertain-write classification, stable CMS content comparison.
- `src/styles.css`: warm white/ink/orange system, receipt-inspired live-day summary, local OS font fallback, minimum 14px text, compact responsive navigation, short transitions and reduced-motion behavior.
- `public/favicon.svg`: original local receipt icon. No remote font/runtime dependency.

## Executed tests and fixes

1. `node --test apps/merchant-web/src/domain.test.mjs` initially produced **4 failing assertions** for missing money, environment guard, safe error copy and legal-action behavior; implemented domain behavior and reran **4/4 passing**.
2. `pnpm --filter @restaurant/merchant-web test` uncertain network-result regression first produced **4 pass / 1 fail**, then **5/5 passing**. Cashier preserves original quote/key on NETWORK/TIMEOUT/UNKNOWN, locks edits, and retries the same request. Explicit rejection clears quote for recalculation. A created order remains the cash retry target.
3. Coordinator found CMS initially marked untouched content dirty because PostgreSQL JSON key order differed. New regression first produced **5 pass / 1 fail**, then stable four-field equality fixed the issue.
4. Latest `pnpm --filter @restaurant/merchant-web test`: **6 tests, 6 pass, 0 fail**.
5. Latest `pnpm --filter @restaurant/merchant-web build`: **exit 0**, `vue-tsc --noEmit` then Vite 6.4.1; 1586 transformed modules; assets 25.08 kB CSS and 149.70 kB JS (51.92 kB gzip).
6. Source formatted using `pnpm dlx prettier@3.6.2 --write 'apps/merchant-web/src/**/*.{vue,ts,mjs,css}' apps/merchant-web/package.json apps/merchant-web/tsconfig.json apps/merchant-web/vite.config.ts apps/merchant-web/index.html`.

## Coordinator real browser and database evidence

These checks were performed by the root coordinator against the real local database, not against mocks:

- Owner login, real dashboard and navigation rendered; screenshot `output/playwright/merchant-dashboard.png`.
- Created `验收菜品·桂花鸡腿饭` through the UI at 29.80 yuan, available stock 12.
- Edited SKU through the UI to 30.80 yuan and stock 15; reloaded and verified persistence.
- Selected this product from the real cashier catalog, obtained quote, created order, entered 50.00 cash and received 19.20 change.
- Accepted the paid order, marked ready, completed; reloaded dashboard and inventory.
- SQL confirmed SKU price **3080 fen**, stock **14**, reserved **0**; order **COMPLETED / PAID**, total **3080**, tendered **5000**, change **1920**; dashboard revenue **30.80 yuan**.
- Tables rendered actual table 01; member list showed masked `138****0000`; actual authorized staff list rendered.
- Store notice saved through UI and survived reload.

## Limits and operational notes

- Real merchant production authentication is absent in the backend. UI explicitly states formal login is unavailable outside development; it does not reuse a development role selector as production login.
- WeChat payment, refunds, delivery service, devices and real external mini-program integration are not verified and are not claimed complete.
- Member/staff management is API-supported querying only. Tables are read-only because no mutation API exists. CMS is structured content editing, not full drag-and-drop decoration.
- Cashier recovery is now persisted in sessionStorage per employee and store, including original quote/order/key/uncertainty/submitted amount. Active or uncertain writes disable app navigation/store/logout/header refresh and install browser unload protection. Browser reload restores the pending store and cashier; retry reuses the same order/key and frozen submitted amount. Recovery lasts for the current browser session, not across browsers or cleared browser storage.
- Client role controls improve usability; all actual authorization decisions remain server-enforced. Cross-store permission and remaining mobile/network/CMS browser checks are being completed by coordinator separately.
- No commit was made by the implementation agent. Root package/lockfile ownership remained with coordinator.

## Independent review corrections — 2026-10-20

The coordinator requested all five identified corrections. The implementation agent addressed them without modifying backend ownership:

1. **P2 frozen tender / actual receipt.** `submittedCash` freezes the first cash amount before financial writes. The amount input is disabled during processing and once submission begins. Retry reuses the frozen amount, regardless of later input changes. Confirmed receipt rendering uses only server `Order.cashReceipt`; missing receipt triggers authorized GET order before confirmation, and no guessed receipt is shown. Root coordinator is adding the matching actual-database `cashReceipt` read field.
2. **P2 recoverable state / departure protection.** `src/recovery.mjs` persists the original cart/quote/key/order/uncertainty/submitted cash scoped by authenticated employee and store. Writes are persisted before sending. `src/checkoutGuard.ts` blocks navigation, store changes, logout and header remount while a write is active or outcome is uncertain. Browser unload protection is installed, and reload login restores the pending cashier/store from its scoped recovery record. Confirmed-but-unpaid orders remain recoverable on return.
3. **P3 blank details after cash.** Orders cash success now clears both selection and the cash-dialog state, rather than opening a blank details dialog.
4. **P3 dashboard amount label.** Recent-order amount is labeled `订单金额`, which is accurate for unpaid orders too.
5. **390px login/error overflow.** Grid children and main containers have `min-width:0`/`max-width:100%`; login form width is bounded; error content wraps and permits flex shrink. Root browser responsive retest pending at this revision.

Regression evidence:

- New `src/recovery.test.mjs`: initial `pnpm --filter @restaurant/merchant-web test` produced **10 tests / 6 pass / 4 fail**, demonstrating missing refresh recovery, frozen tender/actual server receipt, dialog reset and employee/store isolation. Repeated RED after making the last assertion optional-safe still produced **6 pass / 4 fail** (assertions, not module errors).
- Implemented recovery, tender freeze, receipt source and dialog behavior; latest exact test summary: **tests 10, suites 0, pass 10, fail 0, cancelled 0, skipped 0, todo 0**.
- Latest `pnpm --filter @restaurant/merchant-web build`: **exit 0**, Vue typecheck and Vite build, **1588 modules**, CSS **25.40 kB** (gzip **6.41 kB**), JS **153.06 kB** (gzip **53.01 kB**).
- Formatted only owned frontend source using `pnpm dlx prettier@3.6.2 --write 'apps/merchant-web/src/**/*.{vue,ts,mjs,css}'`.

Self-review: no mutable input drives a confirmed receipt; cashier state is saved before requests; app departure controls share the same guard; refresh selects a recovery store only when it belongs to the authenticated employee; receipt missing/error is explicit; no production login or external integration is claimed verified. Root-coordinated actual mobile, delayed/lost response, refresh recovery and API receipt regression runs remain to be recorded separately.

## Second recovery review — 2026-10-20

Coordinator reported that actual browser lost-receipt/reload recovery, clerk authorization, mobile layout and offline/recovery checks passed after the prior correction. Two further recovery edge cases were then reproduced in state-transition tests and fixed:

- **Expired quote / frozen cash:** `src/checkoutTransitions.mjs` is the state reducer used directly by the cashier. A `SUBMIT` event validates quote freshness and amount before setting `submittedFen`. Expiry clears the quote and unsubmitted amount. `CART_CHANGED` and `QUOTE_RECEIVED` invalidate unsubmitted cash only when no submitted/uncertain order exists. The regression goes through expired 30-yuan quote → rejection without freezing 50 yuan → changed cart → fresh 60-yuan quote → successful 70-yuan tender freeze.
- **Terminal order / safe next sale:** After a definitive cash rejection, the cashier re-queries the authorized order. `PAID` requires the actual server receipt and displays confirmation; `CANCELLED` / `CLOSED` becomes a terminal recovery screen offering `开始下一单`. Pending unpaid orders retain their original target for retry. Failed reconciliation retains uncertainty, original key/order and departure guard. Restored unpaid orders are reconciled on mount, so a cancellation performed through Orders is recognized when returning to Cashier.
- Tests cover real state-event sequences, preserving uncertain creation retries even after quote expiry, actual paid receipt reconciliation, failed-query recovery retention and closed-order release. No unsafe reset is offered while payment status is unknown.

Commands and outputs:

1. New `src/checkoutTransitions.test.mjs` with placeholder reducer, `pnpm --filter @restaurant/merchant-web test`: **tests 14 / pass 11 / fail 3**, expected failures on expiry, terminal close and paid-result reconciliation. Existing uncertain-key behavior remained passing.
2. Implemented reducer and connected it to Cashier event handling; latest `pnpm --filter @restaurant/merchant-web test`: **tests 14 / suites 0 / pass 14 / fail 0 / cancelled 0 / skipped 0 / todo 0**.
3. Latest `pnpm --filter @restaurant/merchant-web build`: **exit 0**, Vue typecheck followed by Vite production build; **1589 modules**, CSS **25.40 kB** (gzip **6.41 kB**), JS **155.23 kB** (gzip **53.68 kB**).
4. Formatted only changed sources with `pnpm dlx prettier@3.6.2 --write apps/merchant-web/src/checkoutTransitions.mjs apps/merchant-web/src/checkoutTransitions.test.mjs apps/merchant-web/src/Cashier.vue`.

Self-review gate: cash is frozen after validation and before the first write; receipt and terminal recovery require authorized server evidence; unresolved queries do not release the protection; original order/key survive refresh; next-sale action appears only after paid confirmation or confirmed closure. Coordinator actual-browser expiry/terminal edge checks and final re-review remain pending at this revision. No commit made.
