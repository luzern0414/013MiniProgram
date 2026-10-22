# Pickup capacity API — Task 1 report

Status: DONE (API implementation and isolated validation; independent review, source migration and UI acceptance remain with coordinator).

Dispatch base: cd28444 on codex/restaurant; coordinator documentation commit b23dddc arrived during work. Sole requirements source: .superpowers/sdd/pickup-api-brief.md. Existing product-options report and actual order locking/settlement code were read. Applied test-driven-development, systematic-debugging for observed failures, and verification-before-completion. No overall requirement or production acceptance is marked complete here.

## Implementation and changed files

- apps/api/prisma/schema.prisma and migrations/202610200008_pickup_capacity/migration.sql: PickupPolicy, PickupSlot, PickupReservation, PickupSequence; nullable order service date/ordinal/window, unique store/date/ordinal. SQL checks enforce policy bounds, fixed timezone, positive capacity, nonnegative version/counts, committed count <= capacity, valid increasing same-local-day duration and reservation states. All new FK deletion policies are Restrict in SQL and Prisma.
- apps/api/prisma/seed.ts: explicit seed creates new store and closed policy together through a nested Prisma create. An explicit policy upsert covers old seed stores without changing existing policy configuration. GET never initializes data. No new store API was invented.
- apps/api/src/modules/pickup/pickup.validation.ts: exact local dates, timezone-required ISO instants, interval/batch/range/capacity validation, Shanghai service date, lead and horizon rules.
- apps/api/src/modules/pickup/pickup-capacity.ts: quote version/window snapshot, capacity CAS hold, HELD confirmation/release and per-store/day monotonic sequence. Shared settlement logic is called after existing modifier/SKU writers, preserving their stable lock order.
- apps/api/src/modules/pickup/pickup.service.ts and pickup.controller.ts: authorized policy/slot reads and writes, current owner/store recheck inside Serializable transaction, config revision/audit, overlap predicate reads in same Serializable transaction, filtered public availability, pickup route.
- apps/api/src/modules/orders/orders.service.ts and apps/api/src/app.module.ts: quote input/snapshot, transactional inventory+capacity+sequence+order creation, reservation lifecycle through shared inventory settlement, registration, and verified pickup using the same order transition transaction. Generic fulfillment compatibility remains.
- apps/api/tests/pickup-capacity.test.ts and pickup-runner.cjs: isolated real HTTP/SQL, precise date boundaries, unsafe module guard, migration preservation, actual collision sentinel tests. PICKUP_TEST_BUILD=true executes the HTTP suite against dist classes.
- docs/architecture/api-contract.md and this report: exact request/response/error/compatibility contract and evidence.

No README/config/requirements/progress/research/acceptance files or old review diffs are part of this task's commit.

## Interfaces

All endpoints retain the data/error envelope and requestId; all new input/query objects reject unknown fields.

