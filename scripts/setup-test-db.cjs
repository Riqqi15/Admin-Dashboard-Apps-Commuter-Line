const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { loadEnvFile } = require('node:process');
const { Client } = require('pg');

const root = resolve(__dirname, '..');
if (!process.env.DATABASE_URL && existsSync(resolve(root, '.env'))) loadEnvFile(resolve(root, '.env'));
if (process.env.NODE_ENV === 'production') throw new Error('Test database setup is development-only');

const source = new URL(process.env.DATABASE_URL);
if (source.hostname !== '127.0.0.1' || !['5434', '5435'].includes(source.port) || !['/timetable_admin', '/timetable_admin_test'].includes(source.pathname)) {
  throw new Error('Test database setup only targets the local capstone server on 127.0.0.1:5434/5435');
}
const target = new URL(source);
target.pathname = '/timetable_admin_test';
const maintenance = new URL(source);
maintenance.pathname = '/postgres';

async function main() {
  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'timetable_admin_test'");
    if (exists.rowCount === 0) {
      await client.query('CREATE DATABASE timetable_admin_test');
      console.log('Created database timetable_admin_test.');
    }
  } finally {
    await client.end();
  }
  // Credentials travel through the child environment, never through arguments or logs.
  const prisma = resolve(root, 'node_modules/prisma/build/index.js');
  const result = spawnSync(process.execPath, [prisma, 'migrate', 'deploy', '--config', 'prisma.config.ts'], {
    cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, DATABASE_URL: target.toString() },
  });
  if (result.status !== 0) throw new Error('Migration of timetable_admin_test failed');
  console.log('Test database timetable_admin_test is migrated (port ' + target.port + ').');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
