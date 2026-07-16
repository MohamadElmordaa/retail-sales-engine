import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { FxModule } from '../fx/fx.module';

// PrismaService comes from the global PrismaModule, so it needs no import here.
@Module({
  imports: [FxModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
