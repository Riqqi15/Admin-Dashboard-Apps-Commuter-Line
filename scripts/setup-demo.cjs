const { randomBytes } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const content = ['SEED_SUPER_ADMIN_PASSWORD', 'SEED_SECURITY_A_PASSWORD', 'SEED_SECURITY_B_PASSWORD']
  .map(key => `${key}=${randomBytes(24).toString('base64url')}`).join('\n') + '\n';
try {
  writeFileSync(resolve(__dirname, '../.env.seed.local'), content, { flag: 'wx', mode: 0o600 });
  console.log('Created .env.seed.local with random demo passwords (values hidden).');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Kept existing demo passwords; no values were overwritten.');
}
