export type AuditLogEntry = Readonly<{
  id: string; actorAdminUserId: string | null; stationId: string | null; action: string;
  entityType: string; entityId: string | null; createdAt: Date;
}>;

export type AuditFilter = Readonly<{ stationId?: string | undefined; action?: string | undefined; from?: Date | undefined; toExclusive?: Date | undefined }>;

export interface AuditReader {
  list(filter: AuditFilter, page: { page: number; pageSize: number }): Promise<{ items: AuditLogEntry[]; total: number }>;
}
