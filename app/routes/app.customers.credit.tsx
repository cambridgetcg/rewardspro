// app/routes/app.customers.credit.tsx
import { useState, useEffect } from "react";
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  // Get all customers for this shop
  const customers = await prisma.customer.findMany({
    where: { shopDomain },
    orderBy: [
      { storeCredit: 'desc' }, // Sort by store credit first
      { email: 'asc' } // Then by email
    ]
  });
  
  // Get statistics
  const totalStoreCredit = customers.reduce((sum, c) => sum + c.storeCredit, 0);
  const customersWithCredit = customers.filter(c => c.storeCredit > 0).length;
  
  return json({ 
    customers,
    stats: {
      totalCustomers: customers.length,
      customersWithCredit,
      totalStoreCredit
    }
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const customerId = formData.get("customerId") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const currency = formData.get("currency") as string || "USD";
  const actionType = formData.get("actionType") as string; // "add" or "remove"
  
  if (!customerId || !amount || isNaN(amount)) {
    return json({ 
      success: false, 
      error: "Customer ID and valid amount are required" 
    });
  }
  
  try {
    // Get the customer's Shopify ID
    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });
    
    if (!customer || customer.shopDomain !== session.shop) {
      return json({ 
        success: false, 
        error: "Customer not found" 
      });
    }
    
    // Check if removing more than available credit
    if (actionType === "remove" && amount > customer.storeCredit) {
      return json({ 
        success: false, 
        error: `Cannot remove $${amount.toFixed(2)}. Customer only has $${customer.storeCredit.toFixed(2)} available.` 
      });
    }
    
    // Determine the GraphQL mutation based on action type
    const mutation = actionType === "add" 
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
    
    const variables = actionType === "add"
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
    const result = await response.json();
    
    const mutationResult = actionType === "add" 
      ? result.data?.storeCreditAccountCredit
      : result.data?.storeCreditAccountDebit;
    
    if (mutationResult?.userErrors?.length > 0) {
      const errors = mutationResult.userErrors;
      return json({ 
        success: false, 
        error: errors.map((e: any) => e.message).join(", ")
      });
    }
    
    if (mutationResult?.storeCreditAccountTransaction) {
      // Update local database
      const updateAmount = actionType === "add" ? amount : -amount;
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          storeCredit: { increment: updateAmount }
        }
      });
      
      const actionWord = actionType === "add" ? "added" : "removed";
      return json({ 
        success: true,
        message: `Successfully ${actionWord} ${currency} ${amount.toFixed(2)} ${actionType === "add" ? "to" : "from"} ${customer.email}`
      });
    }
    
    return json({ 
      success: false, 
      error: `Failed to ${actionType} store credit`
    });
    
  } catch (error) {
    console.error("Store credit error:", error);
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : `Failed to ${actionType} store credit`
    });
  }
};

type ActionResponse = 
  | { success: true; message: string; error?: never }
  | { success: false; error: string; message?: never };

