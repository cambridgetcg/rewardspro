// app/services/customer-tier.server.ts
import prisma from "../db.server";
import { TransactionStatus, EvaluationPeriod, AssignmentType, TierChangeType } from "@prisma/client";
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
    orderBy: { cashbackPercent: 'asc' }
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
    
    // Create membership record and log the change
    const membership = await prisma.$transaction(async (tx) => {
      const membership = await tx.customerMembership.create({
        data: {
          customerId,
          tierId: lowestTier.id,
          isActive: true,
          assignmentType: AssignmentType.AUTOMATIC,
        }
      });

      await tx.tierChangeLog.create({
        data: {
          customerId,
          toTierId: lowestTier.id,
          changeType: TierChangeType.INITIAL_ASSIGNMENT,
          changeReason: "New customer initial tier assignment",
          triggeredBy: "System",
          metadata: {
            tierName: lowestTier.name,
            cashbackPercent: lowestTier.cashbackPercent
          }
        }
      });

      return membership;
    });

    return membership;
  }

  // Create membership record and log the change
  const membership = await prisma.$transaction(async (tx) => {
    const membership = await tx.customerMembership.create({
      data: {
        customerId,
        tierId: defaultTier.id,
        isActive: true,
        assignmentType: AssignmentType.AUTOMATIC,
      }
    });

    await tx.tierChangeLog.create({
      data: {
        customerId,
        toTierId: defaultTier.id,
        changeType: TierChangeType.INITIAL_ASSIGNMENT,
        changeReason: "New customer default tier assignment",
        triggeredBy: "System",
        metadata: {
          tierName: defaultTier.name,
          cashbackPercent: defaultTier.cashbackPercent
        }
      }
    });

    return membership;
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
  const now = new Date();
  const tiers = await prisma.tier.findMany({
    where: { 
      shopDomain,
      isActive: true
    },
    orderBy: { cashbackPercent: 'desc' }
  });

  // Calculate spending based on evaluation periods
  const twelveMonthsAgo = subMonths(now, 12);
  
  // Calculate spending amounts that will be used for evaluation
  const lifetimeSpending = customer.transactions.reduce(
    (sum, t) => sum + t.orderAmount, 
    0
  );
  const annualSpending = customer.transactions
    .filter(t => t.createdAt >= twelveMonthsAgo)
    .reduce((sum, t) => sum + t.orderAmount, 0);
  
  // Find the highest tier the customer qualifies for
  let qualifiedTier: Tier | null = null;
  let qualifiedTierSpending = 0;

  for (const tier of tiers) {
    // Get spending amount based on tier's evaluation period
    const tierQualifyingSpending = tier.evaluationPeriod === EvaluationPeriod.LIFETIME 
      ? lifetimeSpending 
      : annualSpending;
    
    // If tier has no minimum spend, it's always qualified
    if (tier.minSpend === null) {
      qualifiedTier = tier;
      qualifiedTierSpending = tierQualifyingSpending;
      continue;
    }

    // Check if customer qualifies for this tier
    if (tierQualifyingSpending >= tier.minSpend) {
      qualifiedTier = tier;
      qualifiedTierSpending = tierQualifyingSpending;
      break; // Found highest qualifying tier
    }
  }

  // If no tier qualified, use the base tier (no minSpend)
  if (!qualifiedTier) {
    qualifiedTier = tiers.find(t => t.minSpend === null) || tiers[tiers.length - 1];
    qualifiedTierSpending = qualifiedTier.evaluationPeriod === EvaluationPeriod.LIFETIME 
      ? lifetimeSpending 
      : annualSpending;
  }

  // Update if tier changed
  if (!currentMembership || currentMembership.tierId !== qualifiedTier.id) {
    // Use a transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Deactivate current membership
      await tx.customerMembership.updateMany({
        where: {
          customerId,
          isActive: true
        },
        data: {
          isActive: false,
          endDate: now
        }
      });

      // Create the new membership
      const newMembership = await tx.customerMembership.create({
        data: {
          customerId,
          tierId: qualifiedTier.id,
          isActive: true,
          assignmentType: AssignmentType.AUTOMATIC,
          previousTierId: currentMembership?.tierId
        },
        include: { tier: true }
      });

      // Log the tier change
      await tx.tierChangeLog.create({
        data: {
          customerId,
          fromTierId: currentMembership?.tierId,
          toTierId: qualifiedTier.id,
          changeType: currentMembership 
            ? (qualifiedTier.cashbackPercent > currentMembership.tier.cashbackPercent 
                ? TierChangeType.AUTOMATIC_UPGRADE 
                : TierChangeType.AUTOMATIC_DOWNGRADE)
            : TierChangeType.INITIAL_ASSIGNMENT,
          changeReason: "Automatic tier evaluation based on spending",
          triggeredBy: "System",
          metadata: {
            previousTier: currentMembership ? {
              name: currentMembership.tier.name,
              cashbackPercent: currentMembership.tier.cashbackPercent
            } : null,
            newTier: {
              name: qualifiedTier.name,
              cashbackPercent: qualifiedTier.cashbackPercent
            },
            qualifyingSpending: qualifiedTierSpending,
            lifetimeSpending,
            annualSpending
          }
        }
      });

      // Update customer analytics
      await updateCustomerAnalytics(customerId, shopDomain);

      return newMembership;
    });

    return result;
  }

  return currentMembership;
}

