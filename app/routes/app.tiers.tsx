// app/routes/app.tiers.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation, useFetcher, useActionData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect } from "react";
import { EvaluationPeriod } from "@prisma/client";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  const tiers = await prisma.tier.findMany({
    where: { shopDomain: session.shop },
    orderBy: { level: "asc" },
  });

  // Get member count for each tier
  const tierMemberCounts = await prisma.customerMembership.groupBy({
    by: ['tierId'],
    where: { isActive: true },
    _count: true,
  });

  const tiersWithCounts = tiers.map(tier => ({
    ...tier,
    memberCount: tierMemberCounts.find(t => t.tierId === tier.id)?._count || 0
  }));

  // Get total customers and total cashback earned
  const [totalCustomers, totalCashback] = await Promise.all([
    prisma.customer.count({ where: { shopDomain: session.shop } }),
    prisma.cashbackTransaction.aggregate({
      where: { shopDomain: session.shop },
      _sum: { cashbackAmount: true }
    })
  ]);

  return json({ 
    tiers: tiersWithCounts,
    stats: {
      totalCustomers,
      totalCashback: totalCashback._sum.cashbackAmount || 0
    }
  });
}

// Helper function to recalculate all tier levels based on cashback percentage
async function recalculateTierLevels(shopDomain: string) {
  // Get all tiers sorted by cashback percentage (highest first)
  const tiers = await prisma.tier.findMany({
    where: { shopDomain },
    orderBy: { cashbackPercent: 'desc' }
  });

  // Update each tier's level based on cashback percentage ranking
  for (let i = 0; i < tiers.length; i++) {
    await prisma.tier.update({
      where: { id: tiers[i].id },
      data: { level: i + 1 }
    });
  }
}

// Define action response type
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
            name
          }
        });
        
        if (existingTier) {
          return json<ActionResponse>({ success: false, error: "A tier with this name already exists" }, { status: 400 });
        }
      }
      
      await prisma.tier.update({
        where: { id: tierId, shopDomain: session.shop },
        data: {
          name: name || currentTier.name, // Use existing name if not provided
          minSpend: minSpend ? parseFloat(minSpend as string) : null,
          cashbackPercent: parseFloat(cashbackPercent as string),
          evaluationPeriod: formData.get("evaluationPeriod") as EvaluationPeriod || currentTier.evaluationPeriod,
          isActive,
        },
      });
      
      // Recalculate levels after update
      await recalculateTierLevels(session.shop);
      
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
      
      // Create the tier with a temporary level
      await prisma.tier.create({
        data: {
          shopDomain: session.shop,
          name,
          level: 999, // Temporary level, will be recalculated
          minSpend: formData.get("minSpend") ? parseFloat(formData.get("minSpend") as string) : null,
          cashbackPercent,
          evaluationPeriod: evaluationPeriod || EvaluationPeriod.ANNUAL,
          isActive: true,
        },
      });
      
      // Recalculate all levels based on cashback percentage
      await recalculateTierLevels(session.shop);
      
      return json<ActionResponse>({ success: true, message: "Tier created and levels recalculated" });
    } else if (action === "delete") {
      const tierId = formData.get("tierId") as string;
      
      // Check if tier has active members
      const memberCount = await prisma.customerMembership.count({
        where: { tierId, isActive: true }
      });
      
      if (memberCount > 0) {
        return json<ActionResponse>({ success: false, error: "Cannot delete tier with active members" }, { status: 400 });
      }
      
      await prisma.tier.delete({
        where: { id: tierId, shopDomain: session.shop },
      });
      
      // Recalculate remaining tier levels
      await recalculateTierLevels(session.shop);
      
      return json<ActionResponse>({ success: true, message: "Tier deleted and levels recalculated" });
    }
  } catch (error) {
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
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const isSubmitting = navigation.state === "submitting";

  // Show notifications from action data
  useEffect(() => {
    if (actionData) {
      if ('success' in actionData && actionData.success) {
        setNotification({ type: 'success', message: actionData.message || 'Operation successful' });
        setShowCreateForm(false);
        setTimeout(() => setNotification(null), 5000);
      } else if ('error' in actionData && actionData.error) {
        setNotification({ type: 'error', message: actionData.error });
        setTimeout(() => setNotification(null), 5000);
      }
    }
  }, [actionData]);

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
    infoBox: {
      backgroundColor: "#e3f2fd",
      border: "1px solid #90caf9",
      borderRadius: "8px",
      padding: "16px",
      marginBottom: "24px",
      fontSize: "14px",
      color: "#1565c0"
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
      marginBottom: "24px"
    },
    sectionTitle: {
      fontSize: "20px",
      fontWeight: "600",
      margin: 0,
      color: "#1a1a1a"
    },
    addButton: {
      padding: "10px 20px",
      backgroundColor: "#1a1a1a",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "opacity 0.2s",
      ":hover": {
        opacity: 0.8
      }
    },
    createForm: {
      backgroundColor: "#f8f9fa",
      padding: "32px",
      marginBottom: "32px",
      borderRadius: "12px",
      border: "1px solid #e0e0e0"
    },
    formTitle: {
      fontSize: "18px",
      fontWeight: "600",
      marginTop: 0,
      marginBottom: "24px",
      color: "#1a1a1a"
    },
    formGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
      gap: "20px",
      marginBottom: "24px"
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
    helpText: {
      fontSize: "12px",
      color: "#666",
      marginTop: "4px"
    },
    tierCard: {
      backgroundColor: "white",
      padding: "24px",
      marginBottom: "16px",
      borderRadius: "12px",
      border: "1px solid #e0e0e0",
      position: "relative" as const,
      transition: "box-shadow 0.2s"
    },
    tierHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: "20px"
    },
    tierName: {
      fontSize: "20px",
      fontWeight: "600",
      margin: 0,
      color: "#1a1a1a"
    },
    tierMeta: {
      display: "flex",
      gap: "12px",
      alignItems: "center",
      marginTop: "4px"
    },
    badge: {
      fontSize: "12px",
      padding: "4px 12px",
      borderRadius: "16px",
      fontWeight: "500"
    },
    activeBadge: {
      backgroundColor: "#e8f5e9",
      color: "#2e7d32"
    },
    inactiveBadge: {
      backgroundColor: "#fff3e0",
      color: "#e65100"
    },
    levelBadge: {
      backgroundColor: "#e3f2fd",
      color: "#1565c0"
    },
    memberCount: {
      fontSize: "14px",
      color: "#666"
    },
    tierForm: {
      display: "grid",
      gridTemplateColumns: "1.5fr 1fr 1fr 1.2fr auto",
      gap: "16px",
      alignItems: "flex-end"
    },
    deleteButton: {
      position: "absolute" as const,
      top: "24px",
      right: "24px",
      padding: "6px 12px",
      backgroundColor: "transparent",
      color: "#dc3545",
      border: "1px solid #dc3545",
      borderRadius: "6px",
      cursor: "pointer",
      fontSize: "13px",
      transition: "all 0.2s"
    },
    saveButton: {
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
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Rewards Tiers</h1>
        <p style={styles.subtitle}>Build customer loyalty with simple, transparent cashback rewards</p>
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

      {/* Info Box */}
      <div style={styles.infoBox}>
        <strong>ℹ️ Tier Level System:</strong> Tiers are automatically ordered by cashback percentage. 
        The tier with the highest cashback % becomes Level 1 (top tier), and so on. 
        Levels are recalculated whenever tiers are created, updated, or deleted.
      </div>

      {/* Stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <h3 style={styles.statValue}>{tiers.filter(t => t.isActive).length}</h3>
          <p style={styles.statLabel}>Active Tiers</p>
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

      {/* Tiers Section */}
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Tier Configuration</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          style={styles.addButton}
          onMouseOver={(e) => e.currentTarget.style.opacity = '0.8'}
          onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
        >
          {showCreateForm ? "Cancel" : "+ Add Tier"}
        </button>
      </div>
      
      {/* Create Form */}
      {showCreateForm && (
        <Form method="post" style={styles.createForm}>
          <input type="hidden" name="_action" value="create" />
          <h3 style={styles.formTitle}>Create New Tier</h3>
          
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Tier Name</label>
              <input
                type="text"
                name="name"
                required
                placeholder="e.g., Silver, Gold, Platinum"
                style={styles.input}
                onFocus={(e) => e.target.style.borderColor = '#1a1a1a'}
                onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
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
                onFocus={(e) => e.target.style.borderColor = '#1a1a1a'}
                onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
              />
              <span style={styles.helpText}>Leave empty for base tier</span>
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Cashback %</label>
              <input
                type="number"
                name="cashbackPercent"
                required
                placeholder="5"
                step="0.1"
                min="0"
                max="100"
                style={styles.input}
                onFocus={(e) => e.target.style.borderColor = '#1a1a1a'}
                onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
              />
              <span style={styles.helpText}>Higher % = Higher tier level</span>
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Evaluation Period</label>
              <select
                name="evaluationPeriod"
                required
                style={styles.input}
                onFocus={(e) => e.target.style.borderColor = '#1a1a1a'}
                onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
              >
                <option value="ANNUAL">12-month rolling</option>
                <option value="LIFETIME">Lifetime (never expires)</option>
              </select>
              <span style={styles.helpText}>How far back to calculate spending</span>
            </div>
          </div>
          
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...styles.saveButton,
              opacity: isSubmitting ? 0.6 : 1,
              cursor: isSubmitting ? "not-allowed" : "pointer"
            }}
          >
            {isSubmitting ? "Creating..." : "Create Tier"}
          </button>
        </Form>
      )}
      
      {/* Tiers List */}
      <div>
        {tiers.length === 0 ? (
          <div style={styles.emptyState}>
            <h3 style={styles.emptyStateTitle}>No tiers yet</h3>
            <p style={styles.emptyStateText}>Create your first tier to start rewarding customers</p>
            <button
              onClick={() => setShowCreateForm(true)}
              style={styles.saveButton}
            >
              Create First Tier
            </button>
          </div>
        ) : (
          tiers.map((tier) => (
            <div 
              key={tier.id} 
              style={{
                ...styles.tierCard,
                opacity: tier.isActive ? 1 : 0.7
              }}
              onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
              onMouseOut={(e) => e.currentTarget.style.boxShadow = 'none'}
            >
              {/* Delete button */}
              <fetcher.Form method="post">
                <input type="hidden" name="_action" value="delete" />
                <input type="hidden" name="tierId" value={tier.id} />
                <button
                  type="submit"
                  disabled={tier.memberCount > 0 || fetcher.state === "submitting"}
                  title={tier.memberCount > 0 ? `${tier.memberCount} active members` : "Delete tier"}
                  style={{
                    ...styles.deleteButton,
                    opacity: tier.memberCount > 0 ? 0.5 : 1,
                    cursor: tier.memberCount > 0 ? "not-allowed" : "pointer"
                  }}
                  onMouseOver={(e) => {
                    if (tier.memberCount === 0) {
                      e.currentTarget.style.backgroundColor = '#dc3545';
                      e.currentTarget.style.color = 'white';
                    }
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#dc3545';
                  }}
                >
                  Delete
                </button>
              </fetcher.Form>
              
              <div style={styles.tierHeader}>
                <div>
                  <h3 style={styles.tierName}>{tier.name}</h3>
                  <div style={styles.tierMeta}>
                    <span style={{
                      ...styles.badge,
                      ...(tier.isActive ? styles.activeBadge : styles.inactiveBadge)
                    }}>
                      {tier.isActive ? "Active" : "Inactive"}
                    </span>
                    <span style={{
                      ...styles.badge,
                      ...styles.levelBadge
                    }}>
                      Level {tier.level} {tier.level === 1 && "👑"}
                    </span>
                    <span style={styles.memberCount}>
                      {tier.cashbackPercent}% cashback
                    </span>
                    <span style={styles.memberCount}>
                      • {tier.evaluationPeriod === 'LIFETIME' ? 'Lifetime' : '12-month'} evaluation
                    </span>
                    {tier.memberCount > 0 && (
                      <span style={styles.memberCount}>
                        • {tier.memberCount} {tier.memberCount === 1 ? 'member' : 'members'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <Form method="post">
                <input type="hidden" name="_action" value="update" />
                <input type="hidden" name="tierId" value={tier.id} />
                
                <div style={styles.tierForm}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Tier Name</label>
                    <input
                      type="text"
                      name="name"
                      defaultValue={tier.name}
                      required
                      placeholder="Tier name"
                      style={styles.input}
                      onFocus={(e) => e.target.style.borderColor = '#1a1a1a'}
                      onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
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
                      onFocus={(e) => e.target.style.borderColor = '#1a1a1a'}
                      onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
                    />
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Cashback %</label>
                    <input
                      type="number"
                      name="cashbackPercent"
                      defaultValue={tier.cashbackPercent}
                      step="0.1"
                      min="0"
                      max="100"
                      required
                      style={styles.input}
                      onFocus={(e) => e.target.style.borderColor = '#1a1a1a'}
                      onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
                    />
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Evaluation Period</label>
                    <select
                      name="evaluationPeriod"
                      defaultValue={tier.evaluationPeriod}
                      style={styles.input}
                      onFocus={(e) => e.target.style.borderColor = '#1a1a1a'}
                      onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
                    >
                      <option value="ANNUAL">12-month rolling</option>
                      <option value="LIFETIME">Lifetime (never expires)</option>
                    </select>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
                      <input
                        type="checkbox"
                        name="isActive"
                        value="true"
                        defaultChecked={tier.isActive}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      Active
                    </label>
                    
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={{
                        ...styles.saveButton,
                        opacity: isSubmitting ? 0.6 : 1,
                        cursor: isSubmitting ? "not-allowed" : "pointer"
                      }}
                    >
                      {isSubmitting ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              </Form>
            </div>
          ))
        )}
      </div>
    </div>
  );
}