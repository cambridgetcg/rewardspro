import prisma from "../db.server";

// Type for the session from authenticate.admin
interface AdminSession {
  shop: string;
  accessToken?: string;
  [key: string]: any;
}

export interface DashboardStats {
  totalCustomers: number;
  activeCustomers: number;
  totalCashbackEarned: number;
  averageCashbackPercent: number;
}

export interface TierDistribution {
  name: string;
  count: number;
  cashbackPercent: number;
}

export interface RecentTransaction {
  id: string;
  customerEmail: string;
  orderAmount: number;
  cashbackAmount: number;
  createdAt: Date;
}

export interface DashboardData {
  stats: DashboardStats;
  tierDistribution: TierDistribution[];
  recentTransactions: RecentTransaction[];
  todaysCashback: number;
  monthlyTrend: {
    earned: number;
    transactions: number;
  };
}

export async function getDashboardData(session: AdminSession): Promise<DashboardData> {
  const shopDomain = session.shop;
  
  // Run all queries in parallel for better performance
  const [
    customers,
    transactions,
    tiers,
    activeMembers,
    todaysTransactions,
    monthlyTransactions
  ] = await Promise.all([
    // Get all customers with basic stats
    prisma.customer.findMany({
      where: { shopDomain },
      select: {
        id: true,
        storeCredit: true,
        totalEarned: true,
      }
    }),
    
    // Get recent transactions
    prisma.cashbackTransaction.findMany({
      where: { shopDomain },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        customer: {
          select: { email: true }
        }
      }
    }),
    
    // Get all tiers with member counts
    prisma.tier.findMany({
      where: { 
        shopDomain,
        isActive: true 
      },
      include: {
        _count: {
          select: {
            customerMemberships: {
              where: { isActive: true }
            }
          }
        }
      },
      orderBy: { cashbackPercent: 'asc' }
    }),
    
    // Count active members (those with active tier membership)
    prisma.customerMembership.count({
      where: {
        isActive: true,
        tier: { shopDomain }
      }
    }),
    
    // Today's transactions
    prisma.cashbackTransaction.findMany({
      where: {
        shopDomain,
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      },
      select: {
        cashbackAmount: true
      }
    }),
    
    // This month's transactions
    prisma.cashbackTransaction.findMany({
      where: {
        shopDomain,
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        }
      },
      select: {
        cashbackAmount: true
      }
    })
  ]);
  
  // Calculate stats
  const totalCustomers = customers.length;
  const totalCashbackEarned = customers.reduce((sum, c) => sum + c.totalEarned, 0);
  const averageCashbackPercent = tiers.length > 0 
    ? tiers.reduce((sum, t) => sum + t.cashbackPercent, 0) / tiers.length 
    : 0;
  
  // Calculate today's cashback
  const todaysCashback = todaysTransactions.reduce((sum, t) => sum + t.cashbackAmount, 0);
  
  // Calculate monthly stats
  const monthlyEarned = monthlyTransactions.reduce((sum, t) => sum + t.cashbackAmount, 0);
  const monthlyTransactionCount = monthlyTransactions.length;
  
  // Format tier distribution
  const tierDistribution: TierDistribution[] = tiers.map(tier => ({
    name: tier.name,
    count: tier._count.customerMemberships,
    cashbackPercent: tier.cashbackPercent
  }));
  
  // Format recent transactions
  const recentTransactions: RecentTransaction[] = transactions.map(t => ({
    id: t.id,
    customerEmail: t.customer.email,
    orderAmount: t.orderAmount,
    cashbackAmount: t.cashbackAmount,
    createdAt: t.createdAt
  }));
  
  return {
    stats: {
      totalCustomers,
      activeCustomers: activeMembers,
      totalCashbackEarned,
      averageCashbackPercent
    },
    tierDistribution,
    recentTransactions,
    todaysCashback,
    monthlyTrend: {
      earned: monthlyEarned,
      transactions: monthlyTransactionCount
    }
  };
}