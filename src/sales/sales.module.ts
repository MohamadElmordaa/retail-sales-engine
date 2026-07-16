import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

// PrismaService comes from the global PrismaModule, so it needs no import here.
@Module({
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
