# Cash shifts Task 1 API report

Scope: API, financial attribution, additive migration 012 and isolated verification only. This does not mark UI, source migration, real devices, WeChat, other tenders, accounts receivable or full REQ-090 accepted. The root coordinator owns source API control, source backup/restore/migration and browser acceptance. Branch: `codex/restaurant`; implementation started from the dispatched `6e6bc5f` baseline, while root documentation commits continued independently.

## Implemented

- Separate finance controller/service/validation/ledger implement the five fixed endpoints. Store-scoped OWNER opens/closes; effective same-store OWNER/CLERK read; writes reauthorize inside Serializable transactions. Strict query/body whitelists, scalar identifiers/keys, money/revision bounds, trim-before-length reason validation, database filtering/pagination/counting and sanitized ShiftView are documented in `docs/architecture/api-contract.md`.
- Opening and closing keys are scoped by store, hashes bind normalized input and actor. Authorization precedes replay. Open replay returns the original shift's current facts even after closure; close replay checks the original key before state/version. Same key with changed input conflicts; two devices cannot open two active shifts or close twice. Opening/closing audits are atomic and occur once.
- The ledger module locks the current/specified shift before new financial/stock writes. Cash payment and refund both use shift → financial/inventory lock order. Existing authorized financial replay precedes requiring an active shift. New receipt, revision increment, safe aggregate validation, order/payment state, event and audit share the original full transaction. Raw lock P2010 is translated only for actual SQLSTATE 40001/40P01 to existing bounded Db.atomic retry; other errors propagate.
- CashShift opening and snapshot amounts/counts use BIGINT. SQL SUM(Int)/COUNT remain BIGINT until explicit JS safe-integer conversion. Expected cash is opening + payment.amountFen − refund.amountFen, with negative values allowed. Tendered/change are not counted again. Revision has an explicit 2,000,000,000 ceiling; reaching numeric limits fails and rolls back. Closure records counted/difference/reason and fixed totals without financial adjustments.
- Migration `202610210012_cash_shifts` adds CashShift with Store/User RESTRICT relations, one-OPEN-per-store partial UNIQUE, opening/closing keys, consistent OPEN/CLOSED snapshot CHECKs, revision/money bounds and indexes. CashPayment/CashRefund only gain nullable shiftId/FK RESTRICT/indexes. No historical row, original column, time default or receipt attribution is rewritten. New shift timestamp default is explicit UTC.
- Root requested the minimal compatible read facts `Order.cashReceipt.shiftId:string|null` and `Order.cashRefunds[].shiftId:string|null`. All order responses use the shared include/view. Existing nulls remain null, refunds use their actual occurrence shift and never inherit the original payment shift. Response-key regression assertions were updated to retain the existing fields and add only shiftId.
- Original cash/refund/options/pickup/deadline/draft fixtures explicitly open a real shift through the API. Their previous inventory, permissions, idempotency, capacity and concurrency assertions remain. Pickup's earlier lifecycle legacy number now uses ABCDEF5678 so it cannot contaminate the independent fixed-date ABCDEF1234 lookup fixture when Shanghai's current date happens to be 2026-10-21; all 104-collision lookup assertions remain exact.

## TDD evidence and investigated failures

1. Before production/schema changes, `node apps/api/tests/run-cash-shifts.cjs` exited 1, 0/2 passed in a newly owned random schema. The first HTTP assertion printed `cash shifts RED missing payment status= 201`, expected 409/SHIFT_REQUIRED. The missing shift endpoint also failed the second test. This is the primary feature RED.
2. Nullable attribution test was run before adding return fields: `node apps/api/tests/run-cash-shifts.cjs --test-name-pattern='cash receipts expose'` failed with `undefined` versus the actual shift ID. A preceding fixture setup mismatch (seed total6200 instead of required6160) was corrected only in the isolated fixture by setting SKU price2780; the subsequent failure was the intended missing response field. Then minimal select/view additions made it pass.
3. `--test-name-pattern='trimmed reason'` failed 400 versus201 for 500 meaningful characters plus outer spaces. Investigation located raw string length validation before trim. Validation now trims first; the same request and canonical replay pass.
4. A synthetic aggregate HTTP attempt widened isolated receipt Int columns to BIGINT and encountered Prisma's expected scalar-type incompatibility (500). It was an invalid HTTP fixture technique, not used as production evidence. The corrected test keeps HTTP at the valid existing ledger boundary and uses real SQL plus the production ledger helper inside Db.atomic for the boundary-crossing write. Before the fix it failed `Missing expected rejection`; after adding post-receipt safe aggregate validation in advanceShift it returns SHIFT_TOTAL_TOO_LARGE and rolls back both receipt and revision. Only isolated fixture columns are widened; production receipt columns are unchanged.
5. Self-review added cross-store close coverage. `--test-name-pattern='strict write/query'` reproduced404 versus the required403 because the scoped lookup masked an existing foreign-store shift as missing. lockShift now distinguishes missing from foreign-store records after the scoped lock and returns403 without a write. Its focused test passes.
6. Original pickup suite initially passed6/7: the lookup saw105 instead of104 because an earlier test's same legacy number had today's timestamp on the fixed lookup date. The isolated fixture-number correction above yielded7/7 without changing the query/asserted bounds or business implementation.

## Verification

Final specialty results: source17/17 and compiled17/17; original affected regressions56/56. All commands used new random owned test schemas; no source migration/seed/reset or source business writes occurred.

