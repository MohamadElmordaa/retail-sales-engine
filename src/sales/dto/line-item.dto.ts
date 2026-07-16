import { IsInt, IsNumberString, IsString, Min } from 'class-validator';

// One scanned line. Money arrives as a string — a JSON number has already lost
// precision by the time class-validator sees it (coding-standards.md §Money).
export class LineItemDto {
  @IsString()
  barcode: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumberString()
  unitPrice: string;
}
