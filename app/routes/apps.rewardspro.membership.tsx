import { json, type LoaderFunctionArgs } from "@remix-run/node";
import crypto from "crypto";
import prisma from "../db.server";
import { AssignmentType, TierChangeType } from "@prisma/client";

// Add debug logging at the very start
console.log("[Membership Route] File loaded successfully");

/**
 * Validates the HMAC signature from Shopify's app proxy
 */
function validateProxySignature(
  queryParams: URLSearchParams,
  secret: string
): boolean {
  const signature = queryParams.get("signature");
  console.log("[HMAC Validation] Signature present:", !!signature);
  
  if (!signature) return false;

  const paramsToValidate = new URLSearchParams(queryParams);
  paramsToValidate.delete("signature");
  
  const sortedParams = Array.from(paramsToValidate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("");

  const calculatedSignature = crypto
    .createHmac("sha256", secret)
    .update(sortedParams)
    .digest("hex");

  console.log("[HMAC Validation] Calculated:", calculatedSignature.substring(0, 10) + "...");
  console.log("[HMAC Validation] Received:", signature.substring(0, 10) + "...");

  return crypto.timingSafeEqual(
    Buffer.from(calculatedSignature),
    Buffer.from(signature)
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  console.log("\n=== MEMBERSHIP API REQUEST START ===");
  console.log("[Debug] Request method:", request.method);
  console.log("[Debug] Request URL:", request.url);
  
  try {
    // 0. CHECK ENVIRONMENT
    console.log("[Debug] Environment check:");
    console.log("  - NODE_ENV:", process.env.NODE_ENV);
    console.log("  - DATABASE_URL exists:", !!process.env.DATABASE_URL);
    console.log("  - SHOPIFY_APP_PROXY_SECRET exists:", !!process.env.SHOPIFY_APP_PROXY_SECRET);
    
    // 1. EXTRACT SHOPIFY PROXY PARAMETERS
    const url = new URL(request.url);
    const queryParams = url.searchParams;
    
    console.log("[Debug] Query parameters:");
    queryParams.forEach((value, key) => {
      if (key === 'signature') {
        console.log(`  - ${key}: ${value.substring(0, 10)}...`);
      } else {
        console.log(`  - ${key}: ${value}`);
      }
    });
    
    const shop = queryParams.get("shop");
    const loggedInCustomerId = queryParams.get("logged_in_customer_id");
    const timestamp = queryParams.get("timestamp");
    const signature = queryParams.get("signature");

    // 2. VALIDATE REQUEST SIGNATURE
    const APP_PROXY_SECRET = process.env.SHOPIFY_APP_PROXY_SECRET;
    if (!APP_PROXY_SECRET) {
      console.error("[ERROR] Missing SHOPIFY_APP_PROXY_SECRET");
      return json(
        { 
          error: "Server configuration error",
          debug: "Missing SHOPIFY_APP_PROXY_SECRET environment variable"
        },
        { status: 500 }
      );
    }
    
    console.log("[Debug] Validating signature...");
    const isValidSignature = validateProxySignature(queryParams, APP_PROXY_SECRET);
    console.log("[Debug] Signature valid:", isValidSignature);
    
    if (!isValidSignature) {
      console.error("[ERROR] Invalid signature");
      return json(
        { 
          error: "Invalid signature",
          debug: "HMAC validation failed"
        },
        { status: 401 }
      );
    }

    // 3. CHECK IF CUSTOMER IS LOGGED IN
    if (!loggedInCustomerId) {
      console.log("[Debug] No logged in customer");
      return json(
        { 
          error: "Not authenticated",
          requiresLogin: true,
          message: "Please log in to view your rewards",
          debug: "No logged_in_customer_id parameter"
        },
        { status: 401 }
      );
    }

    // 4. VALIDATE SHOP DOMAIN
    if (!shop) {
      console.error("[ERROR] Missing shop parameter");
      return json(
        { 
          error: "Missing shop parameter",
          debug: "Shop domain not provided by Shopify proxy"
        },
        { status: 400 }
      );
    }

    console.log("[Debug] Attempting database connection...");
    
    // 5. TEST DATABASE CONNECTION
    try {
      // Simple database test
      await prisma.$queryRaw`SELECT 1`;
      console.log("[Debug] Database connection successful");
    } catch (dbError) {
      console.error("[ERROR] Database connection failed:", dbError);
      return json(
        { 
          error: "Database connection failed",
          debug: process.env.NODE_ENV === 'development' ? String(dbError) : undefined
        },
        { status: 500 }
      );
    }

    // 6. FETCH OR CREATE CUSTOMER RECORD
    console.log(`[Debug] Looking for customer: shop=${shop}, customerId=${loggedInCustomerId}`);
    
    let customer = await prisma.customer.findUnique({
      where: {
        shopDomain_shopifyCustomerId: {
          shopDomain: shop,
          shopifyCustomerId: loggedInCustomerId
        }
      },
      include: {
        membershipHistory: {
          where: { isActive: true },
          include: {
            tier: true
          },
          take: 1
        },
        analytics: true,
        creditLedger: {
          orderBy: { createdAt: 'desc' },
          take: 5
        },
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 5
        }
      }
    });

    console.log("[Debug] Customer found:", !!customer);

    // 7. CREATE NEW CUSTOMER IF DOESN'T EXIST
    if (!customer) {
      console.log("[Debug] Creating new customer record...");
      
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

      console.log("[Debug] Default tier found:", !!defaultTier);

      if (!defaultTier) {
        console.log("[Debug] Creating default tier...");
        defaultTier = await prisma.tier.create({
          data: {
            shopDomain: shop,
            name: "Bronze",
            minSpend: 0,
            cashbackPercent: 1,
            evaluationPeriod: "ANNUAL",
            isActive: true,
            benefits: {
              description: "Welcome to our rewards program!",
              perks: ["1% cashback on all purchases"]
            }
          }
        });
        console.log("[Debug] Default tier created");
      }

      // Create customer
      customer = await prisma.customer.create({
        data: {
          shopDomain: shop,
          shopifyCustomerId: loggedInCustomerId,
          email: "", // Will be updated via webhook
          storeCredit: 0,
          totalEarned: 0,
          membershipHistory: {
            create: {
              tierId: defaultTier.id,
              assignmentType: AssignmentType.AUTOMATIC,
              isActive: true
            }
          },
          analytics: {
            create: {
              shopDomain: shop,
              lifetimeSpending: 0,
              yearlySpending: 0,
              quarterlySpending: 0,
              monthlySpending: 0,
              avgOrderValue: 0,
              orderCount: 0,
              currentTierDays: 0,
              tierUpgradeCount: 0,
              nextTierProgress: 0
            }
          }
        },
        include: {
          membershipHistory: {
            where: { isActive: true },
            include: {
              tier: true
            },
            take: 1
          },
          analytics: true,
          creditLedger: {
            orderBy: { createdAt: 'desc' },
            take: 5
          },
          transactions: {
            orderBy: { createdAt: 'desc' },
            take: 5
          }
        }
      });

      console.log("[Debug] New customer created");

      // Log tier change
      await prisma.tierChangeLog.create({
        data: {
          customerId: customer.id,
          toTierId: defaultTier.id,
          changeType: TierChangeType.INITIAL_ASSIGNMENT,
          changeReason: "New customer auto-enrollment",
          triggeredBy: "System"
        }
      });
    }

    // Build response (rest of your code...)
    const activeMembership = customer.membershipHistory[0];
    const currentTier = activeMembership?.tier;

    console.log("[Debug] Building response...");
    
    const responseData = {
      success: true,
      debug: {
        routeHit: true,
        timestamp: new Date().toISOString(),
        shop,
        customerId: loggedInCustomerId
      },
      customer: {
        id: customer.id,
        shopifyId: loggedInCustomerId,
        memberSince: customer.createdAt.toISOString()
      },
      balance: {
        storeCredit: customer.storeCredit,
        totalEarned: customer.totalEarned,
        pending: 0,
        lastSynced: customer.lastSyncedAt?.toISOString() || null
      },
      membership: {
        tier: currentTier ? {
          id: currentTier.id,
          name: currentTier.name,
          cashbackPercent: currentTier.cashbackPercent,
          benefits: currentTier.benefits || {},
          evaluationPeriod: currentTier.evaluationPeriod
        } : null,
        assignmentType: activeMembership?.assignmentType || AssignmentType.AUTOMATIC,
        startDate: activeMembership?.startDate.toISOString(),
        endDate: activeMembership?.endDate?.toISOString() || null
      },
      recentActivity: [],
      _meta: {
        timestamp: new Date().toISOString(),
        shop,
        cacheFor: 60
      }
    };

    console.log("[Debug] Response ready, sending...");
    console.log("=== MEMBERSHIP API REQUEST END ===\n");

    return json(responseData, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=60",
        "X-Debug-Route-Hit": "true",
        "X-Customer-ID": loggedInCustomerId
      },
    });

  } catch (error) {
    console.error("[ERROR] Unhandled error:", error);
    
    return json(
      { 
        error: "Failed to fetch membership data",
        message: "Please try again later",
        debug: process.env.NODE_ENV === 'development' ? {
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined
        } : undefined
      },
      { status: 500 }
    );
  }
}