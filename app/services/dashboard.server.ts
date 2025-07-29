// app/services/dashboard.server.ts
import { PrismaClient, TransactionStatus, TierChangeType, LedgerEntryType, AssignmentType, LedgerSource, EvaluationPeriod } from "@prisma/client";
import { subDays, startOfMonth, startOfWeek, startOfYear, endOfDay, format } from "date-fns";

// Initialize Prisma client (assuming it's exported from db.server.ts)
const prisma = new PrismaClient();

// Types for dashboard data
export interface DashboardMetrics {
  // Customer metrics
  totalCustomers: number;
  activeCustomers: number;
  newCustomersThisMonth: number;
  customerGrowth: number;
  customersAtRisk: number;
  avgDaysSinceLastOrder: number;
  
  // Financial metrics
  totalRevenue30Days: number;
  totalCashbackThisMonth: number;
  totalCashbackAllTime: number;
  activeStoreCredit: number;
  storeCreditUtilization: number;
  unreconciledCredit: number;
  
  // Order metrics
  averageOrderValue: number;
  aovChange: number;
  totalOrders30Days: number;
  orderGrowth: number;
  repeatPurchaseRate: number;
  
  // Tier metrics
  avgCustomerLifetimeValue: number;
  tierUpgradesThisMonth: number;
  tierDowngradesThisMonth: number;
  manualAssignments: number;
}

export interface TierDistribution {
  tierId: string;
  tierName: string;
  displayName: string; // Generated from name
  color: string; // Generated based on index
  level: number; // Generated based on sort order
  memberCount: number;
  percentage: number;
  avgSpending: number;
  avgOrderValue: number;
  retentionRate: number;
  cashbackPercent: number;
  manualAssignments: number;
  minSpend: number | null;
}

export interface RecentActivity {
  id: string;
  type: 'tier_upgrade' | 'tier_downgrade' | 'cashback_earned' | 'new_customer' | 'manual_adjustment' | 'credit_sync';
  message: string;
  timestamp: Date;
  customerId: string;
  amount?: number;
  metadata?: any;
}

export interface CustomerInsight {
  id: string;
  email: string;
  totalSpending: number;
  totalEarned: number;
  storeCredit: number;
  currentTier: string;
  daysSinceLastOrder: number | null;
  orderCount: number;
  nextTierProgress: number;
  riskScore: number; // 0-100, higher = more at risk
}

export interface EngagementMetrics {
  daily: Array<{ date: string; orders: number; revenue: number }>;
  weekly: Array<{ week: string; orders: number; revenue: number }>;
}

export interface CreditReconciliation {
  totalCustomers: number;
  syncedToday: number;
  syncedThisWeek: number;
  neverSynced: number;
  outOfSync: number;
  totalUnreconciledAmount: number;
}

export interface UpgradeOpportunity {
  customerId: string;
  customerEmail: string;
  currentTier: string;
  nextTier: string;
  currentSpending: number;
  requiredSpending: number;
  remainingAmount: number;
  percentageToNext: number;
  estimatedDaysToUpgrade: number | null;
}

// Main dashboard service class
export class DashboardService {
  private shopDomain: string;

  constructor(shopDomain: string) {
    this.shopDomain = shopDomain;
  }

  // Get all dashboard data
  async getDashboardData() {
    const [
      metrics,
      tierDistribution,
      recentActivity,
      topCustomers,
      upgradeOpportunities,
      engagementMetrics,
      creditReconciliation
    ] = await Promise.all([
      this.getDashboardMetrics(),
      this.getTierDistribution(),
      this.getRecentActivity(20),
      this.getTopCustomers(10),
      this.getUpgradeOpportunities(),
      this.getEngagementMetrics(),
      this.getCreditReconciliation()
    ]);

    return {
      metrics,
      tierDistribution,
      recentActivity,
      topCustomers,
      upgradeOpportunities,
      engagementMetrics,
      creditReconciliation
    };
  }

