import { z } from 'zod';

const timestamp = z.iso.datetime({ offset: true }).transform(value => new Date(value));
const uuid = z.uuid().transform(value => value.toLowerCase());
export const sessionSchema = z.strictObject({
  externalSessionId: uuid, externalUserId: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/u),
  displayName: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$/u),
  phone: z.string().trim().min(6).max(32).regex(/^\+?[0-9][0-9 ()-]+$/).optional(),
  stationId: uuid, stationConfirmed: z.literal(true), startedAt: timestamp, source: z.literal('SIMULATOR'),
});
export const eventSchema = z.strictObject({
  eventId: uuid, externalSessionId: uuid,
  type: z.enum(['SESSION_STARTED', 'CAMERA_INIT_FAILED', 'ANALYSIS_FAILED', 'ANALYSIS_RECOVERED', 'SESSION_ENDED']),
  errorCode: z.enum(['CAMERA_UNAVAILABLE', 'CAMERA_INITIALIZATION_FAILED', 'FRAME_ENCODING_FAILED', 'VISION_TIMEOUT', 'VISION_PROVIDER_UNAVAILABLE', 'NETWORK_TIMEOUT']).optional(),
  occurredAt: timestamp,
}).refine(value => !value.errorCode || value.type.endsWith('FAILED'), { message: 'Error code is only accepted for failure events' });
