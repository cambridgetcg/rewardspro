// app/routes/app.customers.$id.tsx
// Customer detail page showing tier info
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getCustomerTierInfo } from "../services/customer-tier.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  
  const customerId = params.id;
  const tierInfo = await getCustomerTierInfo(customerId!);
  
  if (!tierInfo) {
    throw new Response("Customer not found", { status: 404 });
  }
  
  return json({ tierInfo });
}

export default function CustomerDetail() {
  const { tierInfo } = useLoaderData<typeof loader>();
  
  if (!tierInfo) {
    return <div style={{ padding: "20px" }}>No tier information found</div>;
  }
  
  const { membership, progressInfo } = tierInfo;
  
  return (
    <div style={{ padding: "20px" }}>
      <h1>Customer Tier Information</h1>
      
      <div style={{ 
        backgroundColor: membership.tier.color || "#f5f5f5", 
        color: membership.tier.color ? "white" : "black",
        padding: "20px",
        borderRadius: "8px",
        marginBottom: "20px"
      }}>
        <h2>{membership.tier.displayName} Member</h2>
        <p>Cashback Rate: {membership.tier.cashbackPercent}%</p>
        <p>Member Since: {new Date(membership.startDate).toLocaleDateString()}</p>
        <p>Source: {membership.source.replace('_', ' ')}</p>
      </div>
      
      {progressInfo && (
        <div style={{ backgroundColor: "#f5f5f5", padding: "20px", borderRadius: "8px" }}>
          <h3>Progress to {progressInfo.nextTier.displayName}</h3>
          <div style={{ backgroundColor: "#ddd", height: "20px", borderRadius: "10px", overflow: "hidden" }}>
            <div 
              style={{ 
                backgroundColor: "#4CAF50", 
                height: "100%", 
                width: `${progressInfo.progressPercentage}%`,
                transition: "width 0.3s ease"
              }}
            />
          </div>
          <p>
            ${progressInfo.currentSpending.toFixed(2)} / ${progressInfo.requiredSpending.toFixed(2)}
            ({progressInfo.progressPercentage.toFixed(1)}%)
          </p>
          <p>Spend ${progressInfo.remainingSpending.toFixed(2)} more to reach {progressInfo.nextTier.displayName}!</p>
        </div>
      )}
    </div>
  );
}