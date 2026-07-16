# Current Feature

POST /sales — Unknown barcode + Validation & errors (Slice 3, final)

## Status

<!-- Not Started|In Progress|Completed -->

Completed

## Goals

<!-- Goals & requirements -->

Slices 3 and 4 merged — they touch the same files, so doing them in one pass avoids a second
read of `SalesService`. **Build 3A before 3B.** 3A is the requirement the brief attached a
reason to; 3B is boilerplate that can be trimmed if time runs out.

### Step 0 — clear the two live checks (~2 min)

Run in the Neon SQL editor, then tick Slice 2 closed:

```sql
SELECT COUNT(*) FROM transactions WHERE fx_rate_source = 'IDENTITY_V0';  -- expect 0

SELECT t.id FROM transactions t
JOIN transaction_line_items l ON l.transaction_id = t.id
GROUP BY t.id, t.total_base
HAVING SUM(l.line_total_base) <> t.total_base;                           -- expect 0 rows
```

### 3A — Unknown barcode (do this first)

*"Barcode scans that don't match any known product must still be logged — not dropped or
rejected."* Right now an unknown barcode throws 404. That is the one requirement currently
violated on purpose. Fix it.

- `SalesService`: a barcode with no product no longer throws. The line is written with
  `productId = null`, `isUnmatched = true`, `rawBarcode` = what was scanned,
  `descriptionSnapshot = null`.
- `rawBarcode` is written on **every** line, matched or not. Already true — don't regress it.
- One `unmatched_barcode_scans` row per unknown line, **inside the same `$transaction`**:
  `rawBarcode`, `storeId`, `transactionId`, `lineItemId`, `scannedAt`. Not a separate write
  after commit — if the sale rolls back, the scan log must roll back with it.
- **FX still applies to unmatched lines.** The cashier typed a price, so `unitPriceBase` and
  `lineTotalBase` are computed exactly as for matched lines, and the line counts toward
  `total` / `totalBase`. An unknown product is not a free product.
- Receipt: unmatched lines get `matched: false`, `description: null`, `flag:
  "UNKNOWN_BARCODE"`, and a `warnings[]` entry `{ code: "UNKNOWN_BARCODE", barcode }`.
- `Logger.warn` with store + barcode. This is an ops signal, not noise.
- Still returns **201**. The sale completes.

### 3B — Validation & errors

- Global pipe in `main.ts`:
  `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`
- `HttpExceptionFilter` registered globally. Uniform envelope:
  `{ "error": { "code": "...", "message": "...", "details": [] } }`
- Error codes — clients branch on `code`, never on `message`:

| Case | Status | Code |
|---|---|---|
| Missing / malformed field | 400 | `VALIDATION_FAILED` |
| `lineItems: []` | 400 | `EMPTY_CART` |
| Currency not in `currencies` where `isActive` | 422 | `UNSUPPORTED_CURRENCY` |
| Store code not found | 404 | `STORE_NOT_FOUND` |
| Cashier id not found | 404 | `CASHIER_NOT_FOUND` |
| Duplicate `(storeId, externalRef)` — Prisma `P2002` | 409 | `DUPLICATE_SALE` |

- Catch `PrismaClientKnownRequestError`, map to a domain error, log the original. **Never** let
  Prisma error text, SQL, constraint names, or a stack trace reach the client.

## Notes

<!-- Any extra notes -->

- **`sales.service.spec.ts` asserts unknown barcode -> 404. That test is now wrong.** Delete
  it and assert the opposite: 201, line 3 has `productId: null` / `isUnmatched: true`, one
  scan row written, one `warnings[]` entry. A red test here is the feature working.
- **`line_item_match_consistency` CHECK** enforces `(product_id IS NULL) = is_unmatched`. Set
  both or neither — the database will not let you write a half-flagged line. Free safety net.
- **`EMPTY_CART` needs a service-level check, not `@ArrayNotEmpty`.** The decorator produces
  `VALIDATION_FAILED`, but the brief names empty cart as its own distinct error alongside
  missing fields. Throw it explicitly in the service so the code is distinct. (Keep
  `@ArrayNotEmpty` too — belt and braces, the service check wins.)
- **`forbidNonWhitelisted: true` may break your existing curl** if the payload carries any key
  not on the DTO. That's the pipe doing its job — a silently-ignored typo'd field is how bad
  sales data gets written. Fix the payload, not the pipe.
- `UNSUPPORTED_CURRENCY` (422, user error: we never claimed to support it) is a different thing
  from Slice 2's unknown-rate-pair (500, internal inconsistency: we claimed to and then
  couldn't). Don't merge them.
- Once the P2002 mapping exists, `externalRef` can go back into the README curl example if you
  want to show idempotency — a second run then returns a clean 409, not a 500.
- **After this slice the code is done.** Everything remaining is `docs/scaling.md`, the README
  design-decisions section, and the fresh-clone check. Do not start a fifth slice.

## Definition of Done

