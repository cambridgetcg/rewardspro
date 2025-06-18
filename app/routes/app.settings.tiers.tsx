// app/routes/app.tiers.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  
  const tiers = await prisma.tier.findMany({
    orderBy: { level: "asc" },
  });

  return json({ tiers });
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  
  const formData = await request.formData();
  const tierId = formData.get("tierId") as string;
  const spendingDays = formData.get("spendingDays");
  const cashbackPercent = formData.get("cashbackPercent");
  
  await prisma.tier.update({
    where: { id: tierId },
    data: {
      spendingPeriodDays: spendingDays ? parseInt(spendingDays as string) : null,
      cashbackPercent: parseFloat(cashbackPercent as string),
    },
  });
  
  return json({ success: true });
}

export default function TierSettings() {
  const { tiers } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div style={{ padding: "20px", maxWidth: "800px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "20px" }}>Tier Settings</h1>
      
      <div style={{ backgroundColor: "#f5f5f5", padding: "20px", borderRadius: "8px" }}>
        {tiers.map((tier) => (
          <Form key={tier.id} method="post" style={{ 
            backgroundColor: "white", 
            padding: "20px", 
            marginBottom: "15px", 
            borderRadius: "8px",
            border: "1px solid #ddd"
          }}>
            <input type="hidden" name="tierId" value={tier.id} />
            
            <h3 style={{ 
              fontSize: "18px", 
              marginBottom: "15px",
              color: tier.color || "#000"
            }}>
              {tier.displayName} (Level {tier.level})
            </h3>
            
            <div style={{ display: "flex", gap: "20px", alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "block", marginBottom: "5px", fontSize: "14px" }}>
                  Evaluation Period (days)
                </label>
                <input
                  type="number"
                  name="spendingDays"
                  defaultValue={tier.spendingPeriodDays || ""}
                  placeholder="e.g., 365"
                  min="1"
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
                  Cashback %
                </label>
                <input
                  type="number"
                  name="cashbackPercent"
                  defaultValue={tier.cashbackPercent}
                  step="0.1"
                  min="0"
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
            
            {tier.minSpend !== null && (
              <p style={{ marginTop: "10px", fontSize: "14px", color: "#666" }}>
                Min spend: ${tier.minSpend}
              </p>
            )}
          </Form>
        ))}
      </div>
    </div>
  );
}