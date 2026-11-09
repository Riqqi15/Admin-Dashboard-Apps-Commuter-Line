import { createPrisma } from '../src/lib/prisma';
import { seedDemo } from '../src/lib/seed';

async function main() {
  if (process.env.NODE_ENV !== 'development') throw new Error('Demo seed requires development mode');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const target = new URL(url);
  if (target.hostname !== '127.0.0.1' || target.port !== '5434' || target.pathname !== '/timetable_admin') throw new Error('Demo seed only targets isolated local capstone database');
  const prisma = createPrisma(url);
  try {
    const result = await prisma.$transaction(tx => seedDemo(tx, process.env), { timeout: 15000 });
    console.log(JSON.stringify(result, null, 2));
    console.log('Demo seed completed; passwords/hashes not printed. Existing passwords were preserved.');
  } finally { await prisma.$disconnect(); }
}

main().catch(() => { console.error('Seed failed; verify local database, mode, and seed credentials.'); process.exitCode = 1; });
