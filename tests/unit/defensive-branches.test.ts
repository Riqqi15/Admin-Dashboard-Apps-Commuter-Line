import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client';
import { translatePrismaError } from '../../src/shared/infrastructure/prisma-errors';
import { getAuth } from '../../src/shared/presentation/get-auth';

describe('defensive branches', () => {
  it('getAuth rejects a request that no guard authenticated', () => {
    expect(() => getAuth({} as Request)).toThrowError(expect.objectContaining({ status: 401, code: 'UNAUTHENTICATED' }) as Error);
  });

  it('leaves unknown Prisma codes and non-Prisma errors to the generic 500 handler', () => {
    expect(translatePrismaError(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2034', clientVersion: 'test' }))).toBeUndefined();
    expect(translatePrismaError(new Error('plain'))).toBeUndefined();
  });
});
