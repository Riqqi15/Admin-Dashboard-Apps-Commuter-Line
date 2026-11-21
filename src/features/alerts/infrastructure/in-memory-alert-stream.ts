import { AppError } from '../../../shared/domain/errors';
import type { AuthContext } from '../../../shared/domain/roles';
import type { AlertStream, StreamSink } from '../application/ports';
import type { AlertEvent } from '../domain/alert-event';

type Subscriber = { auth: AuthContext; sink: StreamSink };

// Single-process pub/sub: multi-instance deployments need a shared broker instead.
export function createAlertStream(): AlertStream {
  const subscribers = new Set<Subscriber>();
  const perUser = new Map<string, number>();

  return {
    subscribe(auth, sink) {
      if (subscribers.size >= 500 || (perUser.get(auth.userId) ?? 0) >= 3) throw new AppError(429, 'STREAM_LIMIT', 'Too many alert streams');
      const subscriber = { auth, sink };
      subscribers.add(subscriber);
      perUser.set(auth.userId, (perUser.get(auth.userId) ?? 0) + 1);
      return () => {
        if (!subscribers.delete(subscriber)) return;
        const count = (perUser.get(auth.userId) ?? 1) - 1;
        if (count) perUser.set(auth.userId, count);
        else perUser.delete(auth.userId);
      };
    },

    publish(event: AlertEvent) {
      const message = `event: ${event.type}\ndata: ${JSON.stringify({ alertId: event.alertId, stationId: event.stationId, status: event.status, occurredAt: event.occurredAt })}\n\n`;
      for (const subscriber of subscribers) {
        if (subscriber.auth.role === 'STATION_SECURITY' && subscriber.auth.stationId !== event.stationId) continue;
        if (subscriber.sink.destroyed || subscriber.sink.writableEnded) continue;
        if (!subscriber.sink.write(message)) subscriber.sink.end();
      }
    },
  };
}
