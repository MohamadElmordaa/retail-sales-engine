import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 moves CLI configuration out of schema.prisma into this file.
//
// datasource.url is what the Prisma CLI uses for migrate / seed / studio, so it
// MUST be the DIRECT (non-pooler) Neon host. PgBouncer's transaction pooling
// breaks the session state that DDL and prepared statements rely on.
//
// The running application does NOT use this url — it connects via the pooled
// DATABASE_URL through the @prisma/adapter-pg adapter in src/prisma/prisma.service.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Prisma 7 no longer auto-seeds after `migrate dev`; run `prisma db seed` explicitly.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
});
