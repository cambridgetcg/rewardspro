// app/routes/app.customers.$id.tsx
// Customer detail page showing tier info
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getCustomerTierInfo } from "../services/customer-tier.server";
import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const customerId = params.id;
  const shopDomain = session.shop;
  
  if (!customerId) {
    throw new Response("Customer ID required", { status: 400 });
  }
  
  // Get customer details with transactions
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      transactions: {
        where: {
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      }
    }
  });
  
  if (!customer || customer.shopDomain !== shopDomain) {
    throw new Response("Customer not found", { status: 404 });
  }
  
  const tierInfo = await getCustomerTierInfo(customerId, shopDomain);
  
  // Calculate additional stats
  const totalTransactions = await prisma.cashbackTransaction.count({
    where: { customerId }
  });
  
  const lifetimeStats = await prisma.cashbackTransaction.aggregate({
    where: {
      customerId,
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    },
    _sum: {
      orderAmount: true,
      cashbackAmount: true
    },
    _avg: {
      orderAmount: true
    }
  });
  
  return json({ 
    customer,
    tierInfo,
    stats: {
      totalTransactions,
      lifetimeSpending: lifetimeStats._sum.orderAmount || 0,
      lifetimeCashback: lifetimeStats._sum.cashbackAmount || 0,
      averageOrderValue: lifetimeStats._avg.orderAmount || 0
    }
  });
}

