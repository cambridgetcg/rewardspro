// app/routes/app.tiers.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation, useFetcher } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState } from "react";

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

  return json({ tiers: tiersWithCounts });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const action = formData.get("_action");
  
  if (action === "update") {
    const tierId = formData.get("tierId") as string;
    const minSpend = formData.get("minSpend");
    const cashbackPercent = formData.get("cashbackPercent");
    const isActive = formData.get("isActive") === "true";
    
    await prisma.tier.update({
      where: { id: tierId, shopDomain: session.shop },
      data: {
        minSpend: minSpend ? parseFloat(minSpend as string) : null,
        cashbackPercent: parseFloat(cashbackPercent as string),
        isActive,
      },
    });
  } else if (action === "create") {
    const name = formData.get("name") as string;
    
    // Check for duplicate name
    const existingTier = await prisma.tier.findFirst({
      where: { shopDomain: session.shop, name }
    });
    
    if (existingTier) {
      return json({ error: "A tier with this name already exists" }, { status: 400 });
    }
    
    const maxLevel = await prisma.tier.findFirst({
      where: { shopDomain: session.shop },
      orderBy: { level: 'desc' },
      select: { level: true }
    });
    
    await prisma.tier.create({
      data: {
        shopDomain: session.shop,
        name,
        level: (maxLevel?.level || 0) + 1,
        minSpend: formData.get("minSpend") ? parseFloat(formData.get("minSpend") as string) : null,
        cashbackPercent: parseFloat(formData.get("cashbackPercent") as string),
        isActive: true,
      },
    });
  } else if (action === "delete") {
    const tierId = formData.get("tierId") as string;
    
    // Check if tier has active members
    const memberCount = await prisma.customerMembership.count({
      where: { tierId, isActive: true }
    });
    
    if (memberCount > 0) {
      return json({ error: "Cannot delete tier with active members" }, { status: 400 });
    }
    
    const deletedTier = await prisma.tier.delete({
      where: { id: tierId, shopDomain: session.shop },
    });
    
    // Reorder remaining tiers
    await prisma.tier.updateMany({
      where: {
        shopDomain: session.shop,
        level: { gt: deletedTier.level }
      },
      data: {
        level: { decrement: 1 }
      }
    });
  }
  
  return json({ success: true });
}