- GET /merchant/pickup-policy?storeId=... -> 200 {storeId,enabled,revision,timezone,leadMinutes,maxAdvanceDays}; valid local OWNER/CLERK.
- PUT /merchant/pickup-policy {storeId,expectedRevision,enabled,leadMinutes,maxAdvanceDays} -> 200 policy; valid local OWNER, revision CAS and audit. Missing policy GET is 409 PICKUP_CONFIGURATION_MISSING; expectedRevision=0 PUT explicitly initializes it, returning revision 1. Public list remains empty and instant pickup remains independent of missing policy.
- GET /merchant/pickup-slots?storeId=...&from=YYYY-MM-DD&to=YYYY-MM-DD -> 200 full merchant slots, inclusive date bounds up to31 days, sorted startsAt/id; valid local OWNER/CLERK.
- POST /merchant/pickup-slots {storeId,slots:[{startsAt,endsAt,capacity}]} -> 201 created slots; local OWNER, 1–96 slots, one transaction, same-local-day 5–240-minute intervals, 1–1000 orders capacity. Adjacent allowed; overlapping batches or existing slots rejected, including disabled records. Existing-overlap and concurrent config conflict 409 STATE_CONFLICT.
- PATCH /merchant/pickup-slots/:id {storeId,expectedRevision,enabled,capacity} -> 200 slot; local OWNER; stale revision or capacity below held+confirmed gives409 STATE_CONFLICT. No time edit or delete route exists.
- GET /stores/:storeId/pickup-slots?date=YYYY-MM-DD -> 200 [{id,startsAt,endsAt,timezone,remaining}]; PublicBrand store check first, no order/customer information. Closed/missing-policy/closed-policy/disabled/time-ineligible/full slots are omitted. No read side effects.
- POST /quotes additionally accepts pickupSlotId?:string, only PICKUP. Public snapshot includes pickupWindow:{slotId,startsAt,endsAt,timezone,serviceDate}|null. Internal quote carries known version marker and slot/policy revisions. Unknown legacy booking format is instant pickup; no history is rewritten.
- Order views additionally expose pickupServiceDate, pickupOrdinal and immutable pickupWindow. New PICKUP numbers are Q0001 etc, at least4 digits, per store and Shanghai fulfillment day, cancellation never reuses a number. Instant pickup uses creation date; reservation uses slot start date. DINE_IN is preserved; DELIVERY remains unconfigured.
- POST /merchant/orders/:id/pickup {storeId,pickupNumber} -> 201 order; local valid OWNER/CLERK, paid READY PICKUP only, wrong current number400 VALIDATION_ERROR, wrong state409 STATE_CONFLICT, cross-store403. Repeating a correct completed pickup returns its order without duplicate COMPLETE event/audit. Existing generic transition API and legacy10-digit hex pickup numbers remain usable.
- New booking errors:409 PICKUP_SLOT_FULL, PICKUP_RULES_CHANGED, PICKUP_TIME_UNAVAILABLE; invalid parameters400 VALIDATION_ERROR; cross-store403 FORBIDDEN. Payment/refund availability is unchanged. Client writes with unknown outcomes must be reread, not blindly retried.

## RED evidence

Before production/schema changes, command:

```text
node apps/api/tests/pickup-runner.cjs
Datasource: restaurant_dev, schema test_pickup_e4922843b2f2
7 migrations found; migrations001–007 applied to new schema
✖ pickup policy endpoint returns explicitly initialized policy
AssertionError: missing pickup-policy endpoint is the expected RED
404 !== 200
tests1 pass0 fail1; Exit1
```

The isolated fixture ran real seed/login/HTTP and removed only its successfully-created schema after OID/owner check. This was the intended missing-endpoint RED, not a compiler/fixture error.

## GREEN and regression evidence

```text
node apps/api/tests/pickup-runner.cjs
schema test_pickup_bc0ddcaab543; migrations001–008 applied
✔ pickup HTTP capacity, sequence, lifecycle, rules and permissions are database-backed
✔ pickup dates, timezone, lead and horizon boundaries are exact
✔ module rejects unsafe schemas before connecting
✔ incremental migration preserves legacy data and initializes closed policy
✔ runner preserves collision sentinel
✔ migration fixture preserves collision sentinel
tests6 pass6 fail0 skipped0; exit0

$env:PICKUP_TEST_BUILD='true'; node apps/api/tests/pickup-runner.cjs
schema test_pickup_0b18d4ce6c3c; migrations001–008 applied
same6 tests passed; fail0 skipped0; exit0
```

Actual SQL evidence printed by source and built suites (generated id omitted):

```json
{"storeId":"experience-store-a","startsAt":"2026-10-22T04:00:00.000Z","endsAt":"2026-10-22T04:30:00.000Z","capacity":2,"heldCount":0,"confirmedCount":1,"enabled":true,"revision":2}
```

SQL inventory reserved sum was0 after all remaining unpaid fixtures were canceled; SKU and modifier sums both independently assert0. Before the last-slot race, quote SQL heldCount=0; two different quotes/orders return [201,409 PICKUP_SLOT_FULL], heldCount=1, SKU.reserved=1 and Modifier.reserved=1. Same-key replay returns the original id without increasing counts. Two cancellations leave reservation RELEASED and counts/inventory0. Two cash submissions both return201 with one CashPayment, slot held1/confirmed1; duplicate expiry leaves held0/confirmed1. Completion leaves confirmed1. Config revision remains unchanged by capacity traffic.

Additional commands and observed results:

| Command | Result |
| --- | --- |
| pnpm --filter @restaurant/api test |9/9, exit0 |
| node .superpowers/sdd/catalog-runner.cjs |6/6, exit0 |
| node .superpowers/sdd/product-options-runner.cjs |10/10, exit0 |
| node .superpowers/sdd/catalog-regressions.mjs |staff3/3, bootstrap4/4, source HTTP1/1, exit0 |
| pnpm --filter @restaurant/api build |Prisma6.19 generate + tsc, exit0 |
| pnpm test:integration |dist HTTP R1 acceptance11/11, exit0 |
| pnpm --filter @restaurant/api exec tsc -p tsconfig.json --noEmit |exit0 |
| git diff --check -- apps/api docs/architecture/api-contract.md |exit0 |

