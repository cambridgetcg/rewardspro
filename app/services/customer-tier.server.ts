// app/services/customer-tier.server.ts
import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";
import type { Customer, Tier, CustomerMembership } from "@prisma/client";

// Assign initial tier to new customer
export async function assignInitialTier(customerId: string, shopDomain: string) {
  // Get the lowest level tier (usually Bronze/Basic)
  const defaultTier = await prisma.tier.findFirst({
    where: { 
      shopDomain,
      isActive: true 
    },
    orderBy: { level: 'asc' }
  });

  if (!defaultTier) {
    throw new Error("No active tiers found for shop");
  }

  // Create membership record
  const membership = await prisma.customerMembership.create({
    data: {
      customerId,
      tierId: defaultTier.id,
      isActive: true,
    }
  });

  return membership;
}

// Evaluate customer's tier based on lifetime spending
export async function evaluateCustomerTier(customerId: string, shopDomain: string) {
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
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        }
      }
    }
  });

  if (!customer || customer.shopDomain !== shopDomain) return null;

  const currentMembership = customer.membershipHistory[0];

  // Get all active tiers for this shop
  const tiers = await prisma.tier.findMany({
    where: { 
      shopDomain,
      isActive: true 
    },
    orderBy: { level: 'desc' } // Start from highest
  });

  // Calculate total lifetime spending
  const lifetimeSpending = customer.transactions.reduce(
    (sum, t) => sum + t.orderAmount, 
    0
  );

  // Find the highest tier the customer qualifies for
  let qualifiedTier: Tier | null = null;

  for (const tier of tiers) {
    // If tier has no minimum spend, it's the base tier
    if (tier.minSpend === null) {
      qualifiedTier = tier;
      continue;
    }

    // Check if customer qualifies for this tier
    if (lifetimeSpending >= tier.minSpend) {
      qualifiedTier = tier;
      break; // Found highest qualifying tier
    }
  }

  // If no tier qualified, use the base tier (no minSpend)
  if (!qualifiedTier) {
    qualifiedTier = tiers.find(t => t.minSpend === null) || tiers[tiers.length - 1];
  }

  // Update if tier changed
  if (!currentMembership || currentMembership.tierId !== qualifiedTier.id) {
    // Use a transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // First, deactivate ALL existing active memberships for this customer
      await tx.customerMembership.updateMany({
        where: {
          customerId,
          isActive: true
        },
        data: {
          isActive: false
        }
      });

      // Then create the new membership
      const newMembership = await tx.customerMembership.create({
        data: {
          customerId,
          tierId: qualifiedTier.id,
          isActive: true,
        },
        include: { tier: true }
      });

      return newMembership;
    });

    return result;
  }

  return currentMembership;
}

// Get customer's current tier info
export async function getCustomerTierInfo(customerId: string, shopDomain: string) {
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

  if (!membership || membership.customer.shopDomain !== shopDomain) return null;

  // Calculate progress to next tier
  const nextTier = await prisma.tier.findFirst({
    where: {
      shopDomain,
      level: { gt: membership.tier.level },
      isActive: true
    },
    orderBy: { level: 'asc' }
  });

  let progressInfo = null;
  if (nextTier && nextTier.minSpend !== null) {
    // Get customer's total lifetime spending
    const lifetimeSpending = await prisma.cashbackTransaction.aggregate({
      where: {
        customerId,
        shopDomain,
        status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
      },
      _sum: { orderAmount: true }
    });

    const spent = lifetimeSpending._sum.orderAmount || 0;
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
  shopDomain: string
) {
  // Verify customer belongs to shop
  const customer = await prisma.customer.findUnique({
    where: { id: customerId }
  });

  if (!customer || customer.shopDomain !== shopDomain) {
    throw new Error("Customer not found or belongs to different shop");
  }

  // Verify tier belongs to shop
  const tier = await prisma.tier.findUnique({
    where: { id: tierId }
  });

  if (!tier || tier.shopDomain !== shopDomain) {
    throw new Error("Tier not found or belongs to different shop");
  }

  // Use a transaction to ensure atomicity
  const membership = await prisma.$transaction(async (tx) => {
    // Deactivate all current memberships
    await tx.customerMembership.updateMany({
      where: {
        customerId,
        isActive: true
      },
      data: {
        isActive: false
      }
    });

    // Create new membership
    const newMembership = await tx.customerMembership.create({
      data: {
        customerId,
        tierId,
        isActive: true,
      },
      include: { tier: true }
    });

    return newMembership;
  });

  return membership;
}

// Batch evaluate tiers for all customers in a shop
export async function batchEvaluateCustomerTiers(shopDomain: string) {
  const customers = await prisma.customer.findMany({
    where: { shopDomain },
    include: {
      membershipHistory: {
        where: { isActive: true }
      }
    }
  });

  const results = [];
  
  for (const customer of customers) {
    try {
      const result = await evaluateCustomerTier(customer.id, shopDomain);
      results.push({
        customerId: customer.id,
        success: true,
        membership: result
      });
    } catch (error) {
      results.push({
        customerId: customer.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return results;
}

// Get tier distribution for a shop
export async function getTierDistribution(shopDomain: string) {
  const tiers = await prisma.tier.findMany({
    where: { shopDomain },
    orderBy: { level: 'asc' },
    include: {
      _count: {
        select: {
          customerMemberships: {
            where: { isActive: true }
          }
        }
      }
    }
  });

  const totalCustomers = await prisma.customer.count({
    where: { shopDomain }
  });

  return tiers.map(tier => ({
    ...tier,
    memberCount: tier._count.customerMemberships,
    percentage: totalCustomers > 0 
      ? (tier._count.customerMemberships / totalCustomers) * 100 
      : 0
  }));
}