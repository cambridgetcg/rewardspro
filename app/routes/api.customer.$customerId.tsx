// app/routes/api.customer.$customerId.tsx
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
        }
      }
    });

    if (!customer) {
      return cors(json({ 
        storeCredit: 0, 
        totalEarned: 0, 
        transactions: [] 
      }));
    }

    return cors(json({
      storeCredit: customer.storeCredit,
      totalEarned: customer.totalEarned,
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