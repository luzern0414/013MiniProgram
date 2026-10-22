# Restaurant R1 API

NestJS 11 + Prisma 6.19 + PostgreSQL. All business data comes from PostgreSQL.

Use the root `.env.example` settings, start the project-specific PostgreSQL runtime, then:

```powershell
pnpm --filter @restaurant/api db:migrate
$env:NODE_ENV='development'
$env:DEV_AUTH_ENABLED='true'
$env:DEV_SEED_ENABLED='true'
pnpm --filter @restaurant/api db:seed
pnpm --filter @restaurant/api dev
```

`DATABASE_URL` is mandatory. No fallback database or fake data is used. API defaults to `127.0.0.1:3000/api/v1`. `PORT` and `HOST` can override this. Environment variables must actually be loaded by the calling process; source does not auto-read an `.env` file.

Fixed developer account names are `customer`, `owner`, `clerk-a`, `clerk-b`. Login requires both a nonproduction environment and `DEV_AUTH_ENABLED=true`. Seed additionally requires `DEV_SEED_ENABLED=true`; both flags are forbidden at production startup. Session tokens use 256 bits of random entropy, are hashed in PostgreSQL, and expire after 12 hours. They are development identity sessions, not verified WeChat identities.

For multiple brands, configure `PUBLIC_BRAND_ID`; public catalog/stores/page requests refuse ambiguous configuration and never enumerate other brands. Production CORS uses a comma-separated `CORS_ORIGINS` allowlist. Production identity provisioning and external WeChat/payment/refunds/delivery are not integrated, so this is not a production launch.

```powershell
pnpm --filter @restaurant/api test
pnpm --filter @restaurant/api build
# Only an isolated test_* schema is accepted; test setup deletes that schema's business rows.
$env:DATABASE_URL='postgresql://restaurant_dev:restaurant_dev_local_only@127.0.0.1:55432/restaurant_dev?schema=test_api_r1'
pnpm --filter @restaurant/api db:migrate
pnpm --filter @restaurant/api test:integration
```

On Windows, stop the API before `build`/`prisma generate` because the running Prisma native engine locks its DLL. Use `start` after building. Migrations contain extra SQL constraints that Prisma schema alone cannot describe.

Quote life is five minutes. Creating an order reserves inventory; unpaid reservations are released by customer cancellation/employee rejection, while cash receipt consumes the reservation. Unpaid orders expire after 15 minutes. A startup sweep and a 30-second worker close them in idempotent serializable transactions and release inventory; each sweep handles up to 100 orders. Cash receipt refuses expired orders even before the next sweep. Prices and order lines are immutable snapshots. Totals, changes, stock and modifiers are server-side; order creation/cancellation/cash/transition use serializable transactions with bounded retry. Stock editing sets available stock while preserving held reservations. Currency is CNY integer fen; business-day overview is Asia/Shanghai.

Experience stores open dine-in and pickup only. Delivery quotes always reject with `INTEGRATION_UNAVAILABLE` until actual range and delivery services are implemented. Payment/refund external calls are deliberately unavailable; no HTTP success marks an order paid except an authorized employee's real cash-confirmation workflow. Products belong to a store in R1; reusable brand product templates and delivery range/provider integration remain outside this implementation.
