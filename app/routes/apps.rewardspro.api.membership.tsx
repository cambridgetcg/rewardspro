// File: app/routes/apps.rewardspro.api.membership.tsx
// API route for widget membership data

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

// Determine allowed origins based on environment
const getAllowedOrigin = (request: Request): string => {
  const origin = request.headers.get("origin");
  
  // In production, be more restrictive
  if (process.env.NODE_ENV === "production") {
    const allowedOrigins = [
      "https://cdn.shopify.com",
      "https://extensions.shopifycdn.com",
      // Add your specific store domains if needed
    ];
    
    if (origin && allowedOrigins.includes(origin)) {
      return origin;
    }
    
    // Default to first allowed origin if request origin not in list
    return allowedOrigins[0];
  }
  
  // In development, allow localhost
  return origin || "http://localhost:3000";
};

// CORS headers function
const getCorsHeaders = (request: Request) => ({
  "Access-Control-Allow-Origin": getAllowedOrigin(request),
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Shopify-Customer-Id",
  // Remove credentials or use specific origin
  "Access-Control-Max-Age": "86400", // Cache preflight for 24 hours
});

// Handle OPTIONS requests separately
export async function OPTIONS({ request }: LoaderFunctionArgs) {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsHeaders = getCorsHeaders(request);

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

    // Validate shop domain format (basic security)
    const shopDomainRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
    if (!shopDomainRegex.test(shopDomain)) {
      return json(
        { error: "Invalid shop domain format" },
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
          include: { tier: true },
          orderBy: { startDate: 'desc' },
          take: 1
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
    
    // Don't expose internal error details in production
    const errorMessage = process.env.NODE_ENV === "production" 
      ? "Internal server error" 
      : error instanceof Error ? error.message : "Unknown error";
    
    return json(
      { 
        error: "Internal server error",
        message: errorMessage
      },
      { status: 500, headers: corsHeaders }
    );
  }
};