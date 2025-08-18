// app/routes/api.proxy.$.tsx
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import crypto from "crypto";
import prisma from "../db.server";

/**
 * Validates the Shopify app proxy signature
 */
function validateProxySignature(
  queryParams: URLSearchParams,
  secret: string
): boolean {
  const signature = queryParams.get("signature");
  if (!signature) {
    console.log("[Proxy] No signature found");
    return false;
  }

  // Create a copy and remove signature for validation
  const paramsToValidate = new URLSearchParams(queryParams);
  paramsToValidate.delete("signature");
  
  // Sort and concatenate parameters
  const sortedParams = Array.from(paramsToValidate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("");

  // Calculate HMAC
  const calculatedSignature = crypto
    .createHmac("sha256", secret)
    .update(sortedParams)
    .digest("hex");

  // Compare signatures
  const isValid = crypto.timingSafeEqual(
    Buffer.from(calculatedSignature),
    Buffer.from(signature)
  );

  console.log("[Proxy] Signature validation:", isValid);
  return isValid;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  console.log("\n=== APP PROXY REQUEST ===");
  
  const proxyPath = params["*"] || "";
  const url = new URL(request.url);
  const queryParams = url.searchParams;
  
  console.log("[Proxy] Path:", proxyPath);
  console.log("[Proxy] Shop:", queryParams.get("shop"));
  console.log("[Proxy] Customer ID:", queryParams.get("logged_in_customer_id"));
  
  // Set CORS headers for all responses
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-cache, no-store, must-revalidate"
  };

  try {
    // Handle different endpoints
    switch (proxyPath) {
      case "test":
        return json({
          success: true,
          message: "Proxy is working!",
          timestamp: new Date().toISOString(),
          receivedParams: {
            shop: queryParams.get("shop"),
            customerId: queryParams.get("logged_in_customer_id"),
            pathPrefix: queryParams.get("path_prefix")
          }
        }, { headers });

      case "membership":
        return handleMembershipRequest(queryParams, headers);

      default:
        return json({
          error: "Endpoint not found",
          path: proxyPath,
          availableEndpoints: ["test", "membership"]
        }, { status: 404, headers });
    }
  } catch (error) {
    console.error("[Proxy] Error:", error);
    return json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500, headers });
  }
}

async function handleMembershipRequest(
  queryParams: URLSearchParams,
  headers: HeadersInit
) {
  const shop = queryParams.get("shop");
  const customerId = queryParams.get("logged_in_customer_id");
  
  // Validate proxy signature
  const APP_PROXY_SECRET = process.env.SHOPIFY_APP_PROXY_SECRET;
  
  if (!APP_PROXY_SECRET) {
    console.error("[Proxy] Missing SHOPIFY_APP_PROXY_SECRET");
    return json({
      error: "Server configuration error",
      message: "Proxy secret not configured"
    }, { status: 500, headers });
  }
  
  if (!validateProxySignature(queryParams, APP_PROXY_SECRET)) {
    return json({
      error: "Invalid signature",
      message: "Request signature validation failed"
    }, { status: 401, headers });
  }
  
  // Check if customer is logged in
  if (!customerId) {
    return json({
      success: false,
      requiresLogin: true,
      message: "Please log in to view your rewards"
    }, { status: 401, headers });
  }
  
  if (!shop) {
    return json({
      error: "Missing shop parameter"
    }, { status: 400, headers });
  }
  
  try {
    // Fetch or create customer
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
      console.log("[Proxy] Creating new customer");
      
      // Get default tier
      let defaultTier = await prisma.tier.findFirst({
        where: {
          shopDomain: shop,
          isActive: true
        },
        orderBy: { minSpend: 'asc' }
      });
      
      // Create default tier if none exists
      if (!defaultTier) {
        defaultTier = await prisma.tier.create({
          data: {
            shopDomain: shop,
            name: "Bronze",
            minSpend: 0,
            cashbackPercent: 1,
            isActive: true
          }
        });
      }
      
      // Create customer with default tier
      customer = await prisma.customer.create({
        data: {
          shopDomain: shop,
          shopifyCustomerId: customerId,
          email: `customer_${customerId}@${shop}`, // Placeholder email
          storeCredit: 0,
          totalEarned: 0,
          membershipHistory: {
            create: {
              tierId: defaultTier.id,
              isActive: true
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
    
    // Build response
    const activeMembership = customer.membershipHistory[0];
    const currentTier = activeMembership?.tier;
    
    const response = {
      success: true,
      customer: {
        id: customer.id,
        shopifyId: customerId,
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
        } : null
      }
    };
    
    console.log("[Proxy] Returning customer data");
    return json(response, { headers });
    
  } catch (error) {
    console.error("[Proxy] Database error:", error);
    return json({
      error: "Database error",
      message: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500, headers });
  }
}