  // Get main dashboard metrics
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const now = new Date();
    const startOfThisMonth = startOfMonth(now);
    const thirtyDaysAgo = subDays(now, 30);
    const sixtyDaysAgo = subDays(now, 60);

    // Parallel queries for better performance
    const [
      customerStats,
      financialStats,
      orderStats,
      tierStats,
      analyticsStats
    ] = await Promise.all([
      this.getCustomerStats(thirtyDaysAgo, sixtyDaysAgo, startOfThisMonth),
      this.getFinancialStats(thirtyDaysAgo, startOfThisMonth),
      this.getOrderStats(thirtyDaysAgo, sixtyDaysAgo),
      this.getTierStats(startOfThisMonth),
      this.getAnalyticsStats()
    ]);

    return {
      ...customerStats,
      ...financialStats,
      ...orderStats,
      ...tierStats,
      ...analyticsStats
    };
  }

  private async getCustomerStats(thirtyDaysAgo: Date, sixtyDaysAgo: Date, startOfThisMonth: Date) {
    const [
      totalCustomers,
      activeCustomers,
      newCustomersThisMonth,
      customersLast30Days,
      customersPrevious30Days
    ] = await Promise.all([
      prisma.customer.count({ where: { shopDomain: this.shopDomain } }),
      
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          analytics: { lastOrderDate: { gte: thirtyDaysAgo } }
        }
      }),
      
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: startOfThisMonth }
        }
      }),
      
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: thirtyDaysAgo }
        }
      }),
      
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo }
        }
      })
    ]);

    const customerGrowth = customersPrevious30Days > 0
      ? ((customersLast30Days - customersPrevious30Days) / customersPrevious30Days) * 100
      : 100;

    return {
      totalCustomers,
      activeCustomers,
      newCustomersThisMonth,
      customerGrowth: Math.round(customerGrowth * 10) / 10
    };
  }

  private async getFinancialStats(thirtyDaysAgo: Date, startOfThisMonth: Date) {
    const [
      revenue30Days,
      cashbackThisMonth,
      cashbackAllTime,
      activeCredit,
      creditsUsed,
      unreconciledCount
    ] = await Promise.all([
      prisma.cashbackTransaction.aggregate({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: thirtyDaysAgo },
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        },
        _sum: { orderAmount: true }
      }),
      
      prisma.cashbackTransaction.aggregate({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: startOfThisMonth },
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        },
        _sum: { cashbackAmount: true }
      }),
      
      prisma.cashbackTransaction.aggregate({
        where: {
          shopDomain: this.shopDomain,
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        },
        _sum: { cashbackAmount: true }
      }),
      
      prisma.customer.aggregate({
        where: { shopDomain: this.shopDomain },
        _sum: { storeCredit: true }
      }),
      
      prisma.storeCreditLedger.aggregate({
        where: {
          shopDomain: this.shopDomain,
          type: LedgerEntryType.ORDER_PAYMENT,
          createdAt: { gte: thirtyDaysAgo }
        },
        _sum: { amount: true }
      }),
      
      prisma.storeCreditLedger.count({
        where: {
          shopDomain: this.shopDomain,
          reconciledAt: null,
          source: { in: [LedgerSource.APP_CASHBACK, LedgerSource.APP_MANUAL] }
        }
      })
    ]);

    const storeCreditUtilization = (cashbackAllTime._sum.cashbackAmount || 0) > 0
      ? (Math.abs(creditsUsed._sum.amount || 0) / (cashbackAllTime._sum.cashbackAmount || 1)) * 100
      : 0;

    return {
      totalRevenue30Days: revenue30Days._sum.orderAmount || 0,
      totalCashbackThisMonth: cashbackThisMonth._sum.cashbackAmount || 0,
      totalCashbackAllTime: cashbackAllTime._sum.cashbackAmount || 0,
      activeStoreCredit: activeCredit._sum.storeCredit || 0,
      storeCreditUtilization: Math.round(storeCreditUtilization * 10) / 10,
      unreconciledCredit: unreconciledCount
    };
  }

  private async getOrderStats(thirtyDaysAgo: Date, sixtyDaysAgo: Date) {
    const [ordersLast30Days, ordersPrevious30Days] = await Promise.all([
      prisma.cashbackTransaction.findMany({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: thirtyDaysAgo },
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        },
        select: { orderAmount: true }
      }),
      
      prisma.cashbackTransaction.findMany({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        },
        select: { orderAmount: true }
      })
    ]);

    const currentAOV = ordersLast30Days.length > 0
      ? ordersLast30Days.reduce((sum, order) => sum + order.orderAmount, 0) / ordersLast30Days.length
      : 0;

    const previousAOV = ordersPrevious30Days.length > 0
      ? ordersPrevious30Days.reduce((sum, order) => sum + order.orderAmount, 0) / ordersPrevious30Days.length
      : 0;

    const aovChange = previousAOV > 0
      ? ((currentAOV - previousAOV) / previousAOV) * 100
      : 0;

    const orderGrowth = ordersPrevious30Days.length > 0
      ? ((ordersLast30Days.length - ordersPrevious30Days.length) / ordersPrevious30Days.length) * 100
      : 100;

    // Calculate repeat purchase rate
    const customersWithMultipleOrders = await prisma.customer.count({
      where: {
        shopDomain: this.shopDomain,
        analytics: { orderCount: { gt: 1 } }
      }
    });

    const customersWithOrders = await prisma.customer.count({
      where: {
        shopDomain: this.shopDomain,
        analytics: { orderCount: { gt: 0 } }
      }
    });

    const repeatPurchaseRate = customersWithOrders > 0
      ? (customersWithMultipleOrders / customersWithOrders) * 100
      : 0;

    return {
      averageOrderValue: currentAOV,
      aovChange: Math.round(aovChange * 10) / 10,
      totalOrders30Days: ordersLast30Days.length,
      orderGrowth: Math.round(orderGrowth * 10) / 10,
      repeatPurchaseRate: Math.round(repeatPurchaseRate * 10) / 10
    };
  }

  private async getTierStats(startOfThisMonth: Date) {
    const [tierUpgrades, tierDowngrades, manualAssignments] = await Promise.all([
      prisma.tierChangeLog.count({
        where: {
          customer: { shopDomain: this.shopDomain },
          createdAt: { gte: startOfThisMonth },
          changeType: { in: [TierChangeType.AUTOMATIC_UPGRADE, TierChangeType.MANUAL_OVERRIDE] }
        }
      }),
      
      prisma.tierChangeLog.count({
        where: {
          customer: { shopDomain: this.shopDomain },
          createdAt: { gte: startOfThisMonth },
          changeType: TierChangeType.AUTOMATIC_DOWNGRADE
        }
      }),
      
      prisma.customerMembership.count({
        where: {
          customer: { shopDomain: this.shopDomain },
          assignmentType: AssignmentType.MANUAL,
          isActive: true
        }
      })
    ]);

    return {
      tierUpgradesThisMonth: tierUpgrades,
      tierDowngradesThisMonth: tierDowngrades,
      manualAssignments
    };
  }

  private async getAnalyticsStats() {
    const analytics = await prisma.customerAnalytics.aggregate({
      where: { shopDomain: this.shopDomain },
      _avg: {
        lifetimeSpending: true,
        daysSinceLastOrder: true
      }
    });

    const customersAtRisk = await prisma.customerAnalytics.count({
      where: {
        shopDomain: this.shopDomain,
        daysSinceLastOrder: { gt: 90 }
      }
    });

    return {
      avgCustomerLifetimeValue: analytics._avg.lifetimeSpending || 0,
      avgDaysSinceLastOrder: Math.round(analytics._avg.daysSinceLastOrder || 0),
      customersAtRisk
    };
  }

  // Get tier distribution with analytics
  async getTierDistribution(): Promise<TierDistribution[]> {
    const tiers = await prisma.tier.findMany({
      where: { shopDomain: this.shopDomain, isActive: true },
      orderBy: [
        { minSpend: { sort: 'asc', nulls: 'last' } },
        { cashbackPercent: 'asc' }
      ]
    });

    const distributions = await Promise.all(
      tiers.map(async (tier, index) => {
        const memberships = await prisma.customerMembership.findMany({
          where: { tierId: tier.id, isActive: true },
          include: {
            customer: {
              include: { analytics: true }
            }
          }
        });

        const memberCount = memberships.length;
        const manualAssignments = memberships.filter(
          m => m.assignmentType === AssignmentType.MANUAL
        ).length;

        // Calculate metrics using analytics table
        const metrics = memberships.reduce(
          (acc, membership) => {
            const analytics = membership.customer.analytics;
            if (analytics) {
              acc.totalSpending += analytics.yearlySpending;
              acc.totalOrderValue += analytics.avgOrderValue;
              acc.activeCount += analytics.daysSinceLastOrder && analytics.daysSinceLastOrder <= 30 ? 1 : 0;
            }
            return acc;
          },
          { totalSpending: 0, totalOrderValue: 0, activeCount: 0 }
        );

        const avgSpending = memberCount > 0 ? metrics.totalSpending / memberCount : 0;
        const avgOrderValue = memberCount > 0 ? metrics.totalOrderValue / memberCount : 0;
        const retentionRate = memberCount > 0 ? (metrics.activeCount / memberCount) * 100 : 0;

        // Generate display name and level based on position
        const displayName = this.formatTierName(tier.name);
        const level = index + 1;

        return {
          tierId: tier.id,
          tierName: tier.name,
          displayName: displayName,
          color: this.getDefaultTierColor(index),
          level: level,
          memberCount,
          percentage: 0, // Will calculate after
          avgSpending,
          avgOrderValue,
          retentionRate: Math.round(retentionRate * 10) / 10,
          cashbackPercent: tier.cashbackPercent,
          manualAssignments,
          minSpend: tier.minSpend
        };
      })
    );

    // Calculate percentages
    const totalMembers = distributions.reduce((sum, tier) => sum + tier.memberCount, 0);
    return distributions.map(tier => ({
      ...tier,
      percentage: totalMembers > 0 ? Math.round((tier.memberCount / totalMembers) * 1000) / 10 : 0
    }));
  }

  // Get recent activity across the platform
  async getRecentActivity(limit: number = 10): Promise<RecentActivity[]> {
    const sevenDaysAgo = subDays(new Date(), 7);
    
    // Fetch different types of activities in parallel
    const [
      tierChanges,
      recentCashback,
      newCustomers,
      creditAdjustments,
      recentSyncs
    ] = await Promise.all([
      // Tier changes
      prisma.tierChangeLog.findMany({
        where: {
          customer: { shopDomain: this.shopDomain },
          createdAt: { gte: sevenDaysAgo }
        },
        include: {
          customer: true,
          fromTier: true,
          toTier: true
        },
        orderBy: { createdAt: 'desc' },
        take: limit
      }),
      
      // Recent cashback
      prisma.cashbackTransaction.findMany({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: subDays(new Date(), 1) },
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        },
        include: { customer: true },
        orderBy: { createdAt: 'desc' },
        take: limit
      }),
      
      // New customers
      prisma.customer.findMany({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: sevenDaysAgo }
        },
        include: {
          membershipHistory: {
            where: { isActive: true },
            include: { tier: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: limit
      }),
      
      // Manual credit adjustments
      prisma.storeCreditLedger.findMany({
        where: {
          shopDomain: this.shopDomain,
          type: LedgerEntryType.MANUAL_ADJUSTMENT,
          createdAt: { gte: sevenDaysAgo }
        },
        include: { customer: true },
        orderBy: { createdAt: 'desc' },
        take: limit
      }),
      
      // Recent syncs
      prisma.customer.findMany({
        where: {
          shopDomain: this.shopDomain,
          lastSyncedAt: { gte: subDays(new Date(), 1) }
        },
        orderBy: { lastSyncedAt: 'desc' },
        take: Math.floor(limit / 2) // Less important, so fewer items
      })
    ]);

    // Convert to activity items
    const activities: RecentActivity[] = [];

    // Process tier changes
    tierChanges.forEach(change => {
      const isUpgrade = change.changeType === TierChangeType.AUTOMATIC_UPGRADE ||
                       (change.changeType === TierChangeType.MANUAL_OVERRIDE && 
                        change.fromTier && change.toTier.cashbackPercent > change.fromTier.cashbackPercent);
      
      activities.push({
        id: change.id,
        type: isUpgrade ? 'tier_upgrade' : 'tier_downgrade',
        message: `${change.customer.email} ${
          change.changeType === TierChangeType.MANUAL_OVERRIDE ? 'manually assigned to' :
          isUpgrade ? 'upgraded to' : 'downgraded to'
        } ${this.formatTierName(change.toTier.name)}`,
        timestamp: change.createdAt,
        customerId: change.customerId,
        metadata: {
          changeType: change.changeType,
          fromTier: change.fromTier?.name,
          toTier: change.toTier.name
        }
      });
    });

    // Process cashback
    recentCashback.forEach(transaction => {
      activities.push({
        id: transaction.id,
        type: 'cashback_earned',
        message: `${transaction.customer.email} earned $${transaction.cashbackAmount.toFixed(2)} cashback`,
        timestamp: transaction.createdAt,
        customerId: transaction.customerId,
        amount: transaction.cashbackAmount
      });
    });

    // Process new customers
    newCustomers.forEach(customer => {
      const currentTier = customer.membershipHistory[0]?.tier;
      activities.push({
        id: customer.id,
        type: 'new_customer',
        message: `New customer: ${customer.email}${
          currentTier ? ` (${this.formatTierName(currentTier.name)})` : ''
        }`,
        timestamp: customer.createdAt,
        customerId: customer.id
      });
    });

    // Process manual adjustments
    creditAdjustments.forEach(adjustment => {
      activities.push({
        id: adjustment.id,
        type: 'manual_adjustment',
        message: `Credit ${adjustment.amount >= 0 ? 'added' : 'deducted'}: $${
          Math.abs(adjustment.amount).toFixed(2)
        } for ${adjustment.customer.email}`,
        timestamp: adjustment.createdAt,
        customerId: adjustment.customerId,
        amount: adjustment.amount,
        metadata: { description: adjustment.description }
      });
    });

    // Process syncs
    recentSyncs.forEach(customer => {
      if (customer.lastSyncedAt) {
        activities.push({
          id: `sync-${customer.id}`,
          type: 'credit_sync',
          message: `Store credit synced for ${customer.email}`,
          timestamp: customer.lastSyncedAt,
          customerId: customer.id
        });
      }
    });

    // Sort by timestamp and limit
    return activities
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  // Get top customers with insights
  async getTopCustomers(limit: number = 10): Promise<CustomerInsight[]> {
    const customers = await prisma.customer.findMany({
      where: { shopDomain: this.shopDomain },
      include: {
        analytics: true,
        membershipHistory: {
          where: { isActive: true },
          include: { tier: true }
        }
      },
      orderBy: {
        analytics: {
          lifetimeSpending: 'desc'
        }
      },
      take: limit
    });

    return customers.map(customer => {
      const analytics = customer.analytics;
      const currentTier = customer.membershipHistory[0]?.tier;
      
      // Calculate risk score (0-100)
      let riskScore = 0;
      if (analytics) {
        if (analytics.daysSinceLastOrder) {
          if (analytics.daysSinceLastOrder > 180) riskScore += 40;
          else if (analytics.daysSinceLastOrder > 90) riskScore += 25;
          else if (analytics.daysSinceLastOrder > 60) riskScore += 15;
        }
        
        // Low order frequency increases risk
        if (analytics.orderCount < 2) riskScore += 20;
        
        // Declining spending increases risk
        if (analytics.monthlySpending < analytics.avgOrderValue * 0.5) riskScore += 20;
        
        // No tier progression increases risk
        if (analytics.tierUpgradeCount === 0 && analytics.currentTierDays > 180) riskScore += 20;
      }

      return {
        id: customer.id,
        email: customer.email,
        totalSpending: analytics?.lifetimeSpending || 0,
        totalEarned: customer.totalEarned,
        storeCredit: customer.storeCredit,
        currentTier: currentTier ? this.formatTierName(currentTier.name) : 'None',
        daysSinceLastOrder: analytics?.daysSinceLastOrder || null,
        orderCount: analytics?.orderCount || 0,
        nextTierProgress: analytics?.nextTierProgress || 0,
        riskScore: Math.min(100, riskScore)
      };
    });
  }

  // Get customers close to tier upgrades
  async getUpgradeOpportunities(): Promise<UpgradeOpportunity[]> {
    const tiers = await prisma.tier.findMany({
      where: { 
        shopDomain: this.shopDomain,
        isActive: true,
        minSpend: { not: null }
      },
      orderBy: [
        { minSpend: { sort: 'asc', nulls: 'last' } },
        { cashbackPercent: 'asc' }
      ]
    });

    const opportunities: UpgradeOpportunity[] = [];

    for (let i = 0; i < tiers.length - 1; i++) {
      const currentTier = tiers[i];
      const nextTier = tiers[i + 1];
      
      if (!nextTier.minSpend) continue;

      // Get customers in current tier with analytics
      const memberships = await prisma.customerMembership.findMany({
        where: {
          tierId: currentTier.id,
          isActive: true,
          assignmentType: { not: AssignmentType.MANUAL } // Exclude manually assigned
        },
        include: {
          customer: {
            include: {
              analytics: true,
              transactions: {
                where: {
                  createdAt: { gte: subDays(new Date(), 365) },
                  status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
                },
                orderBy: { createdAt: 'desc' },
                take: 10
              }
            }
          }
        }
      });

      for (const membership of memberships) {
        const analytics = membership.customer.analytics;
        if (!analytics) continue;

        const currentSpending = currentTier.evaluationPeriod === EvaluationPeriod.LIFETIME 
          ? analytics.lifetimeSpending 
          : analytics.yearlySpending;
        
        const remaining = nextTier.minSpend - currentSpending;
        const percentageToNext = (currentSpending / nextTier.minSpend) * 100;
        
        // Only include if within 30% of next tier
        if (percentageToNext >= 70) {
          // Estimate days to upgrade based on recent spending velocity
          let estimatedDays: number | null = null;
          if (membership.customer.transactions.length >= 2) {
            const recentTransactions = membership.customer.transactions;
            const totalRecentSpending = recentTransactions.reduce((sum, t) => sum + t.orderAmount, 0);
            const daysPeriod = Math.max(1, 
              Math.floor(
                (new Date().getTime() - recentTransactions[recentTransactions.length - 1].createdAt.getTime()) 
                / (1000 * 60 * 60 * 24)
              )
            );
            const dailySpendingRate = totalRecentSpending / daysPeriod;
            
            if (dailySpendingRate > 0) {
              estimatedDays = Math.ceil(remaining / dailySpendingRate);
            }
          }

          opportunities.push({
            customerId: membership.customer.id,
            customerEmail: membership.customer.email,
            currentTier: this.formatTierName(currentTier.name),
            nextTier: this.formatTierName(nextTier.name),
            currentSpending,
            requiredSpending: nextTier.minSpend,
            remainingAmount: remaining,
            percentageToNext: Math.round(percentageToNext * 10) / 10,
            estimatedDaysToUpgrade: estimatedDays
          });
        }
      }
    }

    // Sort by percentage to next tier (closest first)
    return opportunities.sort((a, b) => b.percentageToNext - a.percentageToNext);
  }

  // Get engagement metrics for charts
  async getEngagementMetrics(): Promise<EngagementMetrics> {
    const now = new Date();
    
    // Daily metrics for last 7 days
    const dailyMetrics = await Promise.all(
      Array.from({ length: 7 }, async (_, i) => {
        const date = subDays(now, 6 - i);
        const nextDate = i === 6 ? endOfDay(now) : subDays(now, 5 - i);
        
        const [orderCount, revenue] = await Promise.all([
          prisma.cashbackTransaction.count({
            where: {
              shopDomain: this.shopDomain,
              createdAt: { gte: date, lt: nextDate },
              status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
            }
          }),
          prisma.cashbackTransaction.aggregate({
            where: {
              shopDomain: this.shopDomain,
              createdAt: { gte: date, lt: nextDate },
              status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
            },
            _sum: { orderAmount: true }
          })
        ]);

        return {
          date: format(date, 'MMM d'),
          orders: orderCount,
          revenue: revenue._sum.orderAmount || 0
        };
      })
    );

    // Weekly metrics for last 4 weeks
    const weeklyMetrics = await Promise.all(
      Array.from({ length: 4 }, async (_, i) => {
        const weekStart = startOfWeek(subDays(now, (3 - i) * 7));
        const weekEnd = i === 3 ? now : startOfWeek(subDays(now, (2 - i) * 7));
        
        const [orderCount, revenue] = await Promise.all([
          prisma.cashbackTransaction.count({
            where: {
              shopDomain: this.shopDomain,
              createdAt: { gte: weekStart, lt: weekEnd },
              status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
            }
          }),
          prisma.cashbackTransaction.aggregate({
            where: {
              shopDomain: this.shopDomain,
              createdAt: { gte: weekStart, lt: weekEnd },
              status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
            },
            _sum: { orderAmount: true }
          })
        ]);

        return {
          week: format(weekStart, 'MMM d'),
          orders: orderCount,
          revenue: revenue._sum.orderAmount || 0
        };
      })
    );

    return {
      daily: dailyMetrics,
      weekly: weeklyMetrics
    };
  }

  // Get credit reconciliation status
  async getCreditReconciliation(): Promise<CreditReconciliation> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = subDays(today, 7);

    const [
      totalCustomers,
      syncedToday,
      syncedThisWeek,
      neverSynced,
      unreconciledAmount
    ] = await Promise.all([
      prisma.customer.count({
        where: { shopDomain: this.shopDomain }
      }),
      
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          lastSyncedAt: { gte: today }
        }
      }),
      
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          lastSyncedAt: { gte: weekAgo }
        }
      }),
      
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          lastSyncedAt: null
        }
      }),
      
      prisma.storeCreditLedger.aggregate({
        where: {
          shopDomain: this.shopDomain,
          reconciledAt: null,
          source: { in: [LedgerSource.APP_CASHBACK, LedgerSource.APP_MANUAL] }
        },
        _sum: { amount: true }
      })
    ]);

    const outOfSync = await prisma.customer.count({
      where: {
        shopDomain: this.shopDomain,
        OR: [
          { lastSyncedAt: null },
          { lastSyncedAt: { lt: weekAgo } }
        ]
      }
    });

    return {
      totalCustomers,
      syncedToday,
      syncedThisWeek,
      neverSynced,
      outOfSync,
      totalUnreconciledAmount: Math.abs(unreconciledAmount._sum.amount || 0)
    };
  }

  // Get tier-specific detailed analytics
  async getTierDetails(tierId: string) {
    const tier = await prisma.tier.findUnique({
      where: { id: tierId }
    });

    if (!tier) return null;

    // Get all members with full analytics
    const members = await prisma.customerMembership.findMany({
      where: {
        tierId,
        isActive: true
      },
      include: {
        customer: {
          include: {
            analytics: true,
            transactions: {
              where: {
                createdAt: { gte: subDays(new Date(), 365) },
                status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate comprehensive tier statistics
    const stats = members.reduce(
      (acc, membership) => {
        const analytics = membership.customer.analytics;
        if (analytics) {
          acc.totalSpending += analytics.yearlySpending;
          acc.totalLifetimeSpending += analytics.lifetimeSpending;
          acc.totalOrders += analytics.orderCount;
          if (analytics.daysSinceLastOrder && analytics.daysSinceLastOrder <= 30) {
            acc.activeMembers++;
          }
          if (membership.assignmentType === AssignmentType.MANUAL) {
            acc.manualAssignments++;
          }
        }
        return acc;
      },
      {
        totalSpending: 0,
        totalLifetimeSpending: 0,
        totalOrders: 0,
        activeMembers: 0,
        manualAssignments: 0
      }
    );

    const memberCount = members.length;
    const avgSpending = memberCount > 0 ? stats.totalSpending / memberCount : 0;
    const avgLifetimeValue = memberCount > 0 ? stats.totalLifetimeSpending / memberCount : 0;
    const avgOrdersPerMember = memberCount > 0 ? stats.totalOrders / memberCount : 0;
    const retentionRate = memberCount > 0 ? (stats.activeMembers / memberCount) * 100 : 0;

    // Get tier movement data
    const [upgradesFrom, downgradesFrom] = await Promise.all([
      prisma.tierChangeLog.count({
        where: {
          fromTierId: tierId,
          changeType: TierChangeType.AUTOMATIC_UPGRADE,
          createdAt: { gte: subDays(new Date(), 90) }
        }
      }),
      
      prisma.tierChangeLog.count({
        where: {
          toTierId: tierId,
          changeType: TierChangeType.AUTOMATIC_DOWNGRADE,
          createdAt: { gte: subDays(new Date(), 90) }
        }
      })
    ]);

    // Calculate churn rate
    const churnRate = memberCount > 0 
      ? ((upgradesFrom + downgradesFrom) / (memberCount + upgradesFrom)) * 100 
      : 0;

    return {
      tier,
      statistics: {
        memberCount,
        activeMembers: stats.activeMembers,
        manualAssignments: stats.manualAssignments,
        avgSpending,
        avgLifetimeValue,
        avgOrdersPerMember,
        retentionRate: Math.round(retentionRate * 10) / 10,
        churnRate: Math.round(churnRate * 10) / 10,
        totalCashbackIssued: stats.totalSpending * (tier.cashbackPercent / 100),
        upgradesInLast90Days: upgradesFrom,
        downgradesInLast90Days: downgradesFrom
      },
      members: members.map(m => ({
        id: m.customer.id,
        email: m.customer.email,
        joinedTier: m.createdAt,
        assignmentType: m.assignmentType,
        yearlySpending: m.customer.analytics?.yearlySpending || 0,
        lifetimeSpending: m.customer.analytics?.lifetimeSpending || 0,
        storeCredit: m.customer.storeCredit,
        totalEarned: m.customer.totalEarned,
        daysSinceLastOrder: m.customer.analytics?.daysSinceLastOrder || null,
        orderCount: m.customer.analytics?.orderCount || 0
      }))
    };
  }

  // Helper method to get default tier colors
  private getDefaultTierColor(index: number): string {
    const colors = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444'];
    return colors[index % colors.length];
  }

  // Helper method to format tier names for display
  private formatTierName(name: string): string {
    // Convert underscore/hyphen separated names to Title Case
    return name
      .split(/[_-]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
}

// Export functions for backward compatibility
export async function getDashboardMetrics(shopDomain: string): Promise<DashboardMetrics> {
  const service = new DashboardService(shopDomain);
  return service.getDashboardMetrics();
}

export async function getTierDistribution(shopDomain: string): Promise<TierDistribution[]> {
  const service = new DashboardService(shopDomain);
  return service.getTierDistribution();
}

export async function getRecentActivity(shopDomain: string, limit: number = 10): Promise<RecentActivity[]> {
  const service = new DashboardService(shopDomain);
  return service.getRecentActivity(limit);
}

export async function getTierDetails(shopDomain: string, tierId: string) {
  const service = new DashboardService(shopDomain);
  return service.getTierDetails(tierId);
}

export async function getUpgradeOpportunities(shopDomain: string): Promise<UpgradeOpportunity[]> {
  const service = new DashboardService(shopDomain);
  return service.getUpgradeOpportunities();
}