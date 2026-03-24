import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";

const VALID_STATUSES = [
  TransactionStatus.COMPLETED,
  TransactionStatus.SYNCED_TO_SHOPIFY,
];

// ── Types ──

export interface OverviewMetrics {
  memberRevenue: number;
  revenuePerMember: number;
  monthOverMonthGrowth: number;
  memberCount: number;
  repeatPurchaseRate: number;
  purchasesPerMemberPerYear: number;
  totalCreditEarned: number;
  creditEarnedThisPeriod: number;
  outstandingLiability: number;
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
    retentionRate: number;
  }>;
  tierMovement: {
    upgradedCount: number;
    downgradedCount: number;
  };
  tierRevenue: Array<{
    tierId: string;
    tierName: string;
    totalRevenue: number;
    percentOfTotalRevenue: number;
  }>;
}

export interface StoreCreditMetrics {
  totalEarned: number;
  currentPeriodEarned: number;
  avgPerTransaction: number;
  totalRedeemed: number;
  ordersUsingCredits: number;
  redemptionRate: number;
  outstandingLiability: number;
  membersWithBalance: number;
  percentMembersWithBalance: number;
}

// ── Service ──

export class AnalyticsService {
  constructor(private shopDomain: string) {}

  /** Overview: 3 parallel batches, ~10 queries total */
  async getOverviewMetrics(): Promise<OverviewMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const [
      memberCount,
      memberRevenue,
      currentMonthRev,
      lastMonthRev,
      memberTx365,
      membersWithMultiple,
      totalEarned,
      currentPeriodEarned,
      balanceAgg,
    ] = await Promise.all([
      prisma.customer.count({
        where: {
          shopDomain: this.shopDomain,
          membershipHistory: { some: { isActive: true } },
        },
      }),
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
      prisma.cashbackTransaction.count({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: oneYearAgo },
          status: { in: VALID_STATUSES },
          customer: { membershipHistory: { some: { isActive: true } } },
        },
      }),
      prisma.cashbackTransaction.groupBy({
        by: ["customerId"],
        where: {
          shopDomain: this.shopDomain,
          status: { in: VALID_STATUSES },
          customer: { membershipHistory: { some: { isActive: true } } },
        },
        having: { customerId: { _count: { gt: 1 } } },
      }),
      prisma.cashbackTransaction.aggregate({
        where: { shopDomain: this.shopDomain },
        _sum: { cashbackAmount: true },
      }),
      prisma.cashbackTransaction.aggregate({
        where: {
          shopDomain: this.shopDomain,
          createdAt: { gte: thirtyDaysAgo },
        },
        _sum: { cashbackAmount: true },
      }),
      prisma.customer.aggregate({
        where: { shopDomain: this.shopDomain, storeCredit: { gt: 0 } },
        _sum: { storeCredit: true },
      }),
    ]);

    const currentMonth = currentMonthRev._sum.orderAmount || 0;
    const lastMonth = lastMonthRev._sum.orderAmount || 0;
    const mom = lastMonth > 0 ? ((currentMonth - lastMonth) / lastMonth) * 100 : 0;
    const totalMemberRev = memberRevenue._sum.orderAmount || 0;

    return {
      memberRevenue: totalMemberRev,
      revenuePerMember: memberCount > 0 ? totalMemberRev / memberCount : 0,
      monthOverMonthGrowth: mom,
      memberCount,
      repeatPurchaseRate:
        memberCount > 0 ? (membersWithMultiple.length / memberCount) * 100 : 0,
      purchasesPerMemberPerYear:
        memberCount > 0 ? memberTx365 / memberCount : 0,
      totalCreditEarned: totalEarned._sum.cashbackAmount || 0,
      creditEarnedThisPeriod: currentPeriodEarned._sum.cashbackAmount || 0,
      outstandingLiability: balanceAgg._sum.storeCredit || 0,
    };
  }

  /** Tier activity: ~7 queries */
  async getTierActivityMetrics(): Promise<TierActivityMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const totalCustomers = await prisma.customer.count({
      where: { shopDomain: this.shopDomain },
    });

    const tiers = await prisma.tier.findMany({
      where: { shopDomain: this.shopDomain },
      include: {
        _count: {
          select: { customerMemberships: { where: { isActive: true } } },
        },
      },
    });

    const tierIds = tiers.map((t) => t.id);

    const [tierRevenueAgg, membershipMap, recentActive, upgrades, downgrades] =
      await Promise.all([
        prisma.cashbackTransaction.groupBy({
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
        }),
        prisma.customerMembership.findMany({
          where: { isActive: true, tierId: { in: tierIds } },
          select: { customerId: true, tierId: true },
        }),
        prisma.cashbackTransaction.groupBy({
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
        }),
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

    const customerToTier: Record<string, string> = {};
    for (const m of membershipMap) {
      customerToTier[m.customerId] = m.tierId;
    }

    const tierAgg: Record<
      string,
      { revenue: number; orderCount: number }
    > = {};
    for (const t of tiers) {
      tierAgg[t.id] = { revenue: 0, orderCount: 0 };
    }
    for (const row of tierRevenueAgg) {
      const tierId = customerToTier[row.customerId];
      if (tierId && tierAgg[tierId]) {
        tierAgg[tierId].revenue += row._sum.orderAmount || 0;
        tierAgg[tierId].orderCount += row._count;
      }
    }

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
      const retentionRate = memberCt > 0 ? (activeInTier / memberCt) * 100 : 0;

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
        retentionRate,
      };
    });

    const tierRevenue = tierMetrics.map((tm) => ({
      tierId: tm.tierId,
      tierName: tm.tierName,
      totalRevenue: tm.avgAnnualSpend * tm.totalCustomers,
      percentOfTotalRevenue:
        totalRevenue > 0
          ? ((tm.avgAnnualSpend * tm.totalCustomers) / totalRevenue) * 100
          : 0,
    }));

    return {
      tierMetrics,
      tierMovement: { upgradedCount: upgrades, downgradedCount: downgrades },
      tierRevenue,
    };
  }

  /** Store credit health: ~6 queries */
  async getStoreCreditMetrics(): Promise<StoreCreditMetrics> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalEarned, currentPeriodEarned, memberCount, balanceAgg, redemptions, currentRedemptions] =
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
        }),
        prisma.customer.count({
          where: {
            shopDomain: this.shopDomain,
            membershipHistory: { some: { isActive: true } },
          },
        }),
        prisma.customer.aggregate({
          where: { shopDomain: this.shopDomain, storeCredit: { gt: 0 } },
          _sum: { storeCredit: true },
          _count: true,
        }),
        prisma.storeCreditLedger.aggregate({
          where: { shopDomain: this.shopDomain, amount: { lt: 0 } },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.storeCreditLedger.aggregate({
          where: {
            shopDomain: this.shopDomain,
            amount: { lt: 0 },
            createdAt: { gte: thirtyDaysAgo },
          },
          _count: true,
        }),
      ]);

    const totalEarnedAmt = totalEarned._sum.cashbackAmount || 0;
    const totalRedeemed = Math.abs(redemptions._sum.amount || 0);

    return {
      totalEarned: totalEarnedAmt,
      currentPeriodEarned: currentPeriodEarned._sum.cashbackAmount || 0,
      avgPerTransaction:
        totalEarned._count > 0 ? totalEarnedAmt / totalEarned._count : 0,
      totalRedeemed,
      ordersUsingCredits: currentRedemptions._count,
      redemptionRate:
        totalEarnedAmt > 0 ? (totalRedeemed / totalEarnedAmt) * 100 : 0,
      outstandingLiability: balanceAgg._sum.storeCredit || 0,
      membersWithBalance: balanceAgg._count,
      percentMembersWithBalance:
        memberCount > 0 ? (balanceAgg._count / memberCount) * 100 : 0,
    };
  }
}

/** Convenience — used by the analytics route loader */
export async function getAnalyticsDashboard(shopDomain: string) {
  const service = new AnalyticsService(shopDomain);

  const [overview, tierActivity, storeCredit] = await Promise.all([
    service.getOverviewMetrics(),
    service.getTierActivityMetrics(),
    service.getStoreCreditMetrics(),
  ]);

  return { overview, tierActivity, storeCredit };
}
