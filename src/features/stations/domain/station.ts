export type Station = Readonly<{
  id: string; code: string; name: string; isActive: boolean; createdAt: Date; updatedAt: Date;
}>;

export type NewStation = Readonly<{ code: string; name: string; isActive: boolean }>;

export type StationChanges = Readonly<{
  code?: string | undefined; name?: string | undefined; isActive?: boolean | undefined;
}>;
