# Project Overview — Multi-Store Retail Data Capture

> Context document for the Scopsis Full Stack Technical Assessment.
> This file is the **source of truth for scope, data model, and conventions**.
> `CLAUDE.md` points here; agents and humans should read this before writing code.

---

## 1. What we are building

The backend foundation of a **multi-store retail data capture system** — the engine that
sits at the point of sale, records what was sold, and feeds a central reporting layer.

Three deliverables:

| Task | Deliverable | Where |
|------|-------------|-------|
| 1 | PostgreSQL schema (DDL + rationale) | `prisma/schema.prisma` + `prisma/migrations/**` (+ `docs/schema.md`) |
| 2 | Working `POST /sales` endpoint | `src/sales/**` |
| 3 | Written answer (≤200 words) on reporting at scale | `docs/scaling.md` |

Out of scope (explicitly): auth, UI, live FX API, multi-tenancy, payments/tender,
returns, inventory, promotions. **Do not build them.** Note them as future work instead.

---

## 2. Tech stack

- **NestJS** (on Express) — modular, DI-first, testable
- **TypeScript** — `strict: true`, no `any` in committed code
- **PostgreSQL** — hosted on **Neon** (serverless Postgres, free tier)
- **Prisma ORM** v6 — schema-first, migration-driven
- **class-validator / class-transformer** — DTO validation at the edge
- **Jest + Supertest** — unit + e2e

**No Docker.** Neon gives a reviewer a working database faster than `docker compose up`
does, with no Docker Desktop install. The trade-off is that the reviewer must supply their
own `DATABASE_URL` — which is fine, because of the next rule.

> **Neon is a deployment detail, not a dependency.**
> Do **not** install `@prisma/adapter-neon` or `@neondatabase/serverless`. Those exist for
> edge runtimes that can't hold a TCP socket. NestJS is a long-lived Node process — the
> default Prisma engine over plain TCP is correct. Everything in this repo is stock
> PostgreSQL 16, so `DATABASE_URL` can point at Neon, a local install, or a colleague's
> box, and nothing changes. Never `import` anything Neon-branded in `src/`.

**Prisma version:** pinned to **v6.x**. In v6 the connection is configured in
`schema.prisma` via `url` / `directUrl`. Prisma 7 moves this to `prisma.config.ts` and
changes the client import path — if you upgrade, that's a deliberate migration, not a
`npm update` accident.

---

## 3. Repository structure

```
.
├── .env.example                  # committed. DATABASE_URL, DIRECT_URL, PORT, BASE_CURRENCY
├── .env                          # gitignored. NEVER commit a real Neon URL — it's a credential
├── CLAUDE.md                     # agent working agreement -> points at this file
├── README.md                     # setup, run, migrate, curl examples
├── docs/
│   ├── project-overview.md       # this file
│   ├── schema.md                 # ERD + design-decision rationale (Task 1 prose)
│   └── scaling.md                # Task 3 answer (200 words max)
├── postman/
│   └── sales.postman_collection.json
├── prisma/
│   ├── schema.prisma             # single source of truth for the data model
│   ├── migrations/               # committed, ordered, never edited after apply
│   └── seed.ts                   # stores, users, brands, categories, products, currencies
└── src/
    ├── main.ts                   # bootstrap + global ValidationPipe + filters
    ├── app.module.ts
    ├── common/
    │   ├── filters/http-exception.filter.ts   # uniform error envelope
    │   ├── pipes/                              # (ValidationPipe config lives in main.ts)
    │   └── decimal.ts                          # money helpers (Prisma.Decimal)
    ├── prisma/
    │   ├── prisma.module.ts
    │   └── prisma.service.ts     # onModuleInit -> $connect, shutdown hooks
    ├── fx/
    │   ├── fx.module.ts
    │   └── fx.service.ts         # hardcoded rate table; single seam for a live API later
    └── sales/
        ├── sales.module.ts
        ├── sales.controller.ts   # POST /sales — thin, no business logic
        ├── sales.service.ts      # orchestration + $transaction
        ├── dto/
        │   ├── create-sale.dto.ts
        │   └── line-item.dto.ts
        └── receipt/
            └── receipt.mapper.ts # entity -> response shape (no leaking of DB internals)
```

