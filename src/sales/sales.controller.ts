import { Body, Controller, Post, ValidationPipe } from '@nestjs/common';
import { CreateSaleDto } from './dto/create-sale.dto';
import { SalesService } from './sales.service';
import type { SaleReceipt } from './receipt/receipt.mapper';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  // Thin: parse -> delegate -> return. No Prisma, no math.
  // The local pipe runs the DTO decorators and applies @Type transforms this slice;
  // the global ValidationPipe (whitelist/forbidNonWhitelisted) moves to main.ts in Slice 4.
  @Post()
  create(
    @Body(new ValidationPipe({ transform: true })) dto: CreateSaleDto,
  ): Promise<SaleReceipt> {
    return this.salesService.create(dto);
  }
}
