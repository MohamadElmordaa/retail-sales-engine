# Coding Standards

Scope: NestJS + TypeScript + Prisma + PostgreSQL (Neon) backend. No UI, no auth.
See `docs/project-overview.md` for the data model and the `POST /sales` contract.

## TypeScript
- Strict mode enabled (`strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`)
- No `any` — use proper typing or `unknown` + a narrowing guard
- Define types for all DTOs, API responses, and service return values
- Use type inference where obvious, explicit types on public method signatures
- No non-null assertions (`!`) — if it can be null, handle it
- `import type { … }` for type-only imports

## Money — CRITICAL
**All monetary and FX values are `Prisma.Decimal`. Never `number`.**
- Postgres columns are `NUMERIC(14,4)` for money, `NUMERIC(18,8)` for FX rates
- **DO NOT** use `number`, `parseFloat`, `Number()`, `toFixed()`, or `*` / `+` on money.
  IEEE-754 cannot represent `0.10`; cents drift and receipts stop reconciling
- Arithmetic goes through `Decimal`: `.mul()`, `.add()`, `.sub()`, never operators
- Money crosses the API boundary as a **string**, both directions. A JSON number has already
  lost precision by the time class-validator sees it
- Validate with `@IsNumberString()` / `@IsDecimal()`, never `@IsNumber()`
- Round once, at the end, explicitly — never rely on implicit coercion

```ts
// NO
const lineTotal = unitPrice * quantity;

// YES
const lineTotal = new Prisma.Decimal(dto.unitPrice).mul(dto.quantity);
```

## FX — CRITICAL
- The rate applied at time of sale is **snapshotted** on `transactions` (`fx_rate`,
  `fx_rate_source`, `fx_captured_at`). It is never re-derived from a rate table at read time
- Base-currency amounts are computed **at write time** into `*_base` columns
- Reports sum `*_base` columns. **DO NOT** re-multiply by a current rate in a query
- All rate lookups go through `FxService.getRate()` — the single seam for a live provider later.
  No rate constants outside `src/fx/`

## NestJS
- One module per bounded concern. Modules export services, never repositories or Prisma
- **Controllers are thin**: parse → delegate → return. No Prisma calls, no math, no branching
  on business rules
- **Services own business logic** and the transaction boundary
- Constructor injection only. No service locators, no `new SomeService()`
- `PrismaService` is injected — never import a global client singleton
- Config via `@nestjs/config` + a validated schema. No bare `process.env` outside config
- Global `ValidationPipe` and `HttpExceptionFilter` registered in `main.ts`, not per-controller

## DTOs and Validation
- Every request body has a DTO class with class-validator decorators. No inline validation
- Global pipe config is mandatory:
  ```ts
  new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  ```
  `whitelist` strips unknown keys; `forbidNonWhitelisted` rejects them loudly — a typo'd
  field silently ignored is how bad sales data gets written
- Nested arrays need `@ValidateNested({ each: true })` + `@Type(() => LineItemDto)`, or
  the nested objects are validated as plain objects and every rule is skipped
- Validate shape at the edge; validate **business rules** in the service (currency supported,
  store exists). Don't fake a DB lookup inside a decorator
- Never reuse a Prisma model type as a DTO

## Database / Prisma
- Prisma for all database access. Raw SQL only for what Prisma can't express (partial
  indexes, `CHECK`s), and then only inside migrations
- **Always `prisma migrate dev` for schema changes — never `db push`.** `db push` leaves no
  artifact, so the schema history becomes unreproducible and un-reviewable
- `prisma migrate dev --create-only` first, hand-edit the SQL to add partial indexes,
  `CHECK` constraints, and `--` comments on non-obvious decisions, then apply
- Run `prisma migrate status` before committing to verify migrations are in sync
- Deployments run `prisma migrate deploy` before the app starts
- Never edit a migration that has been applied anywhere
- `url` = pooled Neon endpoint (`-pooler` host), `directUrl` = direct. Migrations and seeds
  use `directUrl` — DDL through PgBouncer fails with `prepared statement "s0" already exists`
- Multi-write operations run in `prisma.$transaction(async (tx) => …)` with
  `{ timeout: 15_000, maxWait: 5_000 }`. A half-written sale is a data-integrity bug
- **DO NOT `await` inside a loop.** Batch with `findMany({ where: { in: [...] } })` +
  `createMany`. Against Neon every round-trip crosses a WAN
- Return mapped DTOs from services. Never leak a Prisma model to the controller

## File Organization
- Modules: `src/[feature]/[feature].module.ts`
- Controllers: `src/[feature]/[feature].controller.ts`
- Services: `src/[feature]/[feature].service.ts`
- DTOs: `src/[feature]/dto/[verb-noun].dto.ts`
- Mappers: `src/[feature]/[thing]/[thing].mapper.ts`
- Shared: `src/common/{filters,pipes,decorators}/`
- Prisma: `src/prisma/prisma.service.ts`, schema + migrations in `prisma/`

## Naming
- Classes: PascalCase (`SalesService`, `CreateSaleDto`)
- Files: kebab-case matching the class (`create-sale.dto.ts`, `sales.service.ts`)
- Functions/methods: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Types/Interfaces: PascalCase, no `I` prefix
- Prisma models: PascalCase singular, `@@map` to snake_case plural tables
- Columns snake_case in SQL, camelCase in TS
- Migrations: `snake_case`, verb-first, intent-describing (`add_unmatched_barcode_scans`).
  Not `update`, not `fix`, not `migration2`

## Error Handling
- Uniform envelope from `HttpExceptionFilter`:
  ```jsonc
  { "error": { "code": "EMPTY_CART", "message": "…", "details": [] } }
  ```
- `code` is a stable SCREAMING_SNAKE_CASE enum member. Clients branch on `code`, never on
  `message`. Messages are for humans and may change
- Throw Nest HTTP exceptions from services (`BadRequestException`, `NotFoundException`,
  `UnprocessableEntityException`). Don't return error objects
- Status codes mean things: `400` malformed, `404` missing store/cashier, `422` semantically
  valid but unsupported (currency), `201` sale created
- **Never leak Prisma errors, stack traces, SQL, or connection strings** to the client.
  Catch `PrismaClientKnownRequestError`, map to a domain error, log the original
- An unknown barcode is **not an error** — flag the line, log the scan, complete the sale,
  surface it in `warnings[]`

## Logging
- Nest `Logger`, never `console.log`
- Log the unmatched-barcode path at `warn` with store + barcode — that's an ops signal
- Never log full payloads, connection strings, or credentials

## Testing
- Unit tests for `SalesService` with a mocked Prisma: FX math, unknown-barcode path,
  empty cart, unsupported currency. **These must pass with no database**
- e2e for `POST /sales` via Supertest against a dedicated Neon branch (`TEST_DATABASE_URL`),
  `migrate deploy` + seed per suite
- Assert money as strings. `expect(total).toBe('8.1800')`, not `toBeCloseTo(8.18)`
- Never point tests at the branch you develop against

## Code Quality
- No commented-out code unless specified
- No unused imports or variables
- Keep functions under 50 lines when possible
- Comments explain **why**, not what. Every non-obvious schema decision gets a comment in the
  migration SQL, not only in the docs
- ESLint + Prettier enforced; `npm run lint` clean before commit
- Conventional Commits. Schema change + migration + seed update land in one commit
