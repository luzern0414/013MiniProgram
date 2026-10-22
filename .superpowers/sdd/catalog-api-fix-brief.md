# Catalog Task1 independent review fixes

Base: b667f2c; current branch includes coordinator documentation commit75b1663. Read only this brief and the affected implementation/report as necessary. Working directory D:/Codes/013MiniProgram. Single implementation agent; preserve others' files.

Independent reviewer found:

1. Important: `apps/api/tests/catalog-admin.test.ts` migration fixture derives `${schema}_migration`, but its finally unconditionally drops that name even if CREATE fails because it already exists. Protect cleanup with successful creation and namespace OID/current owner identity, following the safety of the outer runner. Add a real collision/sentinel child-process regression that first observes RED and then proves the pre-existing schema and sentinel remain after the failed fixture. Create and clean only objects this run owns; never delete the source development/public/retained restore database. Existing collision regression of the outer runner must remain valid.
2. Minor: `Product.unitDefinition` in `apps/api/prisma/schema.prisma` omits onDelete, so Prisma generates SET NULL while migration006 intentionally uses RESTRICT. Add explicit `onDelete: Restrict` to align model and actual migration. Check generated SQL with read-only `prisma migrate diff --from-empty --to-schema-datamodel ... --script`; do not alter migration006 or existing source data for a schema declaration correction.

Covering checks: `node .superpowers/sdd/catalog-runner.cjs` (now includes module guard, outer collision, nested migration collision, migration preservation and real API); Prisma read-only SQL diff; API tsc --noEmit; git diff --check. No unrelated full-suite rerun needed. Existing API3000 runs and locks Prisma DLL, so do not generate a client or stop service without notifying coordinator. No client shape changes are required by onDelete metadata.

Append a fix report to `docs/tasks/catalog-admin-report.md`: root cause, actual RED/GREEN, exact commands/results and cleanup outcomes. Commit only task fixes with `git -c user.name=Codex -c user.email=codex@local.invalid commit ...`; do not stage the coordinator review package. Return concise DONE/commit/tests/concerns. Keep working until fixes are reviewable.