// Update customer analytics
async function updateCustomerAnalytics(customerId: string, shopDomain: string) {
  const now = new Date();
  const twelveMonthsAgo = subMonths(now, 12);
  const threeMonthsAgo = subMonths(now, 3);
  const oneMonthAgo = subMonths(now, 1);

  // Get all transaction data
  const transactions = await prisma.cashbackTransaction.findMany({
    where: {
      customerId,
      shopDomain,
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Calculate metrics
  const lifetimeSpending = transactions.reduce((sum, t) => sum + t.orderAmount, 0);
  const yearlySpending = transactions
    .filter(t => t.createdAt >= twelveMonthsAgo)
    .reduce((sum, t) => sum + t.orderAmount, 0);
  const quarterlySpending = transactions
    .filter(t => t.createdAt >= threeMonthsAgo)
    .reduce((sum, t) => sum + t.orderAmount, 0);
  const monthlySpending = transactions
    .filter(t => t.createdAt >= oneMonthAgo)
    .reduce((sum, t) => sum + t.orderAmount, 0);
  
  const orderCount = transactions.length;
  const avgOrderValue = orderCount > 0 ? lifetimeSpending / orderCount : 0;
  const lastOrderDate = transactions[0]?.createdAt || null;
  const daysSinceLastOrder = lastOrderDate 
    ? Math.floor((now.getTime() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Get tier info
  const membership = await prisma.customerMembership.findFirst({
    where: { customerId, isActive: true },
    include: { tier: true }
  });

  const tierChanges = await prisma.tierChangeLog.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' }
  });

  const lastTierChange = tierChanges[0]?.createdAt || membership?.startDate || now;
  const currentTierDays = Math.floor((now.getTime() - lastTierChange.getTime()) / (1000 * 60 * 60 * 24));
  const tierUpgradeCount = tierChanges.filter(
    t => t.changeType === TierChangeType.AUTOMATIC_UPGRADE || t.changeType === TierChangeType.MANUAL_OVERRIDE
  ).length;

  // Calculate progress to next tier
  let nextTierProgress = 0;
  if (membership) {
    const nextTier = await prisma.tier.findFirst({
      where: {
        shopDomain,
        cashbackPercent: { gt: membership.tier.cashbackPercent },
        isActive: true,
        minSpend: { not: null }
      },
      orderBy: { cashbackPercent: 'asc' }
    });

    if (nextTier && nextTier.minSpend) {
      const relevantSpending = nextTier.evaluationPeriod === EvaluationPeriod.LIFETIME
        ? lifetimeSpending
        : yearlySpending;
      nextTierProgress = Math.min(100, (relevantSpending / nextTier.minSpend) * 100);
    }
  }

  // Update or create analytics record
  await prisma.customerAnalytics.upsert({
    where: { customerId },
    update: {
      lifetimeSpending,
      yearlySpending,
      quarterlySpending,
      monthlySpending,
      avgOrderValue,
      orderCount,
      currentTierDays,
      tierUpgradeCount,
      lastTierChange,
      nextTierProgress,
      lastOrderDate,
      daysSinceLastOrder,
      calculatedAt: now
    },
    create: {
      customerId,
      shopDomain,
      lifetimeSpending,
      yearlySpending,
      quarterlySpending,
      monthlySpending,
      avgOrderValue,
      orderCount,
      currentTierDays,
      tierUpgradeCount,
      lastTierChange,
      nextTierProgress,
      lastOrderDate,
      daysSinceLastOrder
    }
  });
}

// Get customer's current tier info with analytics
export async function getCustomerTierInfo(customerId: string, shopDomain: string) {
  const membership = await prisma.customerMembership.findFirst({
    where: {
      customerId,
      isActive: true
    },
    include: {
      tier: true,
      customer: {
        include: {
          analytics: true,
          transactions: {
            where: {
              status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
            }
          }
        }
      }
    }
  });

  if (!membership || membership.customer.shopDomain !== shopDomain) return null;

  // Get next tier info
  const currentTierCashback = membership.tier.cashbackPercent;
  
  const nextTier = await prisma.tier.findFirst({
    where: {
      shopDomain,
      cashbackPercent: { gt: currentTierCashback },
      isActive: true
    },
    orderBy: { cashbackPercent: 'asc' }
  });

  let progressInfo = null;
  if (nextTier && nextTier.minSpend !== null) {
    let relevantSpending = 0;
    
    // Use analytics if available, otherwise calculate from transactions
    if (membership.customer.analytics) {
      relevantSpending = nextTier.evaluationPeriod === EvaluationPeriod.LIFETIME
        ? membership.customer.analytics.lifetimeSpending
        : membership.customer.analytics.yearlySpending;
    } else {
      // Fallback: calculate from transactions if analytics are missing
      const now = new Date();
      const twelveMonthsAgo = subMonths(now, 12);
      
      if (nextTier.evaluationPeriod === EvaluationPeriod.LIFETIME) {
        relevantSpending = membership.customer.transactions.reduce(
          (sum, t) => sum + t.orderAmount, 
          0
        );
      } else {
        relevantSpending = membership.customer.transactions
          .filter(t => t.createdAt >= twelveMonthsAgo)
          .reduce((sum, t) => sum + t.orderAmount, 0);
      }
    }
    
    // Calculate progress percentage directly
    const progressPercentage = Math.min(100, (relevantSpending / nextTier.minSpend) * 100);
    
    progressInfo = {
      nextTier,
      currentSpending: relevantSpending,
      requiredSpending: nextTier.minSpend,
      remainingSpending: Math.max(0, nextTier.minSpend - relevantSpending),
      progressPercentage: progressPercentage
    };
  }

  // Get recent tier changes
  const recentChanges = await prisma.tierChangeLog.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: {
      fromTier: true,
      toTier: true
    }
  });

  return {
    membership,
    analytics: membership.customer.analytics,
    progressInfo,
    recentChanges
  };
}

// Manually assign a tier (admin action)
export async function assignTierManually(
  customerId: string, 
  tierId: string,
  shopDomain: string,
  assignedBy: string,
  reason?: string,
  endDate?: Date
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
    where: { 
      id: tierId,
      shopDomain
    }
  });

  if (!tier) {
    throw new Error("Tier not found or belongs to different shop");
  }

  // Get current membership
  const currentMembership = await prisma.customerMembership.findFirst({
    where: { customerId, isActive: true },
    include: { tier: true }
  });

  const now = new Date();

  // Use a transaction to ensure atomicity
  const membership = await prisma.$transaction(async (tx) => {
    // Deactivate current memberships
    await tx.customerMembership.updateMany({
      where: {
        customerId,
        isActive: true
      },
      data: {
        isActive: false,
        endDate: now
      }
    });

    // Create new membership
    const newMembership = await tx.customerMembership.create({
      data: {
        customerId,
        tierId,
        isActive: true,
        assignmentType: AssignmentType.MANUAL,
        assignedBy,
        reason,
        endDate,
        previousTierId: currentMembership?.tierId
      },
      include: { tier: true }
    });

    // Log the change
    await tx.tierChangeLog.create({
      data: {
        customerId,
        fromTierId: currentMembership?.tierId,
        toTierId: tierId,
        changeType: TierChangeType.MANUAL_OVERRIDE,
        changeReason: reason || "Manual tier assignment by admin",
        triggeredBy: assignedBy,
        metadata: {
          previousTier: currentMembership ? {
            name: currentMembership.tier.name,
            cashbackPercent: currentMembership.tier.cashbackPercent
          } : null,
          newTier: {
            name: tier.name,
            cashbackPercent: tier.cashbackPercent
          },
          endDate
        }
      }
    });

    // Update analytics
    await updateCustomerAnalytics(customerId, shopDomain);

    return newMembership;
  });

  return membership;
}

