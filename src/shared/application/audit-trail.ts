export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  stationId: string | null;
  // Counts and identifiers only; never passwords, tokens or passenger data.
  details?: Record<string, unknown>;
};

export interface AuditTrail {
  record(entry: AuditEntry): Promise<void>;
}
