import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, cors } = await authenticate.public(request);
  
  if (!params.customerId) {
    return cors(json({ error: "Customer ID required" }, { status: 400 }));
  }

  try {
    const customer = await db.customer.findUnique({
      where: { shopifyCustomerId: params.customerId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        membershipHistory: {
          where: { isActive: true },
          include: { tier: true },
          take: 1
        }
      }
    });

    if (!customer) {
      return cors(json({ 
        storeCredit: 0, 
        totalEarned: 0, 
        transactions: [],
        tier: {
          id: 'default',
          name: 'bronze',
          displayName: 'Bronze',
          level: 1,
          cashbackPercent: 1,
          color: '#CD7F32'
        }
      }));
    }

    const activeMembership = customer.membershipHistory[0];
    const tier = activeMembership?.tier || {
      id: 'default',
      name: 'bronze',
      displayName: 'Bronze',
      level: 1,
      cashbackPercent: 1,
      color: '#CD7F32'
    };

    return cors(json({
      customerId: customer.shopifyCustomerId,
      email: customer.email,
      storeCredit: customer.storeCredit,
      totalEarned: customer.totalEarned,
      tier: {
        id: tier.id,
        name: tier.name,
        displayName: tier.displayName,
        level: tier.level,
        cashbackPercent: tier.cashbackPercent,
        color: tier.color
      },
      transactions: customer.transactions.map(t => ({
        orderId: t.shopifyOrderId,
        orderAmount: t.orderAmount,
        cashbackAmount: t.cashbackAmount,
        date: t.createdAt
      }))
    }));
  } catch (error) {
    console.error("Error fetching customer data:", error);
    return cors(json({ error: "Internal server error" }, { status: 500 }));
  }
};