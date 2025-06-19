// app/services/dashboard.server.ts
import prisma from "../db.server";
import { subDays, startOfMonth } from "date-fns";

export interface DashboardMetrics {
  totalCustomers: number;
  customerGrowth: number; // percentage
  totalCashbackThisMonth: number;
  activeStoreCredit: number;
  averageOrderValue: number;
  aovChange: number; // percentage
}

export interface TierDistribution {
  tierId: string;
  tierName: string;
  displayName: string;
  color: string | null;
  level: number;
  memberCount: number;
  percentage: number;
}

export interface RecentActivity {
  id: string;
  type: 'tier_upgrade' | 'cashback_earned' | 'new_customer';
  message: string;
  timestamp: Date;
  customerId: string;
  amount?: number;
}

// Get main dashboard metrics
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const now = new Date();
  const startOfThisMonth = startOfMonth(now);
  const thirtyDaysAgo = subDays(now, 30);
  const sixtyDaysAgo = subDays(now, 60);

  // Total customers
  const totalCustomers = await prisma.customer.count();
  
  // Customer growth (last 30 days vs previous 30 days)
  const customersLast30Days = await prisma.customer.count({
    where: { createdAt: { gte: thirtyDaysAgo } }
  });
  
  const customersPrevious30Days = await prisma.customer.count({
    where: {
      createdAt: {
        gte: sixtyDaysAgo,
        lt: thirtyDaysAgo
      }
    }
  });
  
  const customerGrowth = customersPrevious30Days > 0 
    ? ((customersLast30Days - customersPrevious30Days) / customersPrevious30Days) * 100 
    : 0;

  // Total cashback this month
  const cashbackThisMonth = await prisma.cashbackTransaction.aggregate({
    where: {
      createdAt: { gte: startOfThisMonth },
      status: { in: ["COMPLETED", "SYNCED_TO_SHOPIFY"] }
    },
    _sum: { cashbackAmount: true }
  });

  // Active store credit (liability)
  const activeCredit = await prisma.customer.aggregate({
    _sum: { storeCredit: true }
  });

  // Average order value
  const ordersLast30Days = await prisma.cashbackTransaction.findMany({
    where: {
      createdAt: { gte: thirtyDaysAgo },
      status: { in: ["COMPLETED", "SYNCED_TO_SHOPIFY"] }
    },
    select: { orderAmount: true }
  });

  const ordersPrevious30Days = await prisma.cashbackTransaction.findMany({
    where: {
      createdAt: {
        gte: sixtyDaysAgo,
        lt: thirtyDaysAgo
      },
      status: { in: ["COMPLETED", "SYNCED_TO_SHOPIFY"] }
    },
    select: { orderAmount: true }
  });

  const currentAOV = ordersLast30Days.length > 0
    ? ordersLast30Days.reduce((sum, order) => sum + order.orderAmount, 0) / ordersLast30Days.length
    : 0;

  const previousAOV = ordersPrevious30Days.length > 0
    ? ordersPrevious30Days.reduce((sum, order) => sum + order.orderAmount, 0) / ordersPrevious30Days.length
    : 0;

  const aovChange = previousAOV > 0
    ? ((currentAOV - previousAOV) / previousAOV) * 100
    : 0;

  return {
    totalCustomers,
    customerGrowth: Math.round(customerGrowth * 10) / 10,
    totalCashbackThisMonth: cashbackThisMonth._sum.cashbackAmount || 0,
    activeStoreCredit: activeCredit._sum.storeCredit || 0,
    averageOrderValue: currentAOV,
    aovChange: Math.round(aovChange * 10) / 10
  };
}

// Get tier distribution
export async function getTierDistribution(): Promise<TierDistribution[]> {
  const tiers = await prisma.tier.findMany({
    where: { isActive: true },
    orderBy: { level: 'asc' }
  });

  const memberCounts = await prisma.customerMembership.groupBy({
    by: ['tierId'],
    where: { isActive: true },
    _count: true
  });

  const totalMembers = memberCounts.reduce((sum, tier) => sum + tier._count, 0);

  return tiers.map(tier => {
    const count = memberCounts.find(m => m.tierId === tier.id)?._count || 0;
    return {
      tierId: tier.id,
      tierName: tier.name,
      displayName: tier.displayName,
      color: tier.color,
      level: tier.level,
      memberCount: count,
      percentage: totalMembers > 0 ? Math.round((count / totalMembers) * 1000) / 10 : 0
    };
  });
}