| Command | Actual result |
|---|---|
| `node apps/api/tests/run-cash-shifts.cjs` | 17/17, exit0, zero skips; final duration73.8s |
| `$env:CASH_SHIFTS_TEST_BUILD='true'; node apps/api/tests/run-cash-shifts.cjs` | 17/17, exit0, zero skips; final duration72.8s |
| `node apps/api/tests/cash-refunds-runner.cjs` | 10/10, exit0 |
| `node apps/api/tests/run-cashier-drafts.cjs` | 11/11, exit0 |
| `node .superpowers/sdd/product-options-runner.cjs` | 10/10, exit0 |
| `node apps/api/tests/pickup-runner.cjs` | 7/7, exit0 after fixture isolation correction |
| `node apps/api/tests/payment-deadline-runner.cjs` | 8/8, exit0 |
| `node apps/api/tests/cash-refunds-runner.cjs --regression` | Domain9/9 + original DB/HTTP integration1/1, exit0 |
| `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json` | exit0, compile only, no implicit generate |
| `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit` | exit0 |
| `git diff --check` | exit0 |

Existing refund audit-failure tests and the new shift audit-failure test intentionally produce sanitized INTERNAL_ERROR500 and server error logs; their assertions verify complete rollback. No unexpected application error is treated as passing. Prisma's optional update notice is not a dependency change.

Specialty evidence includes:

- No activity: new payment/refund409 with financial/stock/order/event/audit snapshots unchanged. Legacy null payment/refund replay201 without a current shift, no extra audit/revision; old null attribution stays null.
- Opening0/maximum, owner-only writes, clerk reads, customer/cross-store/cross-brand/corrupt membership/revoked/disabled identities, in-transaction revocation; strict unknown/coerced/array/range/query failures and sanitized actors/hidden-key fields.
- Concurrent same-key/different-key opening/closing, fixed audit counts, closed opening-key replay, conflicting close payload, stale revision409, real SQL partial uniqueness and key uniqueness.
- Isolated required example: paid6160, tendered7000, change840, opening100 → expected6260; refund1000 → expected5260. Closure revision3, immutable stored totals; authorized old payment/refund replay after closure; new refund in second shift yields negative expected cash and leaves first shift/payment ownership unchanged.
- Payment/close and refund/close HTTP competitions allow only a committed financial-first + stale close409 or close-first + SHIFT_REQUIRED. Closed summaries have exactly the receipt counts and no late ledger rows. Same-key retries do not add events/audits/revisions.
- Actual raw lock errors are asserted as `P2010/meta.code=40001` and `P2010/meta.code=40P01` using real competing PostgreSQL transactions. The mapped production helpers retry whole Db.atomic callbacks: serialization attempts2; two deadlock participants total3 attempts (1/2 or2/1). No mocked SQLSTATE or claim about untriggered paths.
- Version overflow payment/refund and close409 with full rollback, unsafe fixed count read409, signed safe-integer helper boundaries and real SQL aggregate boundary transaction rollback.
- A shift explicitly spans Shanghai midnight; daily overview uses receipt occurrence times at `[start,end)` (today's refund500, income0, net−500) while shift totals include all its explicit receipts. New shift and subsequent refund cannot alter the closed snapshot. Browser/system time is not changed.
- Opening and closing audit failures return500/INTERNAL_ERROR while the entire financial/shift/audit snapshot stays unchanged.

## Migration preservation and fixture ownership

The 012 fixture applies001–011 to a new random schema, inserts old order, quote, session, payment, partial refund, product, SKU/modifier inventory, audit and draft data with millisecond timestamps, and enumerates every original column of every pre-012 table. It compares ordered SQL `row_to_json(... )::text`, preserving original timestamp text rather than converting through JavaScript Date. Before/after SHA256 is exactly `108ded12bbac60f2f5de2fcec05d5b3175f685213ebcd01d8746e5b189acd944`. The two legacy receipt shiftIds are explicitly asserted null after migration.

Actual SQL verifies each new receipt shift FK, shift deletion RESTRICT independently for payments and refunds, one-open partial UNIQUE, opening-key uniqueness, actor/store FKs, invalid states/snapshot combinations, negative/oversized revision/initial/count amounts, negative counts, difference arithmetic/reason constraints and new shift default UTC (session Asia/Shanghai, measured deltaSeconds0). Old migrations remain untouched. Additional 010/011 regression preservation fixtures also pass with their own original-column hashes.

Runner and nested fixtures require the owned local project server/database and a `test_cash_shifts_*` schema before access; development/public/missing/wrong-server inputs fail at module load. Every created schema captures OID/owner and checks the project ownership marker plus exact identity before cleanup. The created flag is set only after successful CREATE; actual runner and nested CREATE collisions preserve a prior schema's sentinel42, OID and owner. HTTP cases use separate newly created owned schemas. All subprocesses inherit only the explicitly isolated test URL. Temporary function/trigger and synthetic widening exist solely inside the owned fixture schema.

Prisma generation was performed exactly once, after root reported it had verified/stopped its own source API PID and released port3000. The approved command `node apps/api/node_modules/prisma/build/index.js generate --schema apps/api/prisma/schema.prisma` exited0, Prisma6.19.0. Subsequent compilation used tsc directly. This agent neither stopped/restarted the source API nor applied012 to source. Root backup/restore, fresh source original-column/time comparison, reviewed incremental migration and source health remain required gates.

## Files and self-review

Changed only API schema/012, app.module.ts, orders.service.ts, cash-refunds.service.ts, the four new finance files, new specialty test/runner/ownership guard, six necessary original HTTP fixtures, API contract and this report. No root README/config/requirements/acceptance files or the two unrelated old catalog review diffs were staged.

Self-review checked fixed contracts, null-history semantics, auth before replay and inside writes, same shift-first locking in both financial paths, raw SQLSTATE scope, bigint serialization, close-key precedence, no double change subtraction, complete audit rollback and migration-only additions. No blocking API concern remains. Live source deployment and UI/production/device acceptance are intentionally not claimed; multi-channel REQ-090 remains outside this cash-only task.
