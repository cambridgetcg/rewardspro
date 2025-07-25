// app/routes/app.customers.$id.v2.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, useActionData, Form, useNavigation, useSubmit, useNavigate } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getCustomerTierInfo } from "../services/customer-tier.server";
import prisma from "../db.server";
import { TransactionStatus, type LedgerEntryType, type LedgerSource } from "@prisma/client";
import { useState, useEffect } from "react";

interface StoreCreditAccount {
  id: string;
  balance: {
    amount: string;
    currencyCode: string;
  };
}

interface CustomerTierInfo {
  membership: {
    tier: {
      name: string;
      cashbackPercent: number;
      evaluationPeriod: string;
    };
    startDate: string;
  };
  progressInfo?: {
    currentSpending: number;
    requiredSpending: number;
    remainingSpending: number;
    progressPercentage: number;
    nextTier: {
      name: string;
      cashbackPercent: number;
      evaluationPeriod: string;
    };
  };
}

type ActionResponse = 
  | { success: true; message: string; oldBalance: number; newBalance: number; accountCount: number }
  | { success: false; error: string };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
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
        take: 20
      },
      creditLedger: {
        orderBy: { createdAt: 'desc' },
        take: 20
      }
    }
  });
  
  if (!customer || customer.shopDomain !== shopDomain) {
    throw new Response("Customer not found", { status: 404 });
  }
  
  // Get tier information
  const tierInfo = await getCustomerTierInfo(customerId, shopDomain);
  
  // Calculate statistics
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
    },
    _count: true
  });
  
  // Get store credit accounts from Shopify
  let storeCreditAccounts: StoreCreditAccount[] = [];
  let shopifyError: string | null = null;
  
  try {
    const query = `#graphql
      query getCustomerStoreCredit($customerId: ID!) {
        customer(id: $customerId) {
          id
          displayName
          email
          storeCreditAccounts(first: 10) {
            edges {
              node {
                id
                balance {
                  amount
                  currencyCode
                }
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      }
    `;
    
    const response = await admin.graphql(query, {
      variables: {
        customerId: `gid://shopify/Customer/${customer.shopifyCustomerId}`
      }
    });
    
    const result = await response.json();
    
    if (result.data?.customer?.storeCreditAccounts?.edges) {
      storeCreditAccounts = result.data.customer.storeCreditAccounts.edges.map((edge: any) => edge.node);
    }
  } catch (error) {
    console.error("Failed to fetch store credit accounts:", error);
    shopifyError = "Failed to load store credit accounts from Shopify";
  }
  
  // Calculate total store credit across all currencies (simplified conversion)
  const totalStoreCreditUSD = storeCreditAccounts.reduce((sum, account) => {
    const amount = parseFloat(account.balance.amount);
    const rate = account.balance.currencyCode === 'USD' ? 1 : 
                account.balance.currencyCode === 'CAD' ? 0.75 : 
                account.balance.currencyCode === 'EUR' ? 1.1 : 
                account.balance.currencyCode === 'GBP' ? 1.25 : 1;
    return sum + (amount * rate);
  }, 0);
  
  return json({ 
    customer,
    tierInfo,
    stats: {
      totalTransactions,
      lifetimeSpending: lifetimeStats._sum.orderAmount || 0,
      lifetimeCashback: lifetimeStats._sum.cashbackAmount || 0,
      averageOrderValue: lifetimeStats._avg.orderAmount || 0,
      transactionCount: lifetimeStats._count
    },
    storeCreditAccounts,
    totalStoreCreditUSD,
    shopifyError,
    shopDomain
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const customerId = params.id;
  
  if (!customerId) {
    return json<ActionResponse>({ success: false, error: "Customer ID required" });
  }
  
  const formData = await request.formData();
  const actionType = formData.get("actionType");
  
  if (actionType === "sync") {
    try {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId }
      });
      
      if (!customer || customer.shopDomain !== session.shop) {
        return json<ActionResponse>({ success: false, error: "Customer not found" });
      }
      
      // Query Shopify for all store credit accounts
      const query = `#graphql
        query getCustomerStoreCredit($customerId: ID!) {
          customer(id: $customerId) {
            id
            email
            storeCreditAccounts(first: 10) {
              edges {
                node {
                  id
                  balance {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      `;
      
      const response = await admin.graphql(query, {
        variables: {
          customerId: `gid://shopify/Customer/${customer.shopifyCustomerId}`
        }
      });
      
      const result = await response.json();
      
      if (result.data?.customer?.storeCreditAccounts?.edges) {
        const accounts = result.data.customer.storeCreditAccounts.edges;
        
        // Calculate total balance (simplified - assumes single currency for now)
        let totalBalance = 0;
        const accountDetails = [];
        
        for (const edge of accounts) {
          const amount = parseFloat(edge.node.balance.amount);
          totalBalance += amount;
          accountDetails.push({
            id: edge.node.id,
            amount: amount,
            currency: edge.node.balance.currencyCode
          });
        }
        
        const currentBalance = customer.storeCredit;
        
        // Update database with transaction
        const syncResult = await prisma.$transaction(async (tx) => {
          // Only create ledger entry if balance changed
          if (Math.abs(totalBalance - currentBalance) > 0.01) {
            await tx.storeCreditLedger.create({
              data: {
                customerId: customer.id,
                shopDomain: session.shop,
                amount: totalBalance - currentBalance,
                balance: totalBalance,
                type: 'SHOPIFY_SYNC',
                source: 'SHOPIFY_ADMIN',
                description: `Manual sync: ${accountDetails.length} account(s) found. Balance updated from $${currentBalance.toFixed(2)} to $${totalBalance.toFixed(2)}`,
                reconciledAt: new Date()
              }
            });
          }
          
          // Always update sync time
          const updatedCustomer = await tx.customer.update({
            where: { id: customerId },
            data: {
              storeCredit: totalBalance,
              lastSyncedAt: new Date()
            }
          });
          
          return {
            oldBalance: currentBalance,
            newBalance: totalBalance,
            accountCount: accountDetails.length,
            changed: Math.abs(totalBalance - currentBalance) > 0.01
          };
        });
        
        if (syncResult.changed) {
          return json<ActionResponse>({
            success: true,
            message: `Balance synced successfully: ${syncResult.oldBalance.toFixed(2)} → ${syncResult.newBalance.toFixed(2)} (${syncResult.accountCount} account${syncResult.accountCount !== 1 ? 's' : ''})`,
            oldBalance: syncResult.oldBalance,
            newBalance: syncResult.newBalance,
            accountCount: syncResult.accountCount
          });
        } else {
          return json<ActionResponse>({
            success: true,
            message: `Balance is already up to date (${syncResult.newBalance.toFixed(2)} across ${syncResult.accountCount} account${syncResult.accountCount !== 1 ? 's' : ''})`,
            oldBalance: syncResult.oldBalance,
            newBalance: syncResult.newBalance,
            accountCount: syncResult.accountCount
          });
        }
      } else {
        // No store credit accounts found
        await prisma.$transaction(async (tx) => {
          if (customer.storeCredit !== 0) {
            await tx.storeCreditLedger.create({
              data: {
                customerId: customer.id,
                shopDomain: session.shop,
                amount: -customer.storeCredit,
                balance: 0,
                type: 'SHOPIFY_SYNC',
                source: 'RECONCILIATION',
                description: 'No store credit accounts found in Shopify',
                reconciledAt: new Date()
              }
            });
          }
          
          await tx.customer.update({
            where: { id: customerId },
            data: {
              storeCredit: 0,
              lastSyncedAt: new Date()
            }
          });
        });
        
        return json<ActionResponse>({
          success: true,
          message: "No store credit accounts found in Shopify (balance set to $0.00)",
          oldBalance: customer.storeCredit,
          newBalance: 0,
          accountCount: 0
        });
      }
    } catch (error) {
      console.error("Sync error:", error);
      return json<ActionResponse>({
        success: false,
        error: error instanceof Error ? error.message : "Failed to sync store credit"
      });
    }
  }
  
  return json<ActionResponse>({ success: false, error: "Invalid action" });
}

export default function CustomerDetailV2() {
  const { customer, tierInfo, stats, storeCreditAccounts, totalStoreCreditUSD, shopifyError, shopDomain } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const navigate = useNavigate();
  
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'ledger'>('overview');
  const [showFullLedger, setShowFullLedger] = useState(false);
  
  const isSyncing = navigation.state === "submitting";
  
  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        // TypeScript now knows this is the success type with all properties
        setNotification({ 
          type: actionData.oldBalance !== actionData.newBalance ? 'success' : 'info', 
          message: actionData.message 
        });
        setTimeout(() => setNotification(null), 5000);
      } else {
        // TypeScript now knows this is the error type
        setNotification({ type: 'error', message: actionData.error });
        setTimeout(() => setNotification(null), 5000);
      }
    }
  }, [actionData]);
  
  // Helper functions
  const getTierIcon = (cashbackPercent: number) => {
    if (cashbackPercent >= 10) return "👑";
    if (cashbackPercent >= 7) return "⭐";
    if (cashbackPercent >= 5) return "✨";
    return "";
  };
  
  const isSyncStale = () => {
    if (!customer.lastSyncedAt) return true;
    const lastSync = new Date(customer.lastSyncedAt);
    const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
    return hoursSinceSync > 24;
  };
  
  const formatLastSyncTime = () => {
    if (!customer.lastSyncedAt) return "Never synced";
    const date = new Date(customer.lastSyncedAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };
  
  const formatLedgerType = (type: LedgerEntryType) => {
    const typeMap: Record<LedgerEntryType, { label: string; color: string; icon: string }> = {
      'MANUAL_ADJUSTMENT': { label: 'Manual', color: '#1565c0', icon: '✏️' },
      'SHOPIFY_SYNC': { label: 'Sync', color: '#7b1fa2', icon: '🔄' },
      'CASHBACK_EARNED': { label: 'Cashback', color: '#2e7d32', icon: '💰' },
      'ORDER_PAYMENT': { label: 'Payment', color: '#e65100', icon: '🛒' },
      'REFUND_CREDIT': { label: 'Refund', color: '#00897b', icon: '↩️' },
      'INITIAL_IMPORT': { label: 'Import', color: '#5e35b1', icon: '📥' }
    };
    return typeMap[type] || { label: type, color: '#666', icon: '•' };
  };
  
  const formatLedgerSource = (source: LedgerSource) => {
    const sourceMap: Record<LedgerSource, { label: string; color: string }> = {
      'APP_MANUAL': { label: 'App Admin', color: '#1976d2' },
      'APP_CASHBACK': { label: 'Cashback System', color: '#388e3c' },
      'SHOPIFY_ADMIN': { label: 'Shopify Admin', color: '#7c4dff' },
      'SHOPIFY_ORDER': { label: 'Order System', color: '#f57c00' },
      'RECONCILIATION': { label: 'System Reconciliation', color: '#d32f2f' }
    };
    return sourceMap[source] || { label: source, color: '#666' };
  };
  
  const styles = {
    container: {
      maxWidth: "1200px",
      margin: "0 auto",
      padding: "32px 24px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: "#1a1a1a",
      backgroundColor: "#f8f9fa",
      minHeight: "100vh"
    },
    header: {
      backgroundColor: "white",
      padding: "32px",
      borderRadius: "12px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      marginBottom: "24px"
    },
    backLink: {
      color: "#3b82f6",
      textDecoration: "none",
      fontSize: "14px",
      fontWeight: "500",
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      marginBottom: "16px",
      transition: "color 0.2s"
    },
    headerContent: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: "24px",
      flexWrap: "wrap" as const
    },
    customerInfo: {
      flex: 1
    },
    title: {
      fontSize: "32px",
      fontWeight: "700",
      margin: "0 0 8px 0",
      color: "#1a1a1a"
    },
    subtitle: {
      fontSize: "16px",
      color: "#666",
      margin: "0 0 4px 0"
    },
    shopInfo: {
      fontSize: "14px",
      color: "#999"
    },
    headerActions: {
      display: "flex",
      gap: "12px",
      alignItems: "center"
    },
    notification: {
      padding: "16px 24px",
      borderRadius: "8px",
      marginBottom: "24px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: "15px"
    },
    successNotification: {
      backgroundColor: "#e8f5e9",
      color: "#1b5e20",
      border: "1px solid #66bb6a"
    },
    errorNotification: {
      backgroundColor: "#ffebee",
      color: "#b71c1c",
      border: "1px solid #ef5350"
    },
    infoNotification: {
      backgroundColor: "#e3f2fd",
      color: "#0d47a1",
      border: "1px solid #42a5f5"
    },
    creditCard: {
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      color: "white",
      padding: "32px",
      borderRadius: "16px",
      marginBottom: "24px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
      position: "relative" as const,
      overflow: "hidden"
    },
    creditCardBg: {
      position: "absolute" as const,
      top: 0,
      right: 0,
      fontSize: "200px",
      opacity: 0.1,
      transform: "rotate(-15deg) translate(50px, -50px)"
    },
    creditContent: {
      position: "relative" as const,
      zIndex: 1
    },
    creditHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: "24px"
    },
    creditTitle: {
      fontSize: "16px",
      opacity: 0.9,
      marginBottom: "12px",
      fontWeight: "500"
    },
    creditAmount: {
      fontSize: "48px",
      fontWeight: "700",
      margin: "0 0 16px 0",
      letterSpacing: "-1px",
      lineHeight: "1"
    },
    syncInfo: {
      fontSize: "14px",
      opacity: 0.8,
      marginBottom: "8px",
      marginTop: "4px"
    },
    syncButton: {
      backgroundColor: "rgba(255, 255, 255, 0.2)",
      color: "white",
      border: "2px solid rgba(255, 255, 255, 0.3)",
      padding: "10px 20px",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s",
      display: "inline-flex",
      alignItems: "center",
      gap: "8px"
    },
    syncWarning: {
      backgroundColor: "#fff3e0",
      color: "#e65100",
      padding: "12px 16px",
      borderRadius: "8px",
      fontSize: "14px",
      marginTop: "16px",
      display: "flex",
      alignItems: "center",
      gap: "8px"
    },
    accountsList: {
      marginTop: "24px",
      borderTop: "1px solid rgba(255, 255, 255, 0.2)",
      paddingTop: "24px"
    },
    accountsTitle: {
      fontSize: "14px",
      opacity: 0.9,
      marginBottom: "12px",
      fontWeight: "500"
    },
    accountItem: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "12px 16px",
      backgroundColor: "rgba(255, 255, 255, 0.1)",
      borderRadius: "8px",
      marginBottom: "8px",
      fontSize: "16px"
    },
    accountCurrency: {
      fontWeight: "500"
    },
    accountBalance: {
      fontWeight: "600"
    },
    accountTotal: {
      marginTop: "12px",
      paddingTop: "12px",
      borderTop: "1px solid rgba(255, 255, 255, 0.2)",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: "18px",
      fontWeight: "600"
    },
    mainContent: {
      backgroundColor: "white",
      borderRadius: "12px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      overflow: "hidden"
    },
    tabs: {
      display: "flex",
      borderBottom: "2px solid #e0e0e0",
      backgroundColor: "#fafafa"
    },
    tab: {
      padding: "16px 32px",
      backgroundColor: "transparent",
      border: "none",
      fontSize: "15px",
      fontWeight: "500",
      color: "#666",
      cursor: "pointer",
      transition: "all 0.2s",
      borderBottom: "2px solid transparent",
      marginBottom: "-2px"
    },
    activeTab: {
      color: "#3b82f6",
      borderBottomColor: "#3b82f6",
      backgroundColor: "white"
    },
    tabContent: {
      padding: "32px"
    },
    statsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      gap: "24px",
      marginBottom: "32px"
    },
    statCard: {
      textAlign: "center" as const,
      padding: "24px",
      backgroundColor: "#f8f9fa",
      borderRadius: "12px",
      transition: "transform 0.2s"
    },
    statValue: {
      fontSize: "32px",
      fontWeight: "700",
      color: "#1a1a1a",
      margin: "0 0 8px 0"
    },
    statLabel: {
      fontSize: "13px",
      color: "#666",
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px",
      fontWeight: "500"
    },
    tierSection: {
      marginBottom: "32px"
    },
    tierCard: {
      background: "linear-gradient(135deg, #f5f5f5 0%, #e0e0e0 100%)",
      padding: "32px",
      borderRadius: "12px",
      textAlign: "center" as const
    },
    tierIcon: {
      fontSize: "64px",
      marginBottom: "16px"
    },
    tierName: {
      fontSize: "28px",
      fontWeight: "700",
      margin: "0 0 8px 0",
      color: "#1a1a1a"
    },
    tierSubtext: {
      fontSize: "18px",
      color: "#666",
      margin: "0 0 16px 0"
    },
    tierMeta: {
      fontSize: "14px",
      color: "#999"
    },
    progressSection: {
      marginTop: "32px"
    },
    progressCard: {
      backgroundColor: "#f8f9fa",
      padding: "24px",
      borderRadius: "12px"
    },
    progressTitle: {
      fontSize: "18px",
      fontWeight: "600",
      marginBottom: "20px"
    },
    progressBar: {
      backgroundColor: "#e0e0e0",
      height: "32px",
      borderRadius: "16px",
      overflow: "hidden",
      marginBottom: "20px",
      position: "relative" as const
    },
    progressFill: {
      backgroundColor: "#10B981",
      height: "100%",
      transition: "width 0.5s ease",
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      paddingRight: "16px",
      position: "relative" as const
    },
    progressText: {
      fontSize: "14px",
      fontWeight: "600",
      color: "white"
    },
    progressInfo: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap" as const,
      gap: "16px"
    },
    table: {
      width: "100%",
      borderCollapse: "collapse" as const
    },
    tableHeader: {
      backgroundColor: "#f8f9fa",
      borderBottom: "2px solid #e0e0e0"
    },
    th: {
      textAlign: "left" as const,
      padding: "16px",
      fontSize: "13px",
      fontWeight: "600",
      color: "#666",
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px"
    },
    td: {
      padding: "16px",
      borderBottom: "1px solid #f0f0f0",
      fontSize: "14px"
    },
    badge: {
      display: "inline-block",
      padding: "4px 12px",
      borderRadius: "16px",
      fontSize: "12px",
      fontWeight: "500"
    },
    successBadge: {
      backgroundColor: "#e8f5e9",
      color: "#2e7d32"
    },
    pendingBadge: {
      backgroundColor: "#fff3e0",
      color: "#e65100"
    },
    emptyState: {
      textAlign: "center" as const,
      padding: "60px",
      color: "#999"
    },
    viewAllButton: {
      display: "block",
      margin: "24px auto 0",
      padding: "12px 24px",
      backgroundColor: "transparent",
      color: "#3b82f6",
      border: "2px solid #3b82f6",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    amountPositive: {
      color: "#10B981",
      fontWeight: "600"
    },
    amountNegative: {
      color: "#EF4444",
      fontWeight: "600"
    },
    ledgerType: {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px"
    },
    ledgerSource: {
      fontSize: "12px",
      padding: "2px 8px",
      borderRadius: "12px",
      fontWeight: "500"
    },
    actionButtons: {
      display: "flex",
      gap: "12px"
    },
    primaryButton: {
      padding: "10px 20px",
      backgroundColor: "#3b82f6",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    secondaryButton: {
      padding: "10px 20px",
      backgroundColor: "transparent",
      color: "#3b82f6",
      border: "2px solid #3b82f6",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    }
  };
  
  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <Link 
          to="/app/customers/credit" 
          style={styles.backLink}
          onMouseOver={(e) => e.currentTarget.style.color = '#1d4ed8'}
          onMouseOut={(e) => e.currentTarget.style.color = '#3b82f6'}
        >
          ← Back to Store Credit Management
        </Link>
        
        <div style={styles.headerContent}>
          <div style={styles.customerInfo}>
            <h1 style={styles.title}>{customer.email}</h1>
            <p style={styles.subtitle}>Customer ID: {customer.shopifyCustomerId}</p>
            <p style={styles.shopInfo}>Shop: {shopDomain}</p>
          </div>
          
          <div style={styles.headerActions}>
            <button
              onClick={() => navigate(`/app/customers/credit?customer=${customer.id}`)}
              style={styles.primaryButton}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              Manage Credit
            </button>
          </div>
        </div>
      </div>
      
      {/* Notification */}
      {notification && (
        <div style={{
          ...styles.notification,
          ...(notification.type === 'success' ? styles.successNotification : 
              notification.type === 'error' ? styles.errorNotification : 
              styles.infoNotification)
        }}>
          <span>{notification.message}</span>
          <button 
            onClick={() => setNotification(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: 'inherit' }}
          >
            ×
          </button>
        </div>
      )}
      
      {/* Store Credit Card */}
      <div style={styles.creditCard}>
        <div style={styles.creditCardBg}>💳</div>
        <div style={styles.creditContent}>
          <div style={styles.creditHeader}>
            <div>
              <p style={styles.creditTitle}>Store Credit Balance (Local)</p>
              <h2 style={styles.creditAmount}>${customer.storeCredit.toFixed(2)}</h2>
              <p style={styles.syncInfo}>
                Last synced: {formatLastSyncTime()}
              </p>
            </div>
            <Form method="post">
              <input type="hidden" name="actionType" value="sync" />
              <button
                type="submit"
                disabled={isSyncing}
                style={styles.syncButton}
                onMouseOver={(e) => {
                  if (!isSyncing) {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                {isSyncing ? (
                  <>
                    <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
                    Syncing...
                  </>
                ) : (
                  <>
                    🔄 Sync with Shopify
                  </>
                )}
              </button>
            </Form>
          </div>
          
          {isSyncStale() && (
            <div style={styles.syncWarning}>
              <span>⚠️</span>
              <span>Balance may be outdated. Consider syncing to get the latest balance from Shopify.</span>
            </div>
          )}
          
          {/* Shopify Store Credit Accounts */}
          {storeCreditAccounts.length > 0 && (
            <div style={styles.accountsList}>
              <h3 style={styles.accountsTitle}>Shopify Store Credit Accounts</h3>
              {storeCreditAccounts.map((account) => (
                <div key={account.id} style={styles.accountItem}>
                  <span style={styles.accountCurrency}>{account.balance.currencyCode}</span>
                  <span style={styles.accountBalance}>{parseFloat(account.balance.amount).toFixed(2)}</span>
                </div>
              ))}
              {storeCreditAccounts.length > 1 && (
                <div style={styles.accountTotal}>
                  <span>Total (USD equivalent)</span>
                  <span>${totalStoreCreditUSD.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
          
          {shopifyError && (
            <div style={{ ...styles.syncWarning, marginTop: '16px' }}>
              <span>⚠️</span>
              <span>{shopifyError}</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Main Content Tabs */}
      <div style={styles.mainContent}>
        <div style={styles.tabs}>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'overview' ? styles.activeTab : {})
            }}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'transactions' ? styles.activeTab : {})
            }}
            onClick={() => setActiveTab('transactions')}
          >
            Cashback Transactions ({stats.transactionCount})
          </button>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'ledger' ? styles.activeTab : {})
            }}
            onClick={() => setActiveTab('ledger')}
          >
            Credit Ledger ({customer.creditLedger.length})
          </button>
        </div>
        
        <div style={styles.tabContent}>
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              {/* Statistics */}
              <div style={styles.statsGrid}>
                <div 
                  style={styles.statCard}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  <p style={styles.statValue}>${stats.lifetimeSpending.toFixed(2)}</p>
                  <p style={styles.statLabel}>Lifetime Spending</p>
                </div>
                <div 
                  style={styles.statCard}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  <p style={styles.statValue}>${stats.lifetimeCashback.toFixed(2)}</p>
                  <p style={styles.statLabel}>Total Cashback Earned</p>
                </div>
                <div 
                  style={styles.statCard}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  <p style={styles.statValue}>{stats.totalTransactions}</p>
                  <p style={styles.statLabel}>Total Orders</p>
                </div>
                <div 
                  style={styles.statCard}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  <p style={styles.statValue}>${stats.averageOrderValue.toFixed(2)}</p>
                  <p style={styles.statLabel}>Average Order Value</p>
                </div>
              </div>
              
              {/* Tier Information */}
              {tierInfo && (
                <div style={styles.tierSection}>
                  <div style={styles.tierCard}>
                    <div style={styles.tierIcon}>
                      {getTierIcon(tierInfo.membership.tier.cashbackPercent)}
                    </div>
                    <h2 style={styles.tierName}>{tierInfo.membership.tier.name}</h2>
                    <p style={styles.tierSubtext}>{tierInfo.membership.tier.cashbackPercent}% Cashback Rate</p>
                    <p style={styles.tierMeta}>
                      Member since {new Date(tierInfo.membership.startDate).toLocaleDateString()} • 
                      {tierInfo.membership.tier.evaluationPeriod === 'LIFETIME' ? ' Lifetime tier' : ' Annual evaluation'}
                    </p>
                  </div>
                  
                  {/* Tier Progress */}
                  {tierInfo.progressInfo && (
                    <div style={styles.progressSection}>
                      <div style={styles.progressCard}>
                        <h3 style={styles.progressTitle}>
                          Progress to {tierInfo.progressInfo.nextTier.name} ({tierInfo.progressInfo.nextTier.cashbackPercent}% cashback)
                        </h3>
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
                        <div style={styles.progressInfo}>
                          <div>
                            <strong>${tierInfo.progressInfo.currentSpending.toFixed(2)}</strong> of{' '}
                            <strong>${tierInfo.progressInfo.requiredSpending.toFixed(2)}</strong> spent
                          </div>
                          <div>
                            <strong>${tierInfo.progressInfo.remainingSpending.toFixed(2)}</strong> more to unlock
                          </div>
                        </div>
                        {tierInfo.progressInfo.nextTier.evaluationPeriod === 'ANNUAL' && (
                          <p style={{ textAlign: "center", color: "#999", fontSize: "13px", marginTop: "16px" }}>
                            Based on spending in the last 12 months
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {!tierInfo.progressInfo && (
                    <div style={{ ...styles.progressSection, textAlign: "center", color: "#666" }}>
                      <p>🎉 Already at the highest tier!</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          
          {/* Transactions Tab */}
          {activeTab === 'transactions' && (
            <>
              {customer.transactions.length > 0 ? (
                <>
                  <table style={styles.table}>
                    <thead style={styles.tableHeader}>
                      <tr>
                        <th style={styles.th}>Date</th>
                        <th style={styles.th}>Order ID</th>
                        <th style={{ ...styles.th, textAlign: "right" as const }}>Order Amount</th>
                        <th style={{ ...styles.th, textAlign: "right" as const }}>Cashback %</th>
                        <th style={{ ...styles.th, textAlign: "right" as const }}>Cashback Earned</th>
                        <th style={{ ...styles.th, textAlign: "center" as const }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customer.transactions.slice(0, showFullLedger ? undefined : 10).map((transaction) => (
                        <tr key={transaction.id}>
                          <td style={styles.td}>
                            {new Date(transaction.createdAt).toLocaleDateString()}
                          </td>
                          <td style={styles.td}>
                            #{transaction.shopifyOrderId}
                          </td>
                          <td style={{ ...styles.td, textAlign: "right" as const }}>
                            ${transaction.orderAmount.toFixed(2)}
                          </td>
                          <td style={{ ...styles.td, textAlign: "right" as const }}>
                            {transaction.cashbackPercent}%
                          </td>
                          <td style={{ ...styles.td, textAlign: "right" as const, color: "#10B981", fontWeight: "600" }}>
                            +${transaction.cashbackAmount.toFixed(2)}
                          </td>
                          <td style={{ ...styles.td, textAlign: "center" as const }}>
                            <span style={{ 
                              ...styles.badge, 
                              ...(transaction.status === 'COMPLETED' || transaction.status === 'SYNCED_TO_SHOPIFY' ? styles.successBadge : styles.pendingBadge) 
                            }}>
                              {transaction.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  
                  {customer.transactions.length > 10 && !showFullLedger && (
                    <button
                      style={styles.viewAllButton}
                      onClick={() => setShowFullLedger(true)}
                      onMouseOver={(e) => {
                        e.currentTarget.style.backgroundColor = '#3b82f6';
                        e.currentTarget.style.color = 'white';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = '#3b82f6';
                      }}
                    >
                      View All {customer.transactions.length} Transactions
                    </button>
                  )}
                </>
              ) : (
                <div style={styles.emptyState}>
                  <p>No cashback transactions yet</p>
                </div>
              )}
            </>
          )}
          
          {/* Credit Ledger Tab */}
          {activeTab === 'ledger' && (
            <>
              {customer.creditLedger.length > 0 ? (
                <>
                  <table style={styles.table}>
                    <thead style={styles.tableHeader}>
                      <tr>
                        <th style={styles.th}>Date & Time</th>
                        <th style={styles.th}>Type</th>
                        <th style={styles.th}>Source</th>
                        <th style={{ ...styles.th, textAlign: "right" as const }}>Amount</th>
                        <th style={{ ...styles.th, textAlign: "right" as const }}>Balance</th>
                        <th style={styles.th}>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customer.creditLedger.slice(0, showFullLedger ? undefined : 10).map((entry) => {
                        const typeInfo = formatLedgerType(entry.type);
                        const sourceInfo = formatLedgerSource(entry.source);
                        
                        return (
                          <tr key={entry.id}>
                            <td style={styles.td}>
                              {new Date(entry.createdAt).toLocaleDateString()} {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td style={styles.td}>
                              <div style={styles.ledgerType}>
                                <span>{typeInfo.icon}</span>
                                <span style={{ color: typeInfo.color, fontWeight: "500" }}>
                                  {typeInfo.label}
                                </span>
                              </div>
                            </td>
                            <td style={styles.td}>
                              <span style={{ 
                                ...styles.ledgerSource, 
                                backgroundColor: `${sourceInfo.color}15`,
                                color: sourceInfo.color
                              }}>
                                {sourceInfo.label}
                              </span>
                            </td>
                            <td style={{ 
                              ...styles.td, 
                              textAlign: "right" as const,
                              ...(entry.amount >= 0 ? styles.amountPositive : styles.amountNegative)
                            }}>
                              {entry.amount >= 0 ? '+' : ''}{entry.amount.toFixed(2)}
                            </td>
                            <td style={{ ...styles.td, textAlign: "right" as const, fontWeight: "600" }}>
                              ${entry.balance.toFixed(2)}
                            </td>
                            <td style={styles.td}>
                              {entry.description || '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  
                  {customer.creditLedger.length > 10 && !showFullLedger && (
                    <button
                      style={styles.viewAllButton}
                      onClick={() => setShowFullLedger(true)}
                      onMouseOver={(e) => {
                        e.currentTarget.style.backgroundColor = '#3b82f6';
                        e.currentTarget.style.color = 'white';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = '#3b82f6';
                      }}
                    >
                      View All {customer.creditLedger.length} Ledger Entries
                    </button>
                  )}
                </>
              ) : (
                <div style={styles.emptyState}>
                  <p>No credit ledger entries yet</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}