// Batch evaluate tiers for all customers in a shop
export async function batchEvaluateCustomerTiers(shopDomain: string, batchSize = 100) {
  const totalCustomers = await prisma.customer.count({
    where: { shopDomain }
  });

  const results = [];
  let processed = 0;
  
  while (processed < totalCustomers) {
    const customers = await prisma.customer.findMany({
      where: { shopDomain },
      skip: processed,
      take: batchSize,
      include: {
        membershipHistory: {
          where: { isActive: true }
        }
      }
    });

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

    processed += customers.length;
  }

  return {
    totalProcessed: processed,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results
  };
}

// Get tier distribution with analytics
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

  // Get analytics for each tier
  const tierAnalytics = await Promise.all(
    tiers.map(async (tier) => {
      const members = await prisma.customerMembership.findMany({
        where: {
          tierId: tier.id,
          isActive: true
        },
        include: {
          customer: {
            include: {
              analytics: true
            }
          }
        }
      });

      const avgLifetimeSpending = members.reduce(
        (sum, m) => sum + (m.customer.analytics?.lifetimeSpending || 0),
        0
      ) / (members.length || 1);

      const avgYearlySpending = members.reduce(
        (sum, m) => sum + (m.customer.analytics?.yearlySpending || 0),
        0
      ) / (members.length || 1);

      return {
        ...tier,
        memberCount: tier._count.customerMemberships,
        percentage: totalCustomers > 0 
          ? (tier._count.customerMemberships / totalCustomers) * 100 
          : 0,
        avgLifetimeSpending,
        avgYearlySpending
      };
    })
  );

  return tierAnalytics;
}