**Rules of thumb**
- Controllers: parse/validate/delegate. No Prisma calls, no math.
- Services: own the business rules and the DB transaction boundary.
- Mappers: shape responses. Never return Prisma models straight to the client.
- One module per bounded concern. `sales` does not import `fx` internals, only `FxService`.

---

## 4. Data model

### 4.1 Entities and why they exist

| Table | Purpose |
|-------|---------|
| `stores` | Physical locations. Carries `region` — reporting groups by it (Task 3). |
| `users` | Staff with a role: `CASHIER` / `MANAGER` / `ADMIN`. Cashier is FK'd from a transaction. |
| `brands` | Product brand. Reporting dimension. |
| `categories` | Product category. Self-referencing `parentId` for a shallow hierarchy. |
| `products` | Sellable item. Has `barcode`, `brandId`, `categoryId`, `externalRef`. |
| `currencies` | Whitelist of supported ISO-4217 codes + minor-unit precision. Makes "unsupported currency" a data question, not a hardcoded array. |
| `transactions` | One sale. **Snapshots** `currencyCode`, `baseCurrencyCode`, `fxRate`, and totals. |
| `transaction_line_items` | One scanned line. `productId` is **nullable**; `rawBarcode` is always stored. |
| `unmatched_barcode_scans` | Append-only log of barcodes that matched no product. |

### 4.2 The five requirements, mapped to decisions

**a) FX rate is snapshotted, never derived**
`transactions` stores `currency_code`, `base_currency_code`, `fx_rate NUMERIC(18,8)`,
`fx_rate_source` (`'HARDCODED_V1'`), and `fx_captured_at`. Historic receipts must reproduce
byte-for-byte in five years even if today's rate table is deleted. A rate table joined at
report time would silently rewrite history — so we do not do that.
Line items store `unit_price` in the **transaction currency**, plus `unit_price_base` and
`line_total_base` computed at write time. Reports sum base-currency columns and never
re-multiply.

**b) Unknown barcodes are logged, not dropped**
`transaction_line_items.product_id` is `NULL`-able and `raw_barcode` is `NOT NULL` on
*every* line — matched or not. A matched line keeps the barcode it was scanned with even if
the product's barcode is later corrected. Unmatched lines additionally get a row in
`unmatched_barcode_scans` with store, transaction, and timestamp, so ops can triage the
catalogue gap. The sale still completes. This is the whole point: **losing revenue data is
worse than an incomplete catalogue.**

**c) External reference field**
`products.external_ref TEXT` — a join key for an external data system (ERP/PIM).
Nullable (not every product is mastered externally), unique when present via a
**partial unique index** (`WHERE external_ref IS NOT NULL`). Deliberately not the PK:
external identifiers change hands and we don't want them in our FKs.

**d) Money**
`NUMERIC(14,4)` everywhere. Never `float`/`double` — binary floating point cannot represent
`0.10` and cents drift. Prisma maps this to `Decimal` (`decimal.js`); all arithmetic goes
through `Prisma.Decimal`, never JS `number`. Extra scale (4 dp) so per-unit base-currency
conversion doesn't round twice.

**e) Roles**
A native Postgres `ENUM` (`user_role`). Small, closed, rarely-changing set — an enum gives
DB-level enforcement without a join. A lookup table would be right if roles were
user-manageable; they aren't.

### 4.3 Prisma schema (shape — see `prisma/schema.prisma` for the authoritative copy)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // POOLED  (-pooler host) — application runtime
  directUrl = env("DIRECT_URL")     // DIRECT  (no -pooler)   — migrate, seed, introspect
}

