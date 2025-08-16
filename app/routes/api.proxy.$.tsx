import { json, type LoaderFunctionArgs } from "@remix-run/node";
import crypto from "crypto";
import prisma from "../db.server";
import { AssignmentType, TierChangeType } from "@prisma/client";

function validateProxySignature(
  queryParams: URLSearchParams,
  secret: string
): boolean {
  const signature = queryParams.get("signature");
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

  return crypto.timingSafeEqual(
    Buffer.from(calculatedSignature),
    Buffer.from(signature)
  );
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  console.log("\n=== PROXY REQUEST START ===");
  
  // Get the path after /api/proxy/
  const proxyPath = params["*"] || "";
  console.log("[Debug] Proxy path:", proxyPath);
  console.log("[Debug] Full URL:", request.url);
  
  try {
    // Extract Shopify parameters
    const url = new URL(request.url);
    const queryParams = url.searchParams;
    
    const shop = queryParams.get("shop");
    const loggedInCustomerId = queryParams.get("logged_in_customer_id");
    const pathPrefix = queryParams.get("path_prefix");
    
    console.log("[Debug] Shopify params:", {
      shop,
      loggedInCustomerId: loggedInCustomerId ? "present" : "missing",
      pathPrefix,
      proxyPath
    });

    // Route based on the path
    if (proxyPath === "membership") {
      // VALIDATE REQUEST SIGNATURE
      const APP_PROXY_SECRET = process.env.SHOPIFY_APP_PROXY_SECRET;
      if (!APP_PROXY_SECRET) {
        console.error("[ERROR] Missing SHOPIFY_APP_PROXY_SECRET");
        return json({ error: "Server configuration error" }, { status: 500 });
      }
      
      if (!validateProxySignature(queryParams, APP_PROXY_SECRET)) {
        console.error("[ERROR] Invalid signature");
        return json({ error: "Invalid signature" }, { status: 401 });
      }

      // CHECK IF CUSTOMER IS LOGGED IN
      if (!loggedInCustomerId) {
        return json(
          { 
            error: "Not authenticated",
            requiresLogin: true,
            message: "Please log in to view your rewards"
          },
          { status: 401 }
        );
      }

      if (!shop) {
        return json({ error: "Missing shop parameter" }, { status: 400 });
      }

      // FETCH OR CREATE CUSTOMER
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
            include: { tier: true },
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

      if (!customer) {
        console.log("[Debug] Creating new customer...");
        
        // Get or create default tier
        let defaultTier = await prisma.tier.findFirst({
          where: {
            shopDomain: shop,
            isActive: true
          },
          orderBy: { minSpend: 'asc' }
        });

        if (!defaultTier) {
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
        }

        customer = await prisma.customer.create({
          data: {
            shopDomain: shop,
            shopifyCustomerId: loggedInCustomerId,
            email: "",
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
              include: { tier: true },
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
      }

      // Build response
      const activeMembership = customer.membershipHistory[0];
      const currentTier = activeMembership?.tier;

      const responseData = {
        success: true,
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
          } : null
        },
        recentActivity: customer.transactions.map(tx => ({
          id: tx.id,
          type: 'cashback_earned',
          amount: tx.cashbackAmount,
          description: `Order #${tx.shopifyOrderId.slice(-6)}`,
          date: tx.createdAt.toISOString()
        }))
      };

      console.log("[Debug] Sending membership response");
      return json(responseData);
    }

    // Handle other paths
    return json({ 
      error: "Not found",
      path: proxyPath 
    }, { status: 404 });

  } catch (error) {
    console.error("[ERROR] Proxy handler error:", error);
    return json(
      { 
        error: "Internal server error",
        message: String(error)
      },
      { status: 500 }
    );
  }
}