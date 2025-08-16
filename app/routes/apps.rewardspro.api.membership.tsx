import { json, type LoaderFunctionArgs } from "@remix-run/node";
import crypto from "crypto";
import prisma from "../db.server";
import { AssignmentType, TierChangeType } from "@prisma/client";

/**
 * Validates the HMAC signature from Shopify's app proxy
 */
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

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // 1. EXTRACT SHOPIFY PROXY PARAMETERS
    const url = new URL(request.url);
    const queryParams = url.searchParams;
    
    const shop = queryParams.get("shop");
    const loggedInCustomerId = queryParams.get("logged_in_customer_id");
    const timestamp = queryParams.get("timestamp");
    const signature = queryParams.get("signature");

    console.log("[Membership API] Request params:", {
      shop,
      loggedInCustomerId: loggedInCustomerId ? "present" : "missing",
      timestamp,
      signature: signature ? "present" : "missing"
    });

    // 2. VALIDATE REQUEST SIGNATURE
    const APP_PROXY_SECRET = process.env.SHOPIFY_APP_PROXY_SECRET;
    if (!APP_PROXY_SECRET) {
      console.error("[Membership API] Missing SHOPIFY_APP_PROXY_SECRET");
      return json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }
    
    if (!validateProxySignature(queryParams, APP_PROXY_SECRET)) {
      console.error("[Membership API] Invalid signature");
      return json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // 3. CHECK IF CUSTOMER IS LOGGED IN
    if (!loggedInCustomerId) {
      console.log("[Membership API] No logged in customer");
      return json(
        { 
          error: "Not authenticated",
          requiresLogin: true,
          message: "Please log in to view your rewards"
        },
        { status: 401 }
      );
    }

    // 4. VALIDATE SHOP DOMAIN
    if (!shop) {
      return json(
        { error: "Missing shop parameter" },
        { status: 400 }
      );
    }

    // 5. FETCH OR CREATE CUSTOMER RECORD
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

    // 6. CREATE NEW CUSTOMER IF DOESN'T EXIST
    if (!customer) {
      console.log("[Membership API] Creating new customer record");
      
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
            evaluationPeriod: "ANNUAL",
            isActive: true,
            benefits: {
              description: "Welcome to our rewards program!",
              perks: ["1% cashback on all purchases"]
            }
          }
        });
      }

      // Create customer with initial membership
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
              assignmentType: AssignmentType.AUTOMATIC, // Use the enum value
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

      // Log tier change with correct enum
      await prisma.tierChangeLog.create({
        data: {
          customerId: customer.id,
          toTierId: defaultTier.id,
          changeType: TierChangeType.INITIAL_ASSIGNMENT, // Use correct enum
          changeReason: "New customer auto-enrollment",
          triggeredBy: "System"
        }
      });
    }

    // Now customer is guaranteed to be non-null
    // 7. GET ACTIVE MEMBERSHIP AND TIER
    const activeMembership = customer.membershipHistory[0];
    const currentTier = activeMembership?.tier;

    // 8. CALCULATE NEXT TIER PROGRESS
    let nextTier = null;
    let progressToNextTier = 0;
    
    if (currentTier && customer.analytics) {
      const spendingMetric = currentTier.evaluationPeriod === "LIFETIME" 
        ? customer.analytics.lifetimeSpending 
        : customer.analytics.yearlySpending;

      nextTier = await prisma.tier.findFirst({
        where: {
          shopDomain: shop,
          minSpend: { gt: spendingMetric },
          isActive: true
        },
        orderBy: { minSpend: 'asc' }
      });

      if (nextTier && nextTier.minSpend) {
        progressToNextTier = Math.min(
          100,
          (spendingMetric / nextTier.minSpend) * 100
        );
      }
    }

    // 9. FORMAT RECENT ACTIVITY
    const recentActivity = [
      ...customer.transactions.map(tx => ({
        id: tx.id,
        type: 'cashback_earned' as const,
        amount: tx.cashbackAmount,
        description: `Earned from order #${tx.shopifyOrderId.slice(-6)}`,
        date: tx.createdAt.toISOString(),
        status: tx.status
      })),
      ...customer.creditLedger
        .filter(entry => entry.type !== 'CASHBACK_EARNED')
        .map(entry => ({
          id: entry.id,
          type: 'credit_used' as const,
          amount: entry.amount,
          description: entry.description || `${entry.type.toLowerCase().replace(/_/g, ' ')}`,
          date: entry.createdAt.toISOString(),
          status: 'completed' as const
        }))
    ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

    // 10. BUILD RESPONSE
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
        } : null,
        nextTier: nextTier ? {
          name: nextTier.name,
          cashbackPercent: nextTier.cashbackPercent,
          requiredSpend: nextTier.minSpend,
          benefits: nextTier.benefits || {}
        } : null,
        progressToNextTier,
        assignmentType: activeMembership?.assignmentType || AssignmentType.AUTOMATIC,
        startDate: activeMembership?.startDate.toISOString(),
        endDate: activeMembership?.endDate?.toISOString() || null
      },
      analytics: customer.analytics ? {
        lifetimeSpending: customer.analytics.lifetimeSpending,
        yearlySpending: customer.analytics.yearlySpending,
        monthlySpending: customer.analytics.monthlySpending,
        avgOrderValue: customer.analytics.avgOrderValue,
        orderCount: customer.analytics.orderCount,
        currentTierDays: customer.analytics.currentTierDays,
        lastOrderDate: customer.analytics.lastOrderDate?.toISOString() || null,
        daysSinceLastOrder: customer.analytics.daysSinceLastOrder
      } : null,
      recentActivity,
      _meta: {
        timestamp: new Date().toISOString(),
        shop,
        cacheFor: 60
      }
    };

    // 11. RETURN WITH CACHING HEADERS
    return json(responseData, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-Customer-ID": loggedInCustomerId
      },
    });

  } catch (error) {
    console.error("[Membership API] Error:", error);
    
    return json(
      { 
        error: "Failed to fetch membership data",
        message: "Please try again later"
      },
      { status: 500 }
    );
  }
}