enum UserRole {
  CASHIER
  MANAGER
  ADMIN
}

model Store {
  id        String   @id @default(uuid()) @db.Uuid
  code      String   @unique              // human-readable, used by POS clients
  name      String
  region    String                        // reporting dimension (Task 3)
  createdAt DateTime @default(now())

  users        User[]
  transactions Transaction[]
  scans        UnmatchedBarcodeScan[]

  @@index([region])
  @@map("stores")
}

model User {
  id        String   @id @default(uuid()) @db.Uuid
  storeId   String   @db.Uuid
  email     String   @unique
  fullName  String
  role      UserRole
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())

  store        Store         @relation(fields: [storeId], references: [id], onDelete: Restrict)
  transactions Transaction[]

  @@index([storeId, role])
  @@map("users")
}

model Brand {
  id       String    @id @default(uuid()) @db.Uuid
  name     String    @unique
  products Product[]

  @@map("brands")
}

model Category {
  id       String     @id @default(uuid()) @db.Uuid
  name     String
  parentId String?    @db.Uuid
  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id], onDelete: Restrict)
  children Category[] @relation("CategoryTree")
  products Product[]

  @@unique([parentId, name])
  @@map("categories")
}

model Currency {
  code       String  @id @db.Char(3)   // ISO 4217; PK is the code itself
  name       String
  minorUnits Int     @default(2)
  isActive   Boolean @default(true)

  transactions Transaction[] @relation("TxnCurrency")
  baseFor      Transaction[] @relation("TxnBaseCurrency")

  @@map("currencies")
}

model Product {
  id          String   @id @default(uuid()) @db.Uuid
  barcode     String   @unique           // EAN/UPC as scanned
  sku         String   @unique
  name        String
  brandId     String?  @db.Uuid
  categoryId  String?  @db.Uuid
  externalRef String?                    // join key -> external data system
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  brand     Brand?                 @relation(fields: [brandId], references: [id], onDelete: SetNull)
  category  Category?              @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  lineItems TransactionLineItem[]

  @@index([brandId])
  @@index([categoryId])
  @@map("products")
  // partial unique index on external_ref added via raw SQL in the migration
}

model Transaction {
  id               String   @id @default(uuid()) @db.Uuid
  storeId          String   @db.Uuid
  cashierId        String   @db.Uuid
  externalRef      String?                       // client-supplied idempotency / POS ref
  currencyCode     String   @db.Char(3)
  baseCurrencyCode String   @db.Char(3)
  fxRate           Decimal  @db.Decimal(18, 8)   // SNAPSHOT — never re-derived
  fxRateSource     String   @default("HARDCODED_V1")
  fxCapturedAt     DateTime @default(now())
  subtotal         Decimal  @db.Decimal(14, 4)   // transaction currency
  total            Decimal  @db.Decimal(14, 4)
  totalBase        Decimal  @db.Decimal(14, 4)   // total * fxRate, computed at write time
  occurredAt       DateTime @default(now())      // partition key candidate
  createdAt        DateTime @default(now())

  store        Store                 @relation(fields: [storeId], references: [id], onDelete: Restrict)
  cashier      User                  @relation(fields: [cashierId], references: [id], onDelete: Restrict)
  currency     Currency              @relation("TxnCurrency", fields: [currencyCode], references: [code])
  baseCurrency Currency              @relation("TxnBaseCurrency", fields: [baseCurrencyCode], references: [code])
  lineItems    TransactionLineItem[]
  scans        UnmatchedBarcodeScan[]

  @@unique([storeId, externalRef])
  @@index([occurredAt])
  @@index([storeId, occurredAt])
  @@map("transactions")
}

