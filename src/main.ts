import 'dotenv/config';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { ValidationError } from 'class-validator';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // One global pipe for every route. whitelist strips unknown keys; forbidNonWhitelisted
  // rejects them loudly (a typo'd field is how bad sales data gets written); transform runs
  // @Type so nested DTOs and numeric coercion actually apply.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed.',
          details: flattenValidationErrors(errors),
        }),
    }),
  );

  // One global filter — every error leaves as the uniform { error } envelope.
  app.useGlobalFilters(new HttpExceptionFilter());

  // Let Nest run onModuleDestroy ($disconnect) on SIGINT/SIGTERM.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

// Flatten class-validator's nested error tree into flat "field: reason" strings for details[].
function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      for (const reason of Object.values(error.constraints)) {
        messages.push(`${path}: ${reason}`);
      }
    }
    if (error.children?.length) {
      messages.push(...flattenValidationErrors(error.children, path));
    }
  }
  return messages;
}

void bootstrap();