The category/staff/source regressions used the existing guarded runner's newly-created database test_catalog_regression_f3257f5aef132838 (OID51368/owner10), removed after exact identity/connection checks. Built R1 used new test_acceptance_188aa822a554 and its existing runner cleanup. No test targeted development/public.

Observed intermediate failures were investigated and corrected:

- An expanded test selected the previously edited primary slot but supplied expectedRevision=0; the API correctly returned409. The fixture now selects an untouched adjacent slot before the stale-slot quote assertion. No production conflict rule was weakened.
- First build overlapped this task's own running Prisma test processes and failed Windows query_engine DLL rename with EPERM. After all those precise sessions completed, sequential build passed. The coordinator-owned API had already been stopped and explicitly permitted generate; no unrelated service was stopped.
- Prisma's existing package.json configuration deprecation warning remains unchanged.

## Assertions and migration protection

- Real simultaneous identical slot batches produce [201,409], with adjacency allowed and overlapping inputs rejected before any partial write. Last capacity race rolls back losing modifier/SKU writes and number allocation. Declining capacity below held+confirmed fails. Config close does not block existing cash/fulfillment/release.
- Policy and slot stale quotes return PICKUP_RULES_CHANGED. Exact lead boundary, lead minus1ms, Shanghai midnight, inclusive max-advance last date, first instant after horizon,31-day range, invalid calendar dates, malformed/absent timezone, coercions, unknown fields,5/240-minute limits, cross-date intervals and96-slot cap are covered. The HTTP temporal-ineligibility check moves an isolated persisted slot's time without changing config revision to simulate passage of time; create returns PICKUP_TIME_UNAVAILABLE with no hold.
- Sequence assertions include Q0001 then Q0002 after cancellation, per-day restart, same-day cross-store Q0001 and Q10000 without truncation. Number-only public lookup was not added. Wrong number, wrong state, wrong store, CLERK config write, customer config access, disabled owner and revoked owner grant are rejected.
- Existing10-character hex number displays and verifies through cash/ACCEPT/READY/pickup; saved lines and window remain unchanged. Policy-off and slot-off existing orders remain usable. Paid reject/cancel keeps real REFUND_UNAVAILABLE. Repeated successful pickup has exactly one COMPLETED event.
- Migration fixture creates test_pickup_migration_<random>, applies001–007, then inserts legacy store/product/SKU/modifier/quote/order/session/cash with nonzero available/reserved and old pickupNumber AABBCC1234. It snapshots every column of Store/Product/Sku/Modifier/Order/Quote/Session/CashPayment, applies008, and compares old columns deeply equal. New order fields are null, old number survives, policy is explicitly false/revision0/Shanghai/15/14. No backfilled reservation or fabricated window is created.
- Both runner and test module enforce isolation before DB work; module rejects development/public/absent DATABASE_URL before connection. Cleanup requires CREATE success plus unchanged OID/owner. Two actual collision tests monkeypatch random generation, keep an existing sentinel42 schema for both runner and nested migration fixture, observe failure and verify sentinel preserved. Only this-run-owned objects are dropped.
- Source development/public, retained restore_f51729f327fe53751420304915dec2ea and every backup were not migrated, reset, seeded, overwritten or deleted by this task. Coordinator owns source preservation baseline, reviewed migration, restart and UI/SQL acceptance.

## Self-review and limits

Self-review traced quote→inventory→capacity→sequence→order→reservation and cash/cancel/expiry/reject through the same Db.atomic Serializable full-callback retries. Normal holds/settlement do not increment config revisions. All fulfillment checks use current order/store identity and current transaction-authenticated role/grants. Existing order snapshots are never updated by policy/slot edits.

No blocking API concern found. Timezone is deliberately fixed Shanghai; no recurring templates, new store API, real refunds, WeChat payment/notification, production/domain or device acceptance was added. Slot time edits are intentionally absent from the stated PATCH contract; close/reopen/capacity are supported. Independent review and coordinator-run source migration are required next. This report is included in the implementation commit; final handoff supplies that commit id.