model TransactionLineItem {
  id             String   @id @default(uuid()) @db.Uuid
  transactionId  String   @db.Uuid
  productId      String?  @db.Uuid          // NULL => barcode matched nothing
  rawBarcode     String                     // always recorded, matched or not
  isUnmatched    Boolean  @default(false)
  descriptionSnapshot String?               // product name at time of sale
  quantity       Int
  unitPrice      Decimal  @db.Decimal(14, 4)
  lineTotal      Decimal  @db.Decimal(14, 4)
  unitPriceBase  Decimal  @db.Decimal(14, 4)
  lineTotalBase  Decimal  @db.Decimal(14, 4)

  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  product     Product?    @relation(fields: [productId], references: [id], onDelete: Restrict)

  @@index([transactionId])
  @@index([productId])
  @@index([rawBarcode])
  @@map("transaction_line_items")
}

model UnmatchedBarcodeScan {
  id            String   @id @default(uuid()) @db.Uuid
  rawBarcode    String
  storeId       String   @db.Uuid
  transactionId String?  @db.Uuid
  lineItemId    String?  @db.Uuid
  scannedAt     DateTime @default(now())
  resolvedAt    DateTime?                 // set when the catalogue gap is closed

  store       Store        @relation(fields: [storeId], references: [id], onDelete: Restrict)
  transaction Transaction? @relation(fields: [transactionId], references: [id], onDelete: SetNull)

  @@index([rawBarcode])
  @@index([storeId, scannedAt])
  @@map("unmatched_barcode_scans")
}
```

### 4.4 Constraints Prisma can't express — add as raw SQL in the migration

```sql
-- external_ref unique only when present
CREATE UNIQUE INDEX products_external_ref_key
  ON products (external_ref) WHERE external_ref IS NOT NULL;

-- a line is either matched or flagged — never both, never neither
ALTER TABLE transaction_line_items
  ADD CONSTRAINT line_item_match_consistency
  CHECK ((product_id IS NULL) = is_unmatched);

ALTER TABLE transaction_line_items
  ADD CONSTRAINT line_item_qty_positive CHECK (quantity > 0);

ALTER TABLE transaction_line_items
  ADD CONSTRAINT line_item_price_non_negative CHECK (unit_price >= 0);

ALTER TABLE transactions
  ADD CONSTRAINT txn_fx_rate_positive CHECK (fx_rate > 0);

-- covering index for the Task 3 reporting shape
CREATE INDEX transactions_store_occurred_at_idx
  ON transactions (store_id, occurred_at DESC) INCLUDE (total_base);
```

Every non-obvious decision gets a `--` comment **in the migration SQL itself**, not only here.

---

## 5. Database setup (Neon)

### 5.1 Two connection strings, and why

Neon gives you two URLs for the same database. They differ by one substring in the host:

```bash
# .env.example  (copy to .env, fill from the Neon Console -> Connect)

# POOLED — has "-pooler" in the hostname. Goes through PgBouncer.
# Used by the running app.
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=15&pool_timeout=15"

# DIRECT — no "-pooler". Bypasses PgBouncer.
# Used by Prisma CLI: migrate, db seed, introspect, studio.
DIRECT_URL="postgresql://USER:PASSWORD@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=15"

