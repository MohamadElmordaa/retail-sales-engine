# Current Feature

POST /sales — FX Snapshot (Slice 2 of 4)

## Status

<!-- Not Started|In Progress|Completed -->

In Progress

## Goals

<!-- Goals & requirements -->

### Step 0 — close out Slice 1 first (~15 min)

Three items, then Slice 1 flips to Completed. Don't start FX with these hanging.

- **README curl example.** Append only — don't rewrite the README (that was declined once
  already; a targeted append won't be). Use the store code + cashier UUID the seed prints.
  **Omit `externalRef`** from the example: `@@unique([storeId, externalRef])` means a reviewer
  who runs your curl twice gets a raw `P2002` -> unhandled 500, because Slice 4 hasn't mapped
  Prisma errors yet. It's an optional field. Leave it out and the example stays re-runnable.
- **Delete the `POS-TEST-0001` row** from Neon. It's the only `IDENTITY_V0` row in there and
  Slice 2's DoD greps for exactly that.
- **Commit + push** `feature/sales-endpoint-slice1`.

### Then — Slice 2 proper

Replace the `IDENTITY_V0` placeholder with a real hardcoded rate table and permanently
snapshot the applied rate. This is the requirement the brief spelled out the reasoning for —
*"must permanently record the exchange rate that was applied at time of sale, not derive it
later"* — so it gets built properly, not gestured at.

- `FxModule` / `FxService` in `src/fx/`. Exports `FxService` only.
- `FxService.getRate(from: string, to: string): { rate: Decimal; source: string }` — the
  **single** seam. No rate literal exists anywhere outside `src/fx/`.
- Rate table covers every currency seeded in `currencies` (USD, EUR, GBP, CHF). Source tag
  `'HARDCODED_V1'`.
- `BASE_CURRENCY` from validated config (default `USD`), not `process.env` at the call site.
- `transactions` writes real `fx_rate`, `base_currency_code = BASE_CURRENCY`,
  `fx_rate_source = 'HARDCODED_V1'`, `fx_captured_at = now()`.
- Line items write `unit_price_base` and `line_total_base`, computed **at write time**.
- Receipt exposes the §7 `currency` block: `{ code, baseCode, fxRate, fxRateSource }`,
  `fxRate` stringified at 8dp.
- **No schema change.** The columns already exist — this slice only stops lying to them.

### Out of scope (still)

- Slice 3 — Unknown barcode: nullable `productId`, scan log, `warnings[]`, sale completes.
- Slice 4 — Validation & errors: `ValidationPipe`, `HttpExceptionFilter`, error envelope,
  empty cart / missing fields / unsupported currency / 404s, `P2002` -> domain error.

## Notes

<!-- Any extra notes -->

- **Rate direction, stated once so it's never ambiguous:** `rate` = how many units of the
  base currency one unit of the transaction currency buys. `totalBase = total x rate`.
  EUR 8.18 x 1.0842 = USD 8.8688. Put this in a comment above the rate table — a reversed FX
  rate is the classic silent bug. It produces plausible-looking numbers forever.
- **`totalBase` = sum of `line_total_base`. NOT `total x rate`.** The two differ by fractions
  of a cent once rounding enters, and then the receipt doesn't reconcile against its own
  lines. Compute per line, then sum.
- **`line_total_base` = `lineTotal.mul(rate)`. NOT `unitPriceBase.mul(quantity)`.** The second
  rounds the unit price to 4dp *then* multiplies, so the error scales with quantity.
  `unit_price_base` is informational — derive it, don't build on it.
- Round explicitly, once, per computed value: `.toDecimalPlaces(4, Decimal.ROUND_HALF_UP)`.
- A USD sale is not a special case. `getRate('USD','USD')` returns `1.00000000` /
  `'HARDCODED_V1'` and flows the identical path. Resist `if (same) skip` — that branch is
  where the untested code lives.
- **Unknown currency pair** (in `currencies` but missing from the rate table) is an internal
  consistency failure -> throw a 500-class error, log loudly. Never silently default to 1.
  User-facing `UNSUPPORTED_CURRENCY` (422) is Slice 4 and is a different thing: a currency we
  never claimed to support.
- The rate table is hardcoded *deliberately* — no live API, per the brief. Say so in a
  comment so a reviewer reads it as a scoped decision, not an unfinished one.
- Slice 3 remains the highest-value remaining work. If time collapses: Slice 3 > tests >
  Slice 4 polish.
- `docs/scaling.md` (Task 3, 200 words) is still not written. It's a third of the assessment
  and it's the only deliverable with nothing on disk.

## Definition of Done

- [ ] `SELECT COUNT(*) FROM transactions WHERE fx_rate_source = 'IDENTITY_V0'` -> **0**
      (needs live Neon check)
- [x] `IDENTITY_V0` appears nowhere in `src/` — string fully retired
- [x] EUR sale: receipt shows `fxRate: "1.08420000"`, `totalBase` != `total` (asserted in unit test)
- [x] USD sale: `fxRate: "1.00000000"`, `totalBase` === `total` (asserted in unit test)
- [ ] Reconciliation passes:
      `SELECT t.id FROM transactions t JOIN transaction_line_items l ON l.transaction_id = t.id
       GROUP BY t.id, t.total_base HAVING SUM(l.line_total_base) <> t.total_base;` -> **0 rows**
      (needs live Neon check; per-line-then-sum reconciliation covered by unit test)
- [x] Grep `src/` outside `src/fx/` for rate literals — zero hits
- [x] Unit tests: EUR conversion, USD identity, per-line-then-sum reconciliation, unknown pair
      throws. All pass with no database.
- [x] `npm run lint` clean

## History

<!-- Keep this updated. Earliest to latest -->

- Prisma + Neon PostgreSQL setup completed (9 models, initial migration, seed, app boots)
- Slice 1 started; status set to In Progress
- Built SalesModule/Controller/Service, CreateSale + LineItem DTOs, ReceiptMapper, and
  `src/common/decimal.ts` money helper (fixed-scale formatting, no float ops)
- Identity FX applied (fxRate = 1, baseCurrencyCode = currencyCode, fxRateSource =
  IDENTITY_V0, totalBase = total); single findMany product lookup; atomic $transaction (15s/5s)
- Verified live against Neon: happy path -> 201 with correct string totals (8.9700);
  unknown barcode/store -> 404; atomicity proven (failed line-item insert left no orphan txn)
- Build passes, eslint clean (exit 0), unit tests green; DoD float-op grep returns zero hits
- Slice 1 closed out and merged (PR #2): README curl added, POS-TEST-0001 removed, main synced
- Slice 2 started; status set to In Progress; added @nestjs/config for validated BASE_CURRENCY
- Built `FxModule`/`FxService` in `src/fx/`: single `getRate()` seam, USD-anchored rate table
  (USD/EUR/GBP/CHF), `HARDCODED_V1` source, 8dp `ROUND_HALF_UP`; unknown pair throws a
  500-class `InternalServerErrorException` and logs loudly (never defaults to 1)
- Added `src/config/env.validation.ts` (class-validator) wired into global `ConfigModule`;
  `BASE_CURRENCY` validated against the seeded currency whitelist at boot, default USD
- Retired `IDENTITY_V0`: `SalesService` now snapshots real `fxRate`/`baseCurrencyCode`/
  `fxRateSource`, computes `unit_price_base` + `line_total_base` at write time, and sets
  `totalBase` = SUM(line_total_base) so the receipt reconciles to its own lines
- Receipt §7 `currency` block exposes `{ code, baseCode, fxRate, fxRateSource }`, `fxRate`
  stringified at 8dp via `toRateString`
- Unit tests: `fx.service.spec.ts` (EUR conversion, USD identity, unknown-pair throws) and
  `sales.service.spec.ts` (EUR reconciliation, USD identity, unknown-barcode 404), all no-DB;
  typed the Prisma/Fx mocks so `npm run lint` is clean. build + 8 tests green
- Still pending: live Neon DoD checks (IDENTITY_V0 count, reconciliation SQL) and `docs/scaling.md`