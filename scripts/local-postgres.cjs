const { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { spawnSync } = require('node:child_process');
const net = require('node:net');
const { loadEnvFile } = require('node:process');

const root = resolve(__dirname, '..');
loadEnvFile(join(root, '.env'));
const base = join(root, '.local/postgres');
const data = join(base, 'data');
const bin = process.env.POSTGRES_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.port !== '5434' || url.pathname !== '/timetable_admin' || url.username !== 'admin_backend') {
  throw new Error('Local helper only accepts admin_backend@127.0.0.1:5434/timetable_admin');
}
if (process.env.NODE_ENV !== 'development') throw new Error('Native PostgreSQL helper is development-only');
const run = (executable, args, options = {}) => {
  const result = spawnSync(join(bin, executable + '.exe'), args, {
    encoding: 'utf8', timeout: 40000, windowsHide: true,
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }, ...options,
  });
  if (result.error || result.status !== 0) throw new Error(`${executable} failed; inspect .local/postgres/server.log (secrets hidden)`);
  return result.stdout || '';
};

async function main() {
  const action = process.argv[2] || 'start';
  if (!['start', 'stop', 'status'].includes(action)) throw new Error('Use start, stop or status');
  if (!existsSync(join(bin, 'pg_ctl.exe'))) throw new Error('PostgreSQL binaries unavailable; set POSTGRES_BIN');
  if (existsSync(join(data, 'PG_VERSION'))) {
    const owner = JSON.parse(readFileSync(join(base, 'owner.json'), 'utf8'));
    if (owner.root !== root || owner.port !== 5434 || owner.database !== 'timetable_admin') throw new Error('Cluster belongs to a different workspace');
  }
  if (action === 'stop') {
    run('pg_ctl', ['stop', '-D', data, '-m', 'fast', '-w', '-t', '20']);
    console.log('Stopped project PostgreSQL instance.');
    return;
  }
  if (action === 'status') {
    run('pg_ctl', ['status', '-D', data]);
    console.log('Project PostgreSQL instance is running.');
    return;
  }
  // Probe before touching data: never attach this helper to a different server on the same port.
  const probe = net.createServer();
  const available = await new Promise(resolvePort => {
    probe.once('error', () => resolvePort(false));
    probe.listen(5434, '127.0.0.1', () => probe.close(() => resolvePort(true)));
  });
  if (!available) {
    if (!existsSync(join(data, 'postmaster.pid'))) throw new Error('Port 5434 belongs to another process; refusing to continue');
    run('pg_ctl', ['status', '-D', data]);
    console.log('Kept existing project PostgreSQL instance.');
  }
  mkdirSync(base, { recursive: true });
  if (!existsSync(join(data, 'PG_VERSION'))) {
    if (existsSync(data)) throw new Error('Incomplete data directory; inspect it before retrying');
    const passwordPath = join(base, 'init-password.txt');
    writeFileSync(passwordPath, decodeURIComponent(url.password) + '\n', { flag: 'wx', mode: 0o600 });
    try {
      run('initdb', ['-D', data, '-U', 'admin_backend', '--pwfile=' + passwordPath,
        '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C']);
    } finally { unlinkSync(passwordPath); }
    writeFileSync(join(base, 'owner.json'), JSON.stringify({ root, port: 5434, database: 'timetable_admin' }) + '\n', { flag: 'wx' });
  } else {
    const owner = JSON.parse(readFileSync(join(base, 'owner.json'), 'utf8'));
    if (owner.root !== root) throw new Error('Cluster belongs to a different workspace');
  }
  // PostgreSQL's child must not inherit a captured stdout pipe on Windows.
  if (available) run('pg_ctl', ['start', '-D', data, '-l', join(base, 'server.log'), '-o', '-p 5434 -h 127.0.0.1', '-w', '-t', '20'], { stdio: 'ignore' });
  const exists = run('psql', ['-h', '127.0.0.1', '-p', '5434', '-U', 'admin_backend', '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname = 'timetable_admin'"]);
  if (exists.trim() !== '1') run('createdb', ['-h', '127.0.0.1', '-p', '5434', '-U', 'admin_backend', 'timetable_admin']);
  console.log('Project PostgreSQL ready at 127.0.0.1:5434 (database timetable_admin).');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
