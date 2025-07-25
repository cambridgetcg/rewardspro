// app/routes/app.dashboard.tsx
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TransactionStatus, TierChangeType, LedgerEntryType, AssignmentType } from "@prisma/client";
import { subDays, startOfMonth, startOfWeek, format, differenceInDays } from "date-fns";

interface DashboardMetrics {
  // Customer Metrics
  totalCustomers: number;
  activeCustomers: number;
  customerGrowth: number;
  avgDaysSinceLastOrder: number;
  customersAtRisk: number;
  
  // Financial Metrics
  totalRevenue30Days: number;
  totalCashbackThisMonth: number;
  totalCashbackAllTime: number;
  activeStoreCredit: number;
  storeCreditUtilization: number;
  unreconciledCredit: number;
  
  // Order Metrics
  averageOrderValue: number;
  aovChange: number;
  totalTransactions: number;
  transactionGrowth: number;
  conversionRate: number;
  repeatPurchaseRate: number;
  
  // Tier Metrics
  tierUpgradesThisMonth: number;
  tierDowngradesThisMonth: number;
  manualTierAssignments: number;
  avgCustomerLifetimeValue: number;
}

interface TierAnalytics {
  tierId: string;
  tierName: string;
  cashbackPercent: number;
  memberCount: number;
  percentage: number;
  avgSpending: number;
  avgOrderValue: number;
  retentionRate: number;
  manualAssignments: number;
}

interface RecentActivity {
  id: string;
  type: 'new_customer' | 'cashback_earned' | 'tier_change' | 'manual_adjustment' | 'credit_sync';
  message: string;
  timestamp: Date;
  metadata?: any;
}

interface EngagementMetrics {
  daily: number[];
  weekly: number[];
  labels: string[];
}

interface CreditReconciliation {
  totalCustomers: number;
  syncedToday: number;
  syncedThisWeek: number;
  neverSynced: number;
  outOfSync: number;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  const [
    metrics,
    tierAnalytics,
    recentActivity,
    topCustomers,
    engagementMetrics,
    creditReconciliation,
    tierChangesSummary
  ] = await Promise.all([
    getDashboardMetrics(shopDomain),
    getTierAnalytics(shopDomain),
    getRecentActivity(shopDomain),
    getTopCustomers(shopDomain),
    getEngagementMetrics(shopDomain),
    getCreditReconciliation(shopDomain),
    getTierChangesSummary(shopDomain)
  ]);

  return json({ 
    metrics,
    tierAnalytics,
    recentActivity,
    topCustomers,
    engagementMetrics,
    creditReconciliation,
    tierChangesSummary
  });
}

