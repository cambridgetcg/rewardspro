// app/routes/app.customers.management.tsx
import { useState, useEffect } from "react";
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation, useSubmit, Link, useNavigate } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import type { LedgerEntryType, LedgerSource } from "@prisma/client";
import { TransactionStatus } from "@prisma/client";
import { assignTierManually, evaluateCustomerTier } from "../services/customer-tier.server";

interface StoreCreditAccount {
  id: string;
  balance: {
    amount: string;
    currencyCode: string;
  };
}

interface CustomerData {
  id: string;
  email: string;
  shopifyCustomerId: string;
  storeCredit: number;
  totalEarned: number;
  lastSyncedAt: string | null;
  createdAt: string;
  currentTier: {
    id: string;
    name: string;
    cashbackPercent: number;
  } | null;
  annualSpending: number;
  storeCreditAccounts?: StoreCreditAccount[];
  totalBalanceUSD?: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  // Get all customers with their tier information
  const customers = await prisma.customer.findMany({
    where: { shopDomain },
    include: {
      membershipHistory: {
        where: { isActive: true },
        include: { tier: true }
      },
      transactions: {
        where: {
          createdAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        }
      }
    },
    orderBy: [
      { storeCredit: 'desc' },
      { email: 'asc' }
    ]
  });
  
  // Calculate annual spending and format customer data
  const customersWithData: CustomerData[] = customers.map(customer => {
    const annualSpending = customer.transactions.reduce((sum, t) => sum + t.orderAmount, 0);
    const currentMembership = customer.membershipHistory[0];
    
    return {
      id: customer.id,
      email: customer.email,
      shopifyCustomerId: customer.shopifyCustomerId,
      storeCredit: customer.storeCredit,
      totalEarned: customer.totalEarned,
      lastSyncedAt: customer.lastSyncedAt?.toISOString() || null,
      createdAt: customer.createdAt.toISOString(),
      currentTier: currentMembership?.tier ? {
        id: currentMembership.tier.id,
        name: currentMembership.tier.name,
        cashbackPercent: currentMembership.tier.cashbackPercent
      } : null,
      annualSpending
    };
  });
  
  // Get all tiers for dropdowns
  const tiers = await prisma.tier.findMany({
    where: { 
      shopDomain,
      isActive: true 
    },
    orderBy: { cashbackPercent: 'desc' }
  });
  
  // Get statistics
  const totalStoreCredit = customers.reduce((sum, c) => sum + c.storeCredit, 0);
  const customersWithCredit = customers.filter(c => c.storeCredit > 0).length;
  const customersWithTiers = customers.filter(c => c.membershipHistory.length > 0).length;
  
  const totalCashbackIssued = await prisma.cashbackTransaction.aggregate({
    where: { shopDomain },
    _sum: { cashbackAmount: true }
  });
  
  // Check for stale sync data
  const now = new Date();
  const staleCustomers = customers.filter(c => {
    if (!c.lastSyncedAt) return true;
    const hoursSinceSync = (now.getTime() - new Date(c.lastSyncedAt).getTime()) / (1000 * 60 * 60);
    return hoursSinceSync > 24;
  });
  
  // Get recent ledger entries
  const recentLedgerEntries = await prisma.storeCreditLedger.findMany({
    where: { shopDomain },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      customer: {
        select: { email: true, shopifyCustomerId: true }
      }
    }
  });
  
  // Get sample of customers' Shopify store credit accounts
  const sampleCustomersWithAccounts: CustomerData[] = [];
  const sampleSize = 5;
  
  for (let i = 0; i < Math.min(sampleSize, customersWithData.length); i++) {
    const customer = customersWithData[i];
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
        const accounts = result.data.customer.storeCreditAccounts.edges.map((edge: any) => edge.node);
        const totalUSD = accounts.reduce((sum: number, acc: StoreCreditAccount) => {
          const amount = parseFloat(acc.balance.amount);
          const rate = acc.balance.currencyCode === 'USD' ? 1 : 
                      acc.balance.currencyCode === 'CAD' ? 0.75 : 
                      acc.balance.currencyCode === 'EUR' ? 1.1 : 
                      acc.balance.currencyCode === 'GBP' ? 1.25 : 1;
          return sum + (amount * rate);
        }, 0);
        
        sampleCustomersWithAccounts.push({
          ...customer,
          storeCreditAccounts: accounts,
          totalBalanceUSD: totalUSD
        });
      }
    } catch (error) {
      console.error(`Failed to fetch store credit for customer ${customer.email}:`, error);
    }
  }
  
  return json({ 
    customers: customersWithData,
    sampleCustomersWithAccounts,
    stats: {
      totalCustomers: customers.length,
      customersWithCredit,
      customersWithTiers,
      totalStoreCredit,
      totalCashbackIssued: totalCashbackIssued._sum.cashbackAmount || 0,
      staleCustomers: staleCustomers.length
    },
    tiers,
    recentActivity: recentLedgerEntries,
    shopDomain
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;
  
  // Handle bulk sync
  if (actionType === "bulk-sync") {
    const syncType = formData.get("syncType") as string;
    
    try {
      let customersToSync = await prisma.customer.findMany({
        where: { 
          shopDomain,
          ...(syncType === "stale" ? {
            OR: [
              { lastSyncedAt: null },
              { lastSyncedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
            ]
          } : {})
        },
        take: 50
      });
      
      let updated = 0;
      let errors = 0;
      
      for (const customer of customersToSync) {
        try {
          const query = `#graphql
            query getCustomerStoreCredit($customerId: ID!) {
              customer(id: $customerId) {
                id
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
            let totalBalance = 0;
            
            for (const edge of accounts) {
              const amount = parseFloat(edge.node.balance.amount);
              totalBalance += amount;
            }
            
            if (Math.abs(totalBalance - customer.storeCredit) > 0.01) {
              await prisma.$transaction(async (tx) => {
                const difference = totalBalance - customer.storeCredit;
                
                await tx.storeCreditLedger.create({
                  data: {
                    customerId: customer.id,
                    shopDomain,
                    amount: difference,
                    balance: totalBalance,
                    type: 'SHOPIFY_SYNC',
                    source: 'SHOPIFY_ADMIN',
                    description: `Bulk sync: detected change`,
                    reconciledAt: new Date()
                  }
                });
                
                await tx.customer.update({
                  where: { id: customer.id },
                  data: {
                    storeCredit: totalBalance,
                    lastSyncedAt: new Date()
                  }
                });
              });
              
              updated++;
            } else {
              await prisma.customer.update({
                where: { id: customer.id },
                data: { lastSyncedAt: new Date() }
              });
            }
          }
        } catch (error) {
          console.error(`Failed to sync customer ${customer.email}:`, error);
          errors++;
        }
      }
      
      return json({
        success: true,
        message: `Sync complete: ${updated} balances updated, ${errors} errors`
      });
    } catch (error) {
      console.error("Bulk sync error:", error);
      return json({
        success: false,
        error: "Failed to perform bulk sync"
      });
    }
  }
  
  // Handle tier operations
  if (actionType === "assignTier") {
    const customerId = formData.get("customerId") as string;
    const tierId = formData.get("tierId") as string;
    const reason = formData.get("reason") as string || "Manual assignment via admin dashboard";
    
    try {
      // Use shop domain as the assignedBy identifier
      // In a production app, you might want to implement proper user tracking
      const assignedBy = `${shopDomain}-admin`;
      
      await assignTierManually(
        customerId, 
        tierId, 
        shopDomain, 
        assignedBy,
        reason
        // endDate is optional, not providing it means no expiration
      );
      return json({ success: true, message: "Tier assigned successfully" });
    } catch (error) {
      return json({ 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to assign tier" 
      });
    }
  }
  
  if (actionType === "evaluateTier") {
    const customerId = formData.get("customerId") as string;
    try {
      await evaluateCustomerTier(customerId, shopDomain);
      return json({ success: true, message: "Customer tier evaluated" });
    } catch (error) {
      return json({ 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to evaluate tier" 
      });
    }
  }
  
  if (actionType === "evaluateAllTiers") {
    try {
      const customers = await prisma.customer.findMany({
        where: { shopDomain }
      });
      for (const customer of customers) {
        await evaluateCustomerTier(customer.id, shopDomain);
      }
      return json({ success: true, message: `Evaluated ${customers.length} customers` });
    } catch (error) {
      return json({ 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to evaluate all tiers" 
      });
    }
  }
  
  // Handle credit operations
  const customerId = formData.get("customerId") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const currency = formData.get("currency") as string || "USD";
  const creditActionType = formData.get("creditAction") as string;
  const description = formData.get("description") as string || "";
  
  if (!customerId || !amount || isNaN(amount) || amount <= 0) {
    return json({ 
      success: false, 
      error: "Valid customer ID and positive amount are required" 
    });
  }
  
  if (creditActionType === "add" && amount > 15000) {
    return json({
      success: false,
      error: "Maximum single credit amount is $15,000 USD equivalent"
    });
  }
  
  try {
    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: customerId }
      });
      
      if (!customer || customer.shopDomain !== shopDomain) {
        throw new Error("Customer not found");
      }
      
      if (creditActionType === "remove" && amount > customer.storeCredit) {
        throw new Error(
          `Cannot remove $${amount.toFixed(2)}. Customer only has $${customer.storeCredit.toFixed(2)} available.`
        );
      }
      
      const mutation = creditActionType === "add" 
        ? `#graphql
          mutation storeCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
            storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
              storeCreditAccountTransaction {
                id
                amount {
                  amount
                  currencyCode
                }
                balanceAfterTransaction {
                  amount
                  currencyCode
                }
              }
              userErrors {
                field
                message
                code
              }
            }
          }`
        : `#graphql
          mutation storeCreditAccountDebit($id: ID!, $debitInput: StoreCreditAccountDebitInput!) {
            storeCreditAccountDebit(id: $id, debitInput: $debitInput) {
              storeCreditAccountTransaction {
                id
                amount {
                  amount
                  currencyCode
                }
                balanceAfterTransaction {
                  amount
                  currencyCode
                }
              }
              userErrors {
                field
                message
                code
              }
            }
          }`;
      
      const variables = creditActionType === "add"
        ? {
            id: `gid://shopify/Customer/${customer.shopifyCustomerId}`,
            creditInput: {
              creditAmount: {
                amount: amount.toFixed(2),
                currencyCode: currency
              }
            }
          }
        : {
            id: `gid://shopify/Customer/${customer.shopifyCustomerId}`,
            debitInput: {
              debitAmount: {
                amount: amount.toFixed(2),
                currencyCode: currency
              }
            }
          };
      
      const response = await admin.graphql(mutation, { variables });
      const graphqlResult = await response.json();
      
      const mutationResult = creditActionType === "add" 
        ? graphqlResult.data?.storeCreditAccountCredit
        : graphqlResult.data?.storeCreditAccountDebit;
      
      if (mutationResult?.userErrors?.length > 0) {
        throw new Error(mutationResult.userErrors.map((e: any) => e.message).join(", "));
      }
      
      if (mutationResult?.storeCreditAccountTransaction) {
        const ledgerAmount = creditActionType === "add" ? amount : -amount;
        const newBalance = customer.storeCredit + ledgerAmount;
        
        await tx.storeCreditLedger.create({
          data: {
            customerId: customer.id,
            shopDomain,
            amount: ledgerAmount,
            balance: newBalance,
            type: 'MANUAL_ADJUSTMENT',
            source: 'APP_MANUAL',
            shopifyReference: mutationResult.storeCreditAccountTransaction.id,
            description: description || `Manual ${creditActionType} via admin dashboard`,
            reconciledAt: new Date()
          }
        });
        
        await tx.customer.update({
          where: { id: customerId },
          data: {
            storeCredit: newBalance,
            lastSyncedAt: new Date()
          }
        });
        
        return {
          success: true,
          email: customer.email,
          amount,
          currency,
          actionType: creditActionType,
          newBalance
        };
      }
      
      throw new Error(`Failed to ${creditActionType} store credit`);
    });
    
    const actionWord = result.actionType === "add" ? "added" : "removed";
    return json({ 
      success: true,
      message: `Successfully ${actionWord} ${result.currency} ${result.amount.toFixed(2)} ${result.actionType === "add" ? "to" : "from"} ${result.email}. New balance: $${result.newBalance.toFixed(2)}`
    });
    
  } catch (error) {
    console.error("Store credit error:", error);
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to process store credit operation"
    });
  }
};

