import type { Tx } from './prisma-unit-of-work';

// Lock order used everywhere: station -> account -> session -> audit.
export async function lockUser(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM admin_users WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function lockStationShared(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM stations WHERE id = ${id}::uuid FOR SHARE`;
}

export async function lockStationForUpdate(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM stations WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function lockAlertForUpdate(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM alerts WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function lockCameraSessionForUpdate(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM camera_sessions WHERE id = ${id}::uuid FOR UPDATE`;
}

// Transaction-scoped advisory locks also serialize identifiers for rows that do not exist yet.
export async function advisoryXactLock(tx: Tx, key: bigint) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}::bigint)::text`;
}
