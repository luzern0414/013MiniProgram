# Customer addresses API Task1 report

Implemented the additive address-book API, Prisma models, migration `202610210013_customer_addresses`, isolated HTTP tests and API contract documentation.

The first RED run used `node apps/api/tests/run-customer-addresses.cjs` against an owned `test_customer_addresses_*` schema. Before implementation, the focused GET assertion failed with `404 !== 200`, proving the route was absent. GREEN verification then covered empty-book reads, create/replay, CAS conflicts, default races, soft deletion, capacity, ownership and brand isolation, staff rejection, strict fields/coordinates/timestamps, operation-trigger rollback, version limits, and transaction authorization rechecks.

Fresh targeted results:

- `node apps/api/tests/run-customer-addresses.cjs --test-name-pattern '^HTTP strict whitelist'`: 1 pass, 0 fail.
- `node apps/api/tests/run-customer-addresses.cjs --test-name-pattern '^HTTP operation-log'`: 1 pass, 0 fail.
- `node apps/api/tests/run-customer-addresses.cjs --test-name-pattern '^HTTP transaction'`: 1 pass, 0 fail.
- `pnpm --filter @restaurant/api exec tsc -p tsconfig.json --noEmit`: exit 0.
- Reviewer follow-up: `text()` now rejects the full Unicode `Cc` category, including C1 controls U+0085 and U+009F; the strict isolated test covers both cases.

The migration only creates the three address tables, checks, indexes and RESTRICT foreign keys. It does not alter existing business rows or historical order snapshots. Tests use only disposable, ownership-checked schemas and never seed or reset the source schema.

Known scope: delivery ordering, map search/reverse geocoding and customer UI recovery flows remain outside this API task. Source production migration and API restart remain root-gated.
