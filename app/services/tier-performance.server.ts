import prisma from "../db.server";
import { Tier } from "@prisma/client";

export interface OptimizedTierData extends Tier {
  memberCount: number;
  totalEarned: number;
  percentageOfCustomers: number;
}

// Optimized function with single query and aggregation
export async function getOptimizedTierDistribution(shopDomain: string): Promise<{
  tiers: OptimizedTierData[];
  stats: {
    totalCustomers: number;
    totalCashback: number;
    activeTiers: number;
    totalMembers: number;
  };
}> {
  // Execute all queries in parallel
  const [
    tiers,
    customerStats,
    cashbackStats,
    membershipCounts
  ] = await Promise.all([
    // Get all tiers
    prisma.tier.findMany({
      where: { shopDomain },
      orderBy: { cashbackPercent: 'desc' }
    }),
    
    // Get total customer count
    prisma.customer.count({ 
      where: { shopDomain } 
    }),
    
    // Get total cashback in one aggregation
    prisma.cashbackTransaction.aggregate({
      where: { shopDomain },
      _sum: { cashbackAmount: true }
    }),
    
    // Get all membership counts in one query using groupBy
    prisma.customerMembership.groupBy({
      by: ['tierId'],
      where: { 
        isActive: true,
        tier: { shopDomain }
      },
      _count: true
    })
  ]);

  // Create a map for quick lookup of member counts
  const memberCountMap = new Map(
    membershipCounts.map(m => [m.tierId, m._count])
  );

  // If we need total earned per tier, get it in one aggregated query
  const tierEarnings = await prisma.cashbackTransaction.groupBy({
    by: ['customerId'],
    where: { shopDomain },
    _sum: { cashbackAmount: true }
  }).then(async (earnings) => {
    // Get customer to tier mapping
    const customerTiers = await prisma.customerMembership.findMany({
      where: { 
        isActive: true,
        customerId: { in: earnings.map(e => e.customerId) }
      },
      select: {
        customerId: true,
        tierId: true
      }
    });
    
    // Create earnings map by tier
    const tierEarningsMap = new Map<string, number>();
    const customerTierMap = new Map(customerTiers.map(ct => [ct.customerId, ct.tierId]));
    
    earnings.forEach(earning => {
      const tierId = customerTierMap.get(earning.customerId);
      if (tierId) {
        const current = tierEarningsMap.get(tierId) || 0;
        tierEarningsMap.set(tierId, current + (earning._sum.cashbackAmount || 0));
      }
    });
    
    return tierEarningsMap;
  });

  // Combine all data
  const optimizedTiers: OptimizedTierData[] = tiers.map(tier => ({
    ...tier,
    memberCount: memberCountMap.get(tier.id) || 0,
    totalEarned: tierEarnings.get(tier.id) || 0,
    percentageOfCustomers: customerStats > 0 
      ? ((memberCountMap.get(tier.id) || 0) / customerStats) * 100 
      : 0
  }));

  const activeTiers = tiers.filter(t => t.isActive).length;
  const totalMembers = Array.from(memberCountMap.values()).reduce((sum, count) => sum + count, 0);

  return {
    tiers: optimizedTiers,
    stats: {
      totalCustomers: customerStats,
      totalCashback: cashbackStats._sum.cashbackAmount || 0,
      activeTiers,
      totalMembers
    }
  };
}

// Simple caching mechanism with TTL
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

export async function getCachedTierDistribution(shopDomain: string) {
  const cacheKey = `tiers_${shopDomain}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const data = await getOptimizedTierDistribution(shopDomain);
  cache.set(cacheKey, { data, timestamp: Date.now() });
  
  // Clean old cache entries
  if (cache.size > 100) {
    const oldestKey = Array.from(cache.keys())[0];
    cache.delete(oldestKey);
  }
  
  return data;
}