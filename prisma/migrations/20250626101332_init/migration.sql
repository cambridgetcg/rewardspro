-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'SYNCED_TO_SHOPIFY', 'SHOPIFY_SYNC_FAILED');

-- CreateEnum
CREATE TYPE "MembershipSource" AS ENUM ('SPENDING_THRESHOLD', 'PURCHASED', 'MANUAL_ASSIGNMENT', 'PROMOTION');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('CASHBACK_EARNED', 'CREDIT_USED', 'MANUAL_ADJUSTMENT', 'REFUND_REVERSED', 'EXPIRED', 'PROMOTIONAL', 'PURCHASE_REFUND');

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
CREATE TABLE "StoreCreditLedger" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "LedgerType" NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "referenceId" TEXT,
    "description" TEXT,
    "shopifyTransactionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tier" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "minSpend" DOUBLE PRECISION,
    "spendingPeriodDays" INTEGER,
    "cashbackPercent" DOUBLE PRECISION NOT NULL,
    "benefits" JSONB,
    "isPurchasable" BOOLEAN NOT NULL DEFAULT false,
    "purchasePrice" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMembership" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "source" "MembershipSource" NOT NULL,
    "purchaseOrderId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMembership_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "Customer_shopDomain_email_idx" ON "Customer"("shopDomain", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shopDomain_shopifyCustomerId_key" ON "Customer"("shopDomain", "shopifyCustomerId");

-- CreateIndex
CREATE INDEX "CashbackTransaction_shopDomain_idx" ON "CashbackTransaction"("shopDomain");

-- CreateIndex
CREATE INDEX "CashbackTransaction_customerId_idx" ON "CashbackTransaction"("customerId");

-- CreateIndex
CREATE INDEX "CashbackTransaction_createdAt_idx" ON "CashbackTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "CashbackTransaction_status_idx" ON "CashbackTransaction"("status");

-- CreateIndex
CREATE INDEX "CashbackTransaction_shopifyTransactionId_idx" ON "CashbackTransaction"("shopifyTransactionId");

-- CreateIndex
CREATE INDEX "CashbackTransaction_customerId_createdAt_status_idx" ON "CashbackTransaction"("customerId", "createdAt", "status");

-- CreateIndex
CREATE INDEX "CashbackTransaction_shopDomain_createdAt_idx" ON "CashbackTransaction"("shopDomain", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashbackTransaction_shopDomain_shopifyOrderId_key" ON "CashbackTransaction"("shopDomain", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_shopDomain_idx" ON "StoreCreditLedger"("shopDomain");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_customerId_idx" ON "StoreCreditLedger"("customerId");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_createdAt_idx" ON "StoreCreditLedger"("createdAt");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_type_idx" ON "StoreCreditLedger"("type");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_referenceId_idx" ON "StoreCreditLedger"("referenceId");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_shopifyTransactionId_idx" ON "StoreCreditLedger"("shopifyTransactionId");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_customerId_createdAt_idx" ON "StoreCreditLedger"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_shopDomain_type_createdAt_idx" ON "StoreCreditLedger"("shopDomain", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Tier_shopDomain_idx" ON "Tier"("shopDomain");

-- CreateIndex
CREATE INDEX "Tier_isActive_idx" ON "Tier"("isActive");

-- CreateIndex
CREATE INDEX "Tier_shopDomain_isActive_idx" ON "Tier"("shopDomain", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Tier_shopDomain_level_key" ON "Tier"("shopDomain", "level");

-- CreateIndex
CREATE UNIQUE INDEX "Tier_shopDomain_name_key" ON "Tier"("shopDomain", "name");

-- CreateIndex
CREATE INDEX "CustomerMembership_customerId_idx" ON "CustomerMembership"("customerId");

-- CreateIndex
CREATE INDEX "CustomerMembership_tierId_idx" ON "CustomerMembership"("tierId");

-- CreateIndex
CREATE INDEX "CustomerMembership_startDate_idx" ON "CustomerMembership"("startDate");

-- CreateIndex
CREATE INDEX "CustomerMembership_endDate_idx" ON "CustomerMembership"("endDate");

-- CreateIndex
CREATE INDEX "CustomerMembership_isActive_idx" ON "CustomerMembership"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMembership_customerId_isActive_key" ON "CustomerMembership"("customerId", "isActive");

-- AddForeignKey
ALTER TABLE "CashbackTransaction" ADD CONSTRAINT "CashbackTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCreditLedger" ADD CONSTRAINT "StoreCreditLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMembership" ADD CONSTRAINT "CustomerMembership_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "Tier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
