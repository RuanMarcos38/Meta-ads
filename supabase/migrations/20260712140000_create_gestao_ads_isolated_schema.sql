-- Gestão Ads — R2R Marketing Digital
-- Projeto Supabase autorizado: CRM R2 MARKETING DIGITAL
-- Regra: todos os objetos ficam no schema gestao_ads. Não alterar o schema public.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS gestao_ads;

DO $$ BEGIN
  CREATE TYPE gestao_ads."Role" AS ENUM ('SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER', 'CLIENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE gestao_ads."InsightLevel" AS ENUM ('account', 'campaign', 'adset', 'ad');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS gestao_ads."Organization" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "document" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gestao_ads."Client" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "companyName" TEXT,
  "document" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "segment" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "notes" TEXT,
  "primaryResultAction" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES gestao_ads."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS gestao_ads."User" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" gestao_ads."Role" NOT NULL DEFAULT 'CLIENT',
  "organizationId" TEXT,
  "clientId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE,
  "lastLoginAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_email_key" UNIQUE ("email"),
  CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES gestao_ads."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES gestao_ads."Client"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS gestao_ads."MetaConnection" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT,
  "metaUserId" TEXT,
  "accessTokenEncrypted" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMPTZ,
  "scopes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gestao_ads."MetaAdAccount" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "name" TEXT,
  "currency" TEXT,
  "timezone" TEXT,
  "accountStatus" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetaAdAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES gestao_ads."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MetaAdAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES gestao_ads."MetaConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS gestao_ads."Campaign" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "adAccountId" TEXT NOT NULL,
  "metaCampaignId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "objective" TEXT,
  "status" TEXT,
  "effectiveStatus" TEXT,
  "buyingType" TEXT,
  "dailyBudget" NUMERIC(65,30),
  "lifetimeBudget" NUMERIC(65,30),
  "startTime" TIMESTAMPTZ,
  "stopTime" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Campaign_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES gestao_ads."MetaAdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Campaign_adAccountId_metaCampaignId_key" UNIQUE ("adAccountId", "metaCampaignId")
);

CREATE TABLE IF NOT EXISTS gestao_ads."AdSet" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "campaignId" TEXT NOT NULL,
  "metaAdsetId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT,
  "effectiveStatus" TEXT,
  "dailyBudget" NUMERIC(65,30),
  "lifetimeBudget" NUMERIC(65,30),
  "optimizationGoal" TEXT,
  "billingEvent" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdSet_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES gestao_ads."Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AdSet_campaignId_metaAdsetId_key" UNIQUE ("campaignId", "metaAdsetId")
);

CREATE TABLE IF NOT EXISTS gestao_ads."Ad" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "adSetId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "metaAdId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT,
  "effectiveStatus" TEXT,
  "creativeId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Ad_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES gestao_ads."AdSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Ad_adSetId_metaAdId_key" UNIQUE ("adSetId", "metaAdId")
);

CREATE TABLE IF NOT EXISTS gestao_ads."InsightDaily" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "adAccountId" TEXT NOT NULL,
  "campaignId" TEXT,
  "adSetId" TEXT,
  "adId" TEXT,
  "level" gestao_ads."InsightLevel" NOT NULL,
  "date" TIMESTAMPTZ NOT NULL,
  "spend" NUMERIC(65,30) NOT NULL DEFAULT 0,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "reach" INTEGER NOT NULL DEFAULT 0,
  "frequency" NUMERIC(65,30) NOT NULL DEFAULT 0,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "inlineLinkClicks" INTEGER NOT NULL DEFAULT 0,
  "ctr" NUMERIC(65,30) NOT NULL DEFAULT 0,
  "cpc" NUMERIC(65,30) NOT NULL DEFAULT 0,
  "cpm" NUMERIC(65,30) NOT NULL DEFAULT 0,
  "leads" INTEGER NOT NULL DEFAULT 0,
  "conversations" INTEGER NOT NULL DEFAULT 0,
  "purchases" INTEGER NOT NULL DEFAULT 0,
  "revenue" NUMERIC(65,30) NOT NULL DEFAULT 0,
  "costPerLead" NUMERIC(65,30) NOT NULL DEFAULT 0,
  "costPerConversation" NUMERIC(65,30) NOT NULL DEFAULT 0,
  "rawActionsJson" JSONB,
  "rawCostPerActionJson" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsightDaily_level_date_adAccountId_campaignId_adSetId_adId_key" UNIQUE ("level", "date", "adAccountId", "campaignId", "adSetId", "adId")
);

CREATE TABLE IF NOT EXISTS gestao_ads."SyncJob" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT,
  "adAccountId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ,
  "errorMessage" TEXT,
  "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT
);

CREATE TABLE IF NOT EXISTS gestao_ads."Report" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "periodStart" TIMESTAMPTZ NOT NULL,
  "periodEnd" TIMESTAMPTZ NOT NULL,
  "fileUrl" TEXT,
  "summaryText" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gestao_ads."Alert" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'info',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "isRead" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gestao_ads."AuditLog" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "entity" TEXT,
  "entityId" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "User_organizationId_idx" ON gestao_ads."User"("organizationId");
CREATE INDEX IF NOT EXISTS "User_clientId_idx" ON gestao_ads."User"("clientId");
CREATE INDEX IF NOT EXISTS "Client_organizationId_idx" ON gestao_ads."Client"("organizationId");
CREATE INDEX IF NOT EXISTS "MetaConnection_organizationId_clientId_idx" ON gestao_ads."MetaConnection"("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "MetaAdAccount_organizationId_clientId_idx" ON gestao_ads."MetaAdAccount"("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "Campaign_organizationId_clientId_idx" ON gestao_ads."Campaign"("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "InsightDaily_clientId_date_idx" ON gestao_ads."InsightDaily"("clientId", "date");
CREATE INDEX IF NOT EXISTS "InsightDaily_organizationId_date_idx" ON gestao_ads."InsightDaily"("organizationId", "date");
CREATE INDEX IF NOT EXISTS "SyncJob_organizationId_startedAt_idx" ON gestao_ads."SyncJob"("organizationId", "startedAt");
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_createdAt_idx" ON gestao_ads."AuditLog"("organizationId", "createdAt");
