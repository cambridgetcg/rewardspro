// app/services/activity.server.ts
import prisma from "../db.server";
import { subDays } from "date-fns";

export interface ActivityFilter {
  type?: 'tier_upgrade' | 'tier_downgrade' | 'cashback_earned' | 'cashback_redeemed' | 'new_customer' | 'manual_assignment';
  customerId?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export interface Activity {
  id: string;
  type: string;
  message: string;
  timestamp: Date;
  customerId: string | null;
  metadata?: {
    previousTier?: string;
    newTier?: string;
    amount?: number;
    orderId?: string;
    [key: string]: any;
  };
}

export async function getActivityLog(filter: ActivityFilter = {}) {
  const page = filter.page || 1;
  const limit = filter.limit || 50;
  const skip = (page - 1) * limit;

  const activities: Activity[] = [];
  const where: any = {};

  if (filter.startDate || filter.endDate) {
    where.createdAt = {};
    if (filter.startDate) where.createdAt.gte = filter.startDate;
    if (filter.endDate) where.createdAt.lte = filter.endDate;
  }

  if (filter.customerId) {
    where.customerId = filter.customerId;
  }

  // Fetch different types of activities based on filter
  if (!filter.type || filter.type === 'tier_upgrade' || filter.type === 'tier_downgrade' || filter.type === 'new_customer' || filter.type === 'manual_assignment') {
    const membershipChanges = await prisma.customerMembership.findMany({
      where: {
        ...where,
        isActive: true
      },
      include: {
        customer: true,
        tier: true
      },
      orderBy: { createdAt: 'desc' },
      skip: filter.type ? skip : 0,
      take: filter.type ? limit : undefined
    });

    for (const membership of membershipChanges) {
      // Check previous membership to determine type
      const previousMembership = await prisma.customerMembership.findFirst({
        where: {
          customerId: membership.customerId,
          endDate: { not: null },
          createdAt: { lt: membership.createdAt }
        },
        orderBy: { createdAt: 'desc' },
        include: { tier: true }
      });

      let type: string;
      let message: string;
      const metadata: any = {
        newTier: membership.tier.displayName
      };

      if (!previousMembership) {
        type = 'new_customer';
        message = `New customer: ${membership.customer.email} joined ${membership.tier.displayName}`;
      } else if (membership.source === 'MANUAL') {
        type = 'manual_assignment';
        message = `${membership.customer.email} manually assigned to ${membership.tier.displayName}`;
        metadata.previousTier = previousMembership.tier.displayName;
      } else if (previousMembership.tier.level < membership.tier.level) {
        type = 'tier_upgrade';
        message = `${membership.customer.email} upgraded to ${membership.tier.displayName}`;
        metadata.previousTier = previousMembership.tier.displayName;
      } else {
        type = 'tier_downgrade';
        message = `${membership.customer.email} downgraded to ${membership.tier.displayName}`;
        metadata.previousTier = previousMembership.tier.displayName;
      }

      if (!filter.type || filter.type === type) {
        activities.push({
          id: membership.id,
          type,
          message,
          timestamp: membership.createdAt,
          customerId: membership.customerId,
          metadata
        });
      }
    }
  }

  // Fetch cashback activities
  if (!filter.type || filter.type === 'cashback_earned' || filter.type === 'cashback_redeemed') {
    const cashbackTransactions = await prisma.cashbackTransaction.findMany({
      where: {
        ...where,
        status: { in: ["COMPLETED", "SYNCED_TO_SHOPIFY", "REDEEMED"] }
      },
      include: {
        customer: true
      },
      orderBy: { createdAt: 'desc' },
      skip: filter.type ? skip : 0,
      take: filter.type ? limit : undefined
    });

    for (const transaction of cashbackTransactions) {
      const type = transaction.status === 'REDEEMED' ? 'cashback_redeemed' : 'cashback_earned';
      
      if (!filter.type || filter.type === type) {
        activities.push({
          id: transaction.id,
          type,
          message: type === 'cashback_earned' 
            ? `${transaction.customer.email} earned £${transaction.cashbackAmount.toFixed(2)} cashback`
            : `${transaction.customer.email} redeemed £${transaction.cashbackAmount.toFixed(2)} cashback`,
          timestamp: transaction.createdAt,
          customerId: transaction.customerId,
          metadata: {
            amount: transaction.cashbackAmount,
            orderId: transaction.orderId
          }
        });
      }
    }
  }

  // Sort all activities by timestamp
  activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // Apply pagination if no specific type filter
  let paginatedActivities = activities;
  let totalCount = activities.length;

  if (!filter.type) {
    totalCount = await getTotalActivityCount(where);
    paginatedActivities = activities.slice(skip, skip + limit);
  } else {
    // For specific type, we already applied pagination in the queries
    totalCount = await getTotalActivityCount({ ...where, type: filter.type });
  }

  const totalPages = Math.ceil(totalCount / limit);

  return {
    activities: paginatedActivities,
    totalCount,
    totalPages
  };
}

async function getTotalActivityCount(baseWhere: any) {
  const [membershipCount, cashbackCount] = await Promise.all([
    prisma.customerMembership.count({
      where: {
        ...baseWhere,
        isActive: true
      }
    }),
    prisma.cashbackTransaction.count({
      where: {
        ...baseWhere,
        status: { in: ["COMPLETED", "SYNCED_TO_SHOPIFY", "REDEEMED"] }
      }
    })
  ]);

  return membershipCount + cashbackCount;
}

// Get activity summary for a specific customer
export async function getCustomerActivitySummary(customerId: string) {
  const [
    totalCashbackEarned,
    totalCashbackRedeemed,
    tierChanges,
    recentActivities
  ] = await Promise.all([
    // Total cashback earned
    prisma.cashbackTransaction.aggregate({
      where: {
        customerId,
        status: { in: ["COMPLETED", "SYNCED_TO_SHOPIFY"] }
      },
      _sum: { cashbackAmount: true }
    }),
    
    // Total cashback redeemed
    prisma.cashbackTransaction.aggregate({
      where: {
        customerId,
        status: "REDEEMED"
      },
      _sum: { cashbackAmount: true }
    }),
    
    // Tier change history
    prisma.customerMembership.findMany({
      where: { customerId },
      include: { tier: true },
      orderBy: { createdAt: 'desc' }
    }),
    
    // Recent activities (last 10)
    getActivityLog({ 
      customerId, 
      limit: 10 
    })
  ]);

  return {
    totalCashbackEarned: totalCashbackEarned._sum.cashbackAmount || 0,
    totalCashbackRedeemed: totalCashbackRedeemed._sum.cashbackAmount || 0,
    tierHistory: tierChanges.map(membership => ({
      tierId: membership.tierId,
      tierName: membership.tier.displayName,
      startDate: membership.startDate,
      endDate: membership.endDate,
      isActive: membership.isActive,
      source: membership.source
    })),
    recentActivities: recentActivities.activities
  };
}