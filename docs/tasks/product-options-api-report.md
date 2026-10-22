# Product options API — Task 1 report

Status: DONE (implementation submitted for independent review; source development migration and UI acceptance remain with coordinator).

Base: bb2f88e23caffe96f7d52992a578dde23685b904 on codex/restaurant. Requirements: .superpowers/sdd/product-options-api-brief.md. Scope: API/schema/migration/tests/API contract only. No REQ-034/035/036 acceptance or whole-system completion claimed.

## Implementation

- Added migration 202610200007_product_options and matching Prisma models: stable specification group/value and attribute group/option identities, SKU selections, nullable unique product/combination key, enabled flags and product configuration revision. Every new FK deletion policy is Restrict in SQL and Prisma; selection value/group membership also has a composite FK. Existing rows are not rewritten, deduplicated or truncated.
- Added focused product-options controller, service and validation module. Full-tree ownership/retention checks and all validation precede writes. Generated IDs and clientKey resolution remain server-side. Disabled identities survive. Modifier then SKU updates use ordered IDs, matching existing order inventory writers; derived keys are cleared within the transaction before valid combination swaps are written. Existing stock/reserved are never assigned during configuration save.
- OWNER/store authorization is re-read inside Serializable transactions. Revision CAS, all configuration writes and before/after audit commit together. New item initialStock is the only configuration stock input. Modifier inventory CAS preserves reservations and checks available+reserved bounds. SKU price changes increment the parent revision atomically; stock-only writes do not.
- Catalog exposes selectable public nodes and available quantities; merchant reads include disabled records. Quotes validate required/optional attributes, ownership, duplicates and min/max limits, save names/options/revision, and reject disabled SKU/modifiers. Order creation rechecks configuration and selection rules; old lines missing revision are interpreted as revision 0. Existing order snapshot/payment/fulfillment/release paths remain intact.

## HTTP contract

All responses retain the established data/error envelope and requestId.

- GET /merchant/products/:productId/options?storeId=... and PUT /merchant/products/:productId/options return `{productId,configurationRevision,specGroups,skus,attributeGroups,modifiers}`. Both require current valid OWNER with this store grant (single-store OWNER is sufficient). Specification/attribute group/value/option fields match the brief. Merchant SKU/modifier rows include `{id,name,enabled,priceFen,available,reserved}`; SKU rows additionally include `selections:[{groupRef,valueRef}]`, both refs persisted IDs.
- PUT accepts exactly `{storeId,expectedRevision,specGroups,skus,attributeGroups,modifiers}` and the brief's nested whitelist. Existing nodes carry IDs, new nodes omit IDs; new specification groups/values may declare clientKey. No stock/available/reserved/computed key input. Only new SKU/modifiers accept optional initialStock (default 0).
- PATCH /merchant/modifiers/:id/inventory accepts `{storeId,expectedAvailable,available}` and returns `{id,available,reserved}`. No hard-delete route exists.
- Quote lines accept optional `attributeOptionIds` (omission=[]). Snapshot lines add `configurationRevision`, sorted `attributeOptionIds` and `attributes:[{groupId,groupName,options:[{id,name}]}]`. Attribute selection does not change price/stock; modifiers do.
- Codes: 400 VALIDATION_ERROR for unknown fields, incomplete/foreign/duplicate nodes, invalid refs/combinations/limits, illegal stock input, invalid attributes and disabled new selections; 409 STATE_CONFLICT for stale configuration/inventory CAS; 409 PRODUCT_OPTIONS_CHANGED for changed configuration or disabled selections at order creation; existing PRICE_CHANGED/CATALOG_CHANGED/OUT_OF_STOCK remain effective. Authentication 401, authorization 403. See docs/architecture/api-contract.md for exact shapes and limits.

## RED / GREEN evidence

