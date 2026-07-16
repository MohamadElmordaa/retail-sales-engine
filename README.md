# Retail Sales Engine

Backend service that simulates the transaction-processing layer of a multi-store retail
POS system. Captures sales from multiple stores and persists them to PostgreSQL while
snapshotting the FX rate used at the time of each sale, so historical receipts stay
byte-for-byte reproducible.

Stack: **NestJS + TypeScript + Prisma 7 + PostgreSQL (Neon)**.

## Prerequisites

- **Node.js 22+** (Prisma 7 requires ≥ 20.19 / 22.12 / 24). This repo pins Node 22 via
  `.nvmrc` — run `nvm use` to match.
- A PostgreSQL 16+ connection string. Any works; we developed against **Neon** (serverless).

## Setup

```bash
nvm use                        # Node 22 (see .nvmrc)
npm install                    # also runs `prisma generate` (postinstall)
cp .env.example .env           # paste your own Neon URLs (or any Postgres 16+ URL)
npx prisma migrate deploy      # apply committed migrations
npx prisma db seed             # idempotent reference + demo data
npm run start:dev              # http://localhost:3000
```

`.env` needs two URLs — the **pooled** `DATABASE_URL` (app runtime) and the **direct**
`DIRECT_URL` (Prisma CLI: migrate/seed). On Neon the direct URL is the pooled one with
`-pooler` removed from the host. See `.env.example`.

The seed prints the store code and cashier UUID the curl example below uses.

## `POST /sales`

Records a sale atomically and returns a structured receipt. A sale snapshots the FX rate
applied at the time of purchase, converts every line into the base currency, and logs any
barcode that matched no product without rejecting the sale.

### Example — happy path (works against the seeded data)

```bash
curl -s -X POST http://localhost:3000/sales \
  -H "Content-Type: application/json" \
  -d '{
    "storeCode": "STR-001",
    "cashierId": "<CASHIER_UUID_FROM_SEED_OUTPUT>",
    "currencyCode": "EUR",
    "lineItems": [
      { "barcode": "4001686301227", "quantity": 2, "unitPrice": "3.4900" },
      { "barcode": "4005808777771", "quantity": 1, "unitPrice": "1.9900" }
    ]
  }'
```

Response `201` — note `fxRate` snapshotted at 8dp and `totalBase` ≠ `total` (EUR → USD):

```jsonc
{
  "transactionId": "…",
  "store": { "code": "STR-001", "name": "Hannover Mitte" },
  "cashier": { "id": "…", "fullName": "Clara Kassierer" },
  "occurredAt": "2026-07-16T…Z",
  "currency": { "code": "EUR", "baseCode": "USD", "fxRate": "1.08420000", "fxRateSource": "HARDCODED_V1" },
  "lines": [
    { "barcode": "4001686301227", "description": "Haribo Goldbären 200g", "matched": true,
      "quantity": 2, "unitPrice": "3.4900", "lineTotal": "6.9800" },
    { "barcode": "4005808777771", "description": "Nivea Hand Cream 100ml", "matched": true,
      "quantity": 1, "unitPrice": "1.9900", "lineTotal": "1.9900" }
  ],
  "warnings": [],
  "totals": { "subtotal": "8.9700", "total": "8.9700", "totalBase": "9.7253" }
}
```

### Example — unknown barcode (logged, sale still completes)

Swap one barcode for one that matches no product. The sale returns `201`; the line is kept
with `matched: false` / `flag: "UNKNOWN_BARCODE"`, a `warnings[]` entry is added, and a row is
written to `unmatched_barcode_scans` — inside the same transaction as the sale.

```bash
curl -s -X POST http://localhost:3000/sales \
  -H "Content-Type: application/json" \
  -d '{
    "storeCode": "STR-001",
    "cashierId": "<CASHIER_UUID_FROM_SEED_OUTPUT>",
    "currencyCode": "EUR",
    "lineItems": [
      { "barcode": "4001686301227", "quantity": 2, "unitPrice": "3.4900" },
      { "barcode": "9999999999999", "quantity": 1, "unitPrice": "1.9900" }
    ]
  }'
```

Errors use a uniform envelope `{ "error": { "code", "message", "details": [] } }` — clients
branch on `code`, never on `message`. Codes: `VALIDATION_FAILED` (400), `EMPTY_CART` (400),
`UNSUPPORTED_CURRENCY` (422), `STORE_NOT_FOUND` / `CASHIER_NOT_FOUND` (404),
`DUPLICATE_SALE` (409, on a repeated `(storeCode, externalRef)`).

All money crosses the API as **strings** — a JSON number has already lost precision.
Get the real `cashierId` from the `npx prisma db seed` output.

## Design decisions

- **FX rate is snapshotted on the transaction, never re-derived.** `fxRate` / `fxRateSource` /
  `fxCapturedAt` are frozen at sale time; a later rate change can't rewrite historic receipts.
- **`productId` is nullable and `rawBarcode` is always stored.** An unknown barcode is logged
  and the sale completes — losing a sale is worse than an incomplete catalogue.
- **`NUMERIC(14,4)` + `Decimal`, money as strings over the wire.** No IEEE-754 float touches
  money; per-line base amounts are summed into `totalBase` so a receipt reconciles to its lines.
- **`occurredAt` (business time) vs `createdAt` (ingest time).** Distinct columns so an offline
  POS can replay sales later without corrupting when they *happened*.
- **`externalRef` partial unique index, not a foreign key.** External ids change hands; keep
  them out of FKs but still enforce idempotency per store.
- **`onDelete: Restrict` on financial relations.** A tidied-up staff list must not silently
  evaporate sales history.
- **Migrations only, never `db push`.** The schema history is a reviewable artifact.
- **camelCase columns (Prisma default), snake_case tables via `@@map`.** A deliberate choice —
  ORM-idiomatic columns, SQL-idiomatic table names.

See [`docs/scaling.md`](docs/scaling.md) for how the reporting side would scale.

## Scope

Deliberately out of scope for this exercise: authentication/authorization, any UI, a live FX
provider (rates are a hardcoded table behind a single `getRate()` seam), and any endpoint
beyond `POST /sales`. The brief specifies one endpoint; the effort went into getting that one
correct — atomicity, FX history, and data integrity — rather than into breadth.

## Common commands

```bash
npm run start:dev        # watch mode
npm run build            # nest build -> dist/
npm test                 # unit tests
npm run lint             # eslint --fix

npm run prisma:migrate   # prisma migrate dev
npm run prisma:seed      # prisma db seed
npm run prisma:studio    # browse the data
npm run prisma:status    # migration sync check
```
