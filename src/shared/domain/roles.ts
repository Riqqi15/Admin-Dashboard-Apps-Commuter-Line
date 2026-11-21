export type Role = 'SUPER_ADMIN' | 'STATION_SECURITY';

export type AuthContext = Readonly<{
  sessionId: string; userId: string; username: string; role: Role; stationId: string | null;
  mustChangePassword: boolean; csrfTokenHash: string; expiresAt: Date;
}>;
