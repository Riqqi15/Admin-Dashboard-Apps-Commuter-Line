const { randomBytes } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const databasePassword = randomBytes(24).toString('hex');
const values = {
  NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3000',
  CORS_ORIGIN: 'http://localhost:5173', TRUST_PROXY_HOPS: '0', LOG_LEVEL: 'info',
  POSTGRES_DB: 'timetable_admin', POSTGRES_USER: 'admin_backend',
  POSTGRES_PASSWORD: databasePassword,
  DATABASE_URL: `postgresql://admin_backend:${databasePassword}@127.0.0.1:5434/timetable_admin`,
  SESSION_PEPPER: randomBytes(32).toString('hex'),
  PII_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
};
try {
  writeFileSync(resolve(__dirname, '../.env'), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Created local .env with random secrets (values hidden).');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Kept existing .env; no values were overwritten.');
}
