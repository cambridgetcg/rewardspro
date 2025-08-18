// app/routes/api.proxy.$.tsx
// ULTRA SIMPLE VERSION - No database, with proper TypeScript

import { json, type LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const path = params["*"] || "";
  const url = new URL(request.url);
  
  // Just return test data for ANY request
  return json({
    works: "YES! 🎉",
    path: path,
    shop: url.searchParams.get("shop"),
    customerId: url.searchParams.get("logged_in_customer_id"),
    timestamp: new Date().toISOString(),
    
    // Fake data so widget doesn't error
    success: true,
    balance: { 
      storeCredit: 99.99, 
      totalEarned: 250 
    },
    membership: { 
      tier: { 
        name: "Test", 
        cashbackPercent: 5 
      }
    },
    customer: { 
      id: "test", 
      shopifyId: url.searchParams.get("logged_in_customer_id") || "test", 
      email: "test@test.com" 
    }
  });
}