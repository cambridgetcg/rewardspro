// app/routes/api.customer.$customerId.tsx
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Add CORS headers for public API
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (!params.customerId) {
    return json({ error: "Customer ID required" }, { status: 400, headers });
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
      return json({
        storeCredit: 0,
        totalEarned: 0,
        transactions: []
      }, { headers });
    }

    return json({
      storeCredit: customer.storeCredit,
      totalEarned: customer.totalEarned,
      transactions: customer.transactions.map(t => ({
        orderId: t.shopifyOrderId,
        orderAmount: t.orderAmount,
        cashbackAmount: t.cashbackAmount,
        date: t.createdAt
      }))
    }, { headers });

  } catch (error) {
    console.error("Error fetching customer data:", error);
    return json({ error: "Internal server error" }, { status: 500, headers });
  }
};

// Handle OPTIONS requests for CORS
export const action = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  
  return json({ error: "Method not allowed" }, { status: 405 });
};