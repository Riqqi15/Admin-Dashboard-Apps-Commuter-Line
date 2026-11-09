import type { ErrorRequestHandler } from 'express';
import { AppError } from './errors';

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) { next(error); return; }
  let safe = new AppError(500, 'INTERNAL_ERROR', 'An internal error occurred');
  if (error instanceof AppError) safe = error;
  else if (error && typeof error === 'object' && 'type' in error) {
    switch (error.type) {
      case 'entity.too.large': safe = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the allowed size'); break;
      case 'entity.parse.failed': safe = new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON'); break;
      case 'encoding.unsupported':
      case 'charset.unsupported': safe = new AppError(415, 'UNSUPPORTED_ENCODING', 'Unsupported request encoding'); break;
    }
  }
  response.status(safe.status).json({ success: false, error: { code: safe.code, message: safe.message } });
};
