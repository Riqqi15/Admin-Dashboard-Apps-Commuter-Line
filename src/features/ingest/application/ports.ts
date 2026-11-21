import type { CameraEventType, CameraSessionStatus, IngestSource } from '../../../shared/domain/camera';

export type StoredSession = Readonly<{
  id: string; externalSessionId: string; stationId: string; status: CameraSessionStatus; source: IngestSource;
  payloadFingerprint: string; trackedUserId: string; startedAt: Date; endedAt: Date | null; expiresAt: Date; consecutiveFailures: number;
}>;

export type SessionForEvent = StoredSession & Readonly<{
  station: Readonly<{ isActive: boolean }>;
  trackedUser: Readonly<{ id: string; displayNameCiphertext: string; phoneCiphertext: string | null }>;
  alert: Readonly<{ id: string }> | null;
}>;

export type StoredEvent = Readonly<{
  id: string; eventId: string; payloadFingerprint: string; cameraSessionId: string;
  cameraSession: StoredSession & Readonly<{ alert: Readonly<{ id: string }> | null }>;
}>;

export type TrackedUserSnapshot = Readonly<{ displayNameCiphertext: string; phoneCiphertext: string | null; lastSeenAt: Date; expiresAt: Date }>;

export type NewAlert = Readonly<{
  id: string; cameraSessionId: string; sourceSessionId: string; stationId: string; trackedUserId: string;
  userNameCiphertext: string; userPhoneCiphertext: string | null; failureType: CameraEventType; errorCode: string | null; expiresAt: Date;
}>;

export interface IngestRepository {
  // Serializes an identifier even before its row exists (idempotent creation).
  lockIdentifier(kind: 'session' | 'event' | 'user', id: string): Promise<void>;
  lockStationShared(stationId: string): Promise<void>;
  lockSessionForUpdate(sessionId: string): Promise<void>;
  findSessionByExternalId(externalSessionId: string): Promise<StoredSession | null>;
  findEventById(eventId: string): Promise<StoredEvent | null>;
  findStation(id: string): Promise<{ id: string; isActive: boolean } | null>;
  findTrackedUser(externalUserId: string): Promise<{ id: string } | null>;
  createTrackedUser(id: string, externalUserId: string, snapshot: TrackedUserSnapshot): Promise<{ id: string }>;
  updateTrackedUser(id: string, snapshot: TrackedUserSnapshot): Promise<{ id: string }>;
  touchTrackedUser(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void>;
  createSession(input: { externalSessionId: string; payloadFingerprint: string; trackedUserId: string; stationId: string; startedAt: Date; expiresAt: Date }): Promise<StoredSession>;
  hadSessionOnDay(stationId: string, trackedUserId: string, excludeSessionId: string, day: Date): Promise<boolean>;
  findSessionForEvent(sessionId: string): Promise<SessionForEvent>;
  findLatestEvent(sessionId: string): Promise<{ occurredAt: Date } | null>;
  createEvent(input: { eventId: string; payloadFingerprint: string; cameraSessionId: string; type: CameraEventType; errorCode: string | null; occurredAt: Date; expiresAt: Date }): Promise<{ id: string; eventId: string }>;
  updateSession(sessionId: string, changes: { consecutiveFailures: number; status: CameraSessionStatus; endedAt?: Date | undefined }): Promise<{ status: CameraSessionStatus }>;
  createAlert(input: NewAlert): Promise<{ stationId: string; status: 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED'; createdAt: Date }>;
}

export interface PayloadFingerprint {
  of(kind: 'session' | 'event', value: object): string;
}