async function getDashboardMetrics(shopDomain: string): Promise<DashboardMetrics> {
  const now = new Date();
  const startOfThisMonth = startOfMonth(now);
  const thirtyDaysAgo = subDays(now, 30);
  const sixtyDaysAgo = subDays(now, 60);

  // Customer metrics
  const totalCustomers = await prisma.customer.count({
    where: { shopDomain }
  });
  
  const customersLast30Days = await prisma.customer.count({
    where: { 
      shopDomain,
      createdAt: { gte: thirtyDaysAgo } 
    }
  });
  
  const customersPrevious30Days = await prisma.customer.count({
    where: {
      shopDomain,
      createdAt: {
        gte: sixtyDaysAgo,
        lt: thirtyDaysAgo
      }
    }
  });
  
  const customerGrowth = customersPrevious30Days > 0 
    ? ((customersLast30Days - customersPrevious30Days) / customersPrevious30Days) * 100 
    : 100;

  // Active customers (ordered in last 30 days)
  const activeCustomers = await prisma.customer.count({
    where: {
      shopDomain,
      analytics: {
        lastOrderDate: { gte: thirtyDaysAgo }
      }
    }
  });

  // Average days since last order and customers at risk
  const customerAnalytics = await prisma.customerAnalytics.findMany({
    where: { shopDomain },
    select: { daysSinceLastOrder: true }
  });

  const avgDaysSinceLastOrder = customerAnalytics.length > 0
    ? customerAnalytics.reduce((sum, c) => sum + (c.daysSinceLastOrder || 0), 0) / customerAnalytics.length
    : 0;

  const customersAtRisk = customerAnalytics.filter(
    c => c.daysSinceLastOrder && c.daysSinceLastOrder > 90
  ).length;

  // Financial metrics
  const revenue30Days = await prisma.cashbackTransaction.aggregate({
    where: {
      shopDomain,
      createdAt: { gte: thirtyDaysAgo },
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    },
    _sum: { orderAmount: true }
  });

  const cashbackThisMonth = await prisma.cashbackTransaction.aggregate({
    where: {
      shopDomain,
      createdAt: { gte: startOfThisMonth },
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    },
    _sum: { cashbackAmount: true }
  });

  const cashbackAllTime = await prisma.cashbackTransaction.aggregate({
    where: {
      shopDomain,
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    },
    _sum: { cashbackAmount: true }
  });

  const activeCredit = await prisma.customer.aggregate({
    where: { shopDomain },
    _sum: { storeCredit: true }
  });

  // Store credit utilization (credits used vs earned)
  const creditsUsed = await prisma.storeCreditLedger.aggregate({
    where: {
      shopDomain,
      type: LedgerEntryType.ORDER_PAYMENT,
      createdAt: { gte: thirtyDaysAgo }
    },
    _sum: { amount: true }
  });

  const storeCreditUtilization = (cashbackAllTime._sum.cashbackAmount || 0) > 0
    ? (Math.abs(creditsUsed._sum.amount || 0) / (cashbackAllTime._sum.cashbackAmount || 1)) * 100
    : 0;

  // Unreconciled credit
  const unreconciledCredit = await prisma.storeCreditLedger.count({
    where: {
      shopDomain,
      reconciledAt: null,
      source: { in: ['APP_CASHBACK', 'APP_MANUAL'] }
    }
  });

  // Order metrics
  const ordersLast30Days = await prisma.cashbackTransaction.findMany({
    where: {
      shopDomain,
      createdAt: { gte: thirtyDaysAgo },
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    }
  });

  const ordersPrevious30Days = await prisma.cashbackTransaction.findMany({
    where: {
      shopDomain,
      createdAt: {
        gte: sixtyDaysAgo,
        lt: thirtyDaysAgo
      },
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    }
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

  const totalTransactions = ordersLast30Days.length;
  const transactionGrowth = ordersPrevious30Days.length > 0
    ? ((ordersLast30Days.length - ordersPrevious30Days.length) / ordersPrevious30Days.length) * 100
    : 100;

  // Conversion and repeat purchase rates
  const customersWithTransactions = await prisma.customer.count({
    where: {
      shopDomain,
      transactions: {
        some: {
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        }
      }
    }
  });

  const customersWithMultipleTransactions = await prisma.customer.count({
    where: {
      shopDomain,
      analytics: {
        orderCount: { gt: 1 }
      }
    }
  });

  const conversionRate = totalCustomers > 0 
    ? (customersWithTransactions / totalCustomers) * 100 
    : 0;

  const repeatPurchaseRate = customersWithTransactions > 0
    ? (customersWithMultipleTransactions / customersWithTransactions) * 100
    : 0;

  // Tier metrics
  const tierUpgrades = await prisma.tierChangeLog.count({
    where: {
      customer: { shopDomain },
      createdAt: { gte: startOfThisMonth },
      changeType: { in: [TierChangeType.AUTOMATIC_UPGRADE, TierChangeType.MANUAL_OVERRIDE] }
    }
  });

  const tierDowngrades = await prisma.tierChangeLog.count({
    where: {
      customer: { shopDomain },
      createdAt: { gte: startOfThisMonth },
      changeType: TierChangeType.AUTOMATIC_DOWNGRADE
    }
  });

  const manualAssignments = await prisma.customerMembership.count({
    where: {
      customer: { shopDomain },
      assignmentType: AssignmentType.MANUAL,
      isActive: true
    }
  });

  // Average customer lifetime value
  const avgLifetimeValue = await prisma.customerAnalytics.aggregate({
    where: { shopDomain },
    _avg: { lifetimeSpending: true }
  });

  return {
    totalCustomers,
    activeCustomers,
    customerGrowth: Math.round(customerGrowth * 10) / 10,
    avgDaysSinceLastOrder: Math.round(avgDaysSinceLastOrder),
    customersAtRisk,
    totalRevenue30Days: revenue30Days._sum.orderAmount || 0,
    totalCashbackThisMonth: cashbackThisMonth._sum.cashbackAmount || 0,
    totalCashbackAllTime: cashbackAllTime._sum.cashbackAmount || 0,
    activeStoreCredit: activeCredit._sum.storeCredit || 0,
    storeCreditUtilization: Math.round(storeCreditUtilization * 10) / 10,
    unreconciledCredit,
    averageOrderValue: currentAOV,
    aovChange: Math.round(aovChange * 10) / 10,
    totalTransactions,
    transactionGrowth: Math.round(transactionGrowth * 10) / 10,
    conversionRate: Math.round(conversionRate * 10) / 10,
    repeatPurchaseRate: Math.round(repeatPurchaseRate * 10) / 10,
    tierUpgradesThisMonth: tierUpgrades,
    tierDowngradesThisMonth: tierDowngrades,
    manualTierAssignments: manualAssignments,
    avgCustomerLifetimeValue: avgLifetimeValue._avg.lifetimeSpending || 0
  };
}

async function getTierAnalytics(shopDomain: string): Promise<TierAnalytics[]> {
  const tiers = await prisma.tier.findMany({
    where: { 
      shopDomain,
      isActive: true 
    },
    orderBy: { cashbackPercent: 'desc' }
  });

  const analytics = await Promise.all(
    tiers.map(async (tier) => {
      const memberships = await prisma.customerMembership.findMany({
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

      const memberCount = memberships.length;
      const manualAssignments = memberships.filter(
        m => m.assignmentType === AssignmentType.MANUAL
      ).length;

      // Calculate average spending and AOV
      const avgSpending = memberships.reduce(
        (sum, m) => sum + (m.customer.analytics?.yearlySpending || 0),
        0
      ) / (memberCount || 1);

      const avgOrderValue = memberships.reduce(
        (sum, m) => sum + (m.customer.analytics?.avgOrderValue || 0),
        0
      ) / (memberCount || 1);

      // Calculate retention rate (customers who ordered in last 30 days)
      const activeInTier = memberships.filter(
        m => m.customer.analytics?.daysSinceLastOrder && 
             m.customer.analytics.daysSinceLastOrder <= 30
      ).length;

      const retentionRate = memberCount > 0
        ? (activeInTier / memberCount) * 100
        : 0;

      return {
        tierId: tier.id,
        tierName: tier.name,
        cashbackPercent: tier.cashbackPercent,
        memberCount,
        percentage: 0, // Will calculate after
        avgSpending,
        avgOrderValue,
        retentionRate: Math.round(retentionRate * 10) / 10,
        manualAssignments
      };
    })
  );

  // Calculate percentages
  const totalMembers = analytics.reduce((sum, tier) => sum + tier.memberCount, 0);
  return analytics.map(tier => ({
    ...tier,
    percentage: totalMembers > 0 
      ? Math.round((tier.memberCount / totalMembers) * 1000) / 10 
      : 0
  }));
}

async function getRecentActivity(shopDomain: string, limit: number = 10): Promise<RecentActivity[]> {
  const activities: RecentActivity[] = [];

  // Get various activity types
  const [
    recentCustomers,
    recentCashback,
    recentTierChanges,
    recentCreditAdjustments,
    recentSyncs
  ] = await Promise.all([
    // New customers
    prisma.customer.findMany({
      where: {
        shopDomain,
        createdAt: { gte: subDays(new Date(), 7) }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    }),
    
    // Cashback earned
    prisma.cashbackTransaction.findMany({
      where: {
        shopDomain,
        createdAt: { gte: subDays(new Date(), 7) },
        status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
      },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
      take: limit
    }),
    
    // Tier changes
    prisma.tierChangeLog.findMany({
      where: {
        customer: { shopDomain },
        createdAt: { gte: subDays(new Date(), 7) }
      },
      include: {
        customer: true,
        fromTier: true,
        toTier: true
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    }),
    
    // Manual credit adjustments
    prisma.storeCreditLedger.findMany({
      where: {
        shopDomain,
        type: LedgerEntryType.MANUAL_ADJUSTMENT,
        createdAt: { gte: subDays(new Date(), 7) }
      },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
      take: limit
    }),
    
    // Credit syncs
    prisma.customer.findMany({
      where: {
        shopDomain,
        lastSyncedAt: { gte: subDays(new Date(), 1) }
      },
      orderBy: { lastSyncedAt: 'desc' },
      take: limit
    })
  ]);

  // Process activities
  recentCustomers.forEach(customer => {
    activities.push({
      id: customer.id,
      type: 'new_customer',
      message: `New customer joined: ${customer.email}`,
      timestamp: customer.createdAt
    });
  });

  recentCashback.forEach(transaction => {
    activities.push({
      id: transaction.id,
      type: 'cashback_earned',
      message: `${transaction.customer.email} earned $${transaction.cashbackAmount.toFixed(2)} cashback`,
      timestamp: transaction.createdAt,
      metadata: { amount: transaction.cashbackAmount }
    });
  });

  recentTierChanges.forEach(change => {
    const changeTypeText = change.changeType === TierChangeType.AUTOMATIC_UPGRADE ? 'upgraded' :
                          change.changeType === TierChangeType.AUTOMATIC_DOWNGRADE ? 'downgraded' :
                          change.changeType === TierChangeType.MANUAL_OVERRIDE ? 'manually assigned' :
                          'moved';
    activities.push({
      id: change.id,
      type: 'tier_change',
      message: `${change.customer.email} ${changeTypeText} to ${change.toTier.name}`,
      timestamp: change.createdAt,
      metadata: { 
        fromTier: change.fromTier?.name, 
        toTier: change.toTier.name,
        changeType: change.changeType 
      }
    });
  });

  recentCreditAdjustments.forEach(adjustment => {
    activities.push({
      id: adjustment.id,
      type: 'manual_adjustment',
      message: `Credit ${adjustment.amount >= 0 ? 'added' : 'deducted'} $${Math.abs(adjustment.amount).toFixed(2)} for ${adjustment.customer.email}`,
      timestamp: adjustment.createdAt,
      metadata: { amount: adjustment.amount }
    });
  });

  recentSyncs.forEach(customer => {
    if (customer.lastSyncedAt) {
      activities.push({
        id: customer.id,
        type: 'credit_sync',
        message: `Store credit synced for ${customer.email}`,
        timestamp: customer.lastSyncedAt
      });
    }
  });

  // Sort and limit
  return activities
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);
}

async function getTopCustomers(shopDomain: string, limit: number = 5) {
  const customers = await prisma.customer.findMany({
    where: { shopDomain },
    include: {
      membershipHistory: {
        where: { isActive: true },
        include: { tier: true }
      },
      analytics: true
    },
    orderBy: {
      analytics: {
        lifetimeSpending: 'desc'
      }
    },
    take: limit
  });

  return customers.map(customer => ({
    id: customer.id,
    email: customer.email,
    totalSpending: customer.analytics?.lifetimeSpending || 0,
    totalEarned: customer.totalEarned,
    currentTier: customer.membershipHistory[0]?.tier,
    daysSinceLastOrder: customer.analytics?.daysSinceLastOrder || null,
    orderCount: customer.analytics?.orderCount || 0
  }));
}

async function getEngagementMetrics(shopDomain: string): Promise<EngagementMetrics> {
  const now = new Date();
  const sevenDaysAgo = subDays(now, 7);
  
  // Get daily order counts for last 7 days
  const dailyOrders = await Promise.all(
    Array.from({ length: 7 }, (_, i) => {
      const date = subDays(now, 6 - i);
      const nextDate = subDays(now, 5 - i);
      
      return prisma.cashbackTransaction.count({
        where: {
          shopDomain,
          createdAt: {
            gte: date,
            lt: i === 6 ? now : nextDate
          },
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        }
      });
    })
  );

  // Get weekly order counts for last 4 weeks
  const weeklyOrders = await Promise.all(
    Array.from({ length: 4 }, (_, i) => {
      const weekStart = startOfWeek(subDays(now, (3 - i) * 7));
      const weekEnd = startOfWeek(subDays(now, (2 - i) * 7));
      
      return prisma.cashbackTransaction.count({
        where: {
          shopDomain,
          createdAt: {
            gte: weekStart,
            lt: i === 3 ? now : weekEnd
          },
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        }
      });
    })
  );

  const dailyLabels = Array.from({ length: 7 }, (_, i) => 
    format(subDays(now, 6 - i), 'MMM d')
  );

  const weeklyLabels = Array.from({ length: 4 }, (_, i) => 
    `Week of ${format(startOfWeek(subDays(now, (3 - i) * 7)), 'MMM d')}`
  );

  return {
    daily: dailyOrders,
    weekly: weeklyOrders,
    labels: [...dailyLabels, ...weeklyLabels]
  };
}

async function getCreditReconciliation(shopDomain: string): Promise<CreditReconciliation> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = subDays(today, 7);

  const [
    totalCustomers,
    syncedToday,
    syncedThisWeek,
    neverSynced
  ] = await Promise.all([
    prisma.customer.count({
      where: { shopDomain }
    }),
    
    prisma.customer.count({
      where: {
        shopDomain,
        lastSyncedAt: { gte: today }
      }
    }),
    
    prisma.customer.count({
      where: {
        shopDomain,
        lastSyncedAt: { gte: weekAgo }
      }
    }),
    
    prisma.customer.count({
      where: {
        shopDomain,
        lastSyncedAt: null
      }
    })
  ]);

  const outOfSync = await prisma.customer.count({
    where: {
      shopDomain,
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
    outOfSync
  };
}

async function getTierChangesSummary(shopDomain: string) {
  const thirtyDaysAgo = subDays(new Date(), 30);
  
  const changes = await prisma.tierChangeLog.groupBy({
    by: ['changeType'],
    where: {
      customer: { shopDomain },
      createdAt: { gte: thirtyDaysAgo }
    },
    _count: true
  });

  return changes.reduce((acc, change) => {
    acc[change.changeType] = change._count;
    return acc;
  }, {} as Record<TierChangeType, number>);
}

export default function EnhancedDashboard() {
  const { 
    metrics, 
    tierAnalytics, 
    recentActivity, 
    topCustomers,
    engagementMetrics,
    creditReconciliation,
    tierChangesSummary
  } = useLoaderData<typeof loader>();

  const styles = {
    container: {
      maxWidth: "1600px",
      margin: "0 auto",
      padding: "32px 24px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: "#1a1a1a",
      backgroundColor: "#f5f5f5",
      minHeight: "100vh"
    },
    header: {
      marginBottom: "32px"
    },
    title: {
      fontSize: "32px",
      fontWeight: "600",
      margin: "0 0 8px 0",
      color: "#1a1a1a"
    },
    subtitle: {
      fontSize: "16px",
      color: "#666",
      margin: 0,
      fontWeight: "400"
    },
    metricsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      gap: "20px",
      marginBottom: "32px"
    },
    metricCard: {
      backgroundColor: "white",
      padding: "20px",
      borderRadius: "8px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
      position: "relative" as const,
      overflow: "hidden"
    },
    metricValue: {
      fontSize: "28px",
      fontWeight: "600",
      margin: "0 0 4px 0",
      color: "#1a1a1a"
    },
    metricTitle: {
      fontSize: "13px",
      color: "#666",
      margin: 0,
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px"
    },
    metricSubtext: {
      fontSize: "12px",
      color: "#999",
      margin: "4px 0 0 0"
    },
    metricChange: {
      position: "absolute" as const,
      top: "20px",
      right: "20px",
      fontSize: "13px",
      fontWeight: "500",
      display: "flex",
      alignItems: "center",
      gap: "4px"
    },
    positiveChange: {
      color: "#10B981"
    },
    negativeChange: {
      color: "#EF4444"
    },
    neutralChange: {
      color: "#6B7280"
    },
    sectionGrid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "24px",
      marginBottom: "24px"
    },
    fullWidthSection: {
      gridColumn: "1 / -1"
    },
    card: {
      backgroundColor: "white",
      padding: "24px",
      borderRadius: "8px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
    },
    cardHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "20px"
    },
    cardTitle: {
      fontSize: "18px",
      fontWeight: "600",
      margin: 0,
      color: "#1a1a1a"
    },
    viewAllLink: {
      color: "#3b82f6",
      textDecoration: "none",
      fontSize: "14px",
      fontWeight: "500",
      transition: "opacity 0.2s"
    },
    table: {
      width: "100%",
      borderCollapse: "collapse" as const
    },
    th: {
      textAlign: "left" as const,
      padding: "12px",
      fontSize: "12px",
      fontWeight: "600",
      color: "#666",
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px",
      borderBottom: "2px solid #f0f0f0"
    },
    td: {
      padding: "12px",
      fontSize: "14px",
      borderBottom: "1px solid #f5f5f5"
    },
    activityList: {
      display: "flex",
      flexDirection: "column" as const,
      gap: "8px"
    },
    activityItem: {
      padding: "12px",
      backgroundColor: "#f8f9fa",
      borderRadius: "6px",
      fontSize: "13px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    },
    activityTime: {
      fontSize: "12px",
      color: "#999"
    },
    tierBar: {
      display: "flex",
      height: "32px",
      borderRadius: "6px",
      overflow: "hidden",
      backgroundColor: "#f5f5f5",
      marginBottom: "16px"
    },
    tierSegment: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "white",
      fontSize: "12px",
      fontWeight: "500",
      transition: "all 0.2s",
      position: "relative" as const
    },
    badge: {
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: "12px",
      fontSize: "11px",
      fontWeight: "500"
    },
    warningBadge: {
      backgroundColor: "#FEF3C7",
      color: "#92400E"
    },
    successBadge: {
      backgroundColor: "#D1FAE5",
      color: "#065F46"
    },
    infoBadge: {
      backgroundColor: "#DBEAFE",
      color: "#1E40AF"
    },
    emptyState: {
      padding: "40px",
      textAlign: "center" as const,
      color: "#999"
    },
    chartContainer: {
      height: "200px",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      marginTop: "20px"
    },
    chartBar: {
      backgroundColor: "#3b82f6",
      borderRadius: "4px 4px 0 0",
      transition: "all 0.2s",
      flex: 1,
      marginRight: "8px",
      position: "relative" as const
    },
    chartLabel: {
      fontSize: "10px",
      color: "#666",
      textAlign: "center" as const,
      marginTop: "8px"
    },
    syncStatus: {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: "16px",
      marginTop: "16px"
    },
    syncCard: {
      textAlign: "center" as const,
      padding: "16px",
      backgroundColor: "#f8f9fa",
      borderRadius: "6px"
    },
    syncValue: {
      fontSize: "24px",
      fontWeight: "600",
      color: "#1a1a1a"
    },
    syncLabel: {
      fontSize: "12px",
      color: "#666",
      marginTop: "4px"
    }
  };

  // Helper function to format activity type
  const getActivityIcon = (type: string) => {
    const icons = {
      new_customer: "•",
      cashback_earned: "•",
      tier_change: "•",
      manual_adjustment: "•",
      credit_sync: "•"
    };
    return icons[type as keyof typeof icons] || "•";
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Analytics Dashboard</h1>
        <p style={styles.subtitle}>Comprehensive insights into your cashback rewards program</p>
      </div>

      {/* Key Metrics */}
      <div style={styles.metricsGrid}>
        <div style={styles.metricCard}>
          <h3 style={styles.metricValue}>{metrics.totalCustomers.toLocaleString()}</h3>
          <p style={styles.metricTitle}>Total Customers</p>
          <p style={styles.metricSubtext}>{metrics.activeCustomers} active</p>
          <div style={{
            ...styles.metricChange,
            ...(metrics.customerGrowth >= 0 ? styles.positiveChange : styles.negativeChange)
          }}>
            {metrics.customerGrowth >= 0 ? "↑" : "↓"} {Math.abs(metrics.customerGrowth)}%
          </div>
        </div>

        <div style={styles.metricCard}>
          <h3 style={styles.metricValue}>${metrics.totalRevenue30Days.toFixed(0)}</h3>
          <p style={styles.metricTitle}>Revenue (30d)</p>
          <p style={styles.metricSubtext}>{metrics.totalTransactions} orders</p>
          <div style={{
            ...styles.metricChange,
            ...(metrics.transactionGrowth >= 0 ? styles.positiveChange : styles.negativeChange)
          }}>
            {metrics.transactionGrowth >= 0 ? "↑" : "↓"} {Math.abs(metrics.transactionGrowth)}%
          </div>
        </div>

        <div style={styles.metricCard}>
          <h3 style={styles.metricValue}>${metrics.activeStoreCredit.toFixed(0)}</h3>
          <p style={styles.metricTitle}>Store Credit</p>
          <p style={styles.metricSubtext}>{metrics.storeCreditUtilization}% utilized</p>
          {metrics.unreconciledCredit > 0 && (
            <div style={{ ...styles.metricChange, ...styles.warningBadge }}>
              {metrics.unreconciledCredit} unsynced
            </div>
          )}
        </div>

        <div style={styles.metricCard}>
          <h3 style={styles.metricValue}>${metrics.averageOrderValue.toFixed(0)}</h3>
          <p style={styles.metricTitle}>Avg Order Value</p>
          <p style={styles.metricSubtext}>${metrics.avgCustomerLifetimeValue.toFixed(0)} CLV</p>
          <div style={{
            ...styles.metricChange,
            ...(metrics.aovChange >= 0 ? styles.positiveChange : styles.negativeChange)
          }}>
            {metrics.aovChange >= 0 ? "↑" : "↓"} {Math.abs(metrics.aovChange)}%
          </div>
        </div>

        <div style={styles.metricCard}>
          <h3 style={styles.metricValue}>{metrics.conversionRate}%</h3>
          <p style={styles.metricTitle}>Conversion Rate</p>
          <p style={styles.metricSubtext}>{metrics.repeatPurchaseRate}% repeat</p>
        </div>

        <div style={styles.metricCard}>
          <h3 style={styles.metricValue}>{metrics.avgDaysSinceLastOrder}</h3>
          <p style={styles.metricTitle}>Days Since Order</p>
          <p style={styles.metricSubtext}>{metrics.customersAtRisk} at risk</p>
          {metrics.customersAtRisk > 0 && (
            <div style={{ ...styles.metricChange, ...styles.warningBadge }}>
              &gt;90 days
            </div>
          )}
        </div>
      </div>

      {/* Main Content Grid */}
      <div style={styles.sectionGrid}>
        {/* Tier Analytics */}
        <div style={{ ...styles.card, ...styles.fullWidthSection }}>
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>Tier Performance</h2>
            <Link 
              to="/app/tiers" 
              style={styles.viewAllLink}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.7'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              Manage Tiers →
            </Link>
          </div>

          {tierAnalytics.length > 0 ? (
            <>
              <div style={styles.tierBar}>
                {tierAnalytics.map((tier, index) => (
                  <div
                    key={tier.tierId}
                    style={{
                      ...styles.tierSegment,
                      flex: `0 0 ${tier.percentage}%`,
                      backgroundColor: getDefaultColor(index),
                    }}
                    title={`${tier.tierName}: ${tier.memberCount} members`}
                  />
                ))}
              </div>

              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Tier</th>
                    <th style={{ ...styles.th, textAlign: "center" as const }}>Members</th>
                    <th style={{ ...styles.th, textAlign: "right" as const }}>Avg Yearly Spend</th>
                    <th style={{ ...styles.th, textAlign: "right" as const }}>Avg Order</th>
                    <th style={{ ...styles.th, textAlign: "center" as const }}>Retention</th>
                    <th style={{ ...styles.th, textAlign: "center" as const }}>Manual</th>
                  </tr>
                </thead>
                <tbody>
                  {tierAnalytics.map((tier, index) => (
                    <tr key={tier.tierId}>
                      <td style={styles.td}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{
                            width: "12px",
                            height: "12px",
                            borderRadius: "3px",
                            backgroundColor: getDefaultColor(index)
                          }} />
                          <strong>{tier.tierName}</strong>
                          <span style={{ color: "#666", fontSize: "12px" }}>
                            ({tier.cashbackPercent}%)
                          </span>
                        </div>
                      </td>
                      <td style={{ ...styles.td, textAlign: "center" as const }}>
                        {tier.memberCount} ({tier.percentage}%)
                      </td>
                      <td style={{ ...styles.td, textAlign: "right" as const }}>
                        ${tier.avgSpending.toFixed(0)}
                      </td>
                      <td style={{ ...styles.td, textAlign: "right" as const }}>
                        ${tier.avgOrderValue.toFixed(0)}
                      </td>
                      <td style={{ ...styles.td, textAlign: "center" as const }}>
                        <span style={{
                          ...styles.badge,
                          ...(tier.retentionRate > 70 ? styles.successBadge : 
                              tier.retentionRate > 40 ? styles.warningBadge : 
                              { backgroundColor: "#FEE2E2", color: "#991B1B" })
                        }}>
                          {tier.retentionRate}%
                        </span>
                      </td>
                      <td style={{ ...styles.td, textAlign: "center" as const }}>
                        {tier.manualAssignments > 0 && (
                          <span style={{ ...styles.badge, ...styles.infoBadge }}>
                            {tier.manualAssignments}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Tier Changes Summary */}
              <div style={{ marginTop: "20px", display: "flex", gap: "16px", flexWrap: "wrap" as const }}>
                <div>
                  <span style={{ fontSize: "13px", color: "#666" }}>This Month: </span>
                  <span style={{ ...styles.badge, ...styles.successBadge, marginRight: "8px" }}>
                    ↑ {metrics.tierUpgradesThisMonth} upgrades
                  </span>
                  <span style={{ ...styles.badge, ...styles.warningBadge }}>
                    ↓ {metrics.tierDowngradesThisMonth} downgrades
                  </span>
                </div>
                {metrics.manualTierAssignments > 0 && (
                  <div>
                    <span style={{ ...styles.badge, ...styles.infoBadge }}>
                      {metrics.manualTierAssignments} manual assignments active
                    </span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={styles.emptyState}>
              <p>No tier data available</p>
              <Link to="/app/tiers" style={{ color: "#3b82f6" }}>
                Configure Tiers →
              </Link>
            </div>
          )}
        </div>

        {/* Engagement Trends */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Order Trends (7 Days)</h2>
          <div style={styles.chartContainer}>
            {engagementMetrics.daily.map((value, index) => {
              const maxValue = Math.max(...engagementMetrics.daily, 1);
              const height = (value / maxValue) * 100;
              return (
                <div key={index} style={{ flex: 1, textAlign: "center" as const }}>
                  <div
                    style={{
                      ...styles.chartBar,
                      height: `${height}%`,
                      opacity: value === 0 ? 0.3 : 1
                    }}
                    title={`${value} orders`}
                  >
                    {value > 0 && (
                      <span style={{
                        position: "absolute",
                        top: "-20px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        fontSize: "12px",
                        fontWeight: "500",
                        color: "#666"
                      }}>
                        {value}
                      </span>
                    )}
                  </div>
                  <div style={styles.chartLabel}>
                    {engagementMetrics.labels[index]}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Credit Reconciliation */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>Credit Sync Status</h2>
            <Link 
              to="/app/customers/credit" 
              style={styles.viewAllLink}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.7'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              Manage Credits →
            </Link>
          </div>
          
          <div style={styles.syncStatus}>
            <div style={styles.syncCard}>
              <div style={styles.syncValue}>{creditReconciliation.syncedToday}</div>
              <div style={styles.syncLabel}>Synced Today</div>
            </div>
            <div style={styles.syncCard}>
              <div style={styles.syncValue}>{creditReconciliation.syncedThisWeek}</div>
              <div style={styles.syncLabel}>This Week</div>
            </div>
            <div style={{
              ...styles.syncCard,
              backgroundColor: creditReconciliation.neverSynced > 0 ? "#FEF3C7" : "#f8f9fa"
            }}>
              <div style={styles.syncValue}>{creditReconciliation.neverSynced}</div>
              <div style={styles.syncLabel}>Never Synced</div>
            </div>
            <div style={{
              ...styles.syncCard,
              backgroundColor: creditReconciliation.outOfSync > 10 ? "#FEE2E2" : "#f8f9fa"
            }}>
              <div style={styles.syncValue}>{creditReconciliation.outOfSync}</div>
              <div style={styles.syncLabel}>Out of Sync</div>
            </div>
          </div>
          
          {creditReconciliation.outOfSync > 0 && (
            <p style={{ fontSize: "13px", color: "#666", marginTop: "16px", textAlign: "center" as const }}>
              {Math.round((creditReconciliation.outOfSync / creditReconciliation.totalCustomers) * 100)}% 
              of customers need sync
            </p>
          )}
        </div>

        {/* Recent Activity */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>Recent Activity</h2>
          </div>
          
          {recentActivity.length > 0 ? (
            <div style={styles.activityList}>
              {recentActivity.slice(0, 8).map((activity) => (
                <div key={activity.id} style={styles.activityItem}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>{getActivityIcon(activity.type)}</span>
                    <span>{activity.message}</span>
                  </div>
                  <span style={styles.activityTime}>
                    {format(new Date(activity.timestamp), "h:mm a")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.emptyState}>
              <p>No recent activity</p>
            </div>
          )}
        </div>

        {/* Top Customers */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>Top Customers</h2>
            <Link 
              to="/app/customers" 
              style={styles.viewAllLink}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.7'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              View All →
            </Link>
          </div>
          
          {topCustomers.length > 0 ? (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Customer</th>
                  <th style={{ ...styles.th, textAlign: "right" as const }}>Lifetime</th>
                  <th style={{ ...styles.th, textAlign: "center" as const }}>Orders</th>
                  <th style={{ ...styles.th, textAlign: "center" as const }}>Last Order</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((customer) => (
                  <tr key={customer.id}>
                    <td style={styles.td}>
                      <div>
                        <div style={{ fontWeight: "500" }}>{customer.email}</div>
                        {customer.currentTier && (
                          <span style={{ fontSize: "12px", color: "#666" }}>
                            {customer.currentTier.name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" as const }}>
                      ${customer.totalSpending.toFixed(0)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "center" as const }}>
                      {customer.orderCount}
                    </td>
                    <td style={{ ...styles.td, textAlign: "center" as const }}>
                      {customer.daysSinceLastOrder !== null ? (
                        <span style={{
                          ...styles.badge,
                          ...(customer.daysSinceLastOrder < 30 ? styles.successBadge :
                              customer.daysSinceLastOrder < 90 ? styles.warningBadge :
                              { backgroundColor: "#FEE2E2", color: "#991B1B" })
                        }}>
                          {customer.daysSinceLastOrder}d ago
                        </span>
                      ) : (
                        <span style={{ color: "#999" }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={styles.emptyState}>
              <p>No customer data available</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Default colors for tiers
function getDefaultColor(index: number): string {
  const colors = ["#8B5CF6", "#3B82F6", "#10B981", "#F59E0B", "#EF4444"];
  return colors[index % colors.length];
}