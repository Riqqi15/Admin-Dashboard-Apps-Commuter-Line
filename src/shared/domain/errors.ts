export class AppError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export const notFound = () => new AppError(404, 'NOT_FOUND', 'Resource not found');
export const invalidSession = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
