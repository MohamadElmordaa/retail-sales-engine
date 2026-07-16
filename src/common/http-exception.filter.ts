import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client';

// Uniform error envelope. Every failure leaves the app as
//   { "error": { "code", "message", "details": [] } }
// and NOTHING else — no Prisma text, SQL, constraint names, or stack traces ever reach a
// client. 5xx are logged in full server-side and returned as an opaque INTERNAL_ERROR.
interface ErrorBody {
  code: string;
  message: string;
  details: unknown[];
}

const INTERNAL: ErrorBody = {
  code: 'INTERNAL_ERROR',
  message: 'An unexpected error occurred.',
  details: [],
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const where = `${req.method} ${req.url}`;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody = INTERNAL;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      if (status >= 500) {
        // Internal-class HttpException (e.g. FX_RATE_UNAVAILABLE): log the real thing,
        // return opaque. Never expose an internal code to the client.
        this.logger.error(`5xx on ${where}`, exception.stack);
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        body = INTERNAL;
      } else {
        body = this.fromHttpException(exception, status);
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Safety net — the service maps P2002 to DUPLICATE_SALE before it reaches here.
      // Anything still landing is unmapped: log the code, leak nothing.
      this.logger.error(`Unmapped Prisma error ${exception.code} on ${where}`);
      body = INTERNAL;
    } else {
      const stack =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`Unhandled error on ${where}`, stack);
      body = INTERNAL;
    }

    res.status(status).json({ error: body });
  }

  // Map an HttpException to the envelope. DomainExceptions already carry { code, message,
  // details }; framework exceptions (ValidationPipe, stray 404s) get a status-derived code.
  private fromHttpException(
    exception: HttpException,
    status: number,
  ): ErrorBody {
    const resp = exception.getResponse();
    if (typeof resp === 'object' && resp !== null && 'code' in resp) {
      const r = resp as Record<string, unknown>;
      return {
        code: String(r.code),
        message: typeof r.message === 'string' ? r.message : 'Request failed.',
        details: Array.isArray(r.details) ? r.details : [],
      };
    }

    // Default Nest shape: string, or { message: string | string[] }.
    const raw =
      typeof resp === 'string'
        ? resp
        : ((resp as { message?: unknown })?.message ?? 'Request failed.');
    const details = Array.isArray(raw) ? (raw as unknown[]) : [];
    return {
      code: statusToCode(status),
      message: details.length
        ? 'Validation failed.'
        : typeof raw === 'string'
          ? raw
          : 'Request failed.',
      details,
    };
  }
}

// Fallback code for framework exceptions not carrying our envelope (keyed by numeric status
// so there's no enum-vs-number comparison).
const STATUS_CODE: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
};

function statusToCode(status: number): string {
  return STATUS_CODE[status] ?? 'ERROR';
}
