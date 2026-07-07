ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';
ALTER TABLE "client_users" ALTER COLUMN "role" SET DEFAULT 'USER';

CREATE TABLE IF NOT EXISTS "feature_flags" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "feature_name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_tenant_id_feature_name_key" ON "feature_flags"("tenant_id", "feature_name");
CREATE INDEX IF NOT EXISTS "feature_flags_tenant_id_idx" ON "feature_flags"("tenant_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'feature_flags_tenant_id_fkey'
  ) THEN
    ALTER TABLE "feature_flags"
      ADD CONSTRAINT "feature_flags_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
