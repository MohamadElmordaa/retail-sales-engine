import { Body, Controller, Post } from '@nestjs/common';
import { CreateSaleDto } from './dto/create-sale.dto';
import { SalesService } from './sales.service';
import type { SaleReceipt } from './receipt/receipt.mapper';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  // Thin: parse -> delegate -> return. No Prisma, no math. The global ValidationPipe
  // (whitelist/forbidNonWhitelisted/transform) in main.ts runs the DTO decorators.
  @Post()
  create(@Body() dto: CreateSaleDto): Promise<SaleReceipt> {
    return this.salesService.create(dto);
  }
}
