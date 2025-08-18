// app/routes/api.proxy.$.tsx
// FIXED VERSION - With proper TypeScript types

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";

// Initialize Prisma
const prisma = new PrismaClient();

export async function loader({ request, params }: LoaderFunctionArgs) {
  const proxyPath = params["*"] || "";
  const url = new URL(request.url);
  
  console.log("Proxy path:", proxyPath);
  console.log("Shop:", url.searchParams.get("shop"));
  
  // Test endpoint - no auth, just returns success
  if (proxyPath === "test") {
    return json({ 
      success: true, 
      message: "Proxy works!",
      path: proxyPath 
    });
  }
  
  // Membership endpoint - fetch from database
  if (proxyPath === "membership") {
    const customerId = url.searchParams.get("logged_in_customer_id");
    const shop = url.searchParams.get("shop");
    
    if (!customerId) {
      return json({ 
        error: "Not logged in",
        requiresLogin: true 
      });
    }
    
    try {
      // Try to find customer in database
      let customer = await prisma.customer.findFirst({
        where: {
          shopifyCustomerId: customerId,
          shopDomain: shop || ""
        }
      });
      
      // If not found, create a simple customer
      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            shopDomain: shop || "test-shop.myshopify.com",
            shopifyCustomerId: customerId,
            email: `customer${customerId}@test.com`,
            storeCredit: 0,
            totalEarned: 0
          }
        });
      }
      
      // Return simple response
      return json({
        success: true,
        customer: {
          id: customer.id,
          shopifyId: customer.shopifyCustomerId,
          email: customer.email
        },
        balance: {
          storeCredit: customer.storeCredit,
          totalEarned: customer.totalEarned
        },
        membership: {
          tier: {
            name: "Bronze",
            cashbackPercent: 1
          }
        }
      });
      
    } catch (error) {
      console.error("Database error:", error);
      
      // Handle error properly
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      return json({ 
        error: "Database error",
        details: errorMessage
      }, { status: 500 });
    }
  }
  
  // Default 404
  return json({ 
    error: "Not found",
    path: proxyPath 
  }, { status: 404 });
}