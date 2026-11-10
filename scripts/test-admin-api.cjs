const { randomBytes, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { loadEnvFile } = require('node:process');
const { resolve } = require('node:path');
const newman = require('newman');
const { createApp } = require('../dist/app');
const { parseEnv } = require('../dist/config/env');
const { createPrisma } = require('../dist/lib/prisma');
const { hashPassword } = require('../dist/lib/password');

async function main() {
  loadEnvFile(resolve(__dirname, '../.env'));
  if (process.env.NODE_ENV === 'production') throw new Error('Development-only API workflow');
  const config = parseEnv({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' });
  const target = new URL(config.DATABASE_URL);
  if (target.hostname !== '127.0.0.1' || !['5434', '5435'].includes(target.port) || target.pathname !== '/timetable_admin') throw new Error('Isolated local capstone database required');
  const db = createPrisma(config.DATABASE_URL);
  const prefix = 'test.' + randomUUID().slice(0, 8);
  const password = () => randomBytes(24).toString('hex');
  const server = createServer(createApp(config, undefined, () => db.$queryRaw`SELECT 1`, db));
  try {
    const station = await db.station.create({ data: { code: (prefix + '-A').toUpperCase(), name: 'Postman fixture A' } });
    const other = await db.station.create({ data: { code: (prefix + '-B').toUpperCase(), name: 'Postman fixture B' } });
    const adminPassword = password();
    const admin = await db.adminUser.create({ data: { username: prefix + '.admin', passwordHash: await hashPassword(adminPassword), role: 'SUPER_ADMIN', mustChangePassword: true } });
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
    const port = server.address().port;
    const collection = JSON.parse(readFileSync(resolve(__dirname, '../postman/Timetable-Admin.postman_collection.json'), 'utf8'));
    const environment = JSON.parse(readFileSync(resolve(__dirname, '../postman/Local.postman_environment.json'), 'utf8'));
    const variables = {
      baseUrl: 'http://127.0.0.1:' + port, origin: config.CORS_ORIGIN,
      superAdminUsername: admin.username, superAdminPassword: adminPassword,
      currentPassword: adminPassword, newPassword: password(),
      stationId: station.id, otherStationId: other.id,
      managedStationCode: (prefix + '-C').toUpperCase(), managedStationName: 'Postman fixture C', managedStationUpdatedName: 'Postman fixture C updated',
      managedStaffUsername: prefix + '.staff', managedStaffPassword: password(), managedStaffResetPassword: password(), managedStaffNewPassword: password(),
    };
    variables.stationSecurityUsername = variables.managedStaffUsername;
    variables.stationSecurityPassword = variables.managedStaffResetPassword;
    for (const variable of environment.values) if (Object.hasOwn(variables, variable.key)) variable.value = variables[variable.key];
    const all = collection.item.flatMap(folder => folder.item);
    const copy = (name, label = name) => {
      const item = all.find(candidate => candidate.name === name);
      if (!item) throw new Error('Missing implemented Collection request: ' + name);
      return { ...structuredClone(item), name: label };
    };
    const ownStations = copy('List Stations', 'List Own Station');
    ownStations.event.push({ listen: 'test', script: { type: 'text/javascript', exec: [
      'pm.test("Only assigned station is returned", () => pm.expect(pm.response.json().data.items.map(s => s.id)).to.eql([pm.environment.get("managedStationId")]));',
    ] } });
    const changeStaffPassword = copy('Change Password', 'Change Staff Temporary Password');
    changeStaffPassword.request.body.raw = JSON.stringify({ currentPassword: '{{managedStaffResetPassword}}', newPassword: '{{managedStaffNewPassword}}' });
    const requests = collection.item.slice(0, 5).flatMap(folder => structuredClone(folder.item));
    requests.push(
      copy('Logout', 'Logout as Super Admin'), copy('Login as Station A Security', 'Login as Created Staff'),
      copy('Require Temporary Password Change'), changeStaffPassword, ownStations,
      copy('Deny Station Scope Override'), copy('Deny Staff List Access'), copy('Logout', 'Logout as Staff'),
      copy('Deny Unauthenticated Profile Access'), copy('Reject Invalid Credentials'),
    );
    const result = await new Promise((resolveRun, reject) => newman.run({
      collection: { ...collection, info: { ...collection.info, name: 'Timetable Admin - Checkpoint B' }, item: [{ name: 'Auth and Station Administration', item: requests }] },
      environment, reporters: ['cli'], timeoutRequest: 5000, bail: true,
    }, (error, summary) => error ? reject(error) : resolveRun(summary)));
    if (!result || result.run.failures.length || result.run.stats.requests.total !== 22) throw new Error('Checkpoint B API workflow failed');
    console.log('PASS: 22 real HTTP requests; temporary passwords, station/staff management, scoped access, CSRF propagation and logout. Fixtures are removed below.');
  } finally {
    if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
    // Fixture ownership is a random per-run prefix; seed/demo accounts are never modified.
    const stations = (await db.station.findMany({ where: { code: { startsWith: prefix.toUpperCase() } }, select: { id: true } })).map(row => row.id);
    const users = (await db.adminUser.findMany({ where: { username: { startsWith: prefix } }, select: { id: true } })).map(row => row.id);
    await db.auditLog.deleteMany({ where: { OR: [{ actorAdminUserId: { in: users } }, { stationId: { in: stations } }] } });
    await db.adminSession.deleteMany({ where: { adminUserId: { in: users } } });
    await db.adminUser.deleteMany({ where: { id: { in: users } } });
    await db.station.deleteMany({ where: { id: { in: stations } } });
    await db.$disconnect();
  }
}

main().catch(() => { console.error('Checkpoint B failed; inspect HTTP/assertion results above. Secrets are not printed.'); process.exitCode = 1; });
