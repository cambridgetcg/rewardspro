import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

/**
 * Public API endpoint for storefront widget.
 * Fetches customer rewards data by Shopify customer ID.
 *
 * No Shopify auth — this is called from the theme extension via app proxy.
 * The shop domain must be passed as a query param for scoping.
 */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  };

  if (!params.customerId) {
    return json({ error: "Customer ID required" }, { status: 400, headers });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json({ error: "Missing shop parameter" }, { status: 400, headers });
  }

  try {
    const customer = await prisma.customer.findUnique({
      where: {
        shopDomain_shopifyCustomerId: {
          shopDomain: shop,
          shopifyCustomerId: params.customerId,
        },
      },
      include: {
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        membershipHistory: {
          where: { isActive: true },
          include: { tier: true },
          take: 1,
        },
      },
    });

    const defaultTier = {
      id: "default",
      name: "Bronze",
      cashbackPercent: 1,
    };

    if (!customer) {
      return json(
        {
          storeCredit: 0,
          totalEarned: 0,
          transactions: [],
          tier: defaultTier,
        },
        { headers },
      );
    }

    const activeMembership = customer.membershipHistory[0];
    const tier = activeMembership?.tier
      ? {
          id: activeMembership.tier.id,
          name: activeMembership.tier.name,
          cashbackPercent: activeMembership.tier.cashbackPercent,
        }
      : defaultTier;

    return json(
      {
        customerId: customer.shopifyCustomerId,
        email: customer.email,
        storeCredit: customer.storeCredit,
        totalEarned: customer.totalEarned,
        tier,
        transactions: customer.transactions.map((t) => ({
          orderId: t.shopifyOrderId,
          orderAmount: t.orderAmount,
          cashbackAmount: t.cashbackAmount,
          date: t.createdAt,
        })),
      },
      { headers },
    );
  } catch (error) {
    console.error("Error fetching customer data:", error);
    return json(
      { error: "Internal server error" },
      { status: 500, headers },
    );
  }
};