- [x] Curl with a known + an unknown barcode -> **201**, receipt has 1 matched line + 1 flagged
- [x] `unmatched_barcode_scans` -> the row is there, linked to the transaction AND the line item
- [x] Unmatched line has `unitPriceBase` / `lineTotalBase` populated and counts toward
      `totalBase` (unknown product still costs money) — verified live
- [x] `transaction_line_items WHERE "rawBarcode" IS NULL` -> **0 rows**
- [x] Empty cart -> 400 `EMPTY_CART`; bogus currency -> 422 `UNSUPPORTED_CURRENCY`;
      bad store -> 404 `STORE_NOT_FOUND`; missing field / unknown key -> 400 `VALIDATION_FAILED`
- [x] Same curl twice with `externalRef` -> 409 `DUPLICATE_SALE`, no stack trace, no SQL
- [x] Grep responses for `PrismaClient`, `constraint`, `at Object.` -> zero hits
- [x] Old 404-on-unknown-barcode assertion deleted; replaced with the 201/flagged assertions
- [x] `npm run lint` clean, all 13 tests green, no-DB tests still pass with no `DATABASE_URL`

> Note: DB columns are camelCase (Prisma tables use `@@map`, columns have no per-field `@map`),
> so the live checks used quoted camelCase identifiers (`"rawBarcode"`, `"fxRateSource"`,
> `"totalBase"`, `"lineTotalBase"`, `l."transactionId"`) rather than the snake_case above.

### Slice 2 close-out (now confirmed live)

- [x] `transactions WHERE "fxRateSource" = 'IDENTITY_V0'` -> **0**
- [x] Reconciliation `SUM("lineTotalBase") = "totalBase"` per transaction -> **0** mismatch rows

## History

<!-- Keep this updated. Earliest to latest -->

- Prisma + Neon PostgreSQL setup completed (9 models, initial migration, seed, app boots)
- Slice 1 — happy path: module/controller/service, DTOs, ReceiptMapper, decimal helper,
  single findMany lookup, atomic $transaction. Verified live (201, correct string totals,
  atomicity proven, zero float ops). Closed out and merged (PR #2).
- Slice 2 — FX snapshot: `FxModule`/`FxService` single `getRate()` seam, USD-anchored rate
  table (USD/EUR/GBP/CHF), `HARDCODED_V1`, 8dp ROUND_HALF_UP; unknown pair throws 500-class
  and logs, never defaults to 1
- Slice 2 — `src/config/env.validation.ts` wired into global `ConfigModule`; `BASE_CURRENCY`
  validated against the seeded whitelist at boot
- Slice 2 — `IDENTITY_V0` retired; real fx snapshot on transactions, `*_base` computed at
  write time, `totalBase` = SUM(line_total_base) so the receipt reconciles to its own lines
- Slice 2 — receipt §7 currency block; `fx.service.spec.ts` + `sales.service.spec.ts`, all
  no-DB; build + 8 tests green, lint clean
- Slice 2 — pending: live Neon DoD checks (IDENTITY_V0 count, reconciliation SQL)
- Slice 3 (3A unknown barcode + 3B validation/errors) merged into one pass to reduce cost
- Slice 2 close-out confirmed live: IDENTITY_V0 count = 0, reconciliation mismatch rows = 0
- 3A — unknown barcode no longer 404s: line written `productId=null` / `isUnmatched=true`,
  `rawBarcode` always set, `descriptionSnapshot=null`; FX still applied so it counts toward
  totals; one `unmatched_barcode_scans` row per unknown line written INSIDE the `$transaction`
  (rolls back with the sale), linked to both transaction and line item. Receipt gains per-line
  `matched`/`flag: UNKNOWN_BARCODE` and a derived top-level `warnings[]`. `Logger.warn` per
  unknown line. Sale still returns 201. Line-item ids generated client-side (randomUUID) so the
  scan log can reference the exact line
- 3B — global `ValidationPipe` (whitelist/forbidNonWhitelisted/transform) in `main.ts` with an
  exceptionFactory emitting `VALIDATION_FAILED` + flattened `details[]`; global
  `HttpExceptionFilter` produces the uniform `{ error: { code, message, details } }` envelope and
  never leaks Prisma text/SQL/stack (5xx collapse to opaque `INTERNAL_ERROR`). Domain errors in
  `src/common/errors.ts` (`DomainException` carrying `code`): EMPTY_CART 400 (service-level check,
  `@ArrayNotEmpty` dropped so it doesn't collapse into VALIDATION_FAILED), UNSUPPORTED_CURRENCY
  422, STORE_NOT_FOUND / CASHIER_NOT_FOUND 404, DUPLICATE_SALE 409 (P2002 caught in the service)
- Tests: `sales.service.spec.ts` — old 404 assertion deleted; added unknown-barcode (flagged
  line + scan row + FX applied), raw_barcode-always, EMPTY_CART, STORE_NOT_FOUND,
  UNSUPPORTED_CURRENCY, DUPLICATE_SALE. 13 tests green, build + lint clean
- Verified live against Neon on :3005 — full DoD curl matrix + DB invariants all pass
- Still remaining (not a 5th slice): `docs/scaling.md`, README design-decisions section,
  fresh-clone check