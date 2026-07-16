import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { LineItemDto } from './line-item.dto';

// Slice 1 validation is deliberately minimal — only what stops a crash. The
// global ValidationPipe (whitelist/forbidNonWhitelisted) and the proper
// EMPTY_CART / VALIDATION_FAILED envelope are Slice 4's job.
export class CreateSaleDto {
  @IsString()
  storeCode: string;

  @IsUUID()
  cashierId: string;

  @IsString()
  currencyCode: string;

  @IsOptional()
  @IsString()
  externalRef?: string;

  // @ValidateNested + @Type are NOT optional: without them the array is
  // validated as plain objects and every rule inside LineItemDto silently no-ops.
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems: LineItemDto[];
}
