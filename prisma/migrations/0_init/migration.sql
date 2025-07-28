-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('COMPLETED', 'SYNCED_TO_SHOPIFY', 'SHOPIFY_SYNC_FAILED');

-- CreateEnum
CREATE TYPE "EvaluationPeriod" AS ENUM ('ANNUAL', 'LIFETIME');

-- CreateEnum
CREATE TYPE "MigrationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CASHBACK_EARNED', 'ORDER_PAYMENT', 'REFUND_CREDIT', 'MANUAL_ADJUSTMENT', 'SHOPIFY_SYNC', 'INITIAL_IMPORT');

-- CreateEnum
CREATE TYPE "LedgerSource" AS ENUM ('APP_CASHBACK', 'APP_MANUAL', 'SHOPIFY_ADMIN', 'SHOPIFY_ORDER', 'RECONCILIATION');

-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('AUTOMATIC', 'MANUAL', 'PROMOTIONAL', 'IMPORTED');

-- CreateEnum
CREATE TYPE "TierChangeType" AS ENUM ('INITIAL_ASSIGNMENT', 'AUTOMATIC_UPGRADE', 'AUTOMATIC_DOWNGRADE', 'MANUAL_OVERRIDE', 'EXPIRATION_REVERT', 'TIER_DELETION_MIGRATION');

-- CreateEnum
CREATE TYPE "EmailTemplateType" AS ENUM ('CREDIT_EARNED', 'BALANCE_UPDATE', 'TIER_PROGRESS', 'WELCOME', 'TIER_UPGRADE', 'TIER_DOWNGRADE', 'CREDIT_EXPIRY_WARNING');

-- CreateEnum
CREATE TYPE "EmailTone" AS ENUM ('PROFESSIONAL', 'FRIENDLY', 'CASUAL', 'EXCITED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'FAILED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "EmailFrequency" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'NEVER');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "storeCredit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashbackTransaction" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderAmount" DOUBLE PRECISION NOT NULL,
    "cashbackAmount" DOUBLE PRECISION NOT NULL,
    "cashbackPercent" DOUBLE PRECISION NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "shopifyTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashbackTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tier" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minSpend" DOUBLE PRECISION,
    "cashbackPercent" DOUBLE PRECISION NOT NULL,
    "evaluationPeriod" "EvaluationPeriod" NOT NULL DEFAULT 'ANNUAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "benefits" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMembership" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignmentType" "AssignmentType" NOT NULL DEFAULT 'AUTOMATIC',
    "assignedBy" TEXT,
    "reason" TEXT,
    "previousTierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TierChangeLog" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fromTierId" TEXT,
    "toTierId" TEXT NOT NULL,
    "changeType" "TierChangeType" NOT NULL,
    "changeReason" TEXT,
    "triggeredBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TierChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAnalytics" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "lifetimeSpending" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "yearlySpending" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quarterlySpending" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlySpending" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgOrderValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "currentTierDays" INTEGER NOT NULL DEFAULT 0,
    "tierUpgradeCount" INTEGER NOT NULL DEFAULT 0,
    "lastTierChange" TIMESTAMP(3),
    "nextTierProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastOrderDate" TIMESTAMP(3),
    "daysSinceLastOrder" INTEGER,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Onboarding" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "employeeCount" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "productTypes" TEXT[],
    "goals" TEXT[],
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationHistory" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "status" "MigrationStatus" NOT NULL DEFAULT 'PENDING',
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCreditLedger" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "source" "LedgerSource" NOT NULL,
    "shopifyReference" TEXT,
    "description" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "type" "EmailTemplateType" NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "footer" TEXT NOT NULL,
    "tone" "EmailTone" NOT NULL DEFAULT 'FRIENDLY',
    "includeStoreLogo" BOOLEAN NOT NULL DEFAULT true,
    "includeUnsubscribe" BOOLEAN NOT NULL DEFAULT true,
    "primaryColor" TEXT NOT NULL DEFAULT '#1a1a1a',
    "buttonText" TEXT,
    "buttonUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "customerSegment" TEXT,
    "tierId" TEXT,
    "minBalance" DOUBLE PRECISION,
    "lastModifiedBy" TEXT,
    "testEmailsSent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateType" "EmailTemplateType" NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "renderedBody" TEXT,
    "opens" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerEmailPreferences" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "creditEarnedOptIn" BOOLEAN NOT NULL DEFAULT true,
    "balanceUpdateOptIn" BOOLEAN NOT NULL DEFAULT true,
    "tierProgressOptIn" BOOLEAN NOT NULL DEFAULT true,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT true,
    "balanceUpdateFrequency" "EmailFrequency" NOT NULL DEFAULT 'MONTHLY',
    "tierProgressFrequency" "EmailFrequency" NOT NULL DEFAULT 'MONTHLY',
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "unsubscribedAt" TIMESTAMP(3),
    "unsubscribeReason" TEXT,

    CONSTRAINT "CustomerEmailPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE INDEX "Session_expires_idx" ON "Session"("expires");

-- CreateIndex
CREATE INDEX "Customer_shopDomain_idx" ON "Customer"("shopDomain");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shopDomain_shopifyCustomerId_key" ON "Customer"("shopDomain", "shopifyCustomerId");