PORT=3000
BASE_CURRENCY=USD
```

**Why it matters:** PgBouncer runs in transaction pooling mode, which does not preserve
session state. Run DDL through the pooled URL and you get
`ERROR: prepared statement "s0" already exists`. Migrations and seeds therefore go over
`DIRECT_URL`; that's exactly what Prisma's `directUrl` field is for.

Pick the region closest to you (`eu-central-1` from Hannover) — every migration and every
test round-trips to it.

### 5.2 Neon gotchas to design around

| Gotcha | Consequence | What we do |
|--------|-------------|------------|
| Compute **scales to zero after ~5 min idle**; cold start 500ms–few seconds | First request after a break looks like a hang or a timeout | `connect_timeout=15`, and raise the `$transaction` timeout (default 5s) to ~15s in `SalesService` |
| Pooled endpoint breaks prepared statements / long transactions | Seeds fail halfway through | Seed over `DIRECT_URL`, never the pooler |
| Every network call is a WAN round-trip, not localhost | Chatty code is *visibly* slow — an N+1 you'd never notice locally shows up immediately | Batch the barcode lookup into one `findMany`. This was already the rule; Neon just enforces it |
| Free-tier credentials are a real secret | Committing `.env` leaks a live DB | `.env` gitignored, `.env.example` committed with placeholders |

### 5.3 Reviewer bootstrap (must work from a clean clone)

```bash
npm install
cp .env.example .env          # paste your own Neon URLs (or any Postgres 16+ URL)
npx prisma migrate deploy     # applies committed migrations, creates nothing new
npx prisma db seed            # idempotent reference + demo data
npm run start:dev
```

Four commands, no Docker, no account required if they already have a Postgres. `README.md`
states plainly: *any PostgreSQL 16+ connection string works; Neon is what we developed
against.*

### 5.4 Branching (the thing Neon has that Docker doesn't)

A Neon branch is a copy-on-write clone of the database — instant, free on the tier we're on.
Use it instead of a disposable container:

- `dev` branch for local work. `migrate reset` here is safe and cheap.
- A throwaway branch per e2e run: create branch → `migrate deploy` against its direct URL →
  run suite → delete branch. Full isolation without a `docker compose down -v`.
- If a branch's parent is already seeded, the branch inherits the data — no reseed needed.

This is optional for the assessment. Mention it in the README; don't build CI for it.

---

## 6. Migrations — the rules

**`prisma db push` is banned.** Not in dev, not in CI, not "just this once".
It diffs and mutates without producing an artifact, which means the schema history is
unreproducible, un-reviewable, and undeployable. Every schema change lands as a
**committed, ordered SQL migration.**

| Do | Don't |
|----|-------|
| `npx prisma migrate dev --name add_fx_snapshot_to_transactions` | `prisma db push` |
| `npx prisma migrate deploy` (CI / prod) | `prisma migrate reset` on anything shared |
| `npx prisma migrate dev --create-only` then hand-edit the SQL | Editing a migration that's already applied anywhere |
| Commit `prisma/migrations/**` | `.gitignore`-ing migrations |
| `npx prisma migrate status` before deploying | Trusting that dev and prod drifted the same way |
| Let `directUrl` carry the CLI | Point `directUrl` at the `-pooler` host |

**Workflow for any schema change**
1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate dev --create-only --name <verb_noun>` — generates SQL, applies nothing.
3. **Read the generated SQL.** Add partial indexes, `CHECK`s, `COMMENT ON`, and rationale comments.
4. `npx prisma migrate dev` to apply + regenerate the client.
5. Commit schema + migration + any seed change in one commit.

**Naming:** `snake_case`, verb-first, describes intent — `add_unmatched_barcode_scans`,
`backfill_line_item_base_totals`. Not `update`, not `fix`, not `migration2`.

**Destructive changes** are expand → migrate → contract across separate migrations
(add nullable column → backfill → enforce `NOT NULL` → drop old). Out of scope here, but
the convention holds so we don't have to unlearn it later.

### Seeding

`prisma/seed.ts`, wired via `package.json`:

```jsonc
"prisma": { "seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts" }
```

Run with `npx prisma db seed`. Rules:

- **Idempotent.** Every write is an `upsert` on a natural key (`store.code`, `user.email`,
  `product.barcode`, `currency.code`). Running it twice is a no-op, not a duplicate-key crash.
- **Runs over `DIRECT_URL`** — Prisma's CLI uses `directUrl` automatically, which is half the
  reason it's configured. Don't override it to the pooler.
- **Never a substitute for a migration.** Two different kinds of data live here and the
  distinction matters:
  - **Reference data** the app cannot boot without — the `currencies` rows (`USD`, `EUR`,
    `GBP`, `CHF`). This is arguably schema, not fixtures. Insert it in a **migration** so it
    ships with the DDL and can't be forgotten; the seed only `upsert`s it defensively.
  - **Demo data** — stores across ≥2 regions, one cashier + one manager + one admin,
    a handful of brands/categories, ~20 products (some with `externalRef`, some without).
    This belongs in `seed.ts`.
- **Seed for the demo you want reviewed.** A reviewer will `curl` the examples in your README
  within 30 seconds of cloning. The seed must make those exact curls work: a real
  `storeCode`, a real `cashierId`, real barcodes, plus one barcode you *deliberately left
  out of the catalogue* so the unknown-barcode path is demonstrable. Print the seeded
  store code and cashier UUID to stdout at the end of the seed — don't make anyone go
  digging in Studio for them.
- Note: in Prisma 7, `migrate dev` no longer triggers the seed automatically. Another reason
  the version is pinned.

---

## 7. `POST /sales` contract

### Request
```jsonc
{
  "storeCode": "STR-001",
  "cashierId": "3f6c...-uuid",
  "currencyCode": "EUR",
  "externalRef": "POS-2026-07-16-0042",   // optional, idempotency key per store
  "lineItems": [
    { "barcode": "4006381333931", "quantity": 2, "unitPrice": "3.4900" }
  ]
}
```

### Validation (class-validator, global `ValidationPipe` with
`{ whitelist: true, forbidNonWhitelisted: true, transform: true }`)

| Rule | Error |
|------|-------|
| missing/blank required field | `400 VALIDATION_FAILED` with per-field messages |
| `lineItems` empty | `400 EMPTY_CART` |
| `currencyCode` not in `currencies` where `isActive` | `422 UNSUPPORTED_CURRENCY` |
| `quantity` not a positive int | `400 VALIDATION_FAILED` |
| `unitPrice` negative / non-numeric string | `400 VALIDATION_FAILED` |
| store or cashier not found | `404 STORE_NOT_FOUND` / `404 CASHIER_NOT_FOUND` |
| unknown barcode | **not an error** — line flagged, sale proceeds |

Prices arrive as **strings** and are parsed into `Prisma.Decimal`. `@IsNumberString`, not
`@IsNumber` — JSON numbers already lost precision by the time we see them.

### Error envelope (uniform, from `HttpExceptionFilter`)
```json
{
  "error": { "code": "EMPTY_CART", "message": "A sale must contain at least one line item.", "details": [] }
}
```

### Service flow (`SalesService.create`)
1. Resolve store + cashier + currency. Fail fast on 404/422.
2. `FxService.getRate(from, to)` → `{ rate, source }` from the hardcoded table.
3. Batch-look-up products: **one** `findMany({ where: { barcode: { in: [...] } } })`, then map. Never `await` in a loop.
4. Compute per line: `lineTotal = unitPrice * quantity`, `lineTotalBase = lineTotal * rate`. All `Decimal`.
5. Open `prisma.$transaction(async (tx) => …)`:
   - insert `transactions` with the FX snapshot and totals
   - insert all `transaction_line_items`
   - insert `unmatched_barcode_scans` for the misses
   The whole sale is atomic — a partial receipt is a data-integrity bug, not a degraded mode.
6. Map to the receipt DTO.

### Response `201`
```jsonc
{
  "transactionId": "…",
  "store": { "code": "STR-001", "name": "Hannover Mitte" },
  "cashier": { "id": "…", "fullName": "…" },
  "occurredAt": "2026-07-16T10:12:04.221Z",
  "currency": { "code": "EUR", "baseCode": "USD", "fxRate": "1.08420000", "fxRateSource": "HARDCODED_V1" },
  "lines": [
    { "barcode": "4006381333931", "description": "Nivea Creme 75ml", "matched": true,
      "quantity": 2, "unitPrice": "3.4900", "lineTotal": "6.9800" },
    { "barcode": "0000000000000", "description": null, "matched": false,
      "quantity": 1, "unitPrice": "1.2000", "lineTotal": "1.2000", "flag": "UNKNOWN_BARCODE" }
  ],
  "totals": { "subtotal": "8.1800", "total": "8.1800", "totalBase": "8.8688" },
  "warnings": [{ "code": "UNKNOWN_BARCODE", "barcode": "0000000000000" }]
}
```
`warnings` makes the degraded line visible to the POS client without failing the call.

---

## 8. FX

`FxService` holds a hardcoded rate table keyed `${from}->${to}` against
`BASE_CURRENCY` (default `USD`). It exposes exactly one method, `getRate()`, returning the
rate **and** a source tag. That's the seam: swapping in a live provider later touches this
file and nothing else. The snapshot on `transactions` means yesterday's receipts are
unaffected by that swap.

---

## 9. Conventions

- **Naming:** Prisma models `PascalCase` singular, `@@map` to `snake_case` plural tables. Columns `snake_case` in SQL, `camelCase` in TS.
- **IDs:** UUID v4 PKs (`@db.Uuid`). Multi-store POS clients may generate IDs offline; sequential integers leak volume and collide across stores.
- **Timestamps:** `timestamptz`, UTC. `occurredAt` (business time) is distinct from `createdAt` (ingest time) — offline POS replay depends on that distinction.
- **Deletes:** `onDelete: Restrict` on anything a transaction points at. Financial history must not evaporate because someone tidied the staff list.
- **Commits:** Conventional Commits. Schema change + migration + seed in one commit.
- **Tests:** unit for `SalesService` (FX math, unknown-barcode path, empty cart) with a mocked Prisma — these are the tests that must pass with no database at all, so a reviewer without a `DATABASE_URL` still sees green. e2e for `POST /sales` against a **separate Neon branch** (`TEST_DATABASE_URL`), `migrate deploy` + seed per suite. Never point the e2e suite at the branch you develop against.
- **Transaction timeout:** pass `{ timeout: 15_000, maxWait: 5_000 }` to `prisma.$transaction`. Prisma's 5s default is generous on localhost and marginal against a cold Neon compute over the WAN.

---

## 10. Task 3 pointer

`docs/scaling.md`, ≤200 words. Lead with the **clarifying questions** (read latency target?
freshness tolerance? ad-hoc or fixed reports? row volume per store per day?), then the
progression: composite/covering indexes on the reporting predicates →
declarative range partitioning of `transactions` by `occurred_at` (monthly, 18-month
retention lines up with partition drop) → materialised rollups refreshed nightly for fixed
dashboards → read replica to isolate reporting from POS writes → columnar/warehouse offload
only if it's still slow. Do **not** open with "add an index" and stop. Do **not** prescribe
before asking.

---

## 11. Definition of done

- [ ] Clean clone → `npm i` → `cp .env.example .env` → `migrate deploy` → `db seed` → `start:dev` works against a fresh Neon project
- [ ] Repo contains **zero** Neon-specific imports; swapping `DATABASE_URL` to any Postgres 16+ works unchanged
- [ ] `.env` gitignored; no live connection string anywhere in git history
- [ ] `prisma/migrations/**` committed; zero `db push` in history or scripts
- [ ] Seed prints the store code + cashier UUID the README's curl examples use
- [ ] Seed includes a barcode that intentionally has no product, to demo the unmatched path
- [ ] Migration SQL carries comments on every non-obvious decision
- [ ] `POST /sales` handles: happy path, empty cart, missing fields, unsupported currency, unknown barcode
- [ ] FX rate snapshotted on the transaction row; report math reads base columns only
- [ ] curl examples in `README.md` + Postman collection
- [ ] `docs/scaling.md` under 200 words
- [ ] `npm run lint && npm test && npm run test:e2e` green
