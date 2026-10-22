# Runtime task review requirements

Task 1 of docs/superpowers/plans/2026-10-20-restaurant-r1.md. Workspace scripts/config, isolated local PostgreSQL16 and real transaction verification. Runtime must never operate on another project's database or permit local helper in production. Start/stop persistent cluster; real SQL BEGIN/INSERT/ROLLBACK test; Git ignores data/secrets. Root pnpm-lock includes API dependencies coordinated with next task; app implementation itself is outside this task.

