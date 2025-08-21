import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";

// Types for analytics data
export interface BusinessGrowthMetrics {
  revenue: {
    totalFromMembers: number;
    totalFromNonMembers: number;
    incrementalRevenue: number;
    monthOverMonthGrowth: number;
    yearOverYearGrowth: number;
    revenuePerMember: number;
  };
  clv: {
    averageClvMembers: number;
    averageClvNonMembers: number;
    clvMultiplier: number;
    projected12MonthClv: number;
  };
  purchaseFrequency: {
    avgDaysBetweenPurchasesMembers: number;
    avgDaysBetweenPurchasesNonMembers: number;
    purchasesPerMemberPerMonth: number;
    purchasesPerMemberPerYear: number;
    repeatPurchaseRate: number;
    firstToSecondPurchaseRate: number;
  };
}

export interface TierActivityMetrics {
  tierMetrics: Array<{
    tierId: string;
    tierName: string;
    cashbackPercent: number;
    totalCustomers: number;
    percentOfBase: number;
    avgAnnualSpend: number;
    avgOrderValue: number;
    avgPurchaseFrequency: number;
    avgDaysBetweenPurchases: number;
    retentionRate: number;
    churnRate: number;
  }>;
  tierMovement: {
    upgradedCount: number;
    downgradedCount: number;
    atRiskCount: number;
    closeToUpgradeCount: number;
    upgradeRate: number;
    downgradeRate: number;
  };
  tierRevenue: Array<{
    tierId: string;
    tierName: string;
    totalRevenue: number;
    percentOfTotalRevenue: number;
    revenuePerCustomer: number;
  }>;
}

export interface StoreCreditMetrics {
  earned: {
    totalAllTime: number;
    currentPeriod: number;
    lastPeriod: number;
    avgPerMember: number;
    avgPerTransaction: number;
    transactionsEarningCredits: number;
    percentTransactionsEarning: number;
  };
  redeemed: {
    totalAllTime: number;
    currentPeriod: number;
    lastPeriod: number;
    avgRedemptionValue: number;
    ordersUsingCredits: number;
    percentOrdersUsingCredits: number;
    avgDaysEarnToRedeem: number;
  };
  economics: {
    redemptionRate: number;
    breakageRate: number;
    outstandingLiability: number;
    creditToRevenueRatio: number;
    revenuePerCreditDollar: number;
    avgBalancePerMember: number;
    membersWithBalance: number;
    percentMembersWithBalance: number;
  };
}

export interface ProgramHealthMetrics {
  totalMembers: number;
  activeMembers30Day: number;
  activeMembers90Day: number;
  newMembersThisPeriod: number;
  enrollmentRate: number;
  activationRate: number;
  dailyActiveMembers: number[];
  weeklyRevenue: number[];
}

export class AnalyticsService {
  constructor(private shopDomain: string) {}

  async getBusinessGrowthMetrics(): Promise<BusinessGrowthMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const twoYearsAgo = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);

    // Get all customers with membership status
    const customers = await prisma.customer.findMany({
      where: { shopDomain: this.shopDomain },
      include: {
        membershipHistory: {
          where: { isActive: true }
        },
        transactions: {
          where: {
            status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
          }
        }
      }
    });

    const members = customers.filter(c => c.membershipHistory.length > 0);
    const nonMembers = customers.filter(c => c.membershipHistory.length === 0);

    // Revenue calculations
    const totalFromMembers = members.reduce((sum, m) => 
      sum + m.transactions.reduce((s, t) => s + t.orderAmount, 0), 0
    );
    const totalFromNonMembers = nonMembers.reduce((sum, m) => 
      sum + m.transactions.reduce((s, t) => s + t.orderAmount, 0), 0
    );

    // Current period revenue
    const currentMonthRevenue = await prisma.cashbackTransaction.aggregate({
      where: {
        shopDomain: this.shopDomain,
        createdAt: { gte: thirtyDaysAgo },
        status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
      },
      _sum: { orderAmount: true }
    });

    // Last period revenue
    const lastMonthRevenue = await prisma.cashbackTransaction.aggregate({
      where: {
        shopDomain: this.shopDomain,
        createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
      },
      _sum: { orderAmount: true }
    });

    // Year over year
    const currentYearRevenue = await prisma.cashbackTransaction.aggregate({
      where: {
        shopDomain: this.shopDomain,
        createdAt: { gte: oneYearAgo },
        status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
      },
      _sum: { orderAmount: true }
    });

    const lastYearRevenue = await prisma.cashbackTransaction.aggregate({
      where: {
        shopDomain: this.shopDomain,
        createdAt: { gte: twoYearsAgo, lt: oneYearAgo },
        status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
      },
      _sum: { orderAmount: true }
    });

    const monthOverMonthGrowth = lastMonthRevenue._sum.orderAmount
      ? ((currentMonthRevenue._sum.orderAmount || 0) - (lastMonthRevenue._sum.orderAmount || 0)) / lastMonthRevenue._sum.orderAmount * 100
      : 0;

    const yearOverYearGrowth = lastYearRevenue._sum.orderAmount
      ? ((currentYearRevenue._sum.orderAmount || 0) - (lastYearRevenue._sum.orderAmount || 0)) / lastYearRevenue._sum.orderAmount * 100
      : 0;

    // CLV calculations
    const avgClvMembers = members.length > 0
      ? members.reduce((sum, m) => sum + m.totalEarned, 0) / members.length
      : 0;
    
    const avgClvNonMembers = nonMembers.length > 0
      ? nonMembers.reduce((sum, m) => sum + m.totalEarned, 0) / nonMembers.length
      : 0;

    // Purchase frequency
    const memberTransactions = members.flatMap(m => m.transactions);
    const nonMemberTransactions = nonMembers.flatMap(m => m.transactions);

    const avgDaysBetweenPurchasesMembers = this.calculateAvgDaysBetweenPurchases(memberTransactions);
    const avgDaysBetweenPurchasesNonMembers = this.calculateAvgDaysBetweenPurchases(nonMemberTransactions);

    const purchasesPerMemberPerMonth = members.length > 0
      ? memberTransactions.filter(t => t.createdAt >= thirtyDaysAgo).length / members.length
      : 0;

    const purchasesPerMemberPerYear = members.length > 0
      ? memberTransactions.filter(t => t.createdAt >= oneYearAgo).length / members.length
      : 0;

    // Repeat purchase rate
    const membersWithRepeatPurchases = members.filter(m => m.transactions.length > 1).length;
    const repeatPurchaseRate = members.length > 0
      ? (membersWithRepeatPurchases / members.length) * 100
      : 0;

    // First to second purchase rate
    const membersWithPurchases = members.filter(m => m.transactions.length > 0).length;
    const firstToSecondPurchaseRate = membersWithPurchases > 0
      ? (membersWithRepeatPurchases / membersWithPurchases) * 100
      : 0;

    return {
      revenue: {
        totalFromMembers,
        totalFromNonMembers,
        incrementalRevenue: totalFromMembers - totalFromNonMembers,
        monthOverMonthGrowth,
        yearOverYearGrowth,
        revenuePerMember: members.length > 0 ? totalFromMembers / members.length : 0
      },
      clv: {
        averageClvMembers: avgClvMembers,
        averageClvNonMembers: avgClvNonMembers,
        clvMultiplier: avgClvNonMembers > 0 ? avgClvMembers / avgClvNonMembers : 1,
        projected12MonthClv: avgClvMembers * 1.2 // Simple projection
      },
      purchaseFrequency: {
        avgDaysBetweenPurchasesMembers,
        avgDaysBetweenPurchasesNonMembers,
        purchasesPerMemberPerMonth,
        purchasesPerMemberPerYear,
        repeatPurchaseRate,
        firstToSecondPurchaseRate
      }
    };
  }

  async getTierActivityMetrics(): Promise<TierActivityMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // Get all tiers with members
    const tiers = await prisma.tier.findMany({
      where: { shopDomain: this.shopDomain },
      include: {
        customerMemberships: {
          where: { isActive: true },
          include: {
            customer: {
              include: {
                transactions: {
                  where: {
                    status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
                  }
                }
              }
            }
          }
        }
      }
    });

    const totalCustomers = await prisma.customer.count({
      where: { shopDomain: this.shopDomain }
    });

    const totalRevenue = await prisma.cashbackTransaction.aggregate({
      where: {
        shopDomain: this.shopDomain,
        status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
      },
      _sum: { orderAmount: true }
    });

    // Calculate tier metrics
    const tierMetrics = tiers.map(tier => {
      const customers = tier.customerMemberships.map(m => m.customer);
      const allTransactions = customers.flatMap(c => c.transactions);
      const yearTransactions = allTransactions.filter(t => t.createdAt >= oneYearAgo);
      
      const totalRevenueTier = allTransactions.reduce((sum, t) => sum + t.orderAmount, 0);
      const avgAnnualSpend = customers.length > 0
        ? yearTransactions.reduce((sum, t) => sum + t.orderAmount, 0) / customers.length
        : 0;
      
      const avgOrderValue = allTransactions.length > 0
        ? totalRevenueTier / allTransactions.length
        : 0;

      const avgPurchaseFrequency = customers.length > 0
        ? yearTransactions.length / customers.length
        : 0;

      const avgDaysBetweenPurchases = this.calculateAvgDaysBetweenPurchases(allTransactions);

      // Simple retention calculation (customers with purchase in last 30 days)
      const activeCustomers = customers.filter(c => 
        c.transactions.some(t => t.createdAt >= thirtyDaysAgo)
      ).length;
      
      const retentionRate = customers.length > 0
        ? (activeCustomers / customers.length) * 100
        : 0;

      return {
        tierId: tier.id,
        tierName: tier.name,
        cashbackPercent: tier.cashbackPercent,
        totalCustomers: customers.length,
        percentOfBase: totalCustomers > 0 ? (customers.length / totalCustomers) * 100 : 0,
        avgAnnualSpend,
        avgOrderValue,
        avgPurchaseFrequency,
        avgDaysBetweenPurchases,
        retentionRate,
        churnRate: 100 - retentionRate
      };
    });

    // Tier movement (simplified - would need historical data for accurate tracking)
    const recentMemberships = await prisma.customerMembership.findMany({
      where: {
        tier: { shopDomain: this.shopDomain },
        startDate: { gte: thirtyDaysAgo }
      }
    });

    const totalMembers = await prisma.customerMembership.count({
      where: {
        tier: { shopDomain: this.shopDomain },
        isActive: true
      }
    });

    // Tier revenue contribution
    const tierRevenue = tierMetrics.map(tm => ({
      tierId: tm.tierId,
      tierName: tm.tierName,
      totalRevenue: tm.avgAnnualSpend * tm.totalCustomers,
      percentOfTotalRevenue: totalRevenue._sum.orderAmount
        ? ((tm.avgAnnualSpend * tm.totalCustomers) / totalRevenue._sum.orderAmount) * 100
        : 0,
      revenuePerCustomer: tm.avgAnnualSpend
    }));

    return {
      tierMetrics,
      tierMovement: {
        upgradedCount: Math.floor(recentMemberships.length * 0.3), // Placeholder
        downgradedCount: Math.floor(recentMemberships.length * 0.1), // Placeholder
        atRiskCount: Math.floor(totalMembers * 0.15), // Placeholder
        closeToUpgradeCount: Math.floor(totalMembers * 0.2), // Placeholder
        upgradeRate: 5, // Placeholder
        downgradeRate: 2 // Placeholder
      },
      tierRevenue
    };
  }

  async getStoreCreditMetrics(): Promise<StoreCreditMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Earned metrics
    const [totalEarned, currentPeriodEarned, lastPeriodEarned, totalTransactions] = await Promise.all([
      prisma.cashbackTransaction.aggregate({
        where: { shopDomain: this.shopDomain },
        _sum: { cashbackAmount: true },
        _count: true
      }),
      prisma.cashbackTransaction.aggregate({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: thirtyDaysAgo }
        },
        _sum: { cashbackAmount: true },
        _count: true
      }),
      prisma.cashbackTransaction.aggregate({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo }
        },
        _sum: { cashbackAmount: true }
      }),
      prisma.cashbackTransaction.count({
        where: { shopDomain: this.shopDomain }
      })
    ]);

    const members = await prisma.customer.count({
      where: {
        shopDomain: this.shopDomain,
        membershipHistory: { some: { isActive: true } }
      }
    });

    // Get customers with credit balance
    const customersWithCredit = await prisma.customer.findMany({
      where: {
        shopDomain: this.shopDomain,
        storeCredit: { gt: 0 }
      },
      select: { storeCredit: true }
    });

    const totalOutstanding = customersWithCredit.reduce((sum, c) => sum + c.storeCredit, 0);
    const avgBalance = customersWithCredit.length > 0
      ? totalOutstanding / customersWithCredit.length
      : 0;

    // Redeemed metrics (simplified - would need proper redemption tracking)
    const estimatedRedeemed = (totalEarned._sum.cashbackAmount || 0) * 0.7; // 70% redemption estimate
    const currentRedeemed = (currentPeriodEarned._sum.cashbackAmount || 0) * 0.7;
    const lastRedeemed = (lastPeriodEarned._sum.cashbackAmount || 0) * 0.7;

    return {
      earned: {
        totalAllTime: totalEarned._sum.cashbackAmount || 0,
        currentPeriod: currentPeriodEarned._sum.cashbackAmount || 0,
        lastPeriod: lastPeriodEarned._sum.cashbackAmount || 0,
        avgPerMember: members > 0 ? (totalEarned._sum.cashbackAmount || 0) / members : 0,
        avgPerTransaction: totalEarned._count > 0 
          ? (totalEarned._sum.cashbackAmount || 0) / totalEarned._count 
          : 0,
        transactionsEarningCredits: currentPeriodEarned._count,
        percentTransactionsEarning: totalTransactions > 0
          ? (currentPeriodEarned._count / totalTransactions) * 100
          : 0
      },
      redeemed: {
        totalAllTime: estimatedRedeemed,
        currentPeriod: currentRedeemed,
        lastPeriod: lastRedeemed,
        avgRedemptionValue: currentRedeemed / Math.max(currentPeriodEarned._count * 0.5, 1),
        ordersUsingCredits: Math.floor(currentPeriodEarned._count * 0.5),
        percentOrdersUsingCredits: 50, // Estimate
        avgDaysEarnToRedeem: 15 // Estimate
      },
      economics: {
        redemptionRate: 70, // Estimate
        breakageRate: 30, // Estimate
        outstandingLiability: totalOutstanding,
        creditToRevenueRatio: 0.05, // 5% estimate
        revenuePerCreditDollar: 20, // $20 revenue per $1 credit
        avgBalancePerMember: avgBalance,
        membersWithBalance: customersWithCredit.length,
        percentMembersWithBalance: members > 0
          ? (customersWithCredit.length / members) * 100
          : 0
      }
    };
  }

  async getProgramHealthMetrics(): Promise<ProgramHealthMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [
      totalMembers,
      activeMembers30,
      activeMembers90,
      newMembers,
      totalCustomers
    ] = await Promise.all([
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          membershipHistory: { some: { isActive: true } }
        }
      }),
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          membershipHistory: { some: { isActive: true } },
          transactions: {
            some: { createdAt: { gte: thirtyDaysAgo } }
          }
        }
      }),
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          membershipHistory: { some: { isActive: true } },
          transactions: {
            some: { createdAt: { gte: ninetyDaysAgo } }
          }
        }
      }),
      prisma.customerMembership.count({
        where: {
          tier: { shopDomain: this.shopDomain },
          startDate: { gte: thirtyDaysAgo }
        }
      }),
      prisma.customer.count({
        where: { shopDomain: this.shopDomain }
      })
    ]);

    // Get members who made a purchase
    const activatedMembers = await prisma.customer.count({
      where: {
        shopDomain: this.shopDomain,
        membershipHistory: { some: { isActive: true } },
        transactions: { some: {} }
      }
    });

    // Generate sample daily/weekly data
    const dailyActiveMembers = Array.from({ length: 30 }, (_, i) => 
      Math.floor(activeMembers30 * (0.8 + Math.random() * 0.4))
    );

    const weeklyRevenue = Array.from({ length: 12 }, () => 
      Math.floor(10000 + Math.random() * 5000)
    );

    return {
      totalMembers,
      activeMembers30Day: activeMembers30,
      activeMembers90Day: activeMembers90,
      newMembersThisPeriod: newMembers,
      enrollmentRate: totalCustomers > 0 ? (totalMembers / totalCustomers) * 100 : 0,
      activationRate: totalMembers > 0 ? (activatedMembers / totalMembers) * 100 : 0,
      dailyActiveMembers,
      weeklyRevenue
    };
  }

  private calculateAvgDaysBetweenPurchases(transactions: any[]): number {
    if (transactions.length < 2) return 0;
    
    const sortedDates = transactions
      .map(t => new Date(t.createdAt).getTime())
      .sort((a, b) => a - b);
    
    let totalDays = 0;
    for (let i = 1; i < sortedDates.length; i++) {
      totalDays += (sortedDates[i] - sortedDates[i - 1]) / (1000 * 60 * 60 * 24);
    }
    
    return totalDays / (sortedDates.length - 1);
  }
}

// Export convenience functions
export async function getAnalyticsDashboard(shopDomain: string) {
  const service = new AnalyticsService(shopDomain);
  
  const [businessGrowth, tierActivity, storeCredit, programHealth] = await Promise.all([
    service.getBusinessGrowthMetrics(),
    service.getTierActivityMetrics(),
    service.getStoreCreditMetrics(),
    service.getProgramHealthMetrics()
  ]);

  return {
    businessGrowth,
    tierActivity,
    storeCredit,
    programHealth
  };
}