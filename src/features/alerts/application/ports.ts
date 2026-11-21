import type { AuthContext } from '../../../shared/domain/roles';
import type { SessionRecord } from '../../../shared/domain/session';
import type { Alert, AlertStatus, PublicAlert } from '../domain/alert';
import type { AlertEvent } from '../domain/alert-event';

export interface AlertRepository {
  list(filter: { stationId?: string | undefined; status?: AlertStatus | undefined; notExpiredAt: Date }, page: { page: number; pageSize: number }): Promise<{ items: PublicAlert[]; total: number }>;
  findStationId(id: string): Promise<string | null>;
  lockForUpdate(id: string): Promise<void>;
  find(id: string): Promise<Alert | null>;
  acknowledge(id: string, handlerId: string, at: Date): Promise<PublicAlert>;
  resolve(id: string, notes: string, at: Date): Promise<PublicAlert>;
  averageResponseSeconds(stationId: string, day: Date): Promise<number | null>;
}

// Re-reads the caller's account and session inside the transaction, so a revoked or moved account is refused.
export interface ActorRepository {
  lockStationShared(stationId: string): Promise<void>;
  lockUser(userId: string): Promise<void>;
  findSessionById(id: string): Promise<SessionRecord | null>;
}

export interface AlertNotifier {
  publish(event: AlertEvent): void;
}

// The minimal writable stream a subscriber needs; an Express response satisfies it structurally.
export interface StreamSink {
  readonly destroyed: boolean;
  readonly writableEnded: boolean;
  write(chunk: string): boolean;
  end(): void;
}

export interface AlertStream extends AlertNotifier {
  subscribe(auth: AuthContext, sink: StreamSink): () => void;
}
