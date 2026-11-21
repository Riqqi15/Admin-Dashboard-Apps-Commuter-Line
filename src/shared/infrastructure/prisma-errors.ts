import { Prisma } from '../../generated/prisma/client';
import { AppError } from '../domain/errors';

// Maps database constraint errors to safe, stable API errors. Messages never name tables or constraints.
export function translatePrismaError(error: unknown): AppError | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  if (error.code === 'P2002') return new AppError(409, 'CONFLICT', 'Resource already exists');
  if (error.code === 'P2025') return new AppError(404, 'NOT_FOUND', 'Resource not found');
  if (error.code === 'P2003') return new AppError(409, 'RESOURCE_IN_USE', 'Resource is still referenced');
  return undefined;
}
