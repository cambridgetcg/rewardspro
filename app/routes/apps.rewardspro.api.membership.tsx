// File: app/routes/api.membership.tsx
// Simplified API route for membership data

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Shopify-Customer-Id",
    "Access-Control-Allow-Credentials": "true",
  };

  // Handle preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Get customer ID and shop from request
    const customerId = request.headers.get("X-Shopify-Customer-Id");
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop");

    console.log("API Request - Customer ID:", customerId, "Shop:", shopDomain);

    // Validate required parameters
    if (!customerId || !shopDomain) {
      return json(
        { 
          error: "Missing required parameters",
          customerId: !!customerId,
          shopDomain: !!shopDomain 
        },
        { status: 400, headers: corsHeaders }
      );
    }

    // Try to find customer in database
    const customer = await prisma.customer.findUnique({
      where: {
        shopDomain_shopifyCustomerId: {
          shopDomain: shopDomain,
          shopifyCustomerId: customerId,
        }
      },
      include: {
        membershipHistory: {
          where: { isActive: true },
          include: { tier: true }
        }
      }
    });

    // If customer doesn't exist, return default data
    if (!customer) {
      console.log("Customer not found in database");
      
      // Get default tier
      const defaultTier = await prisma.tier.findFirst({
        where: {
          shopDomain: shopDomain,
          isActive: true
        },
        orderBy: {
          minSpend: 'asc'
        }
      });

      return json({
        exists: false,
        storeCredit: 0,
        totalEarned: 0,
        tier: {
          name: defaultTier?.name || "Bronze",
          cashbackPercent: defaultTier?.cashbackPercent || 1
        }
      }, { headers: corsHeaders });
    }

    // Customer exists - return their data
    const activeMembership = customer.membershipHistory[0];
    const currentTier = activeMembership?.tier;

    const responseData = {
      exists: true,
      customerId: customer.id,
      storeCredit: customer.storeCredit || 0,
      totalEarned: customer.totalEarned || 0,
      tier: {
        name: currentTier?.name || "Bronze",
        cashbackPercent: currentTier?.cashbackPercent || 1
      }
    };

    console.log("Returning customer data:", responseData);

    return json(responseData, { headers: corsHeaders });

  } catch (error) {
    console.error("API Error:", error);
    
    return json(
      { 
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500, headers: corsHeaders }
    );
  }
};