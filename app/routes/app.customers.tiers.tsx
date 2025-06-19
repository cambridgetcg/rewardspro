// app/routes/app.customers.tiers.tsx
// Admin page to view and manage customer tiers
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { assignTierManually, evaluateCustomerTier } from "../services/customer-tier.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  
  // Get all customers with their current tier
  const customers = await prisma.customer.findMany({
    include: {
      membershipHistory: {
        where: { isActive: true },
        include: { tier: true }
      },
      transactions: {
        where: {
          createdAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) }, // Last year
          status: { in: ["COMPLETED", "SYNCED_TO_SHOPIFY"] }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Get all tiers for the dropdown
  const tiers = await prisma.tier.findMany({
    where: { isActive: true },
    orderBy: { level: 'asc' }
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
      membershipSource: currentMembership?.source,
      annualSpending,
      totalEarned: customer.totalEarned,
      storeCredit: customer.storeCredit
    };
  });

  return json({ customers: customersWithSpending, tiers });
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  
  const formData = await request.formData();
  const action = formData.get("_action");
  const customerId = formData.get("customerId") as string;
  
  if (action === "assignTier") {
    const tierId = formData.get("tierId") as string;
    await assignTierManually(customerId, tierId);
  } else if (action === "evaluateTier") {
    await evaluateCustomerTier(customerId);
  } else if (action === "evaluateAll") {
    // Evaluate all customers
    const customers = await prisma.customer.findMany();
    for (const customer of customers) {
      await evaluateCustomerTier(customer.id);
    }
  }
  
  return json({ success: true });
}

export default function CustomerTiers() {
  const { customers, tiers } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h1 style={{ fontSize: "24px", margin: 0 }}>Customer Tier Management</h1>
        <Form method="post">
          <input type="hidden" name="_action" value="evaluateAll" />
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              padding: "8px 16px",
              backgroundColor: isSubmitting ? "#ccc" : "#10B981",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: isSubmitting ? "not-allowed" : "pointer"
            }}
          >
            {isSubmitting ? "Evaluating..." : "Re-evaluate All Customers"}
          </button>
        </Form>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "white" }}>
          <thead>
            <tr style={{ backgroundColor: "#f5f5f5" }}>
              <th style={{ padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }}>Customer</th>
              <th style={{ padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }}>Current Tier</th>
              <th style={{ padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }}>Source</th>
              <th style={{ padding: "12px", textAlign: "right", borderBottom: "2px solid #ddd" }}>Annual Spending</th>
              <th style={{ padding: "12px", textAlign: "right", borderBottom: "2px solid #ddd" }}>Total Earned</th>
              <th style={{ padding: "12px", textAlign: "right", borderBottom: "2px solid #ddd" }}>Store Credit</th>
              <th style={{ padding: "12px", textAlign: "center", borderBottom: "2px solid #ddd" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "12px" }}>
                  <div>{customer.email}</div>
                  <div style={{ fontSize: "12px", color: "#666" }}>ID: {customer.shopifyCustomerId}</div>
                </td>
                <td style={{ padding: "12px" }}>
                  {customer.currentTier ? (
                    <span style={{ 
                      backgroundColor: customer.currentTier.color || "#f5f5f5",
                      color: customer.currentTier.color ? "white" : "black",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "14px"
                    }}>
                      {customer.currentTier.displayName}
                    </span>
                  ) : (
                    <span style={{ color: "#999" }}>No tier</span>
                  )}
                </td>
                <td style={{ padding: "12px" }}>
                  <span style={{ fontSize: "14px", color: "#666" }}>
                    {customer.membershipSource?.replace('_', ' ') || 'N/A'}
                  </span>
                </td>
                <td style={{ padding: "12px", textAlign: "right" }}>
                  ${customer.annualSpending.toFixed(2)}
                </td>
                <td style={{ padding: "12px", textAlign: "right" }}>
                  ${customer.totalEarned.toFixed(2)}
                </td>
                <td style={{ padding: "12px", textAlign: "right" }}>
                  ${customer.storeCredit.toFixed(2)}
                </td>
                <td style={{ padding: "12px" }}>
                  <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                    <Form method="post" style={{ display: "inline" }}>
                      <input type="hidden" name="_action" value="evaluateTier" />
                      <input type="hidden" name="customerId" value={customer.id} />
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        style={{
                          padding: "4px 8px",
                          backgroundColor: "#3B82F6",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "12px"
                        }}
                      >
                        Re-evaluate
                      </button>
                    </Form>
                    
                    <Form method="post" style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      <input type="hidden" name="_action" value="assignTier" />
                      <input type="hidden" name="customerId" value={customer.id} />
                      <select
                        name="tierId"
                        required
                        style={{
                          padding: "4px",
                          borderRadius: "4px",
                          border: "1px solid #ccc",
                          fontSize: "12px"
                        }}
                      >
                        <option value="">Select tier...</option>
                        {tiers.map(tier => (
                          <option key={tier.id} value={tier.id}>
                            {tier.displayName}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        style={{
                          padding: "4px 8px",
                          backgroundColor: "#8B5CF6",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "12px"
                        }}
                      >
                        Assign
                      </button>
                    </Form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {customers.length === 0 && (
        <p style={{ textAlign: "center", color: "#666", marginTop: "40px" }}>
          No customers found. Customers will appear here after their first order.
        </p>
      )}
    </div>
  );
}