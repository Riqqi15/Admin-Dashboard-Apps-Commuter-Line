const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const code = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const argon = require('argon2');
const { createPrisma } = require('./dist/lib/prisma.js');
assert.notEqual(process.getuid(), 0, 'API must not run as root');
for (const path of ['.env', '.env.seed.local', '.git', '.local', 'prisma/seed.ts', 'node_modules/prisma', 'node_modules/newman', 'node_modules/typescript', 'node_modules/tsx', 'node_modules/vitest', 'node_modules/supertest']) {
  assert.equal(fs.existsSync(path), false, 'Unexpected runtime artifact: ' + path);
}
const prisma = createPrisma(process.env.DATABASE_URL);
(async () => {
  const models = ['station', 'adminUser', 'adminSession', 'trackedUser', 'cameraSession', 'cameraEvent', 'alert', 'auditLog', 'dailyUsageStat'];
  for (const model of models) assert.ok((await prisma[model].count()) >= 0);
  const hash = await argon.hash('runtime-check-only', { type: argon.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  assert.equal(await argon.verify(hash, 'runtime-check-only'), true);
  console.log('PASS: Linux API is non-root; no secrets/dev tooling in filesystem; 9 PostgreSQL models readable; Argon2id works.');
})().catch(() => { console.error('Container runtime check failed (details hidden)'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
`;
const runtime = spawnSync('docker', ['compose', 'exec', '-T', 'api', 'node'], {
  cwd: root, input: code, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true,
});
if (runtime.status !== 0) process.exit(runtime.status || 1);
const id = spawnSync('docker', ['compose', 'ps', '-q', 'api'], { cwd: root, encoding: 'utf8', windowsHide: true });
assert.equal(id.status, 0, 'Cannot locate project API container');
const containerId = id.stdout.trim();
assert.match(containerId, /^[a-f0-9]{12,64}$/);
const inspect = spawnSync('docker', ['inspect', '--format', '{{.HostConfig.ReadonlyRootfs}}', containerId], { encoding: 'utf8', windowsHide: true });
assert.equal(inspect.status, 0);
assert.equal(inspect.stdout.trim(), 'true', 'API filesystem must be read-only');
console.log('PASS: Docker reports a read-only root filesystem.');
