import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";

// Types
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
  // TODO: Replace with real daily/weekly aggregation queries when volume justifies it
  dailyActiveMembers: number[];
  weeklyRevenue: number[];
}

const VALID_STATUSES = [
  TransactionStatus.COMPLETED,
  TransactionStatus.SYNCED_TO_SHOPIFY,
];

export class AnalyticsService {
  constructor(private shopDomain: string) {}

  async getBusinessGrowthMetrics(): Promise<BusinessGrowthMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const twoYearsAgo = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);

    // Count members/non-members without loading all customer rows
    const [memberCount, totalCustomerCount] = await Promise.all([
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          membershipHistory: { some: { isActive: true } },
        },
      }),
      prisma.customer.count({
        where: { shopDomain: this.shopDomain },
      }),
    ]);
    const nonMemberCount = totalCustomerCount - memberCount;

    // Revenue aggregates — use subqueries joining through membership to split member vs non-member
    // Member revenue: transactions where the customer has an active membership
    const [memberRevenue, totalRevenue] = await Promise.all([
      prisma.cashbackTransaction.aggregate({
        where: {
          shopDomain: this.shopDomain,
          status: { in: VALID_STATUSES },
          customer: { membershipHistory: { some: { isActive: true } } },
        },
        _sum: { orderAmount: true },
      }),
      prisma.cashbackTransaction.aggregate({
        where: {
          shopDomain: this.shopDomain,
          status: { in: VALID_STATUSES },
        },
        _sum: { orderAmount: true },
      }),
    ]);

    const totalFromMembers = memberRevenue._sum.orderAmount || 0;
    const totalFromNonMembers =
      (totalRevenue._sum.orderAmount || 0) - totalFromMembers;

    // Period revenue for MoM/YoY — all aggregate, no raw rows
    const [currentMonthRev, lastMonthRev, currentYearRev, lastYearRev] =
      await Promise.all([
        prisma.cashbackTransaction.aggregate({
          where: {
            shopDomain: this.shopDomain,
            createdAt: { gte: thirtyDaysAgo },
            status: { in: VALID_STATUSES },
          },
          _sum: { orderAmount: true },
        }),
        prisma.cashbackTransaction.aggregate({
          where: {
            shopDomain: this.shopDomain,
            createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
            status: { in: VALID_STATUSES },
          },
          _sum: { orderAmount: true },
        }),
        prisma.cashbackTransaction.aggregate({
          where: {
            shopDomain: this.shopDomain,
            createdAt: { gte: oneYearAgo },
            status: { in: VALID_STATUSES },
          },
          _sum: { orderAmount: true },
        }),
        prisma.cashbackTransaction.aggregate({
          where: {
            shopDomain: this.shopDomain,
            createdAt: { gte: twoYearsAgo, lt: oneYearAgo },
            status: { in: VALID_STATUSES },
          },
          _sum: { orderAmount: true },
        }),
      ]);

    const currentMonth = currentMonthRev._sum.orderAmount || 0;
    const lastMonth = lastMonthRev._sum.orderAmount || 0;
    const currentYear = currentYearRev._sum.orderAmount || 0;
    const lastYear = lastYearRev._sum.orderAmount || 0;

    const monthOverMonthGrowth =
      lastMonth > 0 ? ((currentMonth - lastMonth) / lastMonth) * 100 : 0;
    const yearOverYearGrowth =
      lastYear > 0 ? ((currentYear - lastYear) / lastYear) * 100 : 0;

    // CLV: average totalEarned per member vs non-member
    const [memberClv, nonMemberClv] = await Promise.all([
      prisma.customer.aggregate({
        where: {
          shopDomain: this.shopDomain,
          membershipHistory: { some: { isActive: true } },
        },
        _avg: { totalEarned: true },
      }),
      prisma.customer.aggregate({
        where: {
          shopDomain: this.shopDomain,
          membershipHistory: { none: { isActive: true } },
        },
        _avg: { totalEarned: true },
      }),
    ]);

    const avgClvMembers = memberClv._avg.totalEarned || 0;
    const avgClvNonMembers = nonMemberClv._avg.totalEarned || 0;

    // Purchase frequency — count-based aggregates
    const [memberTx30, memberTx365, membersWithMultiple, membersWithAny] =
      await Promise.all([
        prisma.cashbackTransaction.count({
          where: {
            shopDomain: this.shopDomain,
            createdAt: { gte: thirtyDaysAgo },
            status: { in: VALID_STATUSES },
            customer: { membershipHistory: { some: { isActive: true } } },
          },
        }),
        prisma.cashbackTransaction.count({
          where: {
            shopDomain: this.shopDomain,
            createdAt: { gte: oneYearAgo },
            status: { in: VALID_STATUSES },
            customer: { membershipHistory: { some: { isActive: true } } },
          },
        }),
        // Members with >1 transaction
        prisma.cashbackTransaction.groupBy({
          by: ["customerId"],
          where: {
            shopDomain: this.shopDomain,
            status: { in: VALID_STATUSES },
            customer: { membershipHistory: { some: { isActive: true } } },
          },
          having: { customerId: { _count: { gt: 1 } } },
        }),
        // Members with any transaction
        prisma.cashbackTransaction.groupBy({
          by: ["customerId"],
          where: {
            shopDomain: this.shopDomain,
            status: { in: VALID_STATUSES },
            customer: { membershipHistory: { some: { isActive: true } } },
          },
        }),
      ]);

    const purchasesPerMemberPerMonth =
      memberCount > 0 ? memberTx30 / memberCount : 0;
    const purchasesPerMemberPerYear =
      memberCount > 0 ? memberTx365 / memberCount : 0;
    const repeatPurchaseRate =
      memberCount > 0 ? (membersWithMultiple.length / memberCount) * 100 : 0;
    const firstToSecondPurchaseRate =
      membersWithAny.length > 0
        ? (membersWithMultiple.length / membersWithAny.length) * 100
        : 0;

    // Avg days between purchases — estimate from avg frequency
    const avgDaysMember =
      purchasesPerMemberPerYear > 1
        ? 365 / purchasesPerMemberPerYear
        : 0;
    const nonMemberTx365 = await prisma.cashbackTransaction.count({
      where: {
        shopDomain: this.shopDomain,
        createdAt: { gte: oneYearAgo },
        status: { in: VALID_STATUSES },
        customer: { membershipHistory: { none: { isActive: true } } },
      },
    });
    const nonMemberFreq =
      nonMemberCount > 0 ? nonMemberTx365 / nonMemberCount : 0;
    const avgDaysNonMember = nonMemberFreq > 1 ? 365 / nonMemberFreq : 0;

    return {
      revenue: {
        totalFromMembers,
        totalFromNonMembers,
        incrementalRevenue: totalFromMembers - totalFromNonMembers,
        monthOverMonthGrowth,
        yearOverYearGrowth,
        revenuePerMember:
          memberCount > 0 ? totalFromMembers / memberCount : 0,
      },
      clv: {
        averageClvMembers: avgClvMembers,
        averageClvNonMembers: avgClvNonMembers,
        clvMultiplier:
          avgClvNonMembers > 0 ? avgClvMembers / avgClvNonMembers : 1,
        projected12MonthClv: avgClvMembers * 1.2,
      },
      purchaseFrequency: {
        avgDaysBetweenPurchasesMembers: avgDaysMember,
        avgDaysBetweenPurchasesNonMembers: avgDaysNonMember,
        purchasesPerMemberPerMonth,
        purchasesPerMemberPerYear,
        repeatPurchaseRate,
        firstToSecondPurchaseRate,
      },
    };
  }

  async getTierActivityMetrics(): Promise<TierActivityMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const totalCustomers = await prisma.customer.count({
      where: { shopDomain: this.shopDomain },
    });

    // Get tiers with member counts in one query
    const tiers = await prisma.tier.findMany({
      where: { shopDomain: this.shopDomain },
      include: {
        _count: {
          select: {
            customerMemberships: { where: { isActive: true } },
          },
        },
      },
    });

    // Get per-tier revenue + order count aggregates in one groupBy
    const tierIds = tiers.map((t) => t.id);
    const tierRevenueAgg = await prisma.cashbackTransaction.groupBy({
      by: ["customerId"],
      where: {
        shopDomain: this.shopDomain,
        status: { in: VALID_STATUSES },
        customer: {
          membershipHistory: {
            some: { isActive: true, tierId: { in: tierIds } },
          },
        },
      },
      _sum: { orderAmount: true },
      _count: true,
    });

    // Map customer → tier for aggregation
    const membershipMap = await prisma.customerMembership.findMany({
      where: {
        isActive: true,
        tierId: { in: tierIds },
      },
      select: { customerId: true, tierId: true },
    });

    const customerToTier: Record<string, string> = {};
    for (const m of membershipMap) {
      customerToTier[m.customerId] = m.tierId;
    }

    // Aggregate per tier
    const tierAgg: Record<
      string,
      { revenue: number; orderCount: number; customers: Set<string> }
    > = {};
    for (const t of tiers) {
      tierAgg[t.id] = { revenue: 0, orderCount: 0, customers: new Set() };
    }
    for (const row of tierRevenueAgg) {
      const tierId = customerToTier[row.customerId];
      if (tierId && tierAgg[tierId]) {
        tierAgg[tierId].revenue += row._sum.orderAmount || 0;
        tierAgg[tierId].orderCount += row._count;
        tierAgg[tierId].customers.add(row.customerId);
      }
    }

    // Active customers in last 30d per tier
    const recentActive = await prisma.cashbackTransaction.groupBy({
      by: ["customerId"],
      where: {
        shopDomain: this.shopDomain,
        createdAt: { gte: thirtyDaysAgo },
        status: { in: VALID_STATUSES },
        customer: {
          membershipHistory: {
            some: { isActive: true, tierId: { in: tierIds } },
          },
        },
      },
    });
    const recentActiveByTier: Record<string, number> = {};
    for (const row of recentActive) {
      const tierId = customerToTier[row.customerId];
      if (tierId) {
        recentActiveByTier[tierId] = (recentActiveByTier[tierId] || 0) + 1;
      }
    }

    const totalRevenue = tiers.reduce(
      (sum, t) => sum + tierAgg[t.id].revenue,
      0,
    );

    const tierMetrics = tiers.map((tier) => {
      const agg = tierAgg[tier.id];
      const memberCt = tier._count.customerMemberships;
      const activeInTier = recentActiveByTier[tier.id] || 0;
      const retentionRate =
        memberCt > 0 ? (activeInTier / memberCt) * 100 : 0;

      return {
        tierId: tier.id,
        tierName: tier.name,
        cashbackPercent: tier.cashbackPercent,
        totalCustomers: memberCt,
        percentOfBase:
          totalCustomers > 0 ? (memberCt / totalCustomers) * 100 : 0,
        avgAnnualSpend: memberCt > 0 ? agg.revenue / memberCt : 0,
        avgOrderValue: agg.orderCount > 0 ? agg.revenue / agg.orderCount : 0,
        avgPurchaseFrequency: memberCt > 0 ? agg.orderCount / memberCt : 0,
        avgDaysBetweenPurchases:
          memberCt > 0 && agg.orderCount > memberCt
            ? 365 / (agg.orderCount / memberCt)
            : 0,
        retentionRate,
        churnRate: 100 - retentionRate,
      };
    });

    // Tier movement from change logs
    const [upgrades, downgrades] = await Promise.all([
      prisma.tierChangeLog.count({
        where: {
          createdAt: { gte: thirtyDaysAgo },
          changeType: "AUTOMATIC_UPGRADE",
          toTier: { shopDomain: this.shopDomain },
        },
      }),
      prisma.tierChangeLog.count({
        where: {
          createdAt: { gte: thirtyDaysAgo },
          changeType: "AUTOMATIC_DOWNGRADE",
          toTier: { shopDomain: this.shopDomain },
        },
      }),
    ]);

    const totalMembers = tiers.reduce(
      (sum, t) => sum + t._count.customerMemberships,
      0,
    );

    const tierRevenue = tierMetrics.map((tm) => ({
      tierId: tm.tierId,
      tierName: tm.tierName,
      totalRevenue: tm.avgAnnualSpend * tm.totalCustomers,
      percentOfTotalRevenue:
        totalRevenue > 0
          ? ((tm.avgAnnualSpend * tm.totalCustomers) / totalRevenue) * 100
          : 0,
      revenuePerCustomer: tm.avgAnnualSpend,
    }));

    return {
      tierMetrics,
      tierMovement: {
        upgradedCount: upgrades,
        downgradedCount: downgrades,
        atRiskCount: Math.floor(totalMembers * 0.15), // TODO: real at-risk query (members near min spend threshold)
        closeToUpgradeCount: Math.floor(totalMembers * 0.2), // TODO: real close-to-upgrade query
        upgradeRate:
          totalMembers > 0 ? (upgrades / totalMembers) * 100 : 0,
        downgradeRate:
          totalMembers > 0 ? (downgrades / totalMembers) * 100 : 0,
      },
      tierRevenue,
    };
  }

  async getStoreCreditMetrics(): Promise<StoreCreditMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // All aggregate — no findMany for raw rows
    const [totalEarned, currentPeriodEarned, lastPeriodEarned, totalTxCount] =
      await Promise.all([
        prisma.cashbackTransaction.aggregate({
          where: { shopDomain: this.shopDomain },
          _sum: { cashbackAmount: true },
          _count: true,
        }),
        prisma.cashbackTransaction.aggregate({
          where: {
            shopDomain: this.shopDomain,
            createdAt: { gte: thirtyDaysAgo },
          },
          _sum: { cashbackAmount: true },
          _count: true,
        }),
        prisma.cashbackTransaction.aggregate({
          where: {
            shopDomain: this.shopDomain,
            createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
          },
          _sum: { cashbackAmount: true },
        }),
        prisma.cashbackTransaction.count({
          where: { shopDomain: this.shopDomain },
        }),
      ]);

    const memberCount = await prisma.customer.count({
      where: {
        shopDomain: this.shopDomain,
        membershipHistory: { some: { isActive: true } },
      },
    });

    // Outstanding balances — aggregate, not findMany
    const balanceAgg = await prisma.customer.aggregate({
      where: { shopDomain: this.shopDomain, storeCredit: { gt: 0 } },
      _sum: { storeCredit: true },
      _avg: { storeCredit: true },
      _count: true,
    });

    const totalOutstanding = balanceAgg._sum.storeCredit || 0;
    const avgBalance = balanceAgg._avg.storeCredit || 0;
    const membersWithBalance = balanceAgg._count;

    // Redemption metrics from ledger (actual data, not estimates)
    const [redemptions, currentRedemptions] = await Promise.all([
      prisma.storeCreditLedger.aggregate({
        where: {
          shopDomain: this.shopDomain,
          amount: { lt: 0 }, // debits are negative
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.storeCreditLedger.aggregate({
        where: {
          shopDomain: this.shopDomain,
          amount: { lt: 0 },
          createdAt: { gte: thirtyDaysAgo },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const totalRedeemed = Math.abs(redemptions._sum.amount || 0);
    const currentRedeemed = Math.abs(currentRedemptions._sum.amount || 0);
    const totalEarnedAmount = totalEarned._sum.cashbackAmount || 0;

    const redemptionRate =
      totalEarnedAmount > 0
        ? (totalRedeemed / totalEarnedAmount) * 100
        : 0;

    return {
      earned: {
        totalAllTime: totalEarnedAmount,
        currentPeriod: currentPeriodEarned._sum.cashbackAmount || 0,
        lastPeriod: lastPeriodEarned._sum.cashbackAmount || 0,
        avgPerMember:
          memberCount > 0 ? totalEarnedAmount / memberCount : 0,
        avgPerTransaction:
          totalEarned._count > 0
            ? totalEarnedAmount / totalEarned._count
            : 0,
        transactionsEarningCredits: currentPeriodEarned._count,
        percentTransactionsEarning:
          totalTxCount > 0
            ? (currentPeriodEarned._count / totalTxCount) * 100
            : 0,
      },
      redeemed: {
        totalAllTime: totalRedeemed,
        currentPeriod: currentRedeemed,
        lastPeriod: 0, // TODO: add last period redemption query
        avgRedemptionValue:
          redemptions._count > 0 ? totalRedeemed / redemptions._count : 0,
        ordersUsingCredits: currentRedemptions._count,
        percentOrdersUsingCredits:
          currentPeriodEarned._count > 0
            ? (currentRedemptions._count / currentPeriodEarned._count) * 100
            : 0,
        avgDaysEarnToRedeem: 0, // TODO: needs join between earn and redeem events
      },
      economics: {
        redemptionRate,
        breakageRate: 100 - redemptionRate,
        outstandingLiability: totalOutstanding,
        creditToRevenueRatio: 0, // TODO: needs total order revenue
        revenuePerCreditDollar: 0, // TODO: needs total order revenue
        avgBalancePerMember: avgBalance,
        membersWithBalance,
        percentMembersWithBalance:
          memberCount > 0
            ? (membersWithBalance / memberCount) * 100
            : 0,
      },
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
      totalCustomers,
      activatedMembers,
    ] = await Promise.all([
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          membershipHistory: { some: { isActive: true } },
        },
      }),
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          membershipHistory: { some: { isActive: true } },
          transactions: { some: { createdAt: { gte: thirtyDaysAgo } } },
        },
      }),
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          membershipHistory: { some: { isActive: true } },
          transactions: { some: { createdAt: { gte: ninetyDaysAgo } } },
        },
      }),
      prisma.customerMembership.count({
        where: {
          tier: { shopDomain: this.shopDomain },
          startDate: { gte: thirtyDaysAgo },
        },
      }),
      prisma.customer.count({
        where: { shopDomain: this.shopDomain },
      }),
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          membershipHistory: { some: { isActive: true } },
          transactions: { some: {} },
        },
      }),
    ]);

    // TODO: Replace with real daily/weekly aggregation queries.
    // These are placeholder trends based on the 30-day active count.
    // Real implementation should use groupBy on createdAt date-truncated to day/week.
    const dailyActiveMembers = Array.from({ length: 30 }, () =>
      Math.max(1, Math.floor(activeMembers30 * (0.8 + Math.random() * 0.4))),
    );
    const weeklyRevenue = Array.from({ length: 12 }, () =>
      Math.floor(10000 + Math.random() * 5000),
    );

    return {
      totalMembers,
      activeMembers30Day: activeMembers30,
      activeMembers90Day: activeMembers90,
      newMembersThisPeriod: newMembers,
      enrollmentRate:
        totalCustomers > 0 ? (totalMembers / totalCustomers) * 100 : 0,
      activationRate:
        totalMembers > 0 ? (activatedMembers / totalMembers) * 100 : 0,
      dailyActiveMembers,
      weeklyRevenue,
    };
  }
}

// Convenience function — used by the analytics route
export async function getAnalyticsDashboard(shopDomain: string) {
  const service = new AnalyticsService(shopDomain);

  const [businessGrowth, tierActivity, storeCredit, programHealth] =
    await Promise.all([
      service.getBusinessGrowthMetrics(),
      service.getTierActivityMetrics(),
      service.getStoreCreditMetrics(),
      service.getProgramHealthMetrics(),
    ]);

  return {
    businessGrowth,
    tierActivity,
    storeCredit,
    programHealth,
  };
}