export default function CustomerManagement() {
  const { customers, sampleCustomersWithAccounts, stats, tiers, recentActivity, shopDomain } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const navigate = useNavigate();
  
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [creditFilter, setCreditFilter] = useState<string>("all");
  const [showCreditForm, setShowCreditForm] = useState(false);
  const [showTierForm, setShowTierForm] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [creditActionType, setCreditActionType] = useState<"add" | "remove">("add");
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showActivityDetails, setShowActivityDetails] = useState(false);
  const [sortBy, setSortBy] = useState<"credit-desc" | "credit-asc" | "spending-desc" | "spending-asc" | "email-asc" | "email-desc">("credit-desc");
  const [displayCount, setDisplayCount] = useState(10);
  
  const isSubmitting = navigation.state === "submitting";
  
  useEffect(() => {
    if (actionData) {
      if (actionData.success && "message" in actionData) {
        setNotification({ type: 'success', message: actionData.message });
        setShowCreditForm(false);
        setShowTierForm(false);
        setShowSyncModal(false);
        setSelectedCustomerId("");
        setTimeout(() => setNotification(null), 5000);
      } else if (!actionData.success && "error" in actionData) {
        setNotification({ type: 'error', message: actionData.error });
        setTimeout(() => setNotification(null), 5000);
      }
    }
  }, [actionData]);
  
  // Reset display count when search or filters change
  useEffect(() => {
    setDisplayCount(10);
  }, [searchTerm, tierFilter, creditFilter, sortBy]);
  
  // Get customer data with Shopify accounts if available
  const getCustomerWithAccounts = (customerId: string) => {
    const sampleData = sampleCustomersWithAccounts.find(s => s.id === customerId);
    if (sampleData) return sampleData;
    return customers.find(c => c.id === customerId);
  };
  
  // Sort customers
  const sortedCustomers = [...customers].sort((a, b) => {
    switch (sortBy) {
      case "credit-desc":
        return b.storeCredit - a.storeCredit;
      case "credit-asc":
        return a.storeCredit - b.storeCredit;
      case "spending-desc":
        return b.annualSpending - a.annualSpending;
      case "spending-asc":
        return a.annualSpending - b.annualSpending;
      case "email-asc":
        return a.email.toLowerCase().localeCompare(b.email.toLowerCase());
      case "email-desc":
        return b.email.toLowerCase().localeCompare(a.email.toLowerCase());
      default:
        return 0;
    }
  });
  
  // Filter customers
  const filteredCustomers = sortedCustomers.filter(customer => {
    const matchesSearch = customer.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.shopifyCustomerId.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesTier = tierFilter === "all" || 
      (tierFilter === "no-tier" && !customer.currentTier) ||
      (customer.currentTier?.id === tierFilter);
    
    const matchesCredit = creditFilter === "all" ||
      (creditFilter === "has-credit" && customer.storeCredit > 0) ||
      (creditFilter === "no-credit" && customer.storeCredit === 0);
    
    return matchesSearch && matchesTier && matchesCredit;
  });
  
  const selectedCustomer = getCustomerWithAccounts(selectedCustomerId);
  
  const formatSyncTime = (lastSyncedAt: string | null) => {
    if (!lastSyncedAt) return "Never synced";
    const date = new Date(lastSyncedAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffHours < 1) return "Recently synced";
    if (diffHours < 24) return `${diffHours} hours ago`;
    return `${diffDays} days ago`;
  };
  
  const isSyncStale = (lastSyncedAt: string | null) => {
    if (!lastSyncedAt) return true;
    const date = new Date(lastSyncedAt);
    const hoursSinceSync = (Date.now() - date.getTime()) / (1000 * 60 * 60);
    return hoursSinceSync > 24;
  };
  
  const formatLedgerType = (type: LedgerEntryType) => {
    const typeMap: Record<LedgerEntryType, { label: string; color: string }> = {
      'MANUAL_ADJUSTMENT': { label: 'Manual', color: '#1565c0' },
      'SHOPIFY_SYNC': { label: 'Sync', color: '#7b1fa2' },
      'CASHBACK_EARNED': { label: 'Cashback', color: '#2e7d32' },
      'ORDER_PAYMENT': { label: 'Payment', color: '#e65100' },
      'REFUND_CREDIT': { label: 'Refund', color: '#00897b' },
      'INITIAL_IMPORT': { label: 'Import', color: '#5e35b1' }
    };
    return typeMap[type] || { label: type, color: '#666' };
  };
  
  const formatLedgerSource = (source: LedgerSource) => {
    const sourceMap: Record<LedgerSource, string> = {
      'APP_MANUAL': 'App',
      'APP_CASHBACK': 'App',
      'SHOPIFY_ADMIN': 'Shopify',
      'SHOPIFY_ORDER': 'Order',
      'RECONCILIATION': 'System'
    };
    return sourceMap[source] || source;
  };
  
  const getTierIcon = (cashbackPercent: number) => {
    if (cashbackPercent >= 10) return "👑";
    if (cashbackPercent >= 7) return "⭐";
    if (cashbackPercent >= 5) return "✨";
    return "";
  };
  
  const styles = {
    container: {
      maxWidth: "1400px",
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
      marginBottom: "32px"
    },
    headerRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "16px",
      gap: "16px",
      flexWrap: "wrap" as const
    },
    title: {
      fontSize: "32px",
      fontWeight: "700",
      margin: "0",
      color: "#1a1a1a"
    },
    buttonGroup: {
      display: "flex",
      gap: "12px",
      flexWrap: "wrap" as const
    },
    syncButton: {
      padding: "12px 24px",
      backgroundColor: "#3b82f6",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s",
      display: "flex",
      alignItems: "center",
      gap: "8px"
    },
    evaluateButton: {
      padding: "12px 24px",
      backgroundColor: "#8B5CF6",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    statsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      gap: "24px",
      marginBottom: "40px"
    },
    statCard: {
      backgroundColor: "white",
      padding: "28px",
      borderRadius: "12px",
      textAlign: "center" as const,
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      transition: "transform 0.2s, box-shadow 0.2s"
    },
    statCardWarning: {
      backgroundColor: "#fff8e1",
      padding: "28px",
      borderRadius: "12px",
      textAlign: "center" as const,
      border: "2px solid #ffc107",
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
    },
    statValue: {
      fontSize: "36px",
      fontWeight: "700",
      margin: "0 0 8px 0",
      color: "#1a1a1a"
    },
    statValueWarning: {
      fontSize: "36px",
      fontWeight: "700",
      margin: "0 0 8px 0",
      color: "#f57c00"
    },
    statLabel: {
      fontSize: "14px",
      color: "#666",
      margin: 0,
      fontWeight: "500",
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px"
    },
    mainContent: {
      backgroundColor: "white",
      borderRadius: "12px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      overflow: "hidden"
    },
    sectionHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "24px 32px",
      borderBottom: "1px solid #e0e0e0",
      gap: "16px",
      flexWrap: "wrap" as const,
      backgroundColor: "#fafafa"
    },
    sectionTitle: {
      fontSize: "20px",
      fontWeight: "600",
      margin: 0,
      color: "#1a1a1a"
    },
    searchAndFilters: {
      display: "flex",
      gap: "12px",
      alignItems: "center",
      flexWrap: "wrap" as const
    },
    searchInput: {
      padding: "10px 16px",
      border: "2px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "15px",
      backgroundColor: "white",
      transition: "border-color 0.2s",
      outline: "none",
      minWidth: "250px"
    },
    filterSelect: {
      padding: "10px 16px",
      border: "2px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "15px",
      backgroundColor: "white",
      transition: "border-color 0.2s",
      outline: "none",
      cursor: "pointer",
      minWidth: "150px"
    },
    customerList: {
      padding: "16px"
    },
    customerCard: {
      backgroundColor: "#fafafa",
      padding: "24px",
      marginBottom: "16px",
      borderRadius: "12px",
      border: "1px solid #e0e0e0",
      transition: "all 0.2s"
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
      color: "#666",
      marginBottom: "4px"
    },
    syncStatus: {
      fontSize: "12px",
      color: "#999"
    },
    syncStatusStale: {
      fontSize: "12px",
      color: "#e65100",
      fontWeight: "500"
    },
    badgeContainer: {
      display: "flex",
      gap: "12px",
      alignItems: "center",
      flexWrap: "wrap" as const
    },
    creditBadge: {
      fontSize: "24px",
      padding: "12px 24px",
      borderRadius: "30px",
      fontWeight: "700",
      backgroundColor: "#e8f5e9",
      color: "#2e7d32"
    },
    noCreditBadge: {
      fontSize: "24px",
      padding: "12px 24px",
      borderRadius: "30px",
      fontWeight: "700",
      backgroundColor: "#f5f5f5",
      color: "#999"
    },
    tierBadge: {
      fontSize: "14px",
      padding: "8px 16px",
      borderRadius: "20px",
      fontWeight: "500",
      backgroundColor: "#e3f2fd",
      color: "#1565c0",
      display: "flex",
      alignItems: "center",
      gap: "4px"
    },
    noTierBadge: {
      fontSize: "14px",
      padding: "8px 16px",
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
      textAlign: "center" as const,
      padding: "12px",
      backgroundColor: "white",
      borderRadius: "8px"
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
    accountsList: {
      marginTop: "12px",
      padding: "12px",
      backgroundColor: "white",
      borderRadius: "8px",
      fontSize: "14px"
    },
    accountItem: {
      display: "flex",
      justifyContent: "space-between",
      padding: "8px 0",
      borderBottom: "1px solid #f0f0f0"
    },
    actionRow: {
      display: "flex",
      gap: "12px",
      alignItems: "center",
      flexWrap: "wrap" as const
    },
    addButton: {
      padding: "10px 20px",
      backgroundColor: "#10B981",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    removeButton: {
      padding: "10px 20px",
      backgroundColor: "#EF4444",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    tierButton: {
      padding: "10px 20px",
      backgroundColor: "#8B5CF6",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    viewDetailsButton: {
      padding: "10px 20px",
      backgroundColor: "transparent",
      color: "#3b82f6",
      border: "2px solid #3b82f6",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
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
    emptyState: {
      textAlign: "center" as const,
      padding: "80px 20px",
      color: "#999"
    },
    emptyStateTitle: {
      fontSize: "24px",
      fontWeight: "600",
      marginBottom: "8px",
      color: "#666"
    },
    emptyStateText: {
      fontSize: "16px",
      color: "#999"
    },
    creditForm: {
      backgroundColor: "#f0f7ff",
      padding: "32px",
      marginBottom: "24px",
      borderRadius: "12px",
      border: "2px solid #3b82f6"
    },
    tierForm: {
      backgroundColor: "#f3e8ff",
      padding: "32px",
      marginBottom: "24px",
      borderRadius: "12px",
      border: "2px solid #8B5CF6"
    },
    formTitle: {
      fontSize: "20px",
      fontWeight: "600",
      marginTop: 0,
      marginBottom: "8px",
      color: "#1a1a1a"
    },
    formSubtitle: {
      fontSize: "14px",
      color: "#666",
      marginBottom: "24px"
    },
    formGrid: {
      display: "grid",
      gridTemplateColumns: "1fr 200px",
      gap: "16px",
      alignItems: "flex-end",
      marginBottom: "16px"
    },
    formGroup: {
      display: "flex",
      flexDirection: "column" as const
    },
    label: {
      fontSize: "14px",
      fontWeight: "600",
      marginBottom: "8px",
      color: "#333"
    },
    input: {
      padding: "12px 16px",
      border: "2px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "15px",
      backgroundColor: "white",
      transition: "border-color 0.2s",
      outline: "none"
    },
    formActions: {
      display: "flex",
      gap: "12px",
      marginTop: "24px"
    },
    cancelButton: {
      padding: "12px 24px",
      backgroundColor: "transparent",
      color: "#666",
      border: "2px solid #e0e0e0",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    saveButton: {
      padding: "12px 24px",
      backgroundColor: "#10B981",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    warningText: {
      fontSize: "14px",
      color: "#d32f2f",
      backgroundColor: "#ffebee",
      padding: "12px 16px",
      borderRadius: "6px",
      marginBottom: "16px",
      display: "flex",
      alignItems: "center",
      gap: "8px"
    },
    infoText: {
      fontSize: "13px",
      color: "#666",
      backgroundColor: "#f5f5f5",
      padding: "12px 16px",
      borderRadius: "6px",
      marginTop: "8px"
    },
    modal: {
      position: "fixed" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000
    },
    modalContent: {
      backgroundColor: "white",
      padding: "40px",
      borderRadius: "16px",
      maxWidth: "600px",
      width: "90%",
      boxShadow: "0 20px 40px rgba(0, 0, 0, 0.15)"
    },
    modalTitle: {
      fontSize: "28px",
      fontWeight: "700",
      marginBottom: "16px",
      color: "#1a1a1a"
    },
    modalText: {
      fontSize: "16px",
      color: "#666",
      marginBottom: "32px",
      lineHeight: "1.6"
    },
    modalButtons: {
      display: "flex",
      gap: "12px",
      justifyContent: "flex-end"
    },
    primaryButton: {
      padding: "12px 24px",
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
      padding: "12px 24px",
      backgroundColor: "transparent",
      color: "#666",
      border: "2px solid #e0e0e0",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    activitySection: {
      marginTop: "48px"
    },
    activityHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "24px"
    },
    activityTitle: {
      fontSize: "24px",
      fontWeight: "600",
      margin: 0,
      color: "#1a1a1a"
    },
    toggleButton: {
      padding: "8px 16px",
      backgroundColor: "transparent",
      color: "#3b82f6",
      border: "2px solid #3b82f6",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    activityTable: {
      width: "100%",
      backgroundColor: "white",
      borderRadius: "12px",
      overflow: "hidden",
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
    },
    activityTableWrapper: {
      overflowX: "auto" as const
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
      letterSpacing: "0.5px",
      whiteSpace: "nowrap" as const
    },
    td: {
      padding: "16px",
      borderBottom: "1px solid #f0f0f0",
      fontSize: "14px"
    },
    amountPositive: {
      color: "#10B981",
      fontWeight: "600"
    },
    amountNegative: {
      color: "#EF4444",
      fontWeight: "600"
    },
    typeBadge: {
      display: "inline-block",
      padding: "4px 12px",
      borderRadius: "16px",
      fontSize: "12px",
      fontWeight: "600",
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px"
    },
    viewMoreContainer: {
      textAlign: "center" as const,
      padding: "32px 16px",
      borderTop: "2px solid #e0e0e0",
      backgroundColor: "#fafafa",
      borderRadius: "0 0 12px 12px",
      marginTop: "24px"
    },
    viewMoreText: {
      fontSize: "14px",
      color: "#666",
      marginBottom: "16px",
      fontWeight: "500"
    },
    viewMoreButton: {
      padding: "10px 24px",
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
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>Customer Management</h1>
          </div>
          <div style={styles.buttonGroup}>
            <button
              onClick={() => setShowSyncModal(true)}
              style={styles.syncButton}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              Sync Credit Balances
            </button>
            <Form method="post" style={{ display: "inline" }}>
              <input type="hidden" name="actionType" value="evaluateAllTiers" />
              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  ...styles.evaluateButton,
                  opacity: isSubmitting ? 0.6 : 1,
                  cursor: isSubmitting ? "not-allowed" : "pointer"
                }}
                onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseOut={(e) => e.currentTarget.style.opacity = isSubmitting ? '0.6' : '1'}
              >
                {isSubmitting ? "Evaluating..." : "Re-evaluate All Tiers"}
              </button>
            </Form>
          </div>
        </div>
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
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: 'inherit' }}
          >
            ×
          </button>
        </div>
      )}
      
      {/* Stats */}
      <div style={styles.statsGrid}>
        <div 
          style={styles.statCard}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
          }}
        >
          <h3 style={styles.statValue}>{stats.totalCustomers}</h3>
          <p style={styles.statLabel}>Total Customers</p>
        </div>
        <div 
          style={styles.statCard}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
          }}
        >
          <h3 style={styles.statValue}>{stats.customersWithCredit}</h3>
          <p style={styles.statLabel}>With Store Credit</p>
        </div>
        <div 
          style={styles.statCard}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
          }}
        >
          <h3 style={styles.statValue}>{stats.customersWithTiers}</h3>
          <p style={styles.statLabel}>With Tier</p>
        </div>
        <div 
          style={styles.statCard}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
          }}
        >
          <h3 style={styles.statValue}>${stats.totalStoreCredit.toFixed(2)}</h3>
          <p style={styles.statLabel}>Total Store Credit</p>
        </div>
        <div 
          style={styles.statCard}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
          }}
        >
          <h3 style={styles.statValue}>${stats.totalCashbackIssued.toFixed(2)}</h3>
          <p style={styles.statLabel}>Total Cashback Issued</p>
        </div>
        <div style={stats.staleCustomers > 0 ? styles.statCardWarning : styles.statCard}>
          <h3 style={stats.staleCustomers > 0 ? styles.statValueWarning : styles.statValue}>
            {stats.staleCustomers}
          </h3>
          <p style={styles.statLabel}>Need Sync</p>
        </div>
      </div>
      
      {/* Main Content */}
      <div style={styles.mainContent}>
        {/* Search and Filters */}
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Customers</h2>
          <div style={styles.searchAndFilters}>
            <input
              type="text"
              placeholder="Search by email or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={styles.searchInput}
              onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
            />
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              style={styles.filterSelect}
              onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
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
            <select
              value={creditFilter}
              onChange={(e) => setCreditFilter(e.target.value)}
              style={styles.filterSelect}
              onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
            >
              <option value="all">All Credit</option>
              <option value="has-credit">Has Credit</option>
              <option value="no-credit">No Credit</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              style={styles.filterSelect}
              onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
            >
              <option value="credit-desc">Credit: High to Low</option>
              <option value="credit-asc">Credit: Low to High</option>
              <option value="spending-desc">Spending: High to Low</option>
              <option value="spending-asc">Spending: Low to High</option>
              <option value="email-asc">Email: A to Z</option>
              <option value="email-desc">Email: Z to A</option>
            </select>
          </div>
        </div>
        
        {/* Credit Form */}
        {showCreditForm && selectedCustomerId && selectedCustomer && (
          <div style={{ padding: "24px 32px 0" }}>
            <Form method="post" style={styles.creditForm}>
              <h3 style={styles.formTitle}>
                {creditActionType === "add" ? "Add" : "Remove"} Store Credit
              </h3>
              <p style={styles.formSubtitle}>
                {selectedCustomer.email} • Current balance: ${selectedCustomer.storeCredit.toFixed(2)}
              </p>
              
              {creditActionType === "remove" && selectedCustomer.storeCredit === 0 && (
                <div style={styles.warningText}>
                  This customer has no store credit to remove.
                </div>
              )}
              
              <input type="hidden" name="customerId" value={selectedCustomerId} />
              <input type="hidden" name="actionType" value="credit" />
              <input type="hidden" name="creditAction" value={creditActionType} />
              
              <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Amount</label>
                  <input
                    type="number"
                    name="amount"
                    step="0.01"
                    min="0.01"
                    max={creditActionType === "remove" ? selectedCustomer.storeCredit : 15000}
                    required
                    placeholder={creditActionType === "remove" ? `Max: ${selectedCustomer.storeCredit.toFixed(2)}` : "10.00"}
                    style={styles.input}
                    onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                    onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                  />
                </div>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>Currency</label>
                  <select
                    name="currency"
                    style={styles.input}
                    defaultValue="USD"
                    onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                    onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                  >
                    <option value="USD">USD</option>
                    <option value="CAD">CAD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
              </div>
              
              <div style={{ ...styles.formGroup, marginTop: "16px" }}>
                <label style={styles.label}>Description (Optional)</label>
                <input
                  type="text"
                  name="description"
                  placeholder={creditActionType === "add" ? "e.g., Loyalty bonus, Referral reward" : "e.g., Correction, Customer request"}
                  style={styles.input}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                />
              </div>
              
              <div style={styles.infoText}>
                {creditActionType === "add" ? "Maximum single credit amount is $15,000 USD equivalent" : "Store credit balance cannot go negative"}
              </div>
              
              <div style={styles.formActions}>
                <button
                  type="submit"
                  disabled={isSubmitting || (creditActionType === "remove" && selectedCustomer.storeCredit === 0)}
                  style={{
                    ...styles.saveButton,
                    backgroundColor: creditActionType === "add" ? "#10B981" : "#EF4444",
                    opacity: (isSubmitting || (creditActionType === "remove" && selectedCustomer.storeCredit === 0)) ? 0.6 : 1,
                    cursor: (isSubmitting || (creditActionType === "remove" && selectedCustomer.storeCredit === 0)) ? "not-allowed" : "pointer"
                  }}
                >
                  {isSubmitting ? "Processing..." : `${creditActionType === "add" ? "Add" : "Remove"} Credit`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreditForm(false);
                    setSelectedCustomerId("");
                  }}
                  style={styles.cancelButton}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#f5f5f5';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  Cancel
                </button>
              </div>
            </Form>
          </div>
        )}
        
        {/* Tier Form */}
        {showTierForm && selectedCustomerId && selectedCustomer && (
          <div style={{ padding: "24px 32px 0" }}>
            <Form method="post" style={styles.tierForm}>
              <h3 style={styles.formTitle}>Manage Customer Tier</h3>
              <p style={styles.formSubtitle}>
                {selectedCustomer.email} • Current tier: {selectedCustomer.currentTier?.name || "No tier"}
              </p>
              
              <input type="hidden" name="customerId" value={selectedCustomerId} />
              <input type="hidden" name="actionType" value="assignTier" />
              
              <div style={styles.formGroup}>
                <label style={styles.label}>Select New Tier</label>
                <select
                  name="tierId"
                  required
                  style={styles.input}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#8B5CF6'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                >
                  <option value="">Choose a tier...</option>
                  {tiers.map(tier => (
                    <option key={tier.id} value={tier.id}>
                      {getTierIcon(tier.cashbackPercent)} {tier.name} ({tier.cashbackPercent}% cashback)
                    </option>
                  ))}
                </select>
              </div>
              
              <div style={{ ...styles.formGroup, marginTop: "16px" }}>
                <label style={styles.label}>Reason (Optional)</label>
                <input
                  type="text"
                  name="reason"
                  placeholder="e.g., VIP customer, Special promotion, Long-term loyalty"
                  style={styles.input}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#8B5CF6'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                />
              </div>
              
              <div style={styles.infoText}>
                Manually assigning a tier will override automatic tier evaluation based on spending. The customer will remain in this tier until manually changed or re-evaluated.
              </div>
              
              <div style={styles.formActions}>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    ...styles.saveButton,
                    backgroundColor: "#8B5CF6",
                    opacity: isSubmitting ? 0.6 : 1,
                    cursor: isSubmitting ? "not-allowed" : "pointer"
                  }}
                >
                  {isSubmitting ? "Assigning..." : "Assign Tier"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowTierForm(false);
                    setSelectedCustomerId("");
                  }}
                  style={styles.cancelButton}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#f5f5f5';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  Cancel
                </button>
              </div>
            </Form>
          </div>
        )}
        
        {/* Customer List */}
        <div style={styles.customerList}>
          {filteredCustomers.length === 0 ? (
            <div style={styles.emptyState}>
              <h3 style={styles.emptyStateTitle}>
                {searchTerm || tierFilter !== "all" || creditFilter !== "all" ? "No customers found" : "No customers yet"}
              </h3>
              <p style={styles.emptyStateText}>
                {searchTerm || tierFilter !== "all" || creditFilter !== "all"
                  ? "Try adjusting your search or filters" 
                  : "Customers will appear here once they're created"}
              </p>
            </div>
          ) : (
            <>
              {filteredCustomers.slice(0, displayCount).map((customer) => {
                const customerData = getCustomerWithAccounts(customer.id);
                
                return (
                  <div 
                    key={customer.id} 
                    style={styles.customerCard}
                    onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
                    onMouseOut={(e) => e.currentTarget.style.boxShadow = 'none'}
                  >
                    <div style={styles.customerHeader}>
                      <div style={styles.customerInfo}>
                        <h3 style={styles.customerEmail}>{customer.email}</h3>
                        <p style={styles.customerId}>
                          Customer ID: {customer.shopifyCustomerId} • 
                          Total Earned: ${customer.totalEarned.toFixed(2)}
                        </p>
                        <p style={isSyncStale(customer.lastSyncedAt) ? styles.syncStatusStale : styles.syncStatus}>
                          {isSyncStale(customer.lastSyncedAt) && "⚠️ "}
                          Last synced: {formatSyncTime(customer.lastSyncedAt)}
                        </p>
                      </div>
                      <div style={styles.badgeContainer}>
                        {customer.currentTier ? (
                          <div style={styles.tierBadge}>
                            <span>{getTierIcon(customer.currentTier.cashbackPercent)}</span>
                            {customer.currentTier.name} • {customer.currentTier.cashbackPercent}%
                          </div>
                        ) : (
                          <div style={styles.noTierBadge}>No tier</div>
                        )}
                        {customer.storeCredit > 0 ? (
                          <div style={styles.creditBadge}>
                            ${customer.storeCredit.toFixed(2)}
                          </div>
                        ) : (
                          <div style={styles.noCreditBadge}>
                            $0.00
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Metrics */}
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
                    
                    {/* Show store credit accounts if available */}
                    {customerData && 'storeCreditAccounts' in customerData && customerData.storeCreditAccounts && customerData.storeCreditAccounts.length > 0 && (
                      <div style={styles.accountsList}>
                        <strong>Store Credit Accounts:</strong>
                        {customerData.storeCreditAccounts.map((account, idx) => (
                          <div key={account.id} style={styles.accountItem}>
                            <span>{account.balance.currencyCode}</span>
                            <span>${parseFloat(account.balance.amount).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    <div style={styles.actionRow}>
                      <button
                        onClick={() => {
                          setSelectedCustomerId(customer.id);
                          setCreditActionType("add");
                          setShowCreditForm(true);
                          setShowTierForm(false);
                        }}
                        style={styles.addButton}
                        onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                        onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                      >
                        + Add Credit
                      </button>
                      <button
                        onClick={() => {
                          setSelectedCustomerId(customer.id);
                          setCreditActionType("remove");
                          setShowCreditForm(true);
                          setShowTierForm(false);
                        }}
                        style={styles.removeButton}
                        disabled={customer.storeCredit === 0}
                        onMouseOver={(e) => {
                          if (customer.storeCredit > 0) {
                            e.currentTarget.style.opacity = '0.9';
                          }
                        }}
                        onMouseOut={(e) => {
                          if (customer.storeCredit > 0) {
                            e.currentTarget.style.opacity = '1';
                          }
                        }}
                      >
                        − Remove Credit
                      </button>
                      <button
                        onClick={() => {
                          setSelectedCustomerId(customer.id);
                          setShowTierForm(true);
                          setShowCreditForm(false);
                        }}
                        style={styles.tierButton}
                        onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                        onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                      >
                        Manage Tier
                      </button>
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="actionType" value="evaluateTier" />
                        <input type="hidden" name="customerId" value={customer.id} />
                        <button
                          type="submit"
                          disabled={isSubmitting}
                          style={{
                            ...styles.viewDetailsButton,
                            opacity: isSubmitting ? 0.6 : 1,
                            cursor: isSubmitting ? "not-allowed" : "pointer"
                          }}
                          onMouseOver={(e) => {
                            if (!isSubmitting) {
                              e.currentTarget.style.backgroundColor = '#3b82f6';
                              e.currentTarget.style.color = 'white';
                            }
                          }}
                          onMouseOut={(e) => {
                            if (!isSubmitting) {
                              e.currentTarget.style.backgroundColor = 'transparent';
                              e.currentTarget.style.color = '#3b82f6';
                            }
                          }}
                        >
                          Re-evaluate
                        </button>
                      </Form>
                      <button
                        onClick={() => navigate(`/app/customers/${customer.id}`)}
                        style={styles.viewDetailsButton}
                        onMouseOver={(e) => {
                          e.currentTarget.style.backgroundColor = '#3b82f6';
                          e.currentTarget.style.color = 'white';
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.color = '#3b82f6';
                        }}
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                );
              })}
              
              {/* View More Button */}
              {filteredCustomers.length > displayCount && (
                <div style={styles.viewMoreContainer}>
                  <p style={styles.viewMoreText}>
                    Showing {displayCount} of {filteredCustomers.length} customers
                  </p>
                  <button
                    onClick={() => setDisplayCount(displayCount + 10)}
                    style={styles.viewMoreButton}
                    onMouseOver={(e) => {
                      e.currentTarget.style.backgroundColor = '#3b82f6';
                      e.currentTarget.style.color = 'white';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = '#3b82f6';
                    }}
                  >
                    View More ({Math.min(10, filteredCustomers.length - displayCount)} more)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Recent Activity */}
      {recentActivity && recentActivity.length > 0 && (
        <div style={styles.activitySection}>
          <div style={styles.activityHeader}>
            <h2 style={styles.activityTitle}>Recent Store Credit Activity</h2>
            <button
              onClick={() => setShowActivityDetails(!showActivityDetails)}
              style={styles.toggleButton}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#3b82f6';
                e.currentTarget.style.color = 'white';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#3b82f6';
              }}
            >
              {showActivityDetails ? 'Hide Details' : 'Show Details'}
            </button>
          </div>
          
          <div style={styles.activityTable}>
            <div style={styles.activityTableWrapper}>
              <table style={styles.table}>
                <thead style={styles.tableHeader}>
                  <tr>
                    <th style={styles.th}>Date & Time</th>
                    <th style={styles.th}>Customer</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Source</th>
                    <th style={{ ...styles.th, textAlign: "right" as const }}>Amount</th>
                    <th style={{ ...styles.th, textAlign: "right" as const }}>Balance</th>
                    {showActivityDetails && (
                      <>
                        <th style={styles.th}>Description</th>
                        <th style={styles.th}>Reference</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((entry) => {
                    const typeInfo = formatLedgerType(entry.type);
                    
                    return (
                      <tr key={entry.id}>
                        <td style={styles.td}>
                          {new Date(entry.createdAt).toLocaleDateString()} {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={styles.td}>
                          <div>
                            <div style={{ fontWeight: '500' }}>{entry.customer.email}</div>
                            <div style={{ fontSize: '12px', color: '#666' }}>ID: {entry.customer.shopifyCustomerId}</div>
                          </div>
                        </td>
                        <td style={styles.td}>
                          <span style={{ 
                            ...styles.typeBadge, 
                            backgroundColor: `${typeInfo.color}20`,
                            color: typeInfo.color
                          }}>
                            {typeInfo.label}
                          </span>
                        </td>
                        <td style={styles.td}>
                          {formatLedgerSource(entry.source)}
                        </td>
                        <td style={{ 
                          ...styles.td, 
                          textAlign: "right" as const,
                          ...(entry.amount >= 0 ? styles.amountPositive : styles.amountNegative)
                        }}>
                          {entry.amount >= 0 ? '+' : ''}{entry.amount.toFixed(2)}
                        </td>
                        <td style={{ ...styles.td, textAlign: "right" as const, fontWeight: '600' }}>
                          ${entry.balance.toFixed(2)}
                        </td>
                        {showActivityDetails && (
                          <>
                            <td style={styles.td}>
                              {entry.description || '-'}
                            </td>
                            <td style={styles.td}>
                              {entry.shopifyReference ? (
                                <code style={{ fontSize: '12px', backgroundColor: '#f5f5f5', padding: '2px 4px', borderRadius: '4px' }}>
                                  {entry.shopifyReference.split('/').pop()}
                                </code>
                              ) : '-'}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      
      {/* Sync Modal */}
      {showSyncModal && (
        <div style={styles.modal} onClick={() => setShowSyncModal(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Sync Store Credit Balances</h2>
            <p style={styles.modalText}>
              This will fetch the latest store credit balances from Shopify and update your local database. 
              The sync process will check for customers with multiple store credit accounts in different currencies.
            </p>
            <p style={styles.modalText}>
              {stats.staleCustomers > 0 ? (
                <>
                  <strong style={{ color: '#f57c00' }}>{stats.staleCustomers} customers</strong> haven't been synced in over 24 hours.
                </>
              ) : (
                <>All customers have been synced recently.</>
              )}
            </p>
            <Form method="post" style={styles.modalButtons}>
              <input type="hidden" name="actionType" value="bulk-sync" />
              <button
                type="button"
                onClick={() => setShowSyncModal(false)}
                style={styles.secondaryButton}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                Cancel
              </button>
              <button
                type="submit"
                name="syncType"
                value="stale"
                disabled={isSubmitting || stats.staleCustomers === 0}
                style={{
                  ...styles.primaryButton,
                  opacity: (isSubmitting || stats.staleCustomers === 0) ? 0.6 : 1,
                  cursor: (isSubmitting || stats.staleCustomers === 0) ? "not-allowed" : "pointer"
                }}
                onMouseOver={(e) => {
                  if (!isSubmitting && stats.staleCustomers > 0) {
                    e.currentTarget.style.opacity = '0.9';
                  }
                }}
                onMouseOut={(e) => {
                  if (!isSubmitting && stats.staleCustomers > 0) {
                    e.currentTarget.style.opacity = '1';
                  }
                }}
              >
                {isSubmitting ? "Syncing..." : `Sync Stale Only (${stats.staleCustomers})`}
              </button>
              <button
                type="submit"
                name="syncType"
                value="all"
                disabled={isSubmitting}
                style={{
                  ...styles.primaryButton,
                  backgroundColor: "#10b981",
                  opacity: isSubmitting ? 0.6 : 1,
                  cursor: isSubmitting ? "not-allowed" : "pointer"
                }}
                onMouseOver={(e) => {
                  if (!isSubmitting) {
                    e.currentTarget.style.opacity = '0.9';
                  }
                }}
                onMouseOut={(e) => {
                  if (!isSubmitting) {
                    e.currentTarget.style.opacity = '1';
                  }
                }}
              >
                {isSubmitting ? "Syncing..." : "Sync All Customers"}
              </button>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}