-- CreateIndex
CREATE INDEX "CashbackTransaction_shopDomain_idx" ON "CashbackTransaction"("shopDomain");

-- CreateIndex
CREATE INDEX "CashbackTransaction_customerId_idx" ON "CashbackTransaction"("customerId");

-- CreateIndex
CREATE INDEX "CashbackTransaction_createdAt_idx" ON "CashbackTransaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashbackTransaction_shopDomain_shopifyOrderId_key" ON "CashbackTransaction"("shopDomain", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "Tier_shopDomain_idx" ON "Tier"("shopDomain");

-- CreateIndex
CREATE INDEX "Tier_cashbackPercent_idx" ON "Tier"("cashbackPercent");

-- CreateIndex
CREATE UNIQUE INDEX "Tier_shopDomain_name_key" ON "Tier"("shopDomain", "name");

-- CreateIndex
CREATE INDEX "CustomerMembership_customerId_idx" ON "CustomerMembership"("customerId");

-- CreateIndex
CREATE INDEX "CustomerMembership_tierId_idx" ON "CustomerMembership"("tierId");

-- CreateIndex
CREATE INDEX "CustomerMembership_assignmentType_idx" ON "CustomerMembership"("assignmentType");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMembership_customerId_isActive_key" ON "CustomerMembership"("customerId", "isActive");

-- CreateIndex
CREATE INDEX "TierChangeLog_customerId_idx" ON "TierChangeLog"("customerId");

-- CreateIndex
CREATE INDEX "TierChangeLog_createdAt_idx" ON "TierChangeLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAnalytics_customerId_key" ON "CustomerAnalytics"("customerId");

-- CreateIndex
CREATE INDEX "CustomerAnalytics_shopDomain_idx" ON "CustomerAnalytics"("shopDomain");

-- CreateIndex
CREATE INDEX "CustomerAnalytics_customerId_idx" ON "CustomerAnalytics"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Onboarding_shopDomain_key" ON "Onboarding"("shopDomain");

-- CreateIndex
CREATE INDEX "Onboarding_shopDomain_idx" ON "Onboarding"("shopDomain");

-- CreateIndex
CREATE INDEX "Onboarding_completedAt_idx" ON "Onboarding"("completedAt");

-- CreateIndex
CREATE INDEX "MigrationHistory_shopDomain_idx" ON "MigrationHistory"("shopDomain");

-- CreateIndex
CREATE INDEX "MigrationHistory_status_idx" ON "MigrationHistory"("status");

-- CreateIndex
CREATE INDEX "MigrationHistory_createdAt_idx" ON "MigrationHistory"("createdAt");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_customerId_idx" ON "StoreCreditLedger"("customerId");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_shopDomain_idx" ON "StoreCreditLedger"("shopDomain");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_createdAt_idx" ON "StoreCreditLedger"("createdAt");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_shopifyReference_idx" ON "StoreCreditLedger"("shopifyReference");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_reconciledAt_idx" ON "StoreCreditLedger"("reconciledAt");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_source_idx" ON "StoreCreditLedger"("source");

-- CreateIndex
CREATE INDEX "EmailTemplate_shopDomain_idx" ON "EmailTemplate"("shopDomain");

-- CreateIndex
CREATE INDEX "EmailTemplate_type_idx" ON "EmailTemplate"("type");

-- CreateIndex
CREATE INDEX "EmailTemplate_enabled_idx" ON "EmailTemplate"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_shopDomain_type_customerSegment_tierId_key" ON "EmailTemplate"("shopDomain", "type", "customerSegment", "tierId");

-- CreateIndex
CREATE INDEX "EmailLog_shopDomain_idx" ON "EmailLog"("shopDomain");

-- CreateIndex
CREATE INDEX "EmailLog_customerId_idx" ON "EmailLog"("customerId");

-- CreateIndex
CREATE INDEX "EmailLog_templateType_idx" ON "EmailLog"("templateType");

-- CreateIndex
CREATE INDEX "EmailLog_status_idx" ON "EmailLog"("status");

-- CreateIndex
CREATE INDEX "EmailLog_sentAt_idx" ON "EmailLog"("sentAt");

-- CreateIndex
CREATE INDEX "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerEmailPreferences_customerId_key" ON "CustomerEmailPreferences"("customerId");

-- CreateIndex
CREATE INDEX "CustomerEmailPreferences_shopDomain_idx" ON "CustomerEmailPreferences"("shopDomain");

-- CreateIndex
CREATE INDEX "CustomerEmailPreferences_customerId_idx" ON "CustomerEmailPreferences"("customerId");

-- AddForeignKey
ALTER TABLE "CashbackTransaction" ADD CONSTRAINT "CashbackTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "Tier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierChangeLog" ADD CONSTRAINT "TierChangeLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierChangeLog" ADD CONSTRAINT "TierChangeLog_fromTierId_fkey" FOREIGN KEY ("fromTierId") REFERENCES "Tier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierChangeLog" ADD CONSTRAINT "TierChangeLog_toTierId_fkey" FOREIGN KEY ("toTierId") REFERENCES "Tier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAnalytics" ADD CONSTRAINT "CustomerAnalytics_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCreditLedger" ADD CONSTRAINT "StoreCreditLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerEmailPreferences" ADD CONSTRAINT "CustomerEmailPreferences_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

