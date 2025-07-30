// File: app/routes/apps.rewardspro.api.membership.tsx
// This API route provides membership data to the frontend widget

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Handle CORS for widget requests
    const origin = request.headers.get("origin");
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Shopify-Customer-Id",
    };

    // Handle preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Get customer ID from request headers
    const shopifyCustomerId = request.headers.get("X-Shopify-Customer-Id");
    
    if (!shopifyCustomerId) {
      return json({ error: "Customer ID not provided" }, { status: 401, headers: corsHeaders });
    }

    // Get shop domain from query params
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop");
    
    if (!shopDomain) {
      return json({ error: "Shop parameter required" }, { status: 400, headers: corsHeaders });
    }

    // Fetch customer data with membership and analytics
    const customer = await prisma.customer.findUnique({
      where: {
        shopDomain_shopifyCustomerId: {
          shopDomain: shopDomain,
          shopifyCustomerId: shopifyCustomerId,
        }
      },
      include: {
        membershipHistory: {
          where: {
            isActive: true
          },
          include: {
            tier: true
          }
        },
        analytics: true,
        transactions: {
          take: 5,
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });

    if (!customer) {
      // Return default data for non-members
      const defaultTier = await prisma.tier.findFirst({
        where: {
          shopDomain: shopDomain,
          isActive: true
        },
        orderBy: {
          cashbackPercent: 'asc'
        }
      });

      return json({
        points: 0,
        storeCredit: 0,
        totalEarned: 0,
        tier: {
          name: defaultTier?.name || "Bronze",
          cashbackPercent: defaultTier?.cashbackPercent || 1,
          color: "#CD7F32"
        },
        tierProgress: null,
        recentActivity: [],
        isMember: false
      }, { headers: corsHeaders });
    }

    // Get current active membership
    const activeMembership = customer.membershipHistory[0];
    const currentTier = activeMembership?.tier;

    // Calculate tier progress if applicable
    let tierProgress = null;
    if (currentTier && customer.analytics) {
      // Find next tier
      const nextTier = await prisma.tier.findFirst({
        where: {
          shopDomain: shopDomain,
          isActive: true,
          minSpend: {
            gt: currentTier.minSpend || 0
          }
        },
        orderBy: {
          minSpend: 'asc'
        }
      });

      if (nextTier) {
        const currentSpending = currentTier.evaluationPeriod === 'ANNUAL' 
          ? customer.analytics.yearlySpending 
          : customer.analytics.lifetimeSpending;
          
        const currentTierMin = currentTier.minSpend || 0;
        const nextTierMin = nextTier.minSpend || 0;
        
        tierProgress = {
          current: Math.max(0, currentSpending - currentTierMin),
          required: nextTierMin - currentTierMin,
          nextTierName: nextTier.name,
          percentComplete: Math.min(100, ((currentSpending - currentTierMin) / (nextTierMin - currentTierMin)) * 100)
        };
      }
    }

    // Format recent transactions
    const recentActivity = customer.transactions.map(transaction => ({
      type: "cashback_earned",
      amount: transaction.cashbackAmount,
      orderAmount: transaction.orderAmount,
      date: transaction.createdAt.toISOString(),
      status: transaction.status
    }));

    // Parse tier benefits if stored as JSON
    let tierBenefits = [];
    if (currentTier?.benefits) {
      try {
        tierBenefits = typeof currentTier.benefits === 'string' 
          ? JSON.parse(currentTier.benefits) 
          : currentTier.benefits;
      } catch {
        tierBenefits = [];
      }
    }

    // Return membership data with CORS headers
    return json({
      points: customer.storeCredit, // Using store credit as points
      storeCredit: customer.storeCredit,
      totalEarned: customer.totalEarned,
      tier: {
        id: currentTier?.id || '',
        name: currentTier?.name || 'Bronze',
        cashbackPercent: currentTier?.cashbackPercent || 1,
        color: getTierColor(currentTier?.name || 'Bronze'),
        benefits: tierBenefits
      },
      tierProgress: tierProgress,
      recentActivity: recentActivity,
      memberSince: customer.createdAt.toISOString(),
      isMember: true,
      analytics: {
        lifetimeSpending: customer.analytics?.lifetimeSpending || 0,
        yearlySpending: customer.analytics?.yearlySpending || 0,
        avgOrderValue: customer.analytics?.avgOrderValue || 0,
        orderCount: customer.analytics?.orderCount || 0
      }
    }, { headers: corsHeaders });

  } catch (error) {
    console.error("Error fetching membership data:", error);
    return json({ error: "Internal server error" }, { status: 500, headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Shopify-Customer-Id",
    }});
  }
};

// Helper function to get tier colors
function getTierColor(tierName: string): string {
  const colors: Record<string, string> = {
    'Bronze': '#CD7F32',
    'Silver': '#C0C0C0',
    'Gold': '#FFD700',
    'Platinum': '#E5E4E2',
    'Diamond': '#B9F2FF'
  };
  return colors[tierName] || '#007bff';
}

// Optional: Add a POST method for actions
export const action = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // Handle CORS
  const origin = request.headers.get("origin");
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Shopify-Customer-Id",
  };

  const body = await request.json();
  const { action, customerId, shopDomain, data } = body;

  if (!shopDomain || !customerId) {
    return json({ error: "Missing required parameters" }, { status: 400, headers: corsHeaders });
  }

  switch (action) {
    case "update_preferences":
      // Update customer preferences
      try {
        await prisma.customer.update({
          where: {
            shopDomain_shopifyCustomerId: {
              shopDomain: shopDomain,
              shopifyCustomerId: customerId
            }
          },
          data: {
            preferences: data.preferences
          }
        });
        return json({ success: true, message: "Preferences updated" }, { headers: corsHeaders });
      } catch (error) {
        return json({ error: "Failed to update preferences" }, { status: 500, headers: corsHeaders });
      }
      
    default:
      return json({ error: "Invalid action" }, { status: 400, headers: corsHeaders });
  }
};