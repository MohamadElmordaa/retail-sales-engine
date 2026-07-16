# Current Feature

Prisma + Neon PostgreSQL Setup

## Status

<!-- Not Started|In Progress|Completed -->

Completed

## Goals

<!-- Goals & requirements -->

- Set up Prisma ORM against Neon PostgreSQL (serverless, free tier).
- Create the initial schema from the data model in `project-overview.md` (§4).
- Two connection strings: pooled `DATABASE_URL` (runtime) + `DIRECT_URL` (migrate/seed).
- Migration-driven only — no `prisma db push`. Add raw-SQL constraints Prisma can't express
  (partial unique index on `external_ref`, CHECK constraints, covering index).
- Idempotent `prisma/seed.ts` with reference + demo data.
- `.env` gitignored, `.env.example` committed with placeholders.

## Notes

<!-- Any extra notes -->

- `database-spec.md` conflicted with `project-overview.md` (the source of truth). Resolved
  with the user: **Prisma 7** (per spec) and **skip NextAuth/auth models** (auth is out of
  scope per overview). Result: the 9 retail models only.
- Prisma 7 required Node ≥ 20.19/22.12/24. Installed Node 22 LTS via nvm and pinned it in
  `.nvmrc` (was on 20.17).
- Prisma 7 specifics: config lives in `prisma.config.ts` (not schema); generator is
  `prisma-client` (output `src/generated/prisma`, `moduleFormat = "cjs"` for NestJS); a
  driver adapter is required — we use `@prisma/adapter-pg` (plain TCP), **not** any
  Neon-branded package, so Neon stays a swappable deployment detail.
- CLI (`prisma.config.ts` `datasource.url`) uses `DIRECT_URL`; the app runtime uses pooled
  `DATABASE_URL` via the pg adapter in `src/prisma/prisma.service.ts`.
- Benign runtime warning from `pg` v8: `sslmode=require` is treated as `verify-full` and the
  alias behavior changes in pg v9. Harmless now; revisit on the pg v9 upgrade.

## History

<!-- Keep this updated. Earliest to latest -->

- Project setup and boilerplate cleanup
- Started Prisma + Neon PostgreSQL setup; flagged spec/overview conflicts for resolution
- Resolved conflicts (Prisma 7, no auth models); installed Node 22 + Prisma 7 stack
- Wrote schema (9 models), `prisma.config.ts`, `PrismaService`/`PrismaModule`, seed
- Applied initial migration to Neon (with hand-added CHECKs, partial-unique + covering
  indexes, currency reference data); seeded demo data; verified app boots and connects