// Get recent activity
export async function getRecentActivity(limit: number = 10): Promise<RecentActivity[]> {
  const activities: RecentActivity[] = [];

  // Get recent tier changes
  const recentMembershipChanges = await prisma.customerMembership.findMany({
    where: {
      isActive: true,
      createdAt: { gte: subDays(new Date(), 7) } // Last 7 days
    },
    include: {
      customer: true,
      tier: true
    },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  // Get recent cashback transactions
  const recentCashback = await prisma.cashbackTransaction.findMany({
    where: {
      createdAt: { gte: subDays(new Date(), 1) }, // Last 24 hours
      status: { in: ["COMPLETED", "SYNCED_TO_SHOPIFY"] }
    },
    include: {
      customer: true
    },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  // Process tier changes
  for (const membership of recentMembershipChanges) {
    // Check if this is an upgrade (not initial assignment)
    const previousMembership = await prisma.customerMembership.findFirst({
      where: {
        customerId: membership.customerId,
        endDate: { not: null },
        createdAt: { lt: membership.createdAt }
      },
      orderBy: { createdAt: 'desc' },
      include: { tier: true }
    });

    if (previousMembership && previousMembership.tier.level < membership.tier.level) {
      activities.push({
        id: membership.id,
        type: 'tier_upgrade',
        message: `${membership.customer.email} upgraded to ${membership.tier.displayName}`,
        timestamp: membership.createdAt,
        customerId: membership.customerId
      });
    } else if (!previousMembership) {
      activities.push({
        id: membership.id,
        type: 'new_customer',
        message: `New customer: ${membership.customer.email} (${membership.tier.displayName})`,
        timestamp: membership.createdAt,
        customerId: membership.customerId
      });
    }
  }

  // Add cashback activities
  for (const transaction of recentCashback) {
    activities.push({
      id: transaction.id,
      type: 'cashback_earned',
      message: `${transaction.customer.email} earned £${transaction.cashbackAmount.toFixed(2)} cashback`,
      timestamp: transaction.createdAt,
      customerId: transaction.customerId,
      amount: transaction.cashbackAmount
    });
  }

  // Sort by timestamp and return limited results
  return activities
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);
}

// Get tier-specific data
export async function getTierDetails(tierId: string) {
  const tier = await prisma.tier.findUnique({
    where: { id: tierId }
  });

  if (!tier) return null;

  // Get members
  const members = await prisma.customerMembership.findMany({
    where: {
      tierId,
      isActive: true
    },
    include: {
      customer: {
        include: {
          transactions: {
            where: {
              createdAt: { gte: subDays(new Date(), 365) },
              status: { in: ["COMPLETED", "SYNCED_TO_SHOPIFY"] }
            }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Calculate tier statistics
  const thirtyDaysAgo = subDays(new Date(), 30);
  const memberCount = members.length;
  const newMembersCount = members.filter(m => m.createdAt >= thirtyDaysAgo).length;
  const growthRate = memberCount > 0 ? (newMembersCount / memberCount) * 100 : 0;

  // Calculate total spending and average
  let totalSpending = 0;
  const memberDetails = members.map(membership => {
    const yearlySpending = membership.customer.transactions.reduce(
      (sum, t) => sum + t.orderAmount, 
      0
    );
    totalSpending += yearlySpending;

    return {
      id: membership.customer.id,
      email: membership.customer.email,
      joinedTier: membership.createdAt,
      yearlySpending,
      storeCredit: membership.customer.storeCredit,
      totalEarned: membership.customer.totalEarned
    };
  });

  const avgSpending = memberCount > 0 ? totalSpending / memberCount : 0;

  // Get recent tier activity
  const recentActivity = await prisma.customerMembership.findMany({
    where: {
      tierId,
      createdAt: { gte: subDays(new Date(), 30) }
    },
    include: {
      customer: true
    },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  // Calculate upgrade rate (members who upgraded from this tier in last 90 days)
  const ninetyDaysAgo = subDays(new Date(), 90);
  const upgradedFrom = await prisma.customerMembership.count({
    where: {
      tierId,
      isActive: false,
      endDate: { gte: ninetyDaysAgo }
    }
  });

  const upgradeRate = memberCount > 0 ? (upgradedFrom / (memberCount + upgradedFrom)) * 100 : 0;

  return {
    tier,
    statistics: {
      memberCount,
      totalSpending,
      avgSpending,
      growthRate: Math.round(growthRate * 10) / 10,
      upgradeRate: Math.round(upgradeRate * 10) / 10,
      totalCashbackIssued: totalSpending * (tier.cashbackPercent / 100)
    },
    members: memberDetails,
    recentActivity: recentActivity.map(activity => ({
      customerId: activity.customerId,
      customerEmail: activity.customer.email,
      action: 'joined_tier',
      timestamp: activity.createdAt
    }))
  };
}

// Get customers close to tier upgrade
export async function getUpgradeOpportunities() {
  const tiers = await prisma.tier.findMany({
    where: { 
      isActive: true,
      minSpend: { not: null },
      spendingPeriodDays: { not: null }
    },
    orderBy: { level: 'asc' }
  });

  const opportunities = [];

  for (let i = 0; i < tiers.length - 1; i++) {
    const currentTier = tiers[i];
    const nextTier = tiers[i + 1];
    
    if (!nextTier.minSpend || !nextTier.spendingPeriodDays) continue;

    // Get customers in current tier
    const memberships = await prisma.customerMembership.findMany({
      where: {
        tierId: currentTier.id,
        isActive: true,
        source: 'SPENDING_THRESHOLD' // Only consider auto-upgraded customers
      },
      include: {
        customer: {
          include: {
            transactions: {
              where: {
                createdAt: { 
                  gte: subDays(new Date(), nextTier.spendingPeriodDays) 
                },
                status: { in: ["COMPLETED", "SYNCED_TO_SHOPIFY"] }
              }
            }
          }
        }
      }
    });

    // Check who's close to upgrade
    for (const membership of memberships) {
      const spending = membership.customer.transactions.reduce(
        (sum, t) => sum + t.orderAmount, 
        0
      );
      
      const remaining = nextTier.minSpend - spending;
      const percentageToNext = (spending / nextTier.minSpend) * 100;
      
      // If within 20% of next tier
      if (percentageToNext >= 80) {
        opportunities.push({
          customerId: membership.customer.id,
          customerEmail: membership.customer.email,
          currentTier: currentTier.displayName,
          nextTier: nextTier.displayName,
          currentSpending: spending,
          requiredSpending: nextTier.minSpend,
          remainingAmount: remaining,
          percentageToNext: Math.round(percentageToNext * 10) / 10
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.percentageToNext - a.percentageToNext);
}