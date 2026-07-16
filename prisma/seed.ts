import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

// Seeding runs over the DIRECT (non-pooler) connection — bulk writes and any
// prepared-statement reuse must not go through PgBouncer. See prisma.config.ts.
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DIRECT_URL (or DATABASE_URL) must be set to seed. See .env.example.');
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// A barcode we deliberately DO NOT seed a product for, so the unknown-barcode
// path in POST /sales is demonstrable straight from a clean seed.
const UNKNOWN_BARCODE_FOR_DEMO = '0000000000000';

async function main(): Promise<void> {
  // --- Reference data: currencies (also inserted in the migration; upserted here defensively) ---
  const currencies = [
    { code: 'USD', name: 'US Dollar', minorUnits: 2 },
    { code: 'EUR', name: 'Euro', minorUnits: 2 },
    { code: 'GBP', name: 'Pound Sterling', minorUnits: 2 },
    { code: 'CHF', name: 'Swiss Franc', minorUnits: 2 },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({
      where: { code: c.code },
      update: { name: c.name, minorUnits: c.minorUnits, isActive: true },
      create: c,
    });
  }

  // --- Demo data: stores across two regions ---
  const hannover = await prisma.store.upsert({
    where: { code: 'STR-001' },
    update: { name: 'Hannover Mitte', region: 'DE-NORD' },
    create: { code: 'STR-001', name: 'Hannover Mitte', region: 'DE-NORD' },
  });
  await prisma.store.upsert({
    where: { code: 'STR-002' },
    update: { name: 'München Zentrum', region: 'DE-SUED' },
    create: { code: 'STR-002', name: 'München Zentrum', region: 'DE-SUED' },
  });

  // --- Demo data: one cashier + one manager + one admin at STR-001 ---
  const cashier = await prisma.user.upsert({
    where: { email: 'cashier@str-001.example' },
    update: { fullName: 'Clara Kassierer', role: 'CASHIER', storeId: hannover.id },
    create: {
      email: 'cashier@str-001.example',
      fullName: 'Clara Kassierer',
      role: 'CASHIER',
      storeId: hannover.id,
    },
  });
  await prisma.user.upsert({
    where: { email: 'manager@str-001.example' },
    update: { fullName: 'Max Manager', role: 'MANAGER', storeId: hannover.id },
    create: {
      email: 'manager@str-001.example',
      fullName: 'Max Manager',
      role: 'MANAGER',
      storeId: hannover.id,
    },
  });
  await prisma.user.upsert({
    where: { email: 'admin@str-001.example' },
    update: { fullName: 'Adele Admin', role: 'ADMIN', storeId: hannover.id },
    create: {
      email: 'admin@str-001.example',
      fullName: 'Adele Admin',
      role: 'ADMIN',
      storeId: hannover.id,
    },
  });

  // --- Demo data: brands ---
  const brandNames = ['Nivea', 'Haribo', 'Lindt', 'Ritter Sport', 'Generic'];
  const brands: Record<string, string> = {};
  for (const name of brandNames) {
    const b = await prisma.brand.upsert({ where: { name }, update: {}, create: { name } });
    brands[name] = b.id;
  }

  // --- Demo data: categories (shallow hierarchy via self-reference) ---
  // findFirst+create rather than upsert: the (parentId, name) unique treats NULL
  // parentId as distinct in SQL, so an upsert on top-level rows isn't reliably idempotent.
  async function ensureCategory(name: string, parentId: string | null): Promise<string> {
    const existing = await prisma.category.findFirst({ where: { name, parentId } });
    if (existing) return existing.id;
    const created = await prisma.category.create({ data: { name, parentId } });
    return created.id;
  }
  const personalCare = await ensureCategory('Personal Care', null);
  const food = await ensureCategory('Food', null);
  const skinCare = await ensureCategory('Skin Care', personalCare);
  const confectionery = await ensureCategory('Confectionery', food);

  // --- Demo data: products (some with externalRef, some without) ---
  // Real EAN barcodes. 4006381333931 is referenced in the README curl examples.
  const products = [
    { barcode: '4006381333931', sku: 'NIV-CRM-075', name: 'Nivea Creme 75ml', brand: 'Nivea', category: skinCare, externalRef: 'ERP-1001' },
    { barcode: '4005808888888', sku: 'NIV-LOT-250', name: 'Nivea Body Lotion 250ml', brand: 'Nivea', category: skinCare, externalRef: 'ERP-1002' },
    { barcode: '4005900123456', sku: 'NIV-DEO-150', name: 'Nivea Deo Spray 150ml', brand: 'Nivea', category: personalCare, externalRef: null },
    { barcode: '4001686301227', sku: 'HAR-GLD-200', name: 'Haribo Goldbären 200g', brand: 'Haribo', category: confectionery, externalRef: 'ERP-2001' },
    { barcode: '4001686315095', sku: 'HAR-COL-175', name: 'Haribo Color-Rado 175g', brand: 'Haribo', category: confectionery, externalRef: null },
    { barcode: '4001686386774', sku: 'HAR-TRO-200', name: 'Haribo Tropifrutti 200g', brand: 'Haribo', category: confectionery, externalRef: 'ERP-2003' },
    { barcode: '7610400071451', sku: 'LIN-EXC-100', name: 'Lindt Excellence 70% 100g', brand: 'Lindt', category: confectionery, externalRef: 'ERP-3001' },
    { barcode: '7610400012341', sku: 'LIN-LIN-200', name: 'Lindt Lindor Milk 200g', brand: 'Lindt', category: confectionery, externalRef: null },
    { barcode: '4000417025005', sku: 'RIT-ALP-100', name: 'Ritter Sport Alpine Milk 100g', brand: 'Ritter Sport', category: confectionery, externalRef: 'ERP-4001' },
    { barcode: '4000417100016', sku: 'RIT-HAZ-100', name: 'Ritter Sport Whole Hazelnut 100g', brand: 'Ritter Sport', category: confectionery, externalRef: null },
    { barcode: '4000417019004', sku: 'RIT-MAR-100', name: 'Ritter Sport Marzipan 100g', brand: 'Ritter Sport', category: confectionery, externalRef: 'ERP-4003' },
    { barcode: '4005808123451', sku: 'NIV-SHM-250', name: 'Nivea Shampoo 250ml', brand: 'Nivea', category: personalCare, externalRef: null },
    { barcode: '4001686111116', sku: 'HAR-PHA-200', name: 'Haribo Phantasia 200g', brand: 'Haribo', category: confectionery, externalRef: 'ERP-2005' },
    { barcode: '7610400099998', sku: 'LIN-GLD-100', name: 'Lindt Gold Bunny 100g', brand: 'Lindt', category: confectionery, externalRef: null },
    { barcode: '4000417055002', sku: 'RIT-COR-100', name: 'Ritter Sport Cornflakes 100g', brand: 'Ritter Sport', category: confectionery, externalRef: 'ERP-4005' },
    { barcode: '4005808777771', sku: 'NIV-HND-100', name: 'Nivea Hand Cream 100ml', brand: 'Nivea', category: skinCare, externalRef: null },
    { barcode: '4001686222225', sku: 'HAR-STM-200', name: 'Haribo Starmix 200g', brand: 'Haribo', category: confectionery, externalRef: 'ERP-2007' },
    { barcode: '7610400055551', sku: 'LIN-HEL-100', name: 'Lindt Hello Cookies 100g', brand: 'Lindt', category: confectionery, externalRef: null },
    { barcode: '4000417088009', sku: 'RIT-YOG-100', name: 'Ritter Sport Yogurt 100g', brand: 'Ritter Sport', category: confectionery, externalRef: 'ERP-4009' },
    { barcode: '5000000000004', sku: 'GEN-BAG-001', name: 'Reusable Shopping Bag', brand: 'Generic', category: null, externalRef: null },
  ];
  for (const p of products) {
    await prisma.product.upsert({
      where: { barcode: p.barcode },
      update: {
        sku: p.sku,
        name: p.name,
        brandId: brands[p.brand],
        categoryId: p.category,
        externalRef: p.externalRef,
        isActive: true,
      },
      create: {
        barcode: p.barcode,
        sku: p.sku,
        name: p.name,
        brandId: brands[p.brand],
        categoryId: p.category,
        externalRef: p.externalRef,
      },
    });
  }

  // --- Print what the README curl examples need ---
  console.log('\n✅ Seed complete.\n');
  console.log('  Store code   :', hannover.code, `(${hannover.name}, ${hannover.region})`);
  console.log('  Cashier id   :', cashier.id);
  console.log('  Cashier email:', cashier.email);
  console.log('  Sample barcode (matched)  :', products[0].barcode, `-> ${products[0].name}`);
  console.log('  Sample barcode (UNMATCHED):', UNKNOWN_BARCODE_FOR_DEMO, '-> intentionally not in catalogue');
  console.log('');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
