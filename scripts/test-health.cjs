const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const newman = require('newman');

const collection = JSON.parse(readFileSync(resolve(__dirname, '../postman/Timetable-Admin.postman_collection.json'), 'utf8'));
// Run the real health request from the existing collection; business routes are not implemented yet.
const health = collection.item.filter(folder => ['01 Health Check', '01b Database Readiness'].includes(folder.name));
if (health.length !== 2) throw new Error('Health / readiness folders are missing');
const docker = process.argv.includes('--docker');
newman.run({
  collection: { ...collection, item: health },
  environment: resolve(__dirname, docker ? '../postman/Docker.postman_environment.json' : '../postman/Local.postman_environment.json'),
  envVar: [{ key: 'baseUrl', value: process.env.API_BASE_URL || (docker ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:3000') }],
  reporters: ['cli'],
  timeoutRequest: 5000,
  bail: true,
}, (error, summary) => {
  if (error || !summary || summary.run.failures.length || summary.run.stats.requests.total !== 2) process.exitCode = 1;
});