export default function StoreCredit() {
  const { customers, stats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [formActionType, setFormActionType] = useState<"add" | "remove">("add");
  const isSubmitting = navigation.state === "submitting";

  // Show notifications from action data
  useEffect(() => {
    if (actionData) {
      if (actionData.success && "message" in actionData) {
        setNotification({ type: 'success', message: actionData.message });
        setShowForm(false);
        setSelectedCustomerId("");
        setTimeout(() => setNotification(null), 5000);
      } else if (!actionData.success && "error" in actionData) {
        setNotification({ type: 'error', message: actionData.error });
        setTimeout(() => setNotification(null), 5000);
      }
    }
  }, [actionData]);

  // Filter customers based on search
  const filteredCustomers = customers.filter(customer => 
    customer.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.shopifyCustomerId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

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
    searchInput: {
      padding: "10px 14px",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "15px",
      backgroundColor: "white",
      transition: "border-color 0.2s",
      outline: "none",
      minWidth: "300px"
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
      alignItems: "center",
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
    creditBadge: {
      fontSize: "20px",
      padding: "8px 20px",
      borderRadius: "24px",
      fontWeight: "600",
      backgroundColor: "#e8f5e9",
      color: "#2e7d32"
    },
    noCreditBadge: {
      fontSize: "20px",
      padding: "8px 20px",
      borderRadius: "24px",
      fontWeight: "600",
      backgroundColor: "#f5f5f5",
      color: "#999"
    },
    actionRow: {
      display: "flex",
      gap: "12px",
      alignItems: "center",
      flexWrap: "wrap" as const
    },
    addButton: {
      padding: "8px 16px",
      backgroundColor: "#10B981",
      color: "white",
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "opacity 0.2s"
    },
    removeButton: {
      padding: "8px 16px",
      backgroundColor: "#EF4444",
      color: "white",
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "opacity 0.2s"
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
    creditForm: {
      backgroundColor: "#f8f9fa",
      padding: "24px",
      marginBottom: "24px",
      borderRadius: "12px",
      border: "1px solid #e0e0e0"
    },
    formTitle: {
      fontSize: "18px",
      fontWeight: "600",
      marginTop: 0,
      marginBottom: "8px",
      color: "#1a1a1a"
    },
    formSubtitle: {
      fontSize: "14px",
      color: "#666",
      marginBottom: "20px"
    },
    formGrid: {
      display: "grid",
      gridTemplateColumns: "1fr 150px",
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
      fontWeight: "500",
      marginBottom: "8px",
      color: "#333"
    },
    input: {
      padding: "10px 14px",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "15px",
      backgroundColor: "white",
      transition: "border-color 0.2s",
      outline: "none"
    },
    formActions: {
      display: "flex",
      gap: "12px"
    },
    cancelButton: {
      padding: "10px 20px",
      backgroundColor: "transparent",
      color: "#666",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    saveButton: {
      padding: "10px 20px",
      backgroundColor: "#10B981",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "opacity 0.2s"
    },
    warningText: {
      fontSize: "14px",
      color: "#e65100",
      backgroundColor: "#fff3e0",
      padding: "12px",
      borderRadius: "6px",
      marginBottom: "16px"
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Store Credit Management</h1>
        <p style={styles.subtitle}>Add or remove store credit for customers</p>
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
          <h3 style={styles.statValue}>{stats.customersWithCredit}</h3>
          <p style={styles.statLabel}>Customers with Credit</p>
        </div>
        <div style={styles.statCard}>
          <h3 style={styles.statValue}>${stats.totalStoreCredit.toFixed(2)}</h3>
          <p style={styles.statLabel}>Total Store Credit</p>
        </div>
      </div>

      {/* Search */}
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Customers</h2>
        <input
          type="text"
          placeholder="Search by email or customer ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
          onFocus={(e) => e.currentTarget.style.borderColor = '#1a1a1a'}
          onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
        />
      </div>

      {/* Credit Form */}
      {showForm && selectedCustomerId && selectedCustomer && (
        <Form method="post" style={styles.creditForm}>
          <h3 style={styles.formTitle}>
            {formActionType === "add" ? "Add" : "Remove"} Store Credit
          </h3>
          <p style={styles.formSubtitle}>
            {selectedCustomer.email} • Current balance: ${selectedCustomer.storeCredit.toFixed(2)}
          </p>
          
          {formActionType === "remove" && selectedCustomer.storeCredit === 0 && (
            <div style={styles.warningText}>
              ⚠️ This customer has no store credit to remove.
            </div>
          )}
          
          <input type="hidden" name="customerId" value={selectedCustomerId} />
          <input type="hidden" name="actionType" value={formActionType} />
          
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Amount</label>
              <input
                type="number"
                name="amount"
                step="0.01"
                min="0.01"
                max={formActionType === "remove" ? selectedCustomer.storeCredit : undefined}
                required
                placeholder={formActionType === "remove" ? `Max: ${selectedCustomer.storeCredit.toFixed(2)}` : "10.00"}
                style={styles.input}
                onFocus={(e) => e.currentTarget.style.borderColor = '#1a1a1a'}
                onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
              />
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Currency</label>
              <select
                name="currency"
                style={styles.input}
                defaultValue="USD"
                onFocus={(e) => e.currentTarget.style.borderColor = '#1a1a1a'}
                onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
              >
                <option value="USD">USD</option>
                <option value="CAD">CAD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>
          
          <div style={styles.formActions}>
            <button
              type="submit"
              disabled={isSubmitting || (formActionType === "remove" && selectedCustomer.storeCredit === 0)}
              style={{
                ...styles.saveButton,
                backgroundColor: formActionType === "add" ? "#10B981" : "#EF4444",
                opacity: (isSubmitting || (formActionType === "remove" && selectedCustomer.storeCredit === 0)) ? 0.6 : 1,
                cursor: (isSubmitting || (formActionType === "remove" && selectedCustomer.storeCredit === 0)) ? "not-allowed" : "pointer"
              }}
            >
              {isSubmitting ? "Processing..." : `${formActionType === "add" ? "Add" : "Remove"} Credit`}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
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
      )}

      {/* Customer List */}
      <div>
        {filteredCustomers.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyStateTitle}>
              {searchTerm ? "No customers found" : "No customers yet"}
            </h3>
            <p style={styles.emptyStateText}>
              {searchTerm 
                ? "Try adjusting your search terms" 
                : "Customers will appear here once they're created"}
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
                  <p style={styles.customerId}>
                    Customer ID: {customer.shopifyCustomerId} • 
                    Total Earned: ${customer.totalEarned.toFixed(2)}
                  </p>
                </div>
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

              <div style={styles.actionRow}>
                <button
                  onClick={() => {
                    setSelectedCustomerId(customer.id);
                    setFormActionType("add");
                    setShowForm(true);
                  }}
                  style={styles.addButton}
                  onMouseOver={(e) => e.currentTarget.style.opacity = '0.8'}
                  onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                >
                  + Add Credit
                </button>
                <button
                  onClick={() => {
                    setSelectedCustomerId(customer.id);
                    setFormActionType("remove");
                    setShowForm(true);
                  }}
                  style={styles.removeButton}
                  disabled={customer.storeCredit === 0}
                  onMouseOver={(e) => {
                    if (customer.storeCredit > 0) {
                      e.currentTarget.style.opacity = '0.8';
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
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}