export default function TierSettings() {
  const { tiers } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const isSubmitting = navigation.state === "submitting";

  return (
    <div style={{ padding: "20px", maxWidth: "800px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h1 style={{ fontSize: "24px", margin: 0 }}>Tier Settings</h1>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          style={{
            padding: "8px 16px",
            backgroundColor: "#10B981",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px"
          }}
        >
          {showCreateForm ? "Cancel" : "+ Add New Tier"}
        </button>
      </div>
      
      {/* Create new tier form */}
      {showCreateForm && (
        <Form method="post" style={{ 
          backgroundColor: "#e0f2fe", 
          padding: "20px", 
          marginBottom: "20px", 
          borderRadius: "8px",
          border: "2px solid #0284c7"
        }}>
          <input type="hidden" name="_action" value="create" />
          <h3 style={{ marginTop: 0, marginBottom: "15px" }}>Create New Tier</h3>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", marginBottom: "15px" }}>
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "14px" }}>
                Tier Name
              </label>
              <input
                type="text"
                name="name"
                required
                placeholder="e.g., Gold, Platinum, Diamond"
                style={{
                  width: "100%",
                  padding: "8px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  fontSize: "16px"
                }}
              />
            </div>
            
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "14px" }}>
                Minimum Lifetime Spend ($)
              </label>
              <input
                type="number"
                name="minSpend"
                placeholder="e.g., 1000 (leave empty for base tier)"
                min="0"
                step="0.01"
                style={{
                  width: "100%",
                  padding: "8px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  fontSize: "16px"
                }}
              />
            </div>
            
            <div>
              <label style={{ display: "block", marginBottom: "5px", fontSize: "14px" }}>
                Cashback Percentage (%)
              </label>
              <input
                type="number"
                name="cashbackPercent"
                required
                placeholder="e.g., 5"
                step="0.1"
                min="0"
                max="100"
                style={{
                  width: "100%",
                  padding: "8px",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  fontSize: "16px"
                }}
              />
            </div>
          </div>
          
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              padding: "10px 24px",
              backgroundColor: isSubmitting ? "#ccc" : "#0284c7",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: isSubmitting ? "not-allowed" : "pointer",
              fontSize: "16px",
              fontWeight: "bold"
            }}
          >
            {isSubmitting ? "Creating..." : "Create Tier"}
          </button>
        </Form>
      )}
      
      <div style={{ backgroundColor: "#f5f5f5", padding: "20px", borderRadius: "8px" }}>
        {tiers.length === 0 ? (
          <p style={{ textAlign: "center", color: "#666" }}>
            No tiers found. Click "Add New Tier" to create your first tier.
          </p>
        ) : (
          tiers.map((tier) => (
            <div key={tier.id} style={{ 
              backgroundColor: "white", 
              padding: "20px", 
              marginBottom: "15px", 
              borderRadius: "8px",
              border: "1px solid #ddd",
              position: "relative",
              opacity: tier.isActive ? 1 : 0.7
            }}>
              {/* Delete button */}
              <fetcher.Form method="post" style={{ position: "absolute", top: "20px", right: "20px" }}>
                <input type="hidden" name="_action" value="delete" />
                <input type="hidden" name="tierId" value={tier.id} />
                <button
                  type="submit"
                  disabled={tier.memberCount > 0 || fetcher.state === "submitting"}
                  title={tier.memberCount > 0 ? `Cannot delete: ${tier.memberCount} active members` : "Delete tier"}
                  style={{
                    padding: "4px 8px",
                    backgroundColor: tier.memberCount > 0 ? "#e5e5e5" : "#ef4444",
                    color: tier.memberCount > 0 ? "#999" : "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: tier.memberCount > 0 ? "not-allowed" : "pointer",
                    fontSize: "12px"
                  }}
                >
                  Delete
                </button>
              </fetcher.Form>
              
              <Form method="post">
                <input type="hidden" name="_action" value="update" />
                <input type="hidden" name="tierId" value={tier.id} />
                
                <h3 style={{ 
                  fontSize: "18px", 
                  marginBottom: "15px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px"
                }}>
                  {tier.name} (Level {tier.level})
                  {!tier.isActive && (
                    <span style={{ 
                      fontSize: "12px", 
                      backgroundColor: "#fbbf24", 
                      color: "#92400e",
                      padding: "2px 8px",
                      borderRadius: "4px"
                    }}>
                      Inactive
                    </span>
                  )}
                  {tier.memberCount > 0 && (
                    <span style={{ fontSize: "14px", color: "#666" }}>
                      {tier.memberCount} members
                    </span>
                  )}
                </h3>
                
                <div style={{ display: "flex", gap: "20px", alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "14px" }}>
                      Minimum Lifetime Spend ($)
                    </label>
                    <input
                      type="number"
                      name="minSpend"
                      defaultValue={tier.minSpend || ""}
                      placeholder="No minimum"
                      min="0"
                      step="0.01"
                      style={{
                        width: "100%",
                        padding: "8px",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        fontSize: "16px"
                      }}
                    />
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "14px" }}>
                      Cashback Percentage (%)
                    </label>
                    <input
                      type="number"
                      name="cashbackPercent"
                      defaultValue={tier.cashbackPercent}
                      step="0.1"
                      min="0"
                      max="100"
                      required
                      style={{
                        width: "100%",
                        padding: "8px",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        fontSize: "16px"
                      }}
                    />
                  </div>
                  
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "5px", fontSize: "14px" }}>
                      <input
                        type="checkbox"
                        name="isActive"
                        value="true"
                        defaultChecked={tier.isActive}
                        style={{ cursor: "pointer" }}
                      />
                      Active
                    </label>
                  </div>
                  
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    style={{
                      padding: "8px 20px",
                      backgroundColor: isSubmitting ? "#ccc" : "#4F46E5",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                      fontSize: "16px"
                    }}
                  >
                    {isSubmitting ? "Saving..." : "Save"}
                  </button>
                </div>
                
                <p style={{ marginTop: "10px", fontSize: "14px", color: "#666" }}>
                  Created: {new Date(tier.createdAt).toLocaleDateString()}
                </p>
              </Form>
            </div>
          ))
        )}
      </div>
    </div>
  );
}