// app/routes/app.dashboard.tsx
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { 
  DashboardService, 
  type DashboardMetrics,
  type TierDistribution,
  type RecentActivity,
  type CustomerInsight,
  type EngagementMetrics,
  type CreditReconciliation,
  type UpgradeOpportunity
} from "../services/dashboard.server";
import { TierChangeType } from "@prisma/client";
import { format } from "date-fns";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const service = new DashboardService(session.shop);
  
  const dashboardData = await service.getDashboardData();
  
  return json(dashboardData);
}

export default function EnhancedDashboard() {
  const { 
    metrics, 
    tierDistribution, 
    recentActivity, 
    topCustomers,
    upgradeOpportunities,
    engagementMetrics,
    creditReconciliation
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
      gap: "8px",
      marginTop: "20px",
      paddingTop: "30px",
      position: "relative" as const
    },
    chartBarWrapper: {
      flex: 1,
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center",
      position: "relative" as const,
      height: "100%"
    },
    chartBar: {
      width: "100%",
      backgroundColor: "#3b82f6",
      borderRadius: "4px 4px 0 0",
      transition: "all 0.3s ease",
      position: "relative" as const,
      minHeight: "2px"
    },
    chartValue: {
      position: "absolute" as const,
      top: "-25px",
      left: "50%",
      transform: "translateX(-50%)",
      fontSize: "13px",
      fontWeight: "600",
      color: "#374151",
      whiteSpace: "nowrap" as const
    },
    chartLabel: {
      fontSize: "11px",
      color: "#666",
      textAlign: "center" as const,
      marginTop: "8px",
      whiteSpace: "nowrap" as const
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
    },
    chartSection: {
      marginTop: "16px"
    },
    chartTypeToggle: {
      display: "flex",
      gap: "8px",
      marginBottom: "16px"
    },
    toggleButton: {
      padding: "6px 12px",
      fontSize: "13px",
      border: "1px solid #e5e7eb",
      borderRadius: "6px",
      backgroundColor: "white",
      color: "#666",
      cursor: "pointer",
      transition: "all 0.2s"
    },
    toggleButtonActive: {
      backgroundColor: "#3b82f6",
      color: "white",
      borderColor: "#3b82f6"
    }
  };

  // Helper function to format activity type
  const getActivityIcon = (type: string) => {
    const icons = {
      new_customer: "👤",
      cashback_earned: "💰",
      tier_upgrade: "⬆️",
      tier_downgrade: "⬇️",
      manual_adjustment: "✏️",
      credit_sync: "🔄"
    };
    return icons[type as keyof typeof icons] || "•";
  };

  // Calculate max values for chart scaling
  const maxDailyOrders = Math.max(...engagementMetrics.daily.map(d => d.orders), 1);
  const maxDailyRevenue = Math.max(...engagementMetrics.daily.map(d => d.revenue), 1);

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
          <p style={styles.metricSubtext}>{metrics.totalOrders30Days} orders</p>
          <div style={{
            ...styles.metricChange,
            ...(metrics.orderGrowth >= 0 ? styles.positiveChange : styles.negativeChange)
          }}>
            {metrics.orderGrowth >= 0 ? "↑" : "↓"} {Math.abs(metrics.orderGrowth)}%
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
          <h3 style={styles.metricValue}>{metrics.repeatPurchaseRate}%</h3>
          <p style={styles.metricTitle}>Repeat Purchase Rate</p>
          <p style={styles.metricSubtext}>{metrics.newCustomersThisMonth} new this month</p>
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
        {/* Tier Performance */}
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

          {tierDistribution.length > 0 ? (
            <>
              <div style={styles.tierBar}>
                {tierDistribution.map((tier) => (
                  <div
                    key={tier.tierId}
                    style={{
                      ...styles.tierSegment,
                      flex: `0 0 ${tier.percentage}%`,
                      backgroundColor: tier.color,
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
                    <th style={{ ...styles.th, textAlign: "right" as const }}>Min Spend</th>
                    <th style={{ ...styles.th, textAlign: "right" as const }}>Avg Yearly</th>
                    <th style={{ ...styles.th, textAlign: "center" as const }}>Retention</th>
                    <th style={{ ...styles.th, textAlign: "center" as const }}>Manual</th>
                  </tr>
                </thead>
                <tbody>
                  {tierDistribution.map((tier) => (
                    <tr key={tier.tierId}>
                      <td style={styles.td}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{
                            width: "12px",
                            height: "12px",
                            borderRadius: "3px",
                            backgroundColor: tier.color
                          }} />
                          <strong>{tier.displayName}</strong>
                          <span style={{ color: "#666", fontSize: "12px" }}>
                            ({tier.cashbackPercent}%)
                          </span>
                        </div>
                      </td>
                      <td style={{ ...styles.td, textAlign: "center" as const }}>
                        {tier.memberCount} ({tier.percentage}%)
                      </td>
                      <td style={{ ...styles.td, textAlign: "right" as const }}>
                        {tier.minSpend ? `$${tier.minSpend.toFixed(0)}` : '-'}
                      </td>
                      <td style={{ ...styles.td, textAlign: "right" as const }}>
                        ${tier.avgSpending.toFixed(0)}
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
                {metrics.manualAssignments > 0 && (
                  <div>
                    <span style={{ ...styles.badge, ...styles.infoBadge }}>
                      {metrics.manualAssignments} manual assignments active
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

        {/* Order Trends */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>Order Trends (7 Days)</h2>
          </div>
          
          <div style={styles.chartSection}>
            {/* Orders Chart */}
            <div style={{ marginBottom: "32px" }}>
              <h3 style={{ fontSize: "14px", fontWeight: "500", color: "#666", marginBottom: "12px" }}>
                Daily Orders
              </h3>
              <div style={styles.chartContainer}>
                {engagementMetrics.daily.map((day, index) => {
                  const height = maxDailyOrders > 0 ? (day.orders / maxDailyOrders) * 100 : 0;
                  return (
                    <div key={index} style={styles.chartBarWrapper}>
                      <div
                        style={{
                          ...styles.chartBar,
                          height: `${height}%`,
                          opacity: day.orders === 0 ? 0.3 : 1,
                          backgroundColor: day.orders === 0 ? "#e5e7eb" : "#3b82f6"
                        }}
                        title={`${day.orders} orders`}
                      >
                        <span style={styles.chartValue}>
                          {day.orders}
                        </span>
                      </div>
                      <div style={styles.chartLabel}>
                        {day.date}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Revenue Chart */}
            <div>
              <h3 style={{ fontSize: "14px", fontWeight: "500", color: "#666", marginBottom: "12px" }}>
                Daily Revenue
              </h3>
              <div style={styles.chartContainer}>
                {engagementMetrics.daily.map((day, index) => {
                  const height = maxDailyRevenue > 0 ? (day.revenue / maxDailyRevenue) * 100 : 0;
                  return (
                    <div key={index} style={styles.chartBarWrapper}>
                      <div
                        style={{
                          ...styles.chartBar,
                          height: `${height}%`,
                          opacity: day.revenue === 0 ? 0.3 : 1,
                          backgroundColor: day.revenue === 0 ? "#e5e7eb" : "#10b981"
                        }}
                        title={`$${day.revenue.toFixed(2)}`}
                      >
                        <span style={styles.chartValue}>
                          ${day.revenue >= 1000 
                            ? `${(day.revenue / 1000).toFixed(1)}k` 
                            : day.revenue.toFixed(0)}
                        </span>
                      </div>
                      <div style={styles.chartLabel}>
                        {day.date}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
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
                        <span style={{ fontSize: "12px", color: "#666" }}>
                          {customer.currentTier}
                        </span>
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

        {/* Upgrade Opportunities */}
        {upgradeOpportunities.length > 0 && (
          <div style={{ ...styles.card, ...styles.fullWidthSection }}>
            <div style={styles.cardHeader}>
              <h2 style={styles.cardTitle}>Upgrade Opportunities</h2>
              <span style={{ fontSize: "14px", color: "#666" }}>
                Customers close to tier upgrades
              </span>
            </div>
            
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Customer</th>
                  <th style={styles.th}>Current Tier</th>
                  <th style={styles.th}>Next Tier</th>
                  <th style={{ ...styles.th, textAlign: "right" as const }}>Current Spend</th>
                  <th style={{ ...styles.th, textAlign: "right" as const }}>Remaining</th>
                  <th style={{ ...styles.th, textAlign: "center" as const }}>Progress</th>
                  <th style={{ ...styles.th, textAlign: "center" as const }}>Est. Days</th>
                </tr>
              </thead>
              <tbody>
                {upgradeOpportunities.slice(0, 5).map((opp) => (
                  <tr key={opp.customerId}>
                    <td style={styles.td}>
                      <div style={{ fontWeight: "500" }}>{opp.customerEmail}</div>
                    </td>
                    <td style={styles.td}>{opp.currentTier}</td>
                    <td style={styles.td}>
                      <strong>{opp.nextTier}</strong>
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" as const }}>
                      ${opp.currentSpending.toFixed(0)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" as const }}>
                      ${opp.remainingAmount.toFixed(0)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "center" as const }}>
                      <div style={{ 
                        width: "100px", 
                        height: "6px", 
                        backgroundColor: "#e5e7eb", 
                        borderRadius: "3px",
                        margin: "0 auto",
                        position: "relative" as const,
                        overflow: "hidden"
                      }}>
                        <div style={{
                          position: "absolute" as const,
                          left: 0,
                          top: 0,
                          height: "100%",
                          width: `${opp.percentageToNext}%`,
                          backgroundColor: "#3b82f6",
                          borderRadius: "3px",
                          transition: "width 0.3s ease"
                        }} />
                      </div>
                      <span style={{ fontSize: "11px", color: "#666" }}>
                        {opp.percentageToNext}%
                      </span>
                    </td>
                    <td style={{ ...styles.td, textAlign: "center" as const }}>
                      {opp.estimatedDaysToUpgrade ? (
                        <span style={{ ...styles.badge, ...styles.infoBadge }}>
                          ~{opp.estimatedDaysToUpgrade}d
                        </span>
                      ) : (
                        <span style={{ color: "#999" }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}