// app/services/customer-tier.server.ts
import prisma from "../db.server";
import type { Customer, Tier, CustomerMembership } from "@prisma/client";

// Assign initial tier to new customer
export async function assignInitialTier(customerId: string) {
  // Get the lowest level tier (usually Bronze/Basic)
  const defaultTier = await prisma.tier.findFirst({
    where: { isActive: true },
    orderBy: { level: 'asc' }
  });

  if (!defaultTier) {
    throw new Error("No active tiers found");
  }

  // Create membership record
  const membership = await prisma.customerMembership.create({
    data: {
      customerId,
      tierId: defaultTier.id,
      source: "SPENDING_THRESHOLD",
      isActive: true,
    }
  });

  return membership;
}

// Evaluate customer's tier based on spending
export async function evaluateCustomerTier(customerId: string) {
  // Get customer with current membership
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      membershipHistory: {
        where: { isActive: true },
        include: { tier: true }
      },
      transactions: {
        where: { 
          status: { in: ["COMPLETED", "SYNCED_TO_SHOPIFY"] }
        }
      }
    }
  });

  if (!customer) return null;

  const currentMembership = customer.membershipHistory[0];
  
  // Don't change purchased or manually assigned tiers
  if (currentMembership?.source !== "SPENDING_THRESHOLD") {
    return currentMembership;
  }

  // Get all active tiers
  const tiers = await prisma.tier.findMany({
    where: { isActive: true },
    orderBy: { level: 'desc' } // Start from highest
  });

  // Calculate spending for each tier's period
  let qualifiedTier: Tier | null = null;

  for (const tier of tiers) {
    if (!tier.spendingPeriodDays || tier.minSpend === null) continue;

    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - tier.spendingPeriodDays);

    const spending = customer.transactions
      .filter(t => new Date(t.createdAt) >= periodStart)
      .reduce((sum, t) => sum + t.orderAmount, 0);

    if (spending >= tier.minSpend) {
      qualifiedTier = tier;
      break; // Found highest qualifying tier
    }
  }

  // If no tier qualified, use default (lowest)
  if (!qualifiedTier) {
    qualifiedTier = tiers[tiers.length - 1];
  }

  // Update if tier changed
  if (!currentMembership || currentMembership.tierId !== qualifiedTier.id) {
    // Deactivate current membership
    if (currentMembership) {
      await prisma.customerMembership.update({
        where: { id: currentMembership.id },
        data: { 
          isActive: false,
          endDate: new Date()
        }
      });
    }

    // Create new membership
    const newMembership = await prisma.customerMembership.create({
      data: {
        customerId,
        tierId: qualifiedTier.id,
        source: "SPENDING_THRESHOLD",
        isActive: true,
      },
      include: { tier: true }
    });

    return newMembership;
  }

  return currentMembership;
}

// Get customer's current tier info
export async function getCustomerTierInfo(customerId: string) {
  const membership = await prisma.customerMembership.findFirst({
    where: {
      customerId,
      isActive: true
    },
    include: {
      tier: true,
      customer: true
    }
  });

  if (!membership) return null;

  // Calculate progress to next tier
  const nextTier = await prisma.tier.findFirst({
    where: {
      level: { gt: membership.tier.level },
      isActive: true
    },
    orderBy: { level: 'asc' }
  });

  let progressInfo = null;
  if (nextTier && nextTier.spendingPeriodDays && nextTier.minSpend) {
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - nextTier.spendingPeriodDays);

    const currentSpending = await prisma.cashbackTransaction.aggregate({
      where: {
        customerId,
        createdAt: { gte: periodStart },
        status: { in: ["COMPLETED", "SYNCED_TO_SHOPIFY"] }
      },
      _sum: { orderAmount: true }
    });

    const spent = currentSpending._sum.orderAmount || 0;
    progressInfo = {
      nextTier,
      currentSpending: spent,
      requiredSpending: nextTier.minSpend,
      remainingSpending: Math.max(0, nextTier.minSpend - spent),
      progressPercentage: Math.min(100, (spent / nextTier.minSpend) * 100)
    };
  }

  return {
    membership,
    progressInfo
  };
}

// Manually assign a tier (admin action)
export async function assignTierManually(
  customerId: string, 
  tierId: string,
  source: "MANUAL_ASSIGNMENT" | "PROMOTION" = "MANUAL_ASSIGNMENT"
) {
  // Deactivate current membership
  await prisma.customerMembership.updateMany({
    where: {
      customerId,
      isActive: true
    },
    data: {
      isActive: false,
      endDate: new Date()
    }
  });

  // Create new membership
  const membership = await prisma.customerMembership.create({
    data: {
      customerId,
      tierId,
      source,
      isActive: true,
    },
    include: { tier: true }
  });

  return membership;
}

// Purchase a tier
export async function purchaseTier(
  customerId: string,
  tierId: string,
  purchaseOrderId: string
) {
  const tier = await prisma.tier.findUnique({
    where: { id: tierId }
  });

  if (!tier?.isPurchasable) {
    throw new Error("This tier is not purchasable");
  }

  // Deactivate current membership
  await prisma.customerMembership.updateMany({
    where: {
      customerId,
      isActive: true
    },
    data: {
      isActive: false,
      endDate: new Date()
    }
  });

  // Create new purchased membership
  const membership = await prisma.customerMembership.create({
    data: {
      customerId,
      tierId,
      source: "PURCHASED",
      purchaseOrderId,
      isActive: true,
    },
    include: { tier: true }
  });

  return membership;
}