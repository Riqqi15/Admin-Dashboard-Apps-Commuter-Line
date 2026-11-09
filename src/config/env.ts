import { z } from 'zod';

const integer = (fallback: string, min: number, max: number) =>
  z.string().regex(/^\d+$/).default(fallback).transform(Number).pipe(z.number().int().min(min).max(max));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  HOST: z.enum(['127.0.0.1', '0.0.0.0', '::1']).default('127.0.0.1'),
  PORT: integer('3000', 1, 65535),
  DATABASE_URL: z.url().refine(value => /^postgres(?:ql)?:\/\//.test(value)),
  SESSION_PEPPER: z.string().min(32),
  PII_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  CORS_ORIGIN: z.url().refine(value => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  }),
  TRUST_PROXY_HOPS: integer('0', 0, 10),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
  SIMULATOR_INGEST_KEY: z.string().min(32).optional(),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== 'production') return;
  const origin = URL.canParse(value.CORS_ORIGIN) ? new URL(value.CORS_ORIGIN) : undefined;
  const local = origin && (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(origin.hostname) || origin.hostname.endsWith('.localhost'));
  if (!origin || origin.protocol !== 'https:' || local) {
    context.addIssue({ code: 'custom', path: ['CORS_ORIGIN'], message: 'Production requires a remote HTTPS origin' });
  }
  if (value.SIMULATOR_INGEST_KEY !== undefined) {
    context.addIssue({ code: 'custom', path: ['SIMULATOR_INGEST_KEY'], message: 'Simulator disabled in production' });
  }
});

export type Env = z.infer<typeof schema>;

export function parseEnv(input: Record<string, string | undefined>): Env {
  const result = schema.safeParse(input);
  const fields = result.success ? [] : result.error.issues.map(issue => issue.path.join('.'));
  if (input.NODE_ENV === 'production' && input.TRUST_PROXY_HOPS === undefined) fields.push('TRUST_PROXY_HOPS');
  // Only field names are reported; Zod input and secrets never enter startup logs.
  if (!result.success || fields.length) throw new Error(`Invalid environment: ${[...new Set(fields)].join(', ')}`);
  return result.data;
}
