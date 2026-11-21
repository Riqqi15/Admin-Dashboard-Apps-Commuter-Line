import type { Response } from 'express';
import type { AuthContext } from '../auth/auth.service';
import { AppError } from '../../http/errors';

export type AlertStreamEvent = Readonly<{
  type: 'alert.created' | 'alert.updated';
  alertId: string;
  stationId: string;
  status: 'NEW' | 'ACKNOWLEDGED' | 'RESOLVED';
  occurredAt: string;
}>;

type Subscriber = { auth: AuthContext; response: Response };

export function createAlertStream() {
  const subscribers = new Set<Subscriber>();
  const perUser = new Map<string, number>();

  return {
    subscribe(auth: AuthContext, response: Response) {
      if (subscribers.size >= 500 || (perUser.get(auth.userId) ?? 0) >= 3) throw new AppError(429, 'STREAM_LIMIT', 'Too many alert streams');
      const subscriber = { auth, response };
      subscribers.add(subscriber);
      perUser.set(auth.userId, (perUser.get(auth.userId) ?? 0) + 1);
      return () => {
        if (!subscribers.delete(subscriber)) return;
        const count = (perUser.get(auth.userId) ?? 1) - 1;
        if (count) perUser.set(auth.userId, count);
        else perUser.delete(auth.userId);
      };
    },

    publish(event: AlertStreamEvent) {
      const message = `event: ${event.type}\ndata: ${JSON.stringify({ alertId: event.alertId, stationId: event.stationId, status: event.status, occurredAt: event.occurredAt })}\n\n`;
      for (const subscriber of subscribers) {
        if (subscriber.auth.role === 'STATION_SECURITY' && subscriber.auth.stationId !== event.stationId) continue;
        if (subscriber.response.destroyed || subscriber.response.writableEnded) continue;
        if (!subscriber.response.write(message)) subscriber.response.end();
      }
    },
  };
}

export type AlertStream = ReturnType<typeof createAlertStream>;
