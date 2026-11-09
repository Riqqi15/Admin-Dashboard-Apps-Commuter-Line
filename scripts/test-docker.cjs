const { loadEnvFile } = require('node:process');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

loadEnvFile(resolve(__dirname, '../.env'));
if (!process.env.npm_execpath) throw new Error('Run this check with npm run test:docker');
if (process.env.POSTGRES_DB !== 'timetable_admin' || !process.env.POSTGRES_USER || !process.env.POSTGRES_PASSWORD) throw new Error('Missing isolated Docker database configuration');
const port = process.env.DOCKER_DB_PORT || '5435';
if (port !== '5435') throw new Error('Integration fixtures only allow Docker port 5435; avoid targeting another database');
const database = new URL('postgresql://127.0.0.1:5435/timetable_admin');
database.username = process.env.POSTGRES_USER;
database.password = process.env.POSTGRES_PASSWORD;
// Pass credentials through process environment, never command arguments or logs.
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'test'], {
  cwd: resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true,
  env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: database.toString() },
});
process.exitCode = result.status ?? 1;
