import type { CameraEventType, IngestSource } from '../../../shared/domain/camera';
import { AppError } from '../../../shared/domain/errors';

export type SessionInput = Readonly<{
  externalSessionId: string; externalUserId: string; displayName: string; phone?: string | undefined;
  stationId: string; stationConfirmed: true; startedAt: Date; source: 'SIMULATOR';
}>;

export type EventInput = Readonly<{
  eventId: string; externalSessionId: string; type: CameraEventType; errorCode?: string | undefined; occurredAt: Date;
}>;

const FRESHNESS_WINDOW_MS = 5 * 60_000;

// Replay protection: client timestamps must be close to server time, in both directions.
export function assertFresh(value: Date, now: Date) {
  if (Math.abs(value.getTime() - now.getTime()) > FRESHNESS_WINDOW_MS) throw new AppError(400, 'TIMESTAMP_OUT_OF_RANGE', 'Timestamp must be within five minutes of server time');
}

// A simulator key may only touch sessions created by the simulator.
export function assertSimulatorSource(source: IngestSource) {
  if (source !== 'SIMULATOR') throw new AppError(403, 'INGEST_SOURCE_MISMATCH', 'Simulator credentials cannot access this session');
}

export const idempotencyConflict = () => new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Identifier was already used with a different payload');
