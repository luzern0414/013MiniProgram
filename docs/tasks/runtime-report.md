# Runtime implementation report

Status: implemented and run locally; application core still in progress.

- Root pnpm workspace, scripts, TypeScript baseline, environment examples, .gitattributes and ignore rules created.
- PostgreSQL16.14 native binaries installed via embedded-postgres package; helper uses project-owned data/postgres, fixed local-only credentials, port55432, listen127.0.0.1. Does not install global services or modify sibling projects.
- Startup uses initdb and pg_ctl; password file removed after init. Ownership marker checked on existing cluster; stop checks exact workspace marker. Production NODE_ENV rejects helper.
- Real database test initially failed because scripts/db.mjs missing; after implementation ran node --test tests/runtime/database.test.mjs, 1 passed 0 failed. It connects using pg, writes within BEGIN and rolls back, count0. Verified database version PostgreSQL16.14.
- Explicit db:stop and db:start both ran successfully; data retained. Discovered Windows inherited stdout handles could keep pg_ctl wrapper alive, closed child streams on exit; re-ran db:start and test successfully.
- No app verification, production deployment or external integrations claimed.
- Git commits e062401 research/design baseline; 59364b7 runtime commit; subsequent scripts/db.mjs stream closure may be in working tree, review package includes current file.

## Ownership review fix (2026-10-20)

- Closed the independent review's ownership gap: both start and verify now use a checked connection. The exact workspace ownership marker is required before connecting; before any SQL writes the helper queries SHOW data_directory, compares its canonical filesystem realpath with this project's data/postgres, and requires SHOW server_version_num major 16. Rejected connections are closed. Importing the helper no longer runs the CLI.
- Added unit coverage for a foreign server directory, a non-16 server, missing and foreign markers, and matching canonical paths through a directory junction. Rejection tests permit only read-only SHOW queries and never connect to or write to a foreign database. The real database integration assertion now requires PostgreSQL 16 output; production start, stop and verify rejection are covered.
- Added root pnpm test:runtime; lockfile unchanged by this fix.
- Test-first evidence: node --test tests/runtime/ownership.test.mjs initially failed 6/6 because the ownership helper was absent; after implementation passed 6/6.
- Verification: pnpm db:start exited 0 against the existing project cluster; pnpm test:runtime passed 10 tests, 0 failed, including a real PostgreSQL16 BEGIN/INSERT/ROLLBACK transaction. pnpm db:verify exited 0, reported PostgreSQL16.14 and rollback verified.
- No commit, application changes, foreign database writes, or production deployment performed by this fix.