// Handle tier expiration
export async function handleExpiredMemberships(shopDomain: string) {
  const now = new Date();
  
  // Find expired manual assignments
  const expiredMemberships = await prisma.customerMembership.findMany({
    where: {
      isActive: true,
      endDate: { lte: now },
      customer: {
        shopDomain
      }
    },
    include: {
      customer: true,
      tier: true
    }
  });

  const results = [];

  for (const membership of expiredMemberships) {
    try {
      // Re-evaluate the customer's tier
      const result = await evaluateCustomerTier(membership.customerId, shopDomain);
      
      // Log the expiration
      await prisma.tierChangeLog.create({
        data: {
          customerId: membership.customerId,
          fromTierId: membership.tierId,
          toTierId: result?.tierId || membership.tierId,
          changeType: TierChangeType.EXPIRATION_REVERT,
          changeReason: "Manual tier assignment expired",
          triggeredBy: "System",
          metadata: {
            expiredAssignment: {
              tierId: membership.tierId,
              tierName: membership.tier.name,
              assignedBy: membership.assignedBy,
              reason: membership.reason
            }
          }
        }
      });

      results.push({
        customerId: membership.customerId,
        success: true,
        newTier: result
      });
    } catch (error) {
      results.push({
        customerId: membership.customerId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return results;
}