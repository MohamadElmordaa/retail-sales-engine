-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('CASHIER', 'MANAGER', 'ADMIN');

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "minorUnits" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandId" UUID,
    "categoryId" UUID,
    "externalRef" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "externalRef" TEXT,
    "currencyCode" CHAR(3) NOT NULL,
    "baseCurrencyCode" CHAR(3) NOT NULL,
    "fxRate" DECIMAL(18,8) NOT NULL,
    "fxRateSource" TEXT NOT NULL DEFAULT 'HARDCODED_V1',
    "fxCapturedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" DECIMAL(14,4) NOT NULL,
    "total" DECIMAL(14,4) NOT NULL,
    "totalBase" DECIMAL(14,4) NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_line_items" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "productId" UUID,
    "rawBarcode" TEXT NOT NULL,
    "isUnmatched" BOOLEAN NOT NULL DEFAULT false,
    "descriptionSnapshot" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "lineTotal" DECIMAL(14,4) NOT NULL,
    "unitPriceBase" DECIMAL(14,4) NOT NULL,
    "lineTotalBase" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "transaction_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unmatched_barcode_scans" (
    "id" UUID NOT NULL,
    "rawBarcode" TEXT NOT NULL,
    "storeId" UUID NOT NULL,
    "transactionId" UUID,
    "lineItemId" UUID,
    "scannedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ,

    CONSTRAINT "unmatched_barcode_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stores_code_key" ON "stores"("code");

-- CreateIndex
CREATE INDEX "stores_region_idx" ON "stores"("region");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_storeId_role_idx" ON "users"("storeId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_parentId_name_key" ON "categories"("parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_brandId_idx" ON "products"("brandId");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "transactions_occurredAt_idx" ON "transactions"("occurredAt");

-- CreateIndex
CREATE INDEX "transactions_storeId_occurredAt_idx" ON "transactions"("storeId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_storeId_externalRef_key" ON "transactions"("storeId", "externalRef");

-- CreateIndex
CREATE INDEX "transaction_line_items_transactionId_idx" ON "transaction_line_items"("transactionId");

-- CreateIndex
CREATE INDEX "transaction_line_items_productId_idx" ON "transaction_line_items"("productId");

-- CreateIndex
CREATE INDEX "transaction_line_items_rawBarcode_idx" ON "transaction_line_items"("rawBarcode");

-- CreateIndex
CREATE INDEX "unmatched_barcode_scans_rawBarcode_idx" ON "unmatched_barcode_scans"("rawBarcode");

-- CreateIndex
CREATE INDEX "unmatched_barcode_scans_storeId_scannedAt_idx" ON "unmatched_barcode_scans"("storeId", "scannedAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_baseCurrencyCode_fkey" FOREIGN KEY ("baseCurrencyCode") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_line_items" ADD CONSTRAINT "transaction_line_items_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_line_items" ADD CONSTRAINT "transaction_line_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmatched_barcode_scans" ADD CONSTRAINT "unmatched_barcode_scans_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmatched_barcode_scans" ADD CONSTRAINT "unmatched_barcode_scans_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Hand-added constraints Prisma's schema DSL cannot express (see
-- context/project-overview.md §4.4). Columns stay camelCase because only tables
-- are @@map'd to snake_case; the model fields are not.
-- ============================================================================

-- external_ref is a join key to an external system: unique when present, but
-- most products have none. A plain UNIQUE would forbid more than one NULL, so we
-- use a partial unique index that only applies to non-NULL values.
CREATE UNIQUE INDEX "products_external_ref_key"
  ON "products" ("externalRef") WHERE "externalRef" IS NOT NULL;

-- A line item is either matched to a product OR flagged unmatched — never both,
-- never neither. Encodes the invariant that productId IS NULL <=> isUnmatched.
ALTER TABLE "transaction_line_items"
  ADD CONSTRAINT "line_item_match_consistency"
  CHECK (("productId" IS NULL) = "isUnmatched");

-- You cannot sell zero or a negative quantity.
ALTER TABLE "transaction_line_items"
  ADD CONSTRAINT "line_item_qty_positive" CHECK ("quantity" > 0);

-- Prices are never negative (returns/refunds are out of scope).
ALTER TABLE "transaction_line_items"
  ADD CONSTRAINT "line_item_price_non_negative" CHECK ("unitPrice" >= 0);

-- A snapshotted FX rate must be a positive multiplier.
ALTER TABLE "transactions"
  ADD CONSTRAINT "txn_fx_rate_positive" CHECK ("fxRate" > 0);

-- Covering index for the Task 3 reporting shape: "recent sales totals per store".
-- DESC matches the newest-first scan; INCLUDE(totalBase) makes it index-only so
-- reports never touch the heap. Reports read base-currency columns only.
CREATE INDEX "transactions_store_occurred_at_idx"
  ON "transactions" ("storeId", "occurredAt" DESC) INCLUDE ("totalBase");

-- ============================================================================
-- Reference data the app cannot boot without: the supported-currency whitelist.
-- This is arguably schema, not fixtures, so it ships with the DDL and can never
-- be forgotten. The seed re-upserts these defensively. ON CONFLICT keeps the
-- migration idempotent if a currency row already exists.
-- ============================================================================
INSERT INTO "currencies" ("code", "name", "minorUnits", "isActive") VALUES
  ('USD', 'US Dollar', 2, true),
  ('EUR', 'Euro', 2, true),
  ('GBP', 'Pound Sterling', 2, true),
  ('CHF', 'Swiss Franc', 2, true)
ON CONFLICT ("code") DO NOTHING;
