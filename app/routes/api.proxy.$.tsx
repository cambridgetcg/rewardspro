// app/routes/api.proxy.$.tsx
// Uses your existing db.server.ts to connect to Supabase

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";  // Your existing db.server file

export async function loader({ request, params }: LoaderFunctionArgs) {
  const proxyPath = params["*"] || "";
  const url = new URL(request.url);
  
  console.log("Proxy path:", proxyPath);
  
  // Test endpoint (no database)
  if (proxyPath === "test") {
    return json({
      success: true,
      message: "Proxy works!",
      path: proxyPath
    });
  }
  
  // Membership endpoint - USES YOUR REAL DATABASE
  if (proxyPath === "membership") {
    const customerId = url.searchParams.get("logged_in_customer_id");
    const shop = url.searchParams.get("shop");
    
    console.log("Membership request - Customer:", customerId, "Shop:", shop);
    
    if (!customerId) {
      return json({
        error: "Not logged in",
        requiresLogin: true
      });
    }
    
    if (!shop) {
      return json({
        error: "Missing shop parameter"
      }, { status: 400 });
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
          createdAt: customer.createdAt
        }
      });
      
    } catch (error) {
      console.error("❌ Database error:", error);
      
      // Return error but with fallback data so widget doesn't break
      return json({
        error: "Database connection failed",
        details: error instanceof Error ? error.message : "Unknown error",
        success: false,
        // Fallback data
        customer: {
          id: "error",
          shopifyId: customerId,
          email: "error@error.com"
        },
        balance: { 
          storeCredit: 0, 
          totalEarned: 0 
        },
        membership: { 
          tier: { 
            name: "Bronze", 
            cashbackPercent: 1 
          }
        }
      }, { status: 500 });
    }
  }
  
  // Default 404 for unknown paths
  return json({
    error: "Not found",
    path: proxyPath,
    availablePaths: ["test", "membership"]
  }, { status: 404 });
}