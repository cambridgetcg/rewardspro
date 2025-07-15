// app/services/customer-tier.server.ts
import prisma from "../db.server";
import { TransactionStatus, EvaluationPeriod } from "@prisma/client";
import type { Customer, Tier, CustomerMembership } from "@prisma/client";
import { subMonths } from "date-fns";

// Assign initial tier to new customer
export async function assignInitialTier(customerId: string, shopDomain: string) {
  // Get the tier with no minimum spend (base tier)
  const defaultTier = await prisma.tier.findFirst({
    where: { 
      shopDomain,
      isActive: true,
      minSpend: null
    },
    orderBy: { cashbackPercent: 'asc' } // Lowest cashback for base tier
  });

  if (!defaultTier) {
    // If no base tier exists, get the tier with lowest minimum spend
    const lowestTier = await prisma.tier.findFirst({
      where: { 
        shopDomain,
        isActive: true 
      },
      orderBy: { minSpend: 'asc' }
    });
    
    if (!lowestTier) {
      throw new Error("No active tiers found for shop");
    }
    
    return prisma.customerMembership.create({
      data: {
        customerId,
        tierId: lowestTier.id,
        isActive: true,
      }
    });
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

// Evaluate customer's tier based on spending
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
        },
        orderBy: { createdAt: 'desc' }
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
    orderBy: { cashbackPercent: 'desc' } // Start from highest cashback
  });

  // Calculate spending based on evaluation periods
  const now = new Date();
  const twelveMonthsAgo = subMonths(now, 12);
  
  // Find the highest tier the customer qualifies for
  let qualifiedTier: Tier | null = null;

  for (const tier of tiers) {
    let qualifyingSpending = 0;
    
    // Calculate spending based on tier's evaluation period
    if (tier.evaluationPeriod === EvaluationPeriod.LIFETIME) {
      // Sum all transactions
      qualifyingSpending = customer.transactions.reduce(
        (sum, t) => sum + t.orderAmount, 
        0
      );
    } else {
      // Sum only last 12 months
      qualifyingSpending = customer.transactions
        .filter(t => t.createdAt >= twelveMonthsAgo)
        .reduce((sum, t) => sum + t.orderAmount, 0);
    }
    
    // If tier has no minimum spend, it's always qualified
    if (tier.minSpend === null) {
      qualifiedTier = tier;
      continue;
    }

    // Check if customer qualifies for this tier
    if (qualifyingSpending >= tier.minSpend) {
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
      // Delete all existing active memberships for this customer
      await tx.customerMembership.deleteMany({
        where: {
          customerId,
          isActive: true
        }
      });

      // Create the new membership
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
  const currentTierCashback = membership.tier.cashbackPercent;
  
  // Find next tier (higher cashback than current)
  const nextTier = await prisma.tier.findFirst({
    where: {
      shopDomain,
      cashbackPercent: { gt: currentTierCashback },
      isActive: true
    },
    orderBy: { cashbackPercent: 'asc' } // Get the next highest
  });

  let progressInfo = null;
  if (nextTier && nextTier.minSpend !== null) {
    // Calculate spending based on next tier's evaluation period
    const now = new Date();
    const twelveMonthsAgo = subMonths(now, 12);
    
    let relevantSpending = 0;
    
    if (nextTier.evaluationPeriod === EvaluationPeriod.LIFETIME) {
      const lifetimeSpending = await prisma.cashbackTransaction.aggregate({
        where: {
          customerId,
          shopDomain,
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        },
        _sum: { orderAmount: true }
      });
      relevantSpending = lifetimeSpending._sum.orderAmount || 0;
    } else {
      const annualSpending = await prisma.cashbackTransaction.aggregate({
        where: {
          customerId,
          shopDomain,
          createdAt: { gte: twelveMonthsAgo },
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        },
        _sum: { orderAmount: true }
      });
      relevantSpending = annualSpending._sum.orderAmount || 0;
    }
    
    progressInfo = {
      nextTier,
      currentSpending: relevantSpending,
      requiredSpending: nextTier.minSpend,
      remainingSpending: Math.max(0, nextTier.minSpend - relevantSpending),
      progressPercentage: Math.min(100, (relevantSpending / nextTier.minSpend) * 100)
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
    // Delete all active memberships
    await tx.customerMembership.deleteMany({
      where: {
        customerId,
        isActive: true
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
    orderBy: { cashbackPercent: 'desc' },
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