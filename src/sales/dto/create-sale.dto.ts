import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { LineItemDto } from './line-item.dto';

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

  // No @ArrayNotEmpty: an empty cart is its own distinct error (EMPTY_CART, thrown in the
  // service), not a generic VALIDATION_FAILED. @ArrayNotEmpty would short-circuit at the pipe
  // and collapse the two. @ValidateNested + @Type stay — without them the array is validated
  // as plain objects and every rule inside LineItemDto silently no-ops.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems: LineItemDto[];
}
