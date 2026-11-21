import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../application/id-generator';

export const uuidIdGenerator: IdGenerator = { newId: randomUUID };
