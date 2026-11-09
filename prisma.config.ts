import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { defineConfig, env } from 'prisma/config';

if (existsSync(resolve(__dirname, '.env'))) loadEnvFile(resolve(__dirname, '.env'));

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx --env-file-if-exists=.env prisma/seed.ts' },
  datasource: { url: env('DATABASE_URL') },
});
