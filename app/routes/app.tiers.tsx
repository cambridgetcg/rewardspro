// app/routes/app.tiers.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation, useFetcher, useActionData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect } from "react";
import { EvaluationPeriod } from "@prisma/client";
import { getTierDistribution, batchEvaluateCustomerTiers, handleExpiredMemberships } from "../services/customer-tier.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  const tierDistribution = await getTierDistribution(session.shop);

  // Get total customers and total cashback earned
  const [totalCustomers, totalCashback] = await Promise.all([
    prisma.customer.count({ where: { shopDomain: session.shop } }),
    prisma.cashbackTransaction.aggregate({
      where: { shopDomain: session.shop },
      _sum: { cashbackAmount: true }
    })
  ]);

  return json({ 
    tiers: tierDistribution,
    stats: {
      totalCustomers,
      totalCashback: totalCashback._sum.cashbackAmount || 0,
      activeTiers: tierDistribution.filter(t => t.isActive).length,
      totalMembers: tierDistribution.reduce((sum, t) => sum + t.memberCount, 0)
    }
  });
}

type ActionResponse = 
  | { success: true; message?: string; error?: never }
  | { success: false; error: string; message?: never };

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const action = formData.get("_action");
  
  try {
    if (action === "update") {
      const tierId = formData.get("tierId") as string;
      const name = formData.get("name") as string;
      const minSpend = formData.get("minSpend");
      const cashbackPercent = formData.get("cashbackPercent");
      const isActive = formData.get("isActive") === "true";
      
      // Get the current tier to check if name is actually changing
      const currentTier = await prisma.tier.findUnique({
        where: { id: tierId, shopDomain: session.shop }
      });
      
      if (!currentTier) {
        return json<ActionResponse>({ success: false, error: "Tier not found" }, { status: 404 });
      }
      
      // Only check for duplicate if name is actually changing
      if (name && name !== currentTier.name) {
        const existingTier = await prisma.tier.findFirst({
          where: { 
            shopDomain: session.shop, 
            name,
            id: { not: tierId }
          }
        });
        
        if (existingTier) {
          return json<ActionResponse>({ success: false, error: "A tier with this name already exists" }, { status: 400 });
        }
      }
      
      await prisma.tier.update({
        where: { id: tierId, shopDomain: session.shop },
        data: {
          name: name || currentTier.name,
          minSpend: minSpend ? parseFloat(minSpend as string) : null,
          cashbackPercent: parseFloat(cashbackPercent as string),
          evaluationPeriod: formData.get("evaluationPeriod") as EvaluationPeriod || currentTier.evaluationPeriod,
          isActive,
        },
      });
      
      return json<ActionResponse>({ success: true, message: "Tier updated successfully" });
    } else if (action === "create") {
      const name = formData.get("name") as string;
      const cashbackPercent = parseFloat(formData.get("cashbackPercent") as string);
      const evaluationPeriod = formData.get("evaluationPeriod") as EvaluationPeriod;
      
      // Check for duplicate name
      const existingTier = await prisma.tier.findFirst({
        where: { shopDomain: session.shop, name }
      });
      
      if (existingTier) {
        return json<ActionResponse>({ success: false, error: "A tier with this name already exists" }, { status: 400 });
      }
      
      await prisma.tier.create({
        data: {
          shopDomain: session.shop,
          name,
          minSpend: formData.get("minSpend") ? parseFloat(formData.get("minSpend") as string) : null,
          cashbackPercent,
          evaluationPeriod: evaluationPeriod || EvaluationPeriod.ANNUAL,
          isActive: true,
        },
      });
      
      return json<ActionResponse>({ success: true, message: "Tier created successfully" });
    } else if (action === "delete") {
      const tierId = formData.get("tierId") as string;
      
      // Check if tier has active members
      const memberCount = await prisma.customerMembership.count({
        where: { tierId, isActive: true }
      });
      
      if (memberCount > 0) {
        return json<ActionResponse>({ success: false, error: "Cannot delete tier with active members. Please reassign members first." }, { status: 400 });
      }
      
      await prisma.tier.delete({
        where: { id: tierId, shopDomain: session.shop },
      });
      
      return json<ActionResponse>({ success: true, message: "Tier deleted successfully" });
    } else if (action === "evaluateAll") {
      // Batch evaluate all customers
      const result = await batchEvaluateCustomerTiers(session.shop);
      return json<ActionResponse>({ 
        success: true, 
        message: `Evaluated ${result.totalProcessed} customers. ${result.successful} updated, ${result.failed} failed.` 
      });
    } else if (action === "handleExpired") {
      // Handle expired memberships
      const results = await handleExpiredMemberships(session.shop);
      const successful = results.filter(r => r.success).length;
      return json<ActionResponse>({ 
        success: true, 
        message: `Processed ${results.length} expired memberships. ${successful} updated successfully.` 
      });
    }
  } catch (error) {
    console.error('Tier operation error:', error);
    return json<ActionResponse>({ success: false, error: "An error occurred. Please try again." }, { status: 500 });
  }
  
  return json<ActionResponse>({ success: true });
}

export default function TierSettings() {
  const { tiers, stats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const isSubmitting = navigation.state === "submitting";

  // Show notifications from action data
  useEffect(() => {
    if (actionData) {
      if ('success' in actionData && actionData.success) {
        setNotification({ type: 'success', message: actionData.message || 'Operation successful' });
        setShowCreateForm(false);
        setEditingTierId(null);
        setTimeout(() => setNotification(null), 5000);
      } else if ('error' in actionData && actionData.error) {
        setNotification({ type: 'error', message: actionData.error });
        setTimeout(() => setNotification(null), 7000);
      }
    }
  }, [actionData]);

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
      fontSize: "28px",
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
      gap: "20px",
      marginBottom: "32px"
    },
    statCard: {
      backgroundColor: "#f8f9fa",
      padding: "20px",
      borderRadius: "8px",
      textAlign: "center" as const
    },
    statValue: {
      fontSize: "28px",
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
      marginBottom: "24px"
    },
    sectionTitle: {
      fontSize: "20px",
      fontWeight: "600",
      margin: 0,
      color: "#1a1a1a"
    },
    buttonGroup: {
      display: "flex",
      gap: "12px"
    },
    button: {
      padding: "10px 16px",
      backgroundColor: "#1a1a1a",
      color: "white",
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "opacity 0.2s"
    },
    secondaryButton: {
      padding: "10px 16px",
      backgroundColor: "transparent",
      color: "#1a1a1a",
      border: "1px solid #e0e0e0",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    form: {
      backgroundColor: "#f8f9fa",
      padding: "24px",
      marginBottom: "24px",
      borderRadius: "8px",
      border: "1px solid #e0e0e0"
    },
    formTitle: {
      fontSize: "18px",
      fontWeight: "600",
      marginTop: 0,
      marginBottom: "20px",
      color: "#1a1a1a"
    },
    formGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
      gap: "16px",
      marginBottom: "20px"
    },
    formGroup: {
      display: "flex",
      flexDirection: "column" as const
    },
    label: {
      fontSize: "14px",
      fontWeight: "500",
      marginBottom: "6px",
      color: "#333"
    },
    input: {
      padding: "8px 12px",
      border: "1px solid #e0e0e0",
      borderRadius: "6px",
      fontSize: "14px",
      backgroundColor: "white",
      transition: "border-color 0.2s",
      outline: "none"
    },
    helpText: {
      fontSize: "12px",
      color: "#666",
      marginTop: "4px"
    },
    tierTable: {
      width: "100%",
      borderCollapse: "collapse" as const,
      backgroundColor: "white",
      borderRadius: "8px",
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
    },
    tableHeader: {
      backgroundColor: "#f8f9fa",
      borderBottom: "1px solid #e0e0e0"
    },
    th: {
      padding: "12px 16px",
      textAlign: "left" as const,
      fontSize: "14px",
      fontWeight: "600",
      color: "#333"
    },
    td: {
      padding: "12px 16px",
      borderBottom: "1px solid #f0f0f0",
      fontSize: "14px",
      color: "#666"
    },
    badge: {
      fontSize: "12px",
      padding: "4px 8px",
      borderRadius: "4px",
      fontWeight: "500",
      display: "inline-block"
    },
    activeBadge: {
      backgroundColor: "#e8f5e9",
      color: "#2e7d32"
    },
    inactiveBadge: {
      backgroundColor: "#fff3e0",
      color: "#e65100"
    },
    notification: {
      padding: "16px 20px",
      borderRadius: "6px",
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
      borderRadius: "8px",
      border: "1px solid #e0e0e0"
    },
    actionButtons: {
      display: "flex",
      gap: "8px"
    },
    linkButton: {
      background: "none",
      border: "none",
      color: "#0066cc",
      cursor: "pointer",
      fontSize: "14px",
      textDecoration: "underline"
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Tier Management</h1>
        <p style={styles.subtitle}>Configure customer tiers and rewards</p>
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
          <h3 style={styles.statValue}>{stats.activeTiers}</h3>
          <p style={styles.statLabel}>Active Tiers</p>
        </div>
        <div style={styles.statCard}>
          <h3 style={styles.statValue}>{stats.totalMembers}</h3>
          <p style={styles.statLabel}>Total Members</p>
        </div>
        <div style={styles.statCard}>
          <h3 style={styles.statValue}>{stats.totalCustomers}</h3>
          <p style={styles.statLabel}>Total Customers</p>
        </div>
        <div style={styles.statCard}>
          <h3 style={styles.statValue}>${stats.totalCashback.toFixed(2)}</h3>
          <p style={styles.statLabel}>Total Cashback Earned</p>
        </div>
      </div>

      {/* Actions Section */}
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Tiers</h2>
        <div style={styles.buttonGroup}>
          <Form method="post" style={{ display: "inline" }}>
            <input type="hidden" name="_action" value="evaluateAll" />
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                ...styles.secondaryButton,
                opacity: isSubmitting ? 0.6 : 1,
                cursor: isSubmitting ? "not-allowed" : "pointer"
              }}
            >
              Re-evaluate All Customers
            </button>
          </Form>
          <Form method="post" style={{ display: "inline" }}>
            <input type="hidden" name="_action" value="handleExpired" />
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                ...styles.secondaryButton,
                opacity: isSubmitting ? 0.6 : 1,
                cursor: isSubmitting ? "not-allowed" : "pointer"
              }}
            >
              Process Expired Memberships
            </button>
          </Form>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            style={styles.button}
          >
            {showCreateForm ? "Cancel" : "+ Add Tier"}
          </button>
        </div>
      </div>
      
      {/* Create Form */}
      {showCreateForm && (
        <Form method="post" style={styles.form}>
          <input type="hidden" name="_action" value="create" />
          <h3 style={styles.formTitle}>Create New Tier</h3>
          
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Tier Name*</label>
              <input
                type="text"
                name="name"
                required
                placeholder="e.g., Silver, Gold, Platinum"
                style={styles.input}
              />
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Cashback %*</label>
              <input
                type="number"
                name="cashbackPercent"
                required
                placeholder="5"
                step="0.1"
                min="0"
                max="100"
                style={styles.input}
              />
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Minimum Spend</label>
              <input
                type="number"
                name="minSpend"
                placeholder="0.00"
                min="0"
                step="0.01"
                style={styles.input}
              />
              <span style={styles.helpText}>Leave empty for base tier</span>
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Evaluation Period*</label>
              <select
                name="evaluationPeriod"
                required
                style={styles.input}
              >
                <option value="ANNUAL">12-month rolling</option>
                <option value="LIFETIME">Lifetime (never expires)</option>
              </select>
            </div>
          </div>
          
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...styles.button,
              opacity: isSubmitting ? 0.6 : 1,
              cursor: isSubmitting ? "not-allowed" : "pointer"
            }}
          >
            {isSubmitting ? "Creating..." : "Create Tier"}
          </button>
        </Form>
      )}
      
      {/* Tiers Table */}
      <div>
        {tiers.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={{ fontSize: "20px", fontWeight: "600", marginBottom: "8px", color: "#1a1a1a" }}>
              No tiers yet
            </h3>
            <p style={{ fontSize: "16px", color: "#666", marginBottom: "24px" }}>
              Create your first tier to start rewarding customers
            </p>
            <button
              onClick={() => setShowCreateForm(true)}
              style={styles.button}
            >
              Create First Tier
            </button>
          </div>
        ) : (
          <table style={styles.tierTable}>
            <thead style={styles.tableHeader}>
              <tr>
                <th style={styles.th}>Tier Name</th>
                <th style={styles.th}>Cashback %</th>
                <th style={styles.th}>Min Spend</th>
                <th style={styles.th}>Evaluation</th>
                <th style={styles.th}>Members</th>
                <th style={styles.th}>Avg Yearly Spend</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier.id}>
                  {editingTierId === tier.id ? (
                    <td colSpan={8} style={{ padding: 0 }}>
                      <Form method="post" style={{ ...styles.form, margin: 0, borderRadius: 0 }}>
                        <input type="hidden" name="_action" value="update" />
                        <input type="hidden" name="tierId" value={tier.id} />
                        
                        <div style={styles.formGrid}>
                          <div style={styles.formGroup}>
                            <label style={styles.label}>Tier Name*</label>
                            <input
                              type="text"
                              name="name"
                              defaultValue={tier.name}
                              required
                              style={styles.input}
                            />
                          </div>
                          
                          <div style={styles.formGroup}>
                            <label style={styles.label}>Cashback %*</label>
                            <input
                              type="number"
                              name="cashbackPercent"
                              defaultValue={tier.cashbackPercent}
                              required
                              step="0.1"
                              min="0"
                              max="100"
                              style={styles.input}
                            />
                          </div>
                          
                          <div style={styles.formGroup}>
                            <label style={styles.label}>Minimum Spend</label>
                            <input
                              type="number"
                              name="minSpend"
                              defaultValue={tier.minSpend || ""}
                              placeholder="No minimum"
                              min="0"
                              step="0.01"
                              style={styles.input}
                            />
                          </div>
                          
                          <div style={styles.formGroup}>
                            <label style={styles.label}>Evaluation Period*</label>
                            <select
                              name="evaluationPeriod"
                              defaultValue={tier.evaluationPeriod}
                              style={styles.input}
                            >
                              <option value="ANNUAL">12-month rolling</option>
                              <option value="LIFETIME">Lifetime (never expires)</option>
                            </select>
                          </div>
                          
                          <div style={styles.formGroup}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <input
                                type="checkbox"
                                name="isActive"
                                value="true"
                                defaultChecked={tier.isActive}
                              />
                              Active
                            </label>
                          </div>
                        </div>
                        
                        <div style={styles.actionButtons}>
                          <button
                            type="submit"
                            disabled={isSubmitting}
                            style={{
                              ...styles.button,
                              opacity: isSubmitting ? 0.6 : 1,
                              cursor: isSubmitting ? "not-allowed" : "pointer"
                            }}
                          >
                            {isSubmitting ? "Saving..." : "Save Changes"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingTierId(null)}
                            style={styles.secondaryButton}
                          >
                            Cancel
                          </button>
                        </div>
                      </Form>
                    </td>
                  ) : (
                    <>
                      <td style={styles.td}>
                        <strong>{tier.name}</strong>
                      </td>
                      <td style={styles.td}>{tier.cashbackPercent}%</td>
                      <td style={styles.td}>
                        {tier.minSpend ? `${tier.minSpend.toFixed(2)}` : "No minimum"}
                      </td>
                      <td style={styles.td}>
                        {tier.evaluationPeriod === 'LIFETIME' ? 'Lifetime' : '12-month'}
                      </td>
                      <td style={styles.td}>
                        {tier.memberCount}
                      </td>
                      <td style={styles.td}>
                        ${tier.avgYearlySpending.toFixed(2)}
                      </td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.badge,
                          ...(tier.isActive ? styles.activeBadge : styles.inactiveBadge)
                        }}>
                          {tier.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <div style={styles.actionButtons}>
                          <button
                            onClick={() => setEditingTierId(tier.id)}
                            style={styles.linkButton}
                          >
                            Edit
                          </button>
                          <fetcher.Form method="post" style={{ display: "inline" }}>
                            <input type="hidden" name="_action" value="delete" />
                            <input type="hidden" name="tierId" value={tier.id} />
                            <button
                              type="submit"
                              disabled={tier.memberCount > 0}
                              title={tier.memberCount > 0 ? "Cannot delete tier with members" : "Delete tier"}
                              style={{
                                ...styles.linkButton,
                                color: tier.memberCount > 0 ? "#999" : "#dc3545",
                                cursor: tier.memberCount > 0 ? "not-allowed" : "pointer",
                                textDecoration: tier.memberCount > 0 ? "none" : "underline"
                              }}
                            >
                              Delete
                            </button>
                          </fetcher.Form>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}