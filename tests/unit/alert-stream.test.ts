import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '../../src/shared/domain/errors';
import { createAlertStream } from '../../src/features/alerts/infrastructure/in-memory-alert-stream';
import type { AlertEvent } from '../../src/features/alerts/domain/alert-event';
import type { AuthContext } from '../../src/shared/domain/roles';

const auth = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  sessionId: randomUUID(), userId: randomUUID(), username: 'u', role: 'SUPER_ADMIN', stationId: null,
  mustChangePassword: false, csrfTokenHash: 'x', expiresAt: new Date(Date.now() + 60000), ...overrides,
});
const fakeResponse = (state: { destroyed?: boolean; writableEnded?: boolean; writeResult?: boolean } = {}) => {
  const response = { destroyed: state.destroyed ?? false, writableEnded: state.writableEnded ?? false, write: vi.fn((_chunk: string) => state.writeResult ?? true), end: vi.fn() };
  return response as unknown as Response & typeof response;
};
const event: AlertEvent = { type: 'alert.created', alertId: randomUUID(), stationId: randomUUID(), status: 'NEW', occurredAt: new Date().toISOString() };

describe('alert stream hub', () => {
  it('refuses the 501st subscriber globally and frees a slot on unsubscribe', () => {
    const stream = createAlertStream();
    const unsubscribers = Array.from({ length: 500 }, () => stream.subscribe(auth(), fakeResponse()));
    expect(() => stream.subscribe(auth(), fakeResponse())).toThrowError(expect.objectContaining({ code: 'STREAM_LIMIT', status: 429 }) as AppError);
    unsubscribers[0]!();
    expect(() => stream.subscribe(auth(), fakeResponse())).not.toThrow();
  });

  it('allows three streams per account and releases the count after unsubscribe', () => {
    const stream = createAlertStream();
    const account = auth();
    const unsubscribers = [1, 2, 3].map(() => stream.subscribe(account, fakeResponse()));
    expect(() => stream.subscribe(account, fakeResponse())).toThrowError(expect.objectContaining({ code: 'STREAM_LIMIT' }) as AppError);
    unsubscribers[0]!();
    unsubscribers[0]!();
    expect(() => stream.subscribe(account, fakeResponse())).not.toThrow();
    expect(() => stream.subscribe(account, fakeResponse())).toThrowError(expect.objectContaining({ code: 'STREAM_LIMIT' }) as AppError);
  });

  it('skips closed connections, ends a connection that cannot take more data, and filters by station', () => {
    const stream = createAlertStream();
    const destroyed = fakeResponse({ destroyed: true });
    const ended = fakeResponse({ writableEnded: true });
    const backpressured = fakeResponse({ writeResult: false });
    const otherStation = fakeResponse();
    const sameStation = fakeResponse();
    stream.subscribe(auth(), destroyed);
    stream.subscribe(auth(), ended);
    stream.subscribe(auth(), backpressured);
    stream.subscribe(auth({ role: 'STATION_SECURITY', stationId: randomUUID() }), otherStation);
    stream.subscribe(auth({ role: 'STATION_SECURITY', stationId: event.stationId }), sameStation);

    stream.publish(event);

    expect(destroyed.write).not.toHaveBeenCalled();
    expect(ended.write).not.toHaveBeenCalled();
    expect(backpressured.write).toHaveBeenCalledOnce();
    expect(backpressured.end).toHaveBeenCalledOnce();
    expect(otherStation.write).not.toHaveBeenCalled();
    expect(sameStation.write).toHaveBeenCalledOnce();
    const payload = String(sameStation.write.mock.calls[0]![0]);
    expect(payload).toContain('event: alert.created');
    expect(payload).not.toMatch(/Fixture|phone|displayName/i);
  });
});
