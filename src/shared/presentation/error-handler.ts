import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../domain/errors';

// Adapters translate infrastructure errors (for example database constraints); the composition root injects the translator.
export type ErrorTranslator = (error: unknown) => AppError | undefined;

export const createErrorHandler = (translate: ErrorTranslator): ErrorRequestHandler => (error: unknown, _request, response, next) => {
  if (response.headersSent) { next(error); return; }
  let safe = new AppError(500, 'INTERNAL_ERROR', 'An internal error occurred');
  if (error instanceof AppError) safe = error;
  else if (error instanceof ZodError) safe = new AppError(400, 'VALIDATION_ERROR', 'Request fields are invalid');
  else {
    const translated = translate(error);
    if (translated) safe = translated;
    else if (error && typeof error === 'object' && 'type' in error) {
      switch (error.type) {
        case 'entity.too.large': safe = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the allowed size'); break;
        case 'entity.parse.failed': safe = new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON'); break;
        case 'encoding.unsupported':
        case 'charset.unsupported': safe = new AppError(415, 'UNSUPPORTED_ENCODING', 'Unsupported request encoding'); break;
      }
    }
  }
  response.status(safe.status).json({ success: false, error: { code: safe.code, message: safe.message } });
};