export default function CustomerDetail() {
  const { customer, tierInfo, stats } = useLoaderData<typeof loader>();
  
  // Helper function to get tier icon
  const getTierIcon = (cashbackPercent: number) => {
    if (cashbackPercent >= 10) return "👑";
    if (cashbackPercent >= 7) return "⭐";
    if (cashbackPercent >= 5) return "✨";
    return "";
  };

  const styles = {
    container: {
      maxWidth: "1000px",
      margin: "0 auto",
      padding: "32px 24px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: "#1a1a1a",
      backgroundColor: "#ffffff",
      minHeight: "100vh"
    },
    backLink: {
      color: "#666",
      textDecoration: "none",
      fontSize: "14px",
      marginBottom: "24px",
      display: "inline-block",
      transition: "color 0.2s"
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
      margin: 0
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "24px",
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
      margin: "0 0 20px 0",
      color: "#1a1a1a"
    },
    tierCard: {
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      color: "white",
      padding: "32px",
      borderRadius: "12px",
      textAlign: "center" as const,
      boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
    },
    tierIcon: {
      fontSize: "48px",
      marginBottom: "16px"
    },
    tierName: {
      fontSize: "28px",
      fontWeight: "600",
      margin: "0 0 8px 0"
    },
    tierSubtext: {
      fontSize: "18px",
      opacity: 0.9,
      margin: "0 0 16px 0"
    },
    tierMeta: {
      fontSize: "14px",
      opacity: 0.8
    },
    statGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: "16px",
      marginBottom: "20px"
    },
    stat: {
      textAlign: "center" as const,
      padding: "16px",
      backgroundColor: "#f8f9fa",
      borderRadius: "8px"
    },
    statValue: {
      fontSize: "24px",
      fontWeight: "600",
      color: "#1a1a1a",
      margin: "0 0 4px 0"
    },
    statLabel: {
      fontSize: "12px",
      color: "#666",
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px"
    },
    progressBar: {
      backgroundColor: "#e0e0e0",
      height: "24px",
      borderRadius: "12px",
      overflow: "hidden",
      marginBottom: "16px",
      position: "relative" as const
    },
    progressFill: {
      backgroundColor: "#10B981",
      height: "100%",
      transition: "width 0.5s ease",
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      paddingRight: "12px"
    },
    progressText: {
      fontSize: "12px",
      fontWeight: "600",
      color: "white"
    },
    progressInfo: {
      textAlign: "center" as const,
      marginBottom: "8px"
    },
    transactionTable: {
      width: "100%",
      borderCollapse: "collapse" as const
    },
    tableHeader: {
      textAlign: "left" as const,
      padding: "12px",
      borderBottom: "2px solid #e0e0e0",
      fontSize: "12px",
      fontWeight: "600",
      color: "#666",
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px"
    },
    tableCell: {
      padding: "12px",
      borderBottom: "1px solid #f0f0f0",
      fontSize: "14px"
    },
    emptyState: {
      textAlign: "center" as const,
      padding: "40px",
      color: "#999"
    },
    badge: {
      display: "inline-block",
      padding: "4px 8px",
      borderRadius: "4px",
      fontSize: "12px",
      fontWeight: "500"
    },
    successBadge: {
      backgroundColor: "#e8f5e9",
      color: "#2e7d32"
    }
  };

  return (
    <div style={styles.container}>
      <Link 
        to="/app/customers/tiers" 
        style={styles.backLink}
        onMouseOver={(e) => e.currentTarget.style.color = '#1a1a1a'}
        onMouseOut={(e) => e.currentTarget.style.color = '#666'}
      >
        ← Back to Customers
      </Link>

      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>{customer.email}</h1>
        <p style={styles.subtitle}>Customer ID: {customer.shopifyCustomerId}</p>
      </div>

      {/* Tier Status Card */}
      {tierInfo ? (
        <div style={styles.tierCard}>
          <div style={styles.tierIcon}>
            {getTierIcon(tierInfo.membership.tier.cashbackPercent)}
          </div>
          <h2 style={styles.tierName}>{tierInfo.membership.tier.name} Member</h2>
          <p style={styles.tierSubtext}>{tierInfo.membership.tier.cashbackPercent}% Cashback</p>
          <p style={styles.tierMeta}>
            Member since {new Date(tierInfo.membership.startDate).toLocaleDateString()} • 
            {tierInfo.membership.tier.evaluationPeriod === 'LIFETIME' ? ' Lifetime tier' : ' 12-month evaluation'}
          </p>
        </div>
      ) : (
        <div style={styles.card}>
          <p style={styles.emptyState}>No tier assigned</p>
        </div>
      )}

      {/* Stats and Progress Grid */}
      <div style={styles.grid}>
        {/* Customer Stats */}
        <div 
          style={styles.card}
          onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
          onMouseOut={(e) => e.currentTarget.style.boxShadow = 'none'}
        >
          <h3 style={styles.cardTitle}>Customer Statistics</h3>
          <div style={styles.statGrid}>
            <div style={styles.stat}>
              <p style={styles.statValue}>${stats.lifetimeSpending.toFixed(2)}</p>
              <p style={styles.statLabel}>Lifetime Spending</p>
            </div>
            <div style={styles.stat}>
              <p style={styles.statValue}>${stats.lifetimeCashback.toFixed(2)}</p>
              <p style={styles.statLabel}>Total Earned</p>
            </div>
            <div style={styles.stat}>
              <p style={styles.statValue}>${customer.storeCredit.toFixed(2)}</p>
              <p style={styles.statLabel}>Store Credit</p>
            </div>
            <div style={styles.stat}>
              <p style={styles.statValue}>{stats.totalTransactions}</p>
              <p style={styles.statLabel}>Total Orders</p>
            </div>
          </div>
          <div style={{ ...styles.stat, marginTop: "16px" }}>
            <p style={styles.statValue}>${stats.averageOrderValue.toFixed(2)}</p>
            <p style={styles.statLabel}>Average Order Value</p>
          </div>
        </div>

        {/* Tier Progress */}
        <div 
          style={styles.card}
          onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
          onMouseOut={(e) => e.currentTarget.style.boxShadow = 'none'}
        >
          <h3 style={styles.cardTitle}>Tier Progress</h3>
          {tierInfo?.progressInfo ? (
            <>
              <p style={styles.progressInfo}>
                Progress to <strong>{tierInfo.progressInfo.nextTier.name}</strong> 
                {' '}({tierInfo.progressInfo.nextTier.cashbackPercent}% cashback)
              </p>
              <div style={styles.progressBar}>
                <div 
                  style={{
                    ...styles.progressFill,
                    width: `${Math.min(tierInfo.progressInfo.progressPercentage, 100)}%`
                  }}
                >
                  {tierInfo.progressInfo.progressPercentage >= 10 && (
                    <span style={styles.progressText}>
                      {tierInfo.progressInfo.progressPercentage.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
              <p style={{ textAlign: "center", marginBottom: "8px" }}>
                <strong>${tierInfo.progressInfo.currentSpending.toFixed(2)}</strong> of{' '}
                <strong>${tierInfo.progressInfo.requiredSpending.toFixed(2)}</strong>
              </p>
              <p style={{ textAlign: "center", color: "#666", fontSize: "14px" }}>
                Spend <strong>${tierInfo.progressInfo.remainingSpending.toFixed(2)}</strong> more to unlock{' '}
                {getTierIcon(tierInfo.progressInfo.nextTier.cashbackPercent)} {tierInfo.progressInfo.nextTier.name}
              </p>
              {tierInfo.progressInfo.nextTier.evaluationPeriod === 'ANNUAL' && (
                <p style={{ textAlign: "center", color: "#999", fontSize: "12px", marginTop: "8px" }}>
                  Based on last 12 months spending
                </p>
              )}
            </>
          ) : (
            <p style={styles.emptyState}>
              {tierInfo ? "Already at highest tier! 🎉" : "No tier information available"}
            </p>
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div 
        style={styles.card}
        onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
        onMouseOut={(e) => e.currentTarget.style.boxShadow = 'none'}
      >
        <h3 style={styles.cardTitle}>Recent Transactions</h3>
        {customer.transactions.length > 0 ? (
          <><table style={styles.transactionTable}>
            <thead>
              <tr>
                <th style={styles.tableHeader}>Date</th>
                <th style={styles.tableHeader}>Order ID</th>
                <th style={{ ...styles.tableHeader, textAlign: "right" as const }}>Amount</th>
                <th style={{ ...styles.tableHeader, textAlign: "right" as const }}>Cashback</th>
                <th style={{ ...styles.tableHeader, textAlign: "center" as const }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {customer.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td style={styles.tableCell}>
                    {new Date(transaction.createdAt).toLocaleDateString()}
                  </td>
                  <td style={styles.tableCell}>
                    {transaction.shopifyOrderId}
                  </td>
                  <td style={{ ...styles.tableCell, textAlign: "right" as const }}>
                    ${transaction.orderAmount.toFixed(2)}
                  </td>
                  <td style={{ ...styles.tableCell, textAlign: "right" as const }}>
                    ${transaction.cashbackAmount.toFixed(2)}
                  </td>
                  <td style={{ ...styles.tableCell, textAlign: "center" as const }}>
                    <span style={{ ...styles.badge, ...styles.successBadge }}>
                      {transaction.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table><p style={{ textAlign: "center", marginTop: "16px", fontSize: "14px", color: "#666" }}>
              Showing last 10 transactions
            </p></>
        ) : (
          <p style={styles.emptyState}>No transactions yet</p>
        )}
      </div>
    </div>
  );
}