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

Records a sale atomically and returns a structured receipt.

> **Status — Slice 1 of 4 (happy path).** One sale, all barcodes matching, written
> atomically. FX is identity (`fxRate = 1`, `fxRateSource = IDENTITY_V0`). Still to come:
> Slice 2 real FX, Slice 3 unknown-barcode logging (currently returns 404), Slice 4
> validation pipe + uniform error envelope.

### Example (works against the seeded data)

```bash
curl -s -X POST http://localhost:3000/sales \
  -H "Content-Type: application/json" \
  -d '{
    "storeCode": "STR-001",
    "cashierId": "<CASHIER_UUID_FROM_SEED_OUTPUT>",
    "currencyCode": "EUR",
    "lineItems": [
      { "barcode": "4006381333931", "quantity": 2, "unitPrice": "3.4900" },
      { "barcode": "4001686301227", "quantity": 1, "unitPrice": "1.9900" }
    ]
  }'
```

Response `201`:

```jsonc
{
  "transactionId": "…",
  "store": { "code": "STR-001", "name": "Hannover Mitte" },
  "cashier": { "id": "…", "fullName": "Clara Kassierer" },
  "occurredAt": "2026-07-16T…Z",
  "currency": { "code": "USD", "baseCode": "USD", "fxRate": "1.00000000", "fxRateSource": "IDENTITY_V0" },
  "lines": [
    { "barcode": "4006381333931", "description": "Nivea Creme 75ml", "matched": true,
      "quantity": 2, "unitPrice": "3.4900", "lineTotal": "6.9800" },
    { "barcode": "4001686301227", "description": "Haribo Goldbären 200g", "matched": true,
      "quantity": 1, "unitPrice": "1.9900", "lineTotal": "1.9900" }
  ],
  "totals": { "subtotal": "8.9700", "total": "8.9700", "totalBase": "8.9700" }
}
```

All money crosses the API as **strings** — a JSON number has already lost precision.
Get the real `cashierId` from the `npx prisma db seed` output.

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
