import { randomUUID } from 'node:crypto';

type Step = { type: 'CAMERA_INIT_FAILED' | 'ANALYSIS_FAILED' | 'ANALYSIS_RECOVERED' | 'SESSION_ENDED'; repeat?: boolean };
const scenarios: Record<string, Step[]> = {
  'healthy-session': [{ type: 'SESSION_ENDED' }],
  'camera-init-failed': [{ type: 'CAMERA_INIT_FAILED' }],
  'two-failures-then-recovered': [{ type: 'ANALYSIS_FAILED' }, { type: 'ANALYSIS_FAILED' }, { type: 'ANALYSIS_RECOVERED' }],
  'three-consecutive-failures': [{ type: 'ANALYSIS_FAILED' }, { type: 'ANALYSIS_FAILED' }, { type: 'ANALYSIS_FAILED' }],
  'duplicate-event': [{ type: 'ANALYSIS_FAILED' }, { type: 'ANALYSIS_FAILED', repeat: true }],
};

function usage(message: string): never {
  console.error(message);
  console.error('Usage: npm run simulate -- <scenario> --station <station-uuid> [--base-url http://127.0.0.1:3000]');
  console.error('Scenarios: ' + Object.keys(scenarios).join(', '));
  process.exit(1);
}

const [scenarioName, ...rest] = process.argv.slice(2);
const option = (name: string) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined; };
const steps = scenarioName ? scenarios[scenarioName] : undefined;
if (!steps) usage('Unknown or missing scenario.');
const stationId = option('--station');
if (!stationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stationId)) usage('--station must be a station UUID.');
const baseUrl = (option('--base-url') ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`).replace(/\/$/, '');
const baseHost = new URL(baseUrl).hostname;
if (process.env.NODE_ENV === 'production') usage('The simulator is development-only and refuses to run in production.');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(baseHost)) usage('The simulator only targets a local API.');
const key = process.env.SIMULATOR_INGEST_KEY;
if (!key) usage('SIMULATOR_INGEST_KEY is not set (see .env); the API rejects simulator ingest without it.');

async function post(path: string, payload: object) {
  const response = await fetch(baseUrl + '/api/v1/ingest' + path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-key': key! }, body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({})) as { data?: Record<string, unknown>; error?: { code?: string } };
  return { status: response.status, data: body.data, errorCode: body.error?.code };
}

async function main() {
  const externalSessionId = randomUUID();
  const session = await post('/sessions', {
    externalSessionId, externalUserId: 'simulator-' + externalSessionId.slice(0, 8), displayName: 'Simulator Passenger',
    stationId, stationConfirmed: true, startedAt: new Date().toISOString(), source: 'SIMULATOR',
  });
  console.log(`session  HTTP ${session.status} ${session.data?.id ?? session.errorCode ?? ''}`);
  if (session.status !== 201) throw new Error('Session was not created.');

  let alertId: unknown = null;
  let lastPayload: object | undefined;
  for (const step of steps!) {
    const failed = step.type.endsWith('FAILED');
    // A replay must be byte-identical (same eventId and occurredAt); any difference is an idempotency conflict.
    const payload = step.repeat && lastPayload ? lastPayload : {
      eventId: randomUUID(), externalSessionId, type: step.type,
      ...(failed ? { errorCode: step.type === 'CAMERA_INIT_FAILED' ? 'CAMERA_UNAVAILABLE' : 'VISION_TIMEOUT' } : {}),
      occurredAt: new Date().toISOString(),
    };
    const result = await post('/events', payload);
    lastPayload = payload;
    alertId = result.data?.alertId ?? alertId;
    console.log(`event    HTTP ${result.status} ${step.type}${step.repeat ? ' (replay)' : ''} consecutiveFailures=${result.data?.consecutiveFailures ?? '-'} alertId=${result.data?.alertId ?? 'none'} ${result.errorCode ?? ''}`.trimEnd());
    if (result.status !== 201 && !(step.repeat && result.status === 200)) throw new Error('Event was rejected.');
  }
  console.log(`done     scenario=${scenarioName} session=${session.data?.id} alert=${alertId ?? 'none'}`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Simulator failed'); process.exitCode = 1; });
