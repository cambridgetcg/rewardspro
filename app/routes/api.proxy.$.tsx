import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    // Get the path after /api/proxy/ (e.g., "membership")
    const path = params["*"];
    
    // Authenticate the app proxy request
    const { session } = await authenticate.public.appProxy(request);
    
    if (!session) {
      return json({ error: "Invalid proxy signature" }, { status: 401 });
    }
    
    // Extract app proxy parameters from the URL
    const url = new URL(request.url);
    const searchParams = url.searchParams;
    
    // Get parameters that Shopify adds to app proxy requests
    const shopDomain = searchParams.get('shop') || session.shop;
    const customerId = searchParams.get('logged_in_customer_id');
    const pathPrefix = searchParams.get('path_prefix');
    const timestamp = searchParams.get('timestamp');
    const signature = searchParams.get('signature');
    
    console.log("App Proxy Request:", {
      path,
      shop: shopDomain,
      customerId,
      timestamp,
      pathPrefix
    });
    
    // Handle the membership endpoint
    if (path === "membership") {
      // If no customer is logged in, return default tier info
      if (!customerId) {
        const defaultTier = await prisma.tier.findFirst({
          where: {
            shopDomain: shopDomain,
            isActive: true,
            minSpend: 0 // or null for base tier
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
            cashbackPercent: defaultTier?.cashbackPercent || 1,
            benefits: defaultTier?.benefits || null
          }
        });
      }
      
      // Find customer with their active membership and analytics
      const customer = await prisma.customer.findUnique({
        where: {
          shopDomain_shopifyCustomerId: {
            shopDomain: shopDomain,
            shopifyCustomerId: customerId,
          }
        },
        include: {
          membershipHistory: {
            where: { 
              isActive: true 
            },
            include: { 
              tier: true 
            },
            orderBy: { 
              startDate: 'desc' 
            },
            take: 1
          },
          analytics: true
        }
      });
      
      // If customer doesn't exist in your database yet
      if (!customer) {
        console.log(`Customer ${customerId} not found for shop ${shopDomain}`);
        
        // Get default tier for new customers
        const defaultTier = await prisma.tier.findFirst({
          where: {
            shopDomain: shopDomain,
            isActive: true,
            minSpend: 0 // or null for base tier
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
            cashbackPercent: defaultTier?.cashbackPercent || 1,
            benefits: defaultTier?.benefits || null
          },
          analytics: {
            nextTierProgress: 0,
            lifetimeSpending: 0
          }
        });
      }
      
      // Customer exists - prepare response data
      const activeMembership = customer.membershipHistory[0];
      const currentTier = activeMembership?.tier;
      
      // Get next tier info for progress calculation
      let nextTier = null;
      if (currentTier?.minSpend !== null) {
        nextTier = await prisma.tier.findFirst({
          where: {
            shopDomain: shopDomain,
            isActive: true,
            minSpend: {
              gt: currentTier.minSpend
            }
          },
          orderBy: {
            minSpend: 'asc'
          }
        });
      }
      
      const responseData = {
        exists: true,
        customerId: customer.id,
        storeCredit: customer.storeCredit,
        totalEarned: customer.totalEarned,
        lastSyncedAt: customer.lastSyncedAt,
        tier: {
          id: currentTier?.id,
          name: currentTier?.name || "Bronze",
          cashbackPercent: currentTier?.cashbackPercent || 1,
          benefits: currentTier?.benefits || null,
          evaluationPeriod: currentTier?.evaluationPeriod
        },
        membership: {
          startDate: activeMembership?.startDate,
          assignmentType: activeMembership?.assignmentType,
          endDate: activeMembership?.endDate
        },
        analytics: customer.analytics ? {
          lifetimeSpending: customer.analytics.lifetimeSpending,
          yearlySpending: customer.analytics.yearlySpending,
          avgOrderValue: customer.analytics.avgOrderValue,
          orderCount: customer.analytics.orderCount,
          nextTierProgress: customer.analytics.nextTierProgress,
          currentTierDays: customer.analytics.currentTierDays,
          lastOrderDate: customer.analytics.lastOrderDate
        } : null,
        nextTier: nextTier ? {
          name: nextTier.name,
          minSpend: nextTier.minSpend,
          cashbackPercent: nextTier.cashbackPercent,
          amountNeeded: nextTier.minSpend ? nextTier.minSpend - (customer.analytics?.yearlySpending || 0) : null
        } : null
      };
      
      console.log("Returning customer data:", {
        customerId: customer.id,
        tier: currentTier?.name,
        storeCredit: customer.storeCredit
      });
      
      return json(responseData);
    }
    
    // Handle store credit balance endpoint
    if (path === "balance") {
      if (!customerId) {
        return json({ 
          storeCredit: 0,
          formattedCredit: "$0.00"
        });
      }
      
      const customer = await prisma.customer.findUnique({
        where: {
          shopDomain_shopifyCustomerId: {
            shopDomain: shopDomain,
            shopifyCustomerId: customerId,
          }
        },
        select: {
          storeCredit: true,
          totalEarned: true,
          lastSyncedAt: true
        }
      });
      
      return json({
        storeCredit: customer?.storeCredit || 0,
        totalEarned: customer?.totalEarned || 0,
        lastSyncedAt: customer?.lastSyncedAt,
        formattedCredit: new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD' // You might want to get this from shop settings
        }).format(customer?.storeCredit || 0)
      });
    }
    
    // Handle recent transactions endpoint
    if (path === "transactions") {
      if (!customerId) {
        return json({ transactions: [] });
      }
      
      const customer = await prisma.customer.findUnique({
        where: {
          shopDomain_shopifyCustomerId: {
            shopDomain: shopDomain,
            shopifyCustomerId: customerId,
          }
        }
      });
      
      if (!customer) {
        return json({ transactions: [] });
      }
      
      const transactions = await prisma.cashbackTransaction.findMany({
        where: {
          customerId: customer.id,
          shopDomain: shopDomain
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 10
      });
      
      return json({
        transactions: transactions.map(t => ({
          id: t.id,
          orderAmount: t.orderAmount,
          cashbackAmount: t.cashbackAmount,
          cashbackPercent: t.cashbackPercent,
          status: t.status,
          createdAt: t.createdAt,
          shopifyOrderId: t.shopifyOrderId
        }))
      });
    }
    
    return json({ error: "Endpoint not found" }, { status: 404 });
    
  } catch (error) {
    console.error("App Proxy Error:", error);
    
    // Don't expose internal error details in production
    const errorMessage = process.env.NODE_ENV === "production" 
      ? "Internal server error" 
      : error instanceof Error ? error.message : "Unknown error";
    
    return json({ 
      error: "Internal server error",
      message: errorMessage
    }, { status: 500 });
  }
};