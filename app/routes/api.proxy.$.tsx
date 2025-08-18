// app/routes/api.proxy.$.tsx
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const proxyPath = params["*"] || "";
  const url = new URL(request.url);
  
  // CORS headers for all responses
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-cache, no-store, must-revalidate"
  };
  
  // Test endpoint
  if (proxyPath === "test") {
    return json({
      success: true,
      message: "API endpoint is working",
      timestamp: new Date().toISOString()
    }, { headers });
  }
  
  // Membership endpoint
  if (proxyPath === "membership") {
    // Extract customer ID from various possible parameters
    const customerId = url.searchParams.get("logged_in_customer_id") ||
                      url.searchParams.get("customer_id") || 
                      url.searchParams.get("customerId") ||
                      url.searchParams.get("cid");
    
    const shop = url.searchParams.get("shop");
    
    // Handle non-logged-in users
    if (!customerId || customerId === "" || customerId === "null" || customerId === "undefined") {
      return json({
        success: false,
        requiresLogin: true,
        message: "Please log in to view your rewards",
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
        }
      }, { 
        status: 200,
        headers 
      });
    }
    
    // Validate shop parameter
    if (!shop) {
      return json({
        success: false,
        error: "Missing shop parameter",
        message: "Invalid request - shop parameter required",
        requiresLogin: false
      }, { status: 400, headers });
    }
    
    try {
      // Find or create customer
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
      
      // Create new customer if doesn't exist
      if (!customer) {
        // Get or create default tier
        let defaultTier = await prisma.tier.findFirst({
          where: {
            shopDomain: shop,
            isActive: true
          },
          orderBy: { 
            minSpend: 'asc' 
          }
        });
        
        if (!defaultTier) {
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
        
        // Create customer with membership
        customer = await prisma.customer.create({
          data: {
            shopDomain: shop,
            shopifyCustomerId: customerId,
            email: `customer${customerId}@${shop}`,
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
      }
      
      // Get current tier
      const currentMembership = customer.membershipHistory[0];
      const currentTier = currentMembership?.tier;
      
      // Return customer data
      return json({
        success: true,
        customer: {
          id: customer.id,
          shopifyId: customer.shopifyCustomerId,
          email: customer.email,
          memberSince: customer.createdAt.toISOString()
        },
        balance: {
          storeCredit: customer.storeCredit,
          totalEarned: customer.totalEarned,
          lastSynced: customer.lastSyncedAt?.toISOString() || null
        },
        membership: {
          tier: currentTier ? {
            id: currentTier.id,
            name: currentTier.name,
            cashbackPercent: currentTier.cashbackPercent
          } : {
            id: "default",
            name: "Bronze",
            cashbackPercent: 1
          }
        }
      }, { headers });
      
    } catch (error) {
      console.error("Database error:", error);
      
      // Return error with fallback data
      return json({
        success: false,
        error: "Database error",
        message: "Unable to load rewards data. Please try again later.",
        requiresLogin: false,
        customer: {
          id: "error",
          shopifyId: customerId,
          email: ""
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
  
  // 404 for unknown paths
  return json({
    success: false,
    error: "Not found",
    message: `Endpoint '${proxyPath}' not found`,
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