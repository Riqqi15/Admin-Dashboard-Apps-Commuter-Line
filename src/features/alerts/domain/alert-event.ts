import type { AlertStatus } from './alert';

// Metadata only: never passenger data or free-form notes.
export type AlertEvent = Readonly<{
  type: 'alert.created' | 'alert.updated';
  alertId: string;
  stationId: string;
  status: AlertStatus;
  occurredAt: string;
}>;
