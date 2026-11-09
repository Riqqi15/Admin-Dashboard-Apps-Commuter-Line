-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'STATION_SECURITY');

-- CreateEnum
CREATE TYPE "CameraSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CameraEventType" AS ENUM ('SESSION_STARTED', 'CAMERA_INIT_FAILED', 'ANALYSIS_FAILED', 'ANALYSIS_RECOVERED', 'SESSION_ENDED');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IngestSource" AS ENUM ('SIMULATOR', 'MOBILE');

-- CreateTable
CREATE TABLE "stations" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "station_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_users" (
    "id" UUID NOT NULL,
    "external_user_id" VARCHAR(100) NOT NULL,
    "display_name_ciphertext" TEXT NOT NULL,
    "phone_ciphertext" TEXT,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tracked_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "camera_sessions" (
    "id" UUID NOT NULL,
    "external_session_id" UUID NOT NULL,
    "payload_fingerprint" CHAR(64) NOT NULL,
    "tracked_user_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "source" "IngestSource" NOT NULL,
    "status" "CameraSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "camera_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "camera_events" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "payload_fingerprint" CHAR(64) NOT NULL,
    "camera_session_id" UUID NOT NULL,
    "type" "CameraEventType" NOT NULL,
    "error_code" VARCHAR(80),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "camera_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "camera_session_id" UUID,
    "source_session_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "tracked_user_id" UUID,
    "user_name_ciphertext" TEXT,
    "user_phone_ciphertext" TEXT,
    "failure_type" "CameraEventType" NOT NULL,
    "error_code" VARCHAR(80),
    "status" "AlertStatus" NOT NULL DEFAULT 'NEW',
    "assigned_to_id" UUID,
    "resolution_note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "pii_purged_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_admin_user_id" UUID,
    "station_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_usage_stats" (
    "id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "stat_date" DATE NOT NULL,
    "session_count" INTEGER NOT NULL DEFAULT 0,
    "unique_user_count" INTEGER NOT NULL DEFAULT 0,
    "failed_session_count" INTEGER NOT NULL DEFAULT 0,
    "alert_count" INTEGER NOT NULL DEFAULT 0,
    "resolved_alert_count" INTEGER NOT NULL DEFAULT 0,
    "average_response_seconds" INTEGER,

    CONSTRAINT "daily_usage_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stations_code_key" ON "stations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE INDEX "admin_users_station_id_idx" ON "admin_users"("station_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_user_id_expires_at_idx" ON "admin_sessions"("admin_user_id", "expires_at");

-- CreateIndex
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_users_external_user_id_key" ON "tracked_users"("external_user_id");

-- CreateIndex
CREATE INDEX "tracked_users_expires_at_idx" ON "tracked_users"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "camera_sessions_external_session_id_key" ON "camera_sessions"("external_session_id");

-- CreateIndex
CREATE INDEX "camera_sessions_station_id_started_at_idx" ON "camera_sessions"("station_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "camera_sessions_tracked_user_id_idx" ON "camera_sessions"("tracked_user_id");

-- CreateIndex
CREATE INDEX "camera_sessions_expires_at_idx" ON "camera_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "camera_events_event_id_key" ON "camera_events"("event_id");

-- CreateIndex
CREATE INDEX "camera_events_camera_session_id_occurred_at_idx" ON "camera_events"("camera_session_id", "occurred_at");

-- CreateIndex
CREATE INDEX "camera_events_expires_at_idx" ON "camera_events"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_camera_session_id_key" ON "alerts"("camera_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_source_session_id_key" ON "alerts"("source_session_id");

-- CreateIndex
CREATE INDEX "alerts_station_id_status_created_at_idx" ON "alerts"("station_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_tracked_user_id_idx" ON "alerts"("tracked_user_id");

-- CreateIndex
CREATE INDEX "alerts_assigned_to_id_idx" ON "alerts"("assigned_to_id");

-- CreateIndex
CREATE INDEX "alerts_expires_at_idx" ON "alerts"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_admin_user_id_created_at_idx" ON "audit_logs"("actor_admin_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_expires_at_idx" ON "audit_logs"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_usage_stats_station_id_stat_date_key" ON "daily_usage_stats"("station_id", "stat_date");

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_sessions" ADD CONSTRAINT "camera_sessions_tracked_user_id_fkey" FOREIGN KEY ("tracked_user_id") REFERENCES "tracked_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_sessions" ADD CONSTRAINT "camera_sessions_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera_events" ADD CONSTRAINT "camera_events_camera_session_id_fkey" FOREIGN KEY ("camera_session_id") REFERENCES "camera_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_camera_session_id_fkey" FOREIGN KEY ("camera_session_id") REFERENCES "camera_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tracked_user_id_fkey" FOREIGN KEY ("tracked_user_id") REFERENCES "tracked_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_admin_user_id_fkey" FOREIGN KEY ("actor_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_usage_stats" ADD CONSTRAINT "daily_usage_stats_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database invariants not expressible as Prisma field attributes.
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_station_check" CHECK (
  ("role" = 'SUPER_ADMIN' AND "station_id" IS NULL) OR
  ("role" = 'STATION_SECURITY' AND "station_id" IS NOT NULL)
);
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_username_check"
  CHECK ("username" ~ '^[a-z0-9._-]{3,50}$');
ALTER TABLE "stations" ADD CONSTRAINT "stations_code_check"
  CHECK ("code" = upper("code") AND length(trim("code")) > 0);
ALTER TABLE "camera_sessions" ADD CONSTRAINT "camera_sessions_failures_check"
  CHECK ("consecutive_failures" >= 0);
ALTER TABLE "camera_sessions" ADD CONSTRAINT "camera_sessions_time_check"
  CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_failure_type_check"
  CHECK ("failure_type" IN ('CAMERA_INIT_FAILED', 'ANALYSIS_FAILED'));
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_source_session_check"
  CHECK ("camera_session_id" IS NULL OR "camera_session_id" = "source_session_id");
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_state_check" CHECK (
  ("status" = 'NEW' AND "assigned_to_id" IS NULL AND "acknowledged_at" IS NULL AND "resolved_at" IS NULL AND "resolution_note" IS NULL) OR
  ("status" = 'ACKNOWLEDGED' AND "assigned_to_id" IS NOT NULL AND "acknowledged_at" IS NOT NULL AND "resolved_at" IS NULL AND "resolution_note" IS NULL) OR
  ("status" = 'RESOLVED' AND "assigned_to_id" IS NOT NULL AND "acknowledged_at" IS NOT NULL AND "resolved_at" IS NOT NULL AND "resolution_note" IS NOT NULL AND length(trim("resolution_note")) > 0)
);
ALTER TABLE "daily_usage_stats" ADD CONSTRAINT "daily_usage_stats_counts_check" CHECK (
  "session_count" >= 0 AND "unique_user_count" >= 0 AND "failed_session_count" >= 0 AND
  "alert_count" >= 0 AND "resolved_alert_count" >= 0 AND
  ("average_response_seconds" IS NULL OR "average_response_seconds" >= 0)
);
