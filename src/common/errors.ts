import { HttpException, HttpStatus } from '@nestjs/common';

// Every client-facing error carries a stable `code` — clients branch on it, never on the
// human `message` (project brief §Errors). The envelope is produced by HttpExceptionFilter.
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'EMPTY_CART'
  | 'UNSUPPORTED_CURRENCY'
  | 'STORE_NOT_FOUND'
  | 'CASHIER_NOT_FOUND'
  | 'DUPLICATE_SALE'
  | 'INTERNAL_ERROR';

// A domain error whose HTTP response body already carries { code, message, details }.
// The filter reads `code` straight off getResponse() — no status->code guessing for these.
export class DomainException extends HttpException {
  constructor(
    status: HttpStatus,
    code: ErrorCode,
    message: string,
    details: unknown[] = [],
  ) {
    super({ code, message, details }, status);
  }
}

export const emptyCart = () =>
  new DomainException(
    HttpStatus.BAD_REQUEST,
    'EMPTY_CART',
    'A sale must contain at least one line item.',
  );

export const unsupportedCurrency = (code: string) =>
  new DomainException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'UNSUPPORTED_CURRENCY',
    `Currency '${code}' is not supported.`,
  );

export const storeNotFound = (code: string) =>
  new DomainException(
    HttpStatus.NOT_FOUND,
    'STORE_NOT_FOUND',
    `No store matches code '${code}'.`,
  );

export const cashierNotFound = (id: string) =>
  new DomainException(
    HttpStatus.NOT_FOUND,
    'CASHIER_NOT_FOUND',
    `No cashier matches id '${id}'.`,
  );

export const duplicateSale = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    'DUPLICATE_SALE',
    'A sale with this externalRef already exists for this store.',
  );
