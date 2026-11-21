import type { RequestHandler } from 'express';

// Built once in the composition root so routers never see the database or the token service.
export type Guards = Readonly<{ session: RequestHandler; csrf: RequestHandler }>;
