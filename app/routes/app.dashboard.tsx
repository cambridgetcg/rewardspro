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
      marginBottom: "40px"
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
      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
      gap: "24px",
      marginBottom: "40px"
    },
    metricCard: {
      backgroundColor: "#f8f9fa",
      padding: "24px",
      borderRadius: "12px",
      textAlign: "center" as const
    },
    metricTitle: {
      fontSize: "14px",
      color: "#666",
      margin: 0,
      marginBottom: "8px"
    },
    metricValue: {
      fontSize: "32px",
      fontWeight: "600",
      margin: "0 0 4px 0",
      color: "#1a1a1a"
    },
    metricSubtext: {
      fontSize: "14px",
      color: "#666",
      margin: 0
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
      padding: "24px",
      borderRadius: "12px",
      border: "1px solid #e0e0e0",
      transition: "box-shadow 0.2s"
    },
    cardTitle: {
      fontSize: "20px",
      fontWeight: "600",
      margin: "0 0 24px 0",
      color: "#1a1a1a"
    },
    tierBar: {
      display: "flex",
      height: "40px",
      borderRadius: "8px",
      overflow: "hidden",
      backgroundColor: "#f5f5f5",
      marginBottom: "24px"
    },
    tierSegment: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "white",
      textDecoration: "none",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s",
      cursor: "pointer",
      position: "relative" as const
    },
    tierLegend: {
      display: "flex",
      flexWrap: "wrap" as const,
      gap: "20px"
    },
    tierLegendItem: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "14px",
      color: "#666"
    },
    tierColor: {
      width: "16px",
      height: "16px",
      borderRadius: "4px"
    },
    activityList: {
      display: "flex",
      flexDirection: "column" as const,
      gap: "12px"
    },
    activityItem: {
      padding: "16px",
      backgroundColor: "#f8f9fa",
      borderRadius: "8px",
      fontSize: "14px",
      transition: "background-color 0.2s"
    },
    activityMessage: {
      color: "#1a1a1a",
      marginBottom: "4px"
    },
    activityTime: {
      fontSize: "12px",
      color: "#999"
    },
    customerList: {
      display: "flex",
      flexDirection: "column" as const,
      gap: "12px"
    },
    customerRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "16px",
      backgroundColor: "#f8f9fa",
      borderRadius: "8px",
      transition: "background-color 0.2s"
    },
    customerInfo: {
      flex: 1
    },
    customerEmail: {
      fontSize: "14px",
      fontWeight: "500",
      color: "#1a1a1a",
      marginBottom: "4px"
    },
    customerStats: {
      fontSize: "12px",
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
      padding: "60px 20px",
      backgroundColor: "#f8f9fa",
      borderRadius: "12px",
      border: "1px solid #e0e0e0"
    },
    emptyStateTitle: {
      fontSize: "20px",
      fontWeight: "600",
      marginBottom: "8px",
      color: "#1a1a1a"
    },
    emptyStateText: {
      fontSize: "16px",
      color: "#666",
      marginBottom: "24px"
    },
    link: {
      color: "#1a1a1a",
      textDecoration: "none",
      fontSize: "14px",
      fontWeight: "500",
      padding: "10px 20px",
      backgroundColor: "#1a1a1a",
      border: "none",
      borderRadius: "8px",
      display: "inline-block",
      transition: "opacity 0.2s"
    },
    sectionHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "24px"
    },
    viewAllLink: {
      color: "#1a1a1a",
      textDecoration: "none",
      fontSize: "14px",
      fontWeight: "500",
      transition: "opacity 0.2s"
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
          changeLabel="30 days"
          styles={styles}
        />
        <MetricCard
          title="Cashback This Month"
          value={`${metrics.totalCashbackThisMonth.toFixed(2)}`}
          subtitle={`${metrics.totalCashbackAllTime.toFixed(2)} all time`}
          styles={styles}
        />
        <MetricCard
          title="Active Store Credit"
          value={`${metrics.activeStoreCredit.toFixed(2)}`}
          subtitle="(Liability)"
          styles={styles}
        />
        <MetricCard
          title="Avg Order Value"
          value={`${metrics.averageOrderValue.toFixed(2)}`}
          change={metrics.aovChange}
          styles={styles}
        />
        <MetricCard
          title="Total Transactions"
          value={metrics.totalTransactions.toLocaleString()}
          subtitle={`${metrics.conversionRate}% conversion`}
          styles={styles}
        />
      </div>

      {/* Tier Distribution and Activity Grid */}
      <div style={styles.grid}>
        {/* Tier Distribution */}
        <div 
          style={styles.card}
          onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
          onMouseOut={(e) => e.currentTarget.style.boxShadow = 'none'}
        >
          <h2 style={styles.cardTitle}>Customer Distribution</h2>
          
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
                      {tier.tierName}: {tier.memberCount} ({tier.percentage}%)
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={styles.emptyState}>
              <h3 style={styles.emptyStateTitle}>No tiers configured</h3>
              <p style={styles.emptyStateText}>Create tiers to start organizing customers</p>
              <Link 
                to="/app/tiers" 
                style={styles.link}
                onMouseOver={(e) => e.currentTarget.style.opacity = '0.8'}
                onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
              >
                Configure Tiers
              </Link>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div 
          style={styles.card}
          onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
          onMouseOut={(e) => e.currentTarget.style.boxShadow = 'none'}
        >
          <h2 style={styles.cardTitle}>Recent Activity</h2>
          
          {recentActivity.length > 0 ? (
            <div style={styles.activityList}>
              {recentActivity.map((activity) => (
                <div 
                  key={activity.id} 
                  style={styles.activityItem}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f0f0f0'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'}
                >
                  <div style={styles.activityMessage}>{activity.message}</div>
                  <div style={styles.activityTime}>
                    {format(new Date(activity.timestamp), "MMM d, h:mm a")}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.emptyState}>
              <h3 style={styles.emptyStateTitle}>No recent activity</h3>
              <p style={styles.emptyStateText}>Activity will appear here as customers engage</p>
            </div>
          )}
        </div>
      </div>

      {/* Top Customers */}
      <div 
        style={styles.card}
        onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
        onMouseOut={(e) => e.currentTarget.style.boxShadow = 'none'}
      >
        <div style={styles.sectionHeader}>
          <h2 style={styles.cardTitle}>Top Customers</h2>
          <Link 
            to="/app/customers/tiers" 
            style={styles.viewAllLink}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.6'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
          >
            View All →
          </Link>
        </div>
        
        {topCustomers.length > 0 ? (
          <div style={styles.customerList}>
            {topCustomers.map((customer) => (
              <div 
                key={customer.id} 
                style={styles.customerRow}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f0f0f0'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'}
              >
                <div style={styles.customerInfo}>
                  <div style={styles.customerEmail}>{customer.email}</div>
                  <div style={styles.customerStats}>
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
            <h3 style={styles.emptyStateTitle}>No customers yet</h3>
            <p style={styles.emptyStateText}>Your top customers will appear here</p>
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
    <div style={styles.metricCard}>
      <h3 style={styles.metricValue}>{value}</h3>
      <p style={styles.metricTitle}>{title}</p>
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