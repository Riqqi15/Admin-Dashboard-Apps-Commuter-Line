import type { CameraEventType } from '../../../shared/domain/camera';
import { AppError } from '../../../shared/domain/errors';
import { DAY_MS } from '../../../shared/domain/time';

export type AlertStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED';

// The fields clients may see in lists and detail. Encrypted passenger snapshots never appear here.
export type PublicAlert = Readonly<{
  id: string; cameraSessionId: string | null; stationId: string; failureType: CameraEventType; errorCode: string | null;
  status: AlertStatus; assignedToId: string | null; resolutionNote: string | null;
  createdAt: Date; acknowledgedAt: Date | null; resolvedAt: Date | null; expiresAt: Date;
}>;

export type Alert = PublicAlert & Readonly<{
  sourceSessionId: string; trackedUserId: string | null;
  userNameCiphertext: string | null; userPhoneCiphertext: string | null; piiPurgedAt: Date | null;
}>;

const PII_VISIBLE_DAYS = 7;

export const piiVisible = (alert: Alert, now = new Date()) =>
  !alert.piiPurgedAt && alert.createdAt.getTime() + PII_VISIBLE_DAYS * DAY_MS > now.getTime() && Boolean(alert.userNameCiphertext);

export const publicAlert = (alert: Alert): PublicAlert => ({
  id: alert.id, cameraSessionId: alert.cameraSessionId, stationId: alert.stationId, failureType: alert.failureType, errorCode: alert.errorCode,
  status: alert.status, assignedToId: alert.assignedToId, resolutionNote: alert.resolutionNote,
  createdAt: alert.createdAt, acknowledgedAt: alert.acknowledgedAt, resolvedAt: alert.resolvedAt, expiresAt: alert.expiresAt,
});

// Answers exactly like a missing alert so existence never leaks; carries the alert's station for the audit trail.
export class CrossStationDenied extends AppError {
  constructor(readonly alertStationId: string) { super(404, 'NOT_FOUND', 'Resource not found'); }
}
