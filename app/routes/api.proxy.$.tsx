// app/routes/api.proxy.$.tsx
// This handles BOTH /test AND /membership endpoints!

import { json, type LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const proxyPath = params["*"] || "";
  const url = new URL(request.url);
  
  console.log("Proxy received path:", proxyPath);
  
  // Handle TEST endpoint
  if (proxyPath === "test") {
    return json({
      success: true,
      message: "Proxy works!",
      path: proxyPath
    });
  }
  
  // Handle MEMBERSHIP endpoint - THIS IS WHAT THE WIDGET USES!
  if (proxyPath === "membership") {
    const customerId = url.searchParams.get("logged_in_customer_id");
    const shop = url.searchParams.get("shop");
    
    console.log("Membership request - Customer:", customerId, "Shop:", shop);
    
    // For now, return fake data to make widget work
    // We'll add database later
    return json({
      success: true,
      customer: {
        id: "test-customer",
        shopifyId: customerId || "unknown",
        email: "customer@test.com",
        memberSince: new Date().toISOString()
      },
      balance: {
        storeCredit: 0.00,  // Changed from 99.99 to 0.00 to look more real
        totalEarned: 0.00,
        lastSynced: new Date().toISOString()
      },
      membership: {
        tier: {
          id: "bronze",
          name: "Bronze",
          cashbackPercent: 1
        }
      }
    });
  }
  
  // Return 404 for any other path
  console.log("Unknown proxy path:", proxyPath);
  return json({
    error: "Not found",
    path: proxyPath,
    message: `Path '${proxyPath}' not handled. Available: test, membership`
  }, { status: 404 });
}