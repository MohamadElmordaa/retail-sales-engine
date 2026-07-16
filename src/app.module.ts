import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SalesModule } from './sales/sales.module';

@Module({
  imports: [PrismaModule, SalesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