1. Before schema or implementation changes: `node .superpowers/sdd/product-options-runner.cjs` exited 1, **0/1 passed**. The real seeded PostgreSQL/HTTP test expected GET options 200 and received **404**. Its owned random schema was removed safely. This was the intended missing-endpoint RED.
2. First expanded run reached **3/4**, revealing a test fixture requesting a modifier quote after its last unit had been cash-settled. The fixture now explicitly replenishes through the new inventory CAS before the disabled-quote checks; no production logic workaround was made. Subsequent runs passed.
3. Final `node .superpowers/sdd/product-options-runner.cjs` exited 0, **10/10 passed**, no skips. Includes five focused domain cases, unsafe-schema module guard, two real collision/sentinel tests, incremental migration preservation and complete real HTTP/inventory behavior.
4. `pnpm --filter @restaurant/api test`: **9/9**, exit 0.
5. `node .superpowers/sdd/catalog-runner.cjs`: **6/6**, exit 0.
6. `node .superpowers/sdd/catalog-regressions.mjs`: **staff 3/3, bootstrap 4/4, source integration 1/1**, exit 0. Each source HTTP suite used the safe existing runner's newly-created random database and isolated schema; its owned OID/owner were verified and database removed. No DATABASE_URL was overridden to development/public.
7. `pnpm --filter @restaurant/api build`: exit 0 (Prisma generate + TypeScript). Coordinator stopped its verified API process before the first generate and kept source migration reserved for review.
8. After build, `pnpm test:integration`: **11/11**, exit 0, using built API and random test_acceptance_* schema; owned acceptance schema removed.
9. `pnpm --filter @restaurant/api exec tsc -p tsconfig.json --noEmit`: exit 0.
10. `git diff --check`: exit 0. Existing Prisma package.json configuration deprecation notice remains; no dependency/config change was needed.

## Covering assertions

- Two real simultaneous same-revision PUTs produce `[200,409]`; only committed saves advance revision/audit.
- Full-tree missing existing group/value/SKU/attribute group/option/modifier, duplicate IDs, foreign IDs, wrong-parent refs, invalid clientKeys, unknown fields, coercions, duplicate combinations, disabled required values and every stated node-count cap are rejected. Disabled-dimension combination merging is rejected; duplicate disabled SKU identity can remain.
- Missing/too many/duplicate/cross-product/disabled attribute options fail; omitted optional input becomes []. Required old-client omission is rejected. HTTP response includes name snapshots and revision.
- Legacy snapshot with its revision removed successfully creates an order before configuration editing. Configuration edit, attribute rename, actual SKU price change and SKU/modifier disable invalidate old quotes with PRODUCT_OPTIONS_CHANGED. Stock-only SKU and modifier inventory changes leave quotes usable.
- Same expectedAvailable inventory races produce `[200,409]`; competing orders for last modifier produce `[201,409]`, reserved=1. Overflow available+reserved is rejected.
- Configuration save retains original SKU and modifier stock/reserved, including existing order holds. New inventory uses initialStock; existing initialStock is rejected. Unpaid orders involving disabled SKU/modifier can cancel and restore inventory; expiry restores modifier stock/reserved exactly once.
- Cash settlement and ACCEPT→READY→COMPLETE remain usable after disabling configuration. Saved paid-order JSON lines remain deeply equal. No DELETE endpoint exists.
- CLERK/CUSTOMER access, wrong store, disabled owner and revoked store grant are rejected; a valid single-store OWNER can read. Audits retain before/after product identities.

## Preservation and isolation

- The migration fixture creates a fresh test_product_options_migration_* schema, applies migrations 001–006, inserts **22 same-named legacy SKUs and 21 modifiers** with nonzero available/reserved, plus product, quote, order and session. After 007, all prior columns of Product/Sku/Modifier/Order/Quote/Session compare deeply equal; every old SKU/Modifier is enabled, old SKU combinationKey is null, product revision is 0. Oversized records are preserved; full-tree edit caps return an explicit adjustment message rather than truncating records.
- Every product-options DB test module validates `test_product_options_*` at module load before DB work. Runner/migration fixtures set `created` only after successful CREATE and capture OID/owner; cleanup only removes this-run-created objects with the exact same identity. Actual name collisions preserve existing sentinel=42 for both runner and nested migration fixture. Unsafe development/public/missing schema subprocesses fail before connection.
- All local DB operations targeted newly-owned test objects. No reset, source migration, development/public cleanup or retained restore database write occurred. The coordinator owns source-table baseline comparison, reviewed source migration, restart and UI acceptance.

## Remaining scope / concerns

No blocking API concern found. Over-limit legacy trees are readable and rejected by new edit limits as specified; stored identities are never silently removed to fit caps. Brand templates/import, UI flows, genuine WeChat/payment resources and production acceptance are outside Task 1. Independent review is required before applying migration to development; this report does not mark any overall requirement verified.
