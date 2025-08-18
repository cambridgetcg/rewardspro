// app/routes/api.proxy.$.tsx
// Fixed version with better non-logged-in user detection

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const proxyPath = params["*"] || "";
  const url = new URL(request.url);
  
  console.log("Proxy path:", proxyPath);
  console.log("Request URL:", request.url);
  
  // Set CORS headers for all responses
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-cache, no-store, must-revalidate"
  };
  
  // Test endpoint (no database)
  if (proxyPath === "test") {
    return json({
      success: true,
      message: "Proxy works!",
      path: proxyPath,
      timestamp: new Date().toISOString()
    }, { headers });
  }
  
  // Membership endpoint - USES YOUR REAL DATABASE
  if (proxyPath === "membership") {
    // Get customer ID from query params or headers
    let customerId = url.searchParams.get("logged_in_customer_id");
    const shop = url.searchParams.get("shop");
    
    // Also check alternative parameter names that Shopify might use
    if (!customerId) {
      customerId = url.searchParams.get("customer_id") || 
                   url.searchParams.get("customerId") ||
                   url.searchParams.get("cid");
    }
    
    console.log("Membership request - Customer:", customerId, "Shop:", shop);
    console.log("All query params:", Object.fromEntries(url.searchParams));
    
    // Handle non-logged-in users gracefully
    if (!customerId || customerId === "" || customerId === "null" || customerId === "undefined") {
      console.log("No customer ID - user not logged in");
      // Return 200 with requiresLogin flag (not an error!)
      return json({
        success: false,
        requiresLogin: true,
        message: "Please log in to view your rewards",
        // Include empty data structure so widget doesn't break
        customer: null,
        balance: {
          storeCredit: 0,
          totalEarned: 0,
          lastSynced: null
        },
        membership: {
          tier: {
            id: "guest",
            name: "Guest",
            cashbackPercent: 1
          }
        },
        debug: {
          customerId: customerId,
          shop: shop,
          message: "Customer not logged in"
        }
      }, { 
        status: 200,  // Return 200, not 401, since this is expected behavior
        headers 
      });
    }
    
    if (!shop) {
      console.warn("Missing shop parameter");
      return json({
        success: false,
        error: "Missing shop parameter",
        message: "Invalid request - shop parameter required",
        requiresLogin: false
      }, { status: 400, headers });
    }
    
    try {
      // Try to find existing customer in your Supabase database
      let customer = await prisma.customer.findUnique({
        where: {
          shopDomain_shopifyCustomerId: {
            shopDomain: shop,
            shopifyCustomerId: customerId
          }
        },
        include: {
          membershipHistory: {
            where: { isActive: true },
            include: { tier: true },
            take: 1
          }
        }
      });
      
      // If customer doesn't exist, create them
      if (!customer) {
        console.log("Creating new customer in Supabase:", customerId);
        
        // Check if a default tier exists for this shop
        let defaultTier = await prisma.tier.findFirst({
          where: {
            shopDomain: shop,
            isActive: true
          },
          orderBy: { 
            minSpend: 'asc' 
          }
        });
        
        // Create default Bronze tier if none exists
        if (!defaultTier) {
          console.log("Creating default Bronze tier for shop:", shop);
          defaultTier = await prisma.tier.create({
            data: {
              shopDomain: shop,
              name: "Bronze",
              minSpend: 0,
              cashbackPercent: 1,
              isActive: true,
              evaluationPeriod: "ANNUAL"
            }
          });
        }
        
        // Create the customer with membership
        customer = await prisma.customer.create({
          data: {
            shopDomain: shop,
            shopifyCustomerId: customerId,
            email: `customer${customerId}@${shop}`, // Will update when we get real email
            storeCredit: 0,
            totalEarned: 0,
            membershipHistory: {
              create: {
                tierId: defaultTier.id,
                isActive: true,
                assignmentType: "AUTOMATIC"
              }
            }
          },
          include: {
            membershipHistory: {
              where: { isActive: true },
              include: { tier: true },
              take: 1
            }
          }
        });
        
        console.log("✅ Created new customer in Supabase:", customer.id);
      } else {
        console.log("✅ Found existing customer:", customer.id);
      }
      
      // Get current tier info
      const currentMembership = customer.membershipHistory[0];
      const currentTier = currentMembership?.tier;
      
      // Return the real customer data from Supabase
      return json({
        success: true,
        customer: {
          id: customer.id,
          shopifyId: customer.shopifyCustomerId,
          email: customer.email,
          memberSince: customer.createdAt.toISOString()
        },
        balance: {
          storeCredit: customer.storeCredit,      // Real balance from database
          totalEarned: customer.totalEarned,      // Real total from database
          lastSynced: customer.lastSyncedAt?.toISOString() || null
        },
        membership: {
          tier: currentTier ? {
            id: currentTier.id,
            name: currentTier.name,
            cashbackPercent: currentTier.cashbackPercent
          } : {
            // Fallback tier if something goes wrong
            id: "default",
            name: "Bronze",
            cashbackPercent: 1
          }
        },
        debug: {
          databaseConnected: true,
          customerId: customer.id,
          createdAt: customer.createdAt,
          shopDomain: shop
        }
      }, { headers });
      
    } catch (error) {
      console.error("❌ Database error:", error);
      
      // Check if it's a connection error
      const isConnectionError = error instanceof Error && 
        (error.message.includes('connect') || 
         error.message.includes('ECONNREFUSED') ||
         error.message.includes('P1001'));
      
      // Return error but with fallback data so widget doesn't break
      return json({
        success: false,
        error: isConnectionError ? "Database connection failed" : "Database error",
        details: error instanceof Error ? error.message : "Unknown error",
        message: "Unable to load rewards data",
        requiresLogin: false,
        // Fallback data structure
        customer: {
          id: "error",
          shopifyId: customerId,
          email: "error@error.com"
        },
        balance: { 
          storeCredit: 0, 
          totalEarned: 0,
          lastSynced: null
        },
        membership: { 
          tier: { 
            id: "error",
            name: "Bronze", 
            cashbackPercent: 1 
          }
        }
      }, { status: 500, headers });
    }
  }
  
  // Default 404 for unknown paths
  return json({
    success: false,
    error: "Not found",
    message: `Endpoint '${proxyPath}' not found`,
    path: proxyPath,
    availablePaths: ["test", "membership"]
  }, { status: 404, headers });
}

// Handle OPTIONS requests for CORS
export async function action({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  
  return json({ error: "Method not allowed" }, { status: 405 });
}