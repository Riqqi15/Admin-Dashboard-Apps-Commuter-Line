import { DAY_MS } from '../../../shared/domain/time';

// Passenger data lives 7 days; alerts and audit rows 30 days (their expires_at is set when they are written).
const PII_RETENTION_DAYS = 7;
export const BATCH_SIZE = 500;
// Arbitrary constant shared by every retention process so two runs can never overlap.
export const RETENTION_LOCK_KEY = 4_207_001;

export const piiCutoff = (now: Date) => new Date(now.getTime() - PII_RETENTION_DAYS * DAY_MS);
