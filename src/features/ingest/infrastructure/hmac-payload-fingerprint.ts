import { createHmac } from 'node:crypto';
import type { PayloadFingerprint } from '../application/ports';

// Same identifier + same payload => same fingerprint, so a replay is recognised without storing the payload.
export const hmacPayloadFingerprint = (pepper: string): PayloadFingerprint => ({
  of: (kind, value) => createHmac('sha256', pepper).update('ingest:' + kind + ':v1:' + JSON.stringify(value)).digest('hex'),
});
