// app/routes/app.customers.tiers.tsx
// Admin page to view and manage customer tiers
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation, useActionData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";
import { assignTierManually, evaluateCustomerTier } from "../services/customer-tier.server";
import { useState, useEffect } from "react";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  // Get the shop domain from the session
  const shopDomain = session.shop;
  
  // Get all customers for this shop with their current tier
  const customers = await prisma.customer.findMany({
    where: { shopDomain },
    include: {
      membershipHistory: {
        where: { isActive: true },
        include: { tier: true }
      },
      transactions: {
        where: {
          createdAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) }, // Last year
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Get all tiers for this shop for the dropdown - order by cashback descending
  const tiers = await prisma.tier.findMany({
    where: { 
      shopDomain,
      isActive: true 
    },
    orderBy: { cashbackPercent: 'desc' } // Highest cashback first
  });

  // Calculate annual spending for each customer
  const customersWithSpending = customers.map(customer => {
    const annualSpending = customer.transactions.reduce((sum, t) => sum + t.orderAmount, 0);
    const currentMembership = customer.membershipHistory[0];
    
    return {
      id: customer.id,
      email: customer.email,
      shopifyCustomerId: customer.shopifyCustomerId,
      currentTier: currentMembership?.tier,
      annualSpending,
      totalEarned: customer.totalEarned,
      storeCredit: customer.storeCredit,
      createdAt: customer.createdAt
    };
  });

  // Get statistics
  const totalCashbackIssued = await prisma.cashbackTransaction.aggregate({
    where: { shopDomain },
    _sum: { cashbackAmount: true }
  });

  const averageOrderValue = customers.length > 0
    ? customersWithSpending.reduce((sum, c) => sum + c.annualSpending, 0) / customers.length
    : 0;

  return json({ 
    customers: customersWithSpending, 
    tiers,
    stats: {
      totalCustomers: customers.length,
      totalCashbackIssued: totalCashbackIssued._sum.cashbackAmount || 0,
      averageOrderValue
    }
  });
}

// Define action response type
type ActionResponse = 
  | { success: true; message?: string; error?: never }
  | { success: false; error: string; message?: never };

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  const formData = await request.formData();
  const action = formData.get("_action");
  const customerId = formData.get("customerId") as string;
  
  try {
    if (action === "assignTier") {
      const tierId = formData.get("tierId") as string;
      await assignTierManually(customerId, tierId, shopDomain);
      return json<ActionResponse>({ success: true, message: "Tier assigned successfully" });
    } else if (action === "evaluateTier") {
      await evaluateCustomerTier(customerId, shopDomain);
      return json<ActionResponse>({ success: true, message: "Customer tier evaluated" });
    } else if (action === "evaluateAll") {
      // Evaluate all customers for this shop
      const customers = await prisma.customer.findMany({
        where: { shopDomain }
      });
      for (const customer of customers) {
        await evaluateCustomerTier(customer.id, shopDomain);
      }
      return json<ActionResponse>({ success: true, message: `Evaluated ${customers.length} customers` });
    }
  } catch (error) {
    return json<ActionResponse>({ 
      success: false, 
      error: error instanceof Error ? error.message : "An error occurred" 
    }, { status: 500 });
  }
  
  return json<ActionResponse>({ success: true });
}

export default function CustomerTiers() {
  const { customers, tiers, stats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const isSubmitting = navigation.state === "submitting";

  // Show notifications from action data
  useEffect(() => {
    if (actionData) {
      if ('success' in actionData && actionData.success) {
        setNotification({ type: 'success', message: actionData.message || 'Operation successful' });
        setTimeout(() => setNotification(null), 5000);
      } else if ('error' in actionData && actionData.error) {
        setNotification({ type: 'error', message: actionData.error });
        setTimeout(() => setNotification(null), 5000);
      }
    }
  }, [actionData]);

  // Filter customers based on search and tier
  const filteredCustomers = customers.filter(customer => {
    const matchesSearch = customer.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.shopifyCustomerId.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesTier = tierFilter === "all" || 
      (tierFilter === "no-tier" && !customer.currentTier) ||
      (customer.currentTier?.id === tierFilter);
    
    return matchesSearch && matchesTier;
  });

  // Helper function to get tier icon
  const getTierIcon = (cashbackPercent: number) => {
    if (cashbackPercent >= 10) return "👑";
    if (cashbackPercent >= 7) return "⭐";
    if (cashbackPercent >= 5) return "✨";
    return "";
  };

  const styles = {
    container: {
      maxWidth: "1200px",
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
    statsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      gap: "24px",
      marginBottom: "40px"
    },
    statCard: {
      backgroundColor: "#f8f9fa",
      padding: "24px",
      borderRadius: "12px",
      textAlign: "center" as const
    },
    statValue: {
      fontSize: "32px",
      fontWeight: "600",
      margin: "0 0 4px 0",
      color: "#1a1a1a"
    },
    statLabel: {
      fontSize: "14px",
      color: "#666",
      margin: 0
    },
    sectionHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "24px",
      gap: "16px",
      flexWrap: "wrap" as const
    },
    sectionTitle: {
      fontSize: "20px",
      fontWeight: "600",
      margin: 0,
      color: "#1a1a1a"
    },
    actionButton: {
      padding: "10px 20px",
      backgroundColor: "#1a1a1a",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "opacity 0.2s"
    },
    searchInput: {
      padding: "10px 14px",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "15px",
      backgroundColor: "white",
      transition: "border-color 0.2s",
      outline: "none",
      minWidth: "250px"
    },
    filterSelect: {
      padding: "10px 14px",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "15px",
      backgroundColor: "white",
      cursor: "pointer",
      minWidth: "180px"
    },
    customerCard: {
      backgroundColor: "white",
      padding: "24px",
      marginBottom: "16px",
      borderRadius: "12px",
      border: "1px solid #e0e0e0",
      transition: "box-shadow 0.2s"
    },
    customerHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: "16px",
      flexWrap: "wrap" as const,
      gap: "16px"
    },
    customerInfo: {
      flex: 1
    },
    customerEmail: {
      fontSize: "18px",
      fontWeight: "600",
      margin: "0 0 4px 0",
      color: "#1a1a1a"
    },
    customerId: {
      fontSize: "14px",
      color: "#666"
    },
    tierBadge: {
      fontSize: "14px",
      padding: "6px 16px",
      borderRadius: "20px",
      fontWeight: "500",
      backgroundColor: "#e8f5e9",
      color: "#2e7d32",
      display: "flex",
      alignItems: "center",
      gap: "4px"
    },
    noTierBadge: {
      fontSize: "14px",
      padding: "6px 16px",
      borderRadius: "20px",
      fontWeight: "500",
      backgroundColor: "#f5f5f5",
      color: "#999"
    },
    metricsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      gap: "16px",
      marginBottom: "20px"
    },
    metric: {
      textAlign: "center" as const
    },
    metricValue: {
      fontSize: "20px",
      fontWeight: "600",
      color: "#1a1a1a",
      margin: "0 0 4px 0"
    },
    metricLabel: {
      fontSize: "12px",
      color: "#666",
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px"
    },
    actionRow: {
      display: "flex",
      gap: "12px",
      alignItems: "center",
      flexWrap: "wrap" as const
    },
    primaryButton: {
      padding: "8px 16px",
      backgroundColor: "#3B82F6",
      color: "white",
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "opacity 0.2s"
    },
    secondaryButton: {
      padding: "8px 16px",
      backgroundColor: "#8B5CF6",
      color: "white",
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "opacity 0.2s"
    },
    select: {
      padding: "8px 12px",
      borderRadius: "6px",
      border: "1px solid #e0e0e0",
      fontSize: "14px",
      backgroundColor: "white",
      cursor: "pointer",
      minWidth: "150px"
    },
    notification: {
      padding: "16px 20px",
      borderRadius: "8px",
      marginBottom: "24px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    },
    successNotification: {
      backgroundColor: "#e8f5e9",
      color: "#2e7d32",
      border: "1px solid #c8e6c9"
    },
    errorNotification: {
      backgroundColor: "#ffebee",
      color: "#c62828",
      border: "1px solid #ffcdd2"
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
    filterInfo: {
      fontSize: "14px",
      color: "#666",
      marginBottom: "16px"
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Customer Tier Management</h1>
        <p style={styles.subtitle}>Manage customer tiers and track their loyalty progress</p>
      </div>

      {/* Notification */}
      {notification && (
        <div style={{
          ...styles.notification,
          ...(notification.type === 'success' ? styles.successNotification : styles.errorNotification)
        }}>
          <span>{notification.message}</span>
          <button 
            onClick={() => setNotification(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}
          >
            ×
          </button>
        </div>
      )}

      {/* Stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <h3 style={styles.statValue}>{stats.totalCustomers}</h3>
          <p style={styles.statLabel}>Total Customers</p>
        </div>
        <div style={styles.statCard}>
          <h3 style={styles.statValue}>${stats.totalCashbackIssued.toFixed(2)}</h3>
          <p style={styles.statLabel}>Total Cashback Issued</p>
        </div>
        <div style={styles.statCard}>
          <h3 style={styles.statValue}>${stats.averageOrderValue.toFixed(2)}</h3>
          <p style={styles.statLabel}>Average Annual Spending</p>
        </div>
      </div>

      {/* Actions and Search */}
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Customers</h2>
        <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search by email or customer ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
            onFocus={(e) => e.currentTarget.style.borderColor = '#1a1a1a'}
            onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
          />
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            style={styles.filterSelect}
            onFocus={(e) => e.currentTarget.style.borderColor = '#1a1a1a'}
            onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
          >
            <option value="all">All Tiers</option>
            <option value="no-tier">No Tier</option>
            {tiers.map(tier => (
              <option key={tier.id} value={tier.id}>
                {tier.name} ({tier.cashbackPercent}%)
              </option>
            ))}
          </select>
          <Form method="post">
            <input type="hidden" name="_action" value="evaluateAll" />
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                ...styles.actionButton,
                opacity: isSubmitting ? 0.6 : 1,
                cursor: isSubmitting ? "not-allowed" : "pointer"
              }}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.8'}
              onMouseOut={(e) => e.currentTarget.style.opacity = isSubmitting ? '0.6' : '1'}
            >
              {isSubmitting ? "Evaluating..." : "Re-evaluate All"}
            </button>
          </Form>
        </div>
      </div>

      {/* Filter info */}
      {(searchTerm || tierFilter !== "all") && (
        <p style={styles.filterInfo}>
          Showing {filteredCustomers.length} of {customers.length} customers
          {tierFilter !== "all" && tierFilter !== "no-tier" && 
            ` in ${tiers.find(t => t.id === tierFilter)?.name || "selected"} tier`}
          {tierFilter === "no-tier" && " with no tier assigned"}
        </p>
      )}

      {/* Customer List */}
      <div>
        {filteredCustomers.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyStateTitle}>
              {searchTerm || tierFilter !== "all" ? "No customers found" : "No customers yet"}
            </h3>
            <p style={styles.emptyStateText}>
              {searchTerm || tierFilter !== "all"
                ? "Try adjusting your filters" 
                : "Customers will appear here after their first order"}
            </p>
          </div>
        ) : (
          filteredCustomers.map((customer) => (
            <div 
              key={customer.id} 
              style={styles.customerCard}
              onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
              onMouseOut={(e) => e.currentTarget.style.boxShadow = 'none'}
            >
              <div style={styles.customerHeader}>
                <div style={styles.customerInfo}>
                  <h3 style={styles.customerEmail}>{customer.email}</h3>
                  <p style={styles.customerId}>Customer ID: {customer.shopifyCustomerId}</p>
                </div>
                {customer.currentTier ? (
                  <div style={styles.tierBadge}>
                    <span>{getTierIcon(customer.currentTier.cashbackPercent)}</span>
                    {customer.currentTier.name} • {customer.currentTier.cashbackPercent}% cashback
                  </div>
                ) : (
                  <div style={styles.noTierBadge}>No tier assigned</div>
                )}
              </div>

              <div style={styles.metricsGrid}>
                <div style={styles.metric}>
                  <p style={styles.metricValue}>${customer.annualSpending.toFixed(2)}</p>
                  <p style={styles.metricLabel}>Annual Spending</p>
                </div>
                <div style={styles.metric}>
                  <p style={styles.metricValue}>${customer.totalEarned.toFixed(2)}</p>
                  <p style={styles.metricLabel}>Total Earned</p>
                </div>
                <div style={styles.metric}>
                  <p style={styles.metricValue}>${customer.storeCredit.toFixed(2)}</p>
                  <p style={styles.metricLabel}>Store Credit</p>
                </div>
                <div style={styles.metric}>
                  <p style={styles.metricValue}>
                    {new Date(customer.createdAt).toLocaleDateString()}
                  </p>
                  <p style={styles.metricLabel}>Member Since</p>
                </div>
              </div>

              <div style={styles.actionRow}>
                <Form method="post" style={{ display: "inline" }}>
                  <input type="hidden" name="_action" value="evaluateTier" />
                  <input type="hidden" name="customerId" value={customer.id} />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    style={{
                      ...styles.primaryButton,
                      opacity: isSubmitting ? 0.6 : 1,
                      cursor: isSubmitting ? "not-allowed" : "pointer"
                    }}
                    onMouseOver={(e) => e.currentTarget.style.opacity = '0.8'}
                    onMouseOut={(e) => e.currentTarget.style.opacity = isSubmitting ? '0.6' : '1'}
                  >
                    Re-evaluate Tier
                  </button>
                </Form>
                
                <Form method="post" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input type="hidden" name="_action" value="assignTier" />
                  <input type="hidden" name="customerId" value={customer.id} />
                  <select
                    name="tierId"
                    required
                    style={styles.select}
                    onFocus={(e) => e.currentTarget.style.borderColor = '#1a1a1a'}
                    onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                  >
                    <option value="">Select tier...</option>
                    {tiers.map(tier => (
                      <option key={tier.id} value={tier.id}>
                        {getTierIcon(tier.cashbackPercent)} {tier.name} ({tier.cashbackPercent}%)
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    style={{
                      ...styles.secondaryButton,
                      opacity: isSubmitting ? 0.6 : 1,
                      cursor: isSubmitting ? "not-allowed" : "pointer"
                    }}
                    onMouseOver={(e) => e.currentTarget.style.opacity = '0.8'}
                    onMouseOut={(e) => e.currentTarget.style.opacity = isSubmitting ? '0.6' : '1'}
                  >
                    Assign Tier
                  </button>
                </Form>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}