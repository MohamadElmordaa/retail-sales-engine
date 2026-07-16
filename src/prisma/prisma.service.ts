import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// Runtime database access for the app.
//
// Prisma 7 requires a driver adapter. We use @prisma/adapter-pg (node-postgres)
// over the POOLED DATABASE_URL — a plain TCP connection, correct for a long-lived
// NestJS process. We deliberately do NOT use @prisma/adapter-neon / @neondatabase/serverless:
// those are for edge runtimes that can't hold a socket. Neon stays a deployment detail,
// so DATABASE_URL can point at Neon, a local Postgres, or a colleague's box unchanged.
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. Copy .env.example to .env and fill it in.',
      );
    }
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
