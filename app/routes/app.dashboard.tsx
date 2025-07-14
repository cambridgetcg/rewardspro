// app/routes/app.dashboard.tsx
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";
import { subDays, startOfMonth, endOfMonth, format } from "date-fns";

interface DashboardMetrics {
  totalCustomers: number;
  customerGrowth: number;
  totalCashbackThisMonth: number;
  totalCashbackAllTime: number;
  activeStoreCredit: number;
  averageOrderValue: number;
  aovChange: number;
  totalTransactions: number;
  conversionRate: number;
}

interface TierDistribution {
  tierId: string;
  tierName: string;
  level: number;
  memberCount: number;
  percentage: number;
  cashbackPercent: number;
}

interface RecentActivity {
  id: string;
  type: 'new_customer' | 'cashback_earned' | 'tier_change';
  message: string;
  timestamp: Date;
  amount?: number;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  // Get dashboard metrics
  const metrics = await getDashboardMetrics(shopDomain);
  const tierDistribution = await getTierDistribution(shopDomain);
  const recentActivity = await getRecentActivity(shopDomain);
  const topCustomers = await getTopCustomers(shopDomain);

  return json({ 
    metrics, 
    tierDistribution, 
    recentActivity,
    topCustomers
  });
}

async function getDashboardMetrics(shopDomain: string): Promise<DashboardMetrics> {
  const now = new Date();
  const startOfThisMonth = startOfMonth(now);
  const thirtyDaysAgo = subDays(now, 30);
  const sixtyDaysAgo = subDays(now, 60);

  // Total customers
  const totalCustomers = await prisma.customer.count({
    where: { shopDomain }
  });
  
  // Customer growth (last 30 days vs previous 30 days)
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

  // Total cashback this month
  const cashbackThisMonth = await prisma.cashbackTransaction.aggregate({
    where: {
      shopDomain,
      createdAt: { gte: startOfThisMonth },
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    },
    _sum: { cashbackAmount: true }
  });

  // Total cashback all time
  const cashbackAllTime = await prisma.cashbackTransaction.aggregate({
    where: {
      shopDomain,
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    },
    _sum: { cashbackAmount: true }
  });

  // Active store credit (liability)
  const activeCredit = await prisma.customer.aggregate({
    where: { shopDomain },
    _sum: { storeCredit: true }
  });

  // Average order value and transactions
  const ordersLast30Days = await prisma.cashbackTransaction.findMany({
    where: {
      shopDomain,
      createdAt: { gte: thirtyDaysAgo },
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    },
    select: { orderAmount: true }
  });

  const ordersPrevious30Days = await prisma.cashbackTransaction.findMany({
    where: {
      shopDomain,
      createdAt: {
        gte: sixtyDaysAgo,
        lt: thirtyDaysAgo
      },
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
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

  // Total transactions
  const totalTransactions = await prisma.cashbackTransaction.count({
    where: {
      shopDomain,
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    }
  });

  // Conversion rate (customers with transactions / total customers)
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

  const conversionRate = totalCustomers > 0 
    ? (customersWithTransactions / totalCustomers) * 100 
    : 0;

  return {
    totalCustomers,
    customerGrowth: Math.round(customerGrowth * 10) / 10,
    totalCashbackThisMonth: cashbackThisMonth._sum.cashbackAmount || 0,
    totalCashbackAllTime: cashbackAllTime._sum.cashbackAmount || 0,
    activeStoreCredit: activeCredit._sum.storeCredit || 0,
    averageOrderValue: currentAOV,
    aovChange: Math.round(aovChange * 10) / 10,
    totalTransactions,
    conversionRate: Math.round(conversionRate * 10) / 10
  };
}

async function getTierDistribution(shopDomain: string): Promise<TierDistribution[]> {
  const tiers = await prisma.tier.findMany({
    where: { 
      shopDomain,
      isActive: true 
    },
    orderBy: { level: 'asc' }
  });

  const memberCounts = await prisma.customerMembership.groupBy({
    by: ['tierId'],
    where: { 
      isActive: true,
      tier: { shopDomain }
    },
    _count: true
  });

  const totalMembers = memberCounts.reduce((sum, tier) => sum + tier._count, 0);

  return tiers.map(tier => {
    const count = memberCounts.find(m => m.tierId === tier.id)?._count || 0;
    return {
      tierId: tier.id,
      tierName: tier.name,
      level: tier.level,
      memberCount: count,
      percentage: totalMembers > 0 ? Math.round((count / totalMembers) * 1000) / 10 : 0,
      cashbackPercent: tier.cashbackPercent
    };
  });
}

async function getRecentActivity(shopDomain: string, limit: number = 5): Promise<RecentActivity[]> {
  const activities: RecentActivity[] = [];

  // Get recent new customers
  const recentCustomers = await prisma.customer.findMany({
    where: {
      shopDomain,
      createdAt: { gte: subDays(new Date(), 7) }
    },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  // Get recent cashback transactions
  const recentCashback = await prisma.cashbackTransaction.findMany({
    where: {
      shopDomain,
      createdAt: { gte: subDays(new Date(), 7) },
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    },
    include: {
      customer: true
    },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  // Add new customer activities
  for (const customer of recentCustomers) {
    activities.push({
      id: customer.id,
      type: 'new_customer',
      message: `New customer: ${customer.email}`,
      timestamp: customer.createdAt
    });
  }

  // Add cashback activities
  for (const transaction of recentCashback) {
    activities.push({
      id: transaction.id,
      type: 'cashback_earned',
      message: `${transaction.customer.email} earned $${transaction.cashbackAmount.toFixed(2)} cashback`,
      timestamp: transaction.createdAt,
      amount: transaction.cashbackAmount
    });
  }

  // Sort by timestamp and return limited results
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
      transactions: {
        where: {
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        }
      }
    }
  });

  const customersWithSpending = customers.map(customer => ({
    id: customer.id,
    email: customer.email,
    totalSpending: customer.transactions.reduce((sum, t) => sum + t.orderAmount, 0),
    totalEarned: customer.totalEarned,
    currentTier: customer.membershipHistory[0]?.tier
  }));

  return customersWithSpending
    .sort((a, b) => b.totalSpending - a.totalSpending)
    .slice(0, limit);
}

export default function Dashboard() {
  const { metrics, tierDistribution, recentActivity, topCustomers } = useLoaderData<typeof loader>();

  const styles = {
    container: {
      maxWidth: "1400px",
      margin: "0 auto",
      padding: "32px 24px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: "#1a1a1a",
      backgroundColor: "#ffffff",
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
      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
      gap: "24px",
      marginBottom: "40px"
    },
    metricCard: {
      backgroundColor: "#f8f9fa",
      padding: "24px",
      borderRadius: "12px",
      border: "1px solid #e0e0e0",
      transition: "box-shadow 0.2s"
    },
    metricTitle: {
      fontSize: "14px",
      fontWeight: "500",
      color: "#666",
      marginBottom: "8px",
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px"
    },
    metricValue: {
      fontSize: "32px",
      fontWeight: "600",
      margin: "0",
      color: "#1a1a1a"
    },
    metricSubtext: {
      fontSize: "14px",
      color: "#666",
      marginTop: "4px"
    },
    metricChange: {
      fontSize: "14px",
      marginTop: "8px",
      fontWeight: "500"
    },
    positiveChange: {
      color: "#10B981"
    },
    negativeChange: {
      color: "#EF4444"
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "32px",
      marginBottom: "32px"
    },
    card: {
      backgroundColor: "white",
      border: "1px solid #e0e0e0",
      borderRadius: "12px",
      padding: "24px",
      height: "100%"
    },
    cardTitle: {
      fontSize: "20px",
      fontWeight: "600",
      marginBottom: "20px",
      color: "#1a1a1a"
    },
    tierBar: {
      display: "flex",
      height: "48px",
      borderRadius: "8px",
      overflow: "hidden",
      backgroundColor: "#f5f5f5",
      marginBottom: "20px"
    },
    tierSegment: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "white",
      textDecoration: "none",
      fontSize: "14px",
      fontWeight: "500",
      transition: "opacity 0.2s",
      cursor: "pointer"
    },
    tierLegend: {
      display: "flex",
      flexWrap: "wrap" as const,
      gap: "16px"
    },
    tierLegendItem: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "14px"
    },
    tierColor: {
      width: "16px",
      height: "16px",
      borderRadius: "4px"
    },
    activityItem: {
      padding: "12px 0",
      borderBottom: "1px solid #f0f0f0",
      fontSize: "14px"
    },
    activityTime: {
      fontSize: "12px",
      color: "#999",
      marginTop: "4px"
    },
    customerRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "12px 0",
      borderBottom: "1px solid #f0f0f0"
    },
    customerInfo: {
      flex: 1
    },
    customerEmail: {
      fontSize: "14px",
      fontWeight: "500",
      color: "#1a1a1a"
    },
    customerSpending: {
      fontSize: "14px",
      color: "#666"
    },
    tierBadge: {
      fontSize: "12px",
      padding: "4px 12px",
      borderRadius: "16px",
      fontWeight: "500",
      backgroundColor: "#e8f5e9",
      color: "#2e7d32"
    },
    emptyState: {
      textAlign: "center" as const,
      padding: "40px",
      color: "#999"
    },
    link: {
      color: "#3B82F6",
      textDecoration: "none",
      fontSize: "14px",
      fontWeight: "500"
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Cashback Dashboard</h1>
        <p style={styles.subtitle}>Monitor your rewards program performance and customer engagement</p>
      </div>

      {/* Metrics Grid */}
      <div style={styles.metricsGrid}>
        <MetricCard
          title="Total Customers"
          value={metrics.totalCustomers.toLocaleString()}
          change={metrics.customerGrowth}
          changeLabel="vs last 30 days"
          styles={styles}
        />
        <MetricCard
          title="Cashback This Month"
          value={`$${metrics.totalCashbackThisMonth.toFixed(2)}`}
          subtitle={`$${metrics.totalCashbackAllTime.toFixed(2)} all time`}
          styles={styles}
        />
        <MetricCard
          title="Active Store Credit"
          value={`$${metrics.activeStoreCredit.toFixed(2)}`}
          subtitle="Outstanding liability"
          styles={styles}
        />
        <MetricCard
          title="Average Order Value"
          value={`$${metrics.averageOrderValue.toFixed(2)}`}
          change={metrics.aovChange}
          changeLabel="vs last 30 days"
          styles={styles}
        />
        <MetricCard
          title="Total Transactions"
          value={metrics.totalTransactions.toLocaleString()}
          subtitle={`${metrics.conversionRate}% conversion rate`}
          styles={styles}
        />
      </div>

      {/* Tier Distribution and Activity Grid */}
      <div style={styles.grid}>
        {/* Tier Distribution */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Customer Distribution by Tier</h2>
          
          {tierDistribution.length > 0 ? (
            <>
              <div style={styles.tierBar}>
                {tierDistribution.map((tier, index) => (
                  <Link
                    key={tier.tierId}
                    to={`/app/customers/tiers?tier=${tier.tierId}`}
                    style={{
                      ...styles.tierSegment,
                      flex: `0 0 ${tier.percentage}%`,
                      backgroundColor: getDefaultColor(index),
                      fontSize: tier.percentage > 5 ? "14px" : "0"
                    }}
                    title={`${tier.tierName}: ${tier.memberCount} members (${tier.percentage}%)`}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = "0.8"}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
                  >
                    {tier.percentage > 10 && tier.tierName}
                  </Link>
                ))}
              </div>
              
              <div style={styles.tierLegend}>
                {tierDistribution.map((tier, index) => (
                  <div key={tier.tierId} style={styles.tierLegendItem}>
                    <div style={{ 
                      ...styles.tierColor,
                      backgroundColor: getDefaultColor(index)
                    }} />
                    <span>
                      {tier.tierName}: {tier.memberCount} ({tier.percentage}%) • {tier.cashbackPercent}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={styles.emptyState}>
              <p>No tier data available</p>
              <Link to="/app/tiers" style={styles.link}>
                Configure Tiers →
              </Link>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Recent Activity</h2>
          
          {recentActivity.length > 0 ? (
            <div>
              {recentActivity.map((activity) => (
                <div key={activity.id} style={styles.activityItem}>
                  <div>{activity.message}</div>
                  <div style={styles.activityTime}>
                    {format(new Date(activity.timestamp), "MMM d, h:mm a")}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.emptyState}>
              <p>No recent activity</p>
            </div>
          )}
        </div>
      </div>

      {/* Top Customers */}
      <div style={styles.card}>
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          marginBottom: "20px"
        }}>
          <h2 style={styles.cardTitle}>Top Customers</h2>
          <Link to="/app/customers/tiers" style={styles.link}>
            View All →
          </Link>
        </div>
        
        {topCustomers.length > 0 ? (
          <div>
            {topCustomers.map((customer) => (
              <div key={customer.id} style={styles.customerRow}>
                <div style={styles.customerInfo}>
                  <div style={styles.customerEmail}>{customer.email}</div>
                  <div style={styles.customerSpending}>
                    Lifetime: ${customer.totalSpending.toFixed(2)} • Earned: ${customer.totalEarned.toFixed(2)}
                  </div>
                </div>
                {customer.currentTier && (
                  <div style={styles.tierBadge}>
                    {customer.currentTier.name}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={styles.emptyState}>
            <p>No customer data available yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Metric Card Component
function MetricCard({ 
  title, 
  value, 
  subtitle, 
  change, 
  changeLabel = "vs last period",
  styles
}: {
  title: string;
  value: string;
  subtitle?: string;
  change?: number;
  changeLabel?: string;
  styles: any;
}) {
  return (
    <div 
      style={styles.metricCard}
      onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
      onMouseOut={(e) => e.currentTarget.style.boxShadow = 'none'}
    >
      <h3 style={styles.metricTitle}>{title}</h3>
      <p style={styles.metricValue}>{value}</p>
      {subtitle && (
        <p style={styles.metricSubtext}>{subtitle}</p>
      )}
      {change !== undefined && (
        <p style={{
          ...styles.metricChange,
          ...(change >= 0 ? styles.positiveChange : styles.negativeChange)
        }}>
          {change >= 0 ? "↑" : "↓"} {Math.abs(change)}% {changeLabel}
        </p>
      )}
    </div>
  );
}

// Default colors for tiers
function getDefaultColor(index: number): string {
  const colors = ["#CD7F32", "#C0C0C0", "#FFD700", "#E5E4E2", "#B87333"];
  return colors[index % colors.length];
}