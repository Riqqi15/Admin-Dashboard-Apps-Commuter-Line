import { loadEnvFile } from 'node:process';

// Tests never touch the demo database: they derive the dedicated *_test database on the same local server.
export function testDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) loadEnvFile('.env');
  const url = new URL(process.env.DATABASE_URL!);
  if (url.pathname === '/timetable_admin') url.pathname = '/timetable_admin_test';
  if (url.hostname !== '127.0.0.1' || !['5434', '5435'].includes(url.port) || url.pathname !== '/timetable_admin_test') {
    throw new Error('Tests require the isolated timetable_admin_test database on 127.0.0.1:5434/5435');
  }
  return url.toString();
}
