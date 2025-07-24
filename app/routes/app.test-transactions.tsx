// app/routes/app.test-transactions.tsx

import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { useState } from "react";

type ActionResponse =
  | { error: string; success?: never }
  | {
      success: true;
      orderId: string;
      orderName: string;
      analysis: {
        orderTotal: number;
        giftCardAmount: number;
        storeCreditAmount: number;
        cashbackEligibleAmount: number;
        currency: string;
        transactions: Array<{
          id: string;
          gateway: string;
          amount: number;
          kind: string;
          status: string;
        }>;
      };
      error?: never;
    };

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({ ready: true });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();
  const orderIdInput = formData.get("orderId") as string;

  if (!orderIdInput) {
    return json<ActionResponse>({ error: "Order ID is required" });
  }

  // 1. Test GraphQL connection
  try {
    const testQuery = `#graphql
      query testConnection {
        shop {
          name
          currencyCode
        }
      }
    `;
    const testResponse = await admin.graphql(testQuery);
    const testResult = await testResponse.json();
    if (!("data" in testResult) || !testResult.data?.shop) {
      return json<ActionResponse>({
        error: "Unable to connect to Shopify GraphQL API. Please check your app permissions.",
      });
    }
  } catch (testError) {
    return json<ActionResponse>({
      error: "Failed to connect to Shopify API. Please ensure your app is properly installed.",
    });
  }

  // 2. Fetch order transactions and details
  try {
    const QUERY = `#graphql
      query getOrderPaymentDetails($id: ID!) {
        order(id: $id) {
          id
          name
          currencyCode
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
          paymentGatewayNames
          transactions(first: 50) {
            nodes {
              id
              kind
              gateway
              status
              amountSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    `;

    // Normalize to Relay Global ID if needed
    const gid = orderIdInput.startsWith("gid://")
      ? orderIdInput
      : `gid://shopify/Order/${orderIdInput}`;

    const response = await admin.graphql(QUERY, { variables: { id: gid } });
    const result = await response.json();

    if ("errors" in result && result.errors) {
      return json<ActionResponse>({
        error: `GraphQL Error: ${(result.errors as any[])
          .map((e: any) => e.message)
          .join(", ")}`,
      });
    }

    const order = result.data?.order;
    if (!order) {
      return json<ActionResponse>({
        error: "Order not found. Please check the order ID and ensure your app has the necessary permissions.",
      });
    }

    const txs = order.transactions.nodes as Array<any>;

    // 3. Payment breakdown calculation
    let giftCardAmount = 0;
    let storeCreditAmount = 0;

    const processedTransactions = txs
      .filter((t) => t.status === "SUCCESS" && t.kind === "SALE")
      .map((t) => {
        const amount = parseFloat(t.amountSet.shopMoney.amount);
        const gw = t.gateway.toLowerCase();

        if (gw.includes("gift_card")) {
          giftCardAmount += amount;
        } else if (gw.includes("store_credit")) {
          storeCreditAmount += amount;
        }
        return {
          id: t.id,
          gateway: t.gateway,
          amount,
          kind: t.kind,
          status: t.status,
        };
      });

    const orderTotal = parseFloat(order.totalPriceSet.shopMoney.amount);
    const cashbackEligibleAmount = orderTotal - giftCardAmount - storeCreditAmount;

    return json<ActionResponse>({
      success: true,
      orderId: order.id,
      orderName: order.name,
      analysis: {
        orderTotal,
        giftCardAmount,
        storeCreditAmount,
        cashbackEligibleAmount,
        currency: order.currencyCode,
        transactions: processedTransactions,
      },
    });
  } catch (error) {
    return json<ActionResponse>({
      error: `Error: ${error instanceof Error ? error.message : "Unknown error occurred"}`,
    });
  }
}

export default function TestTransactions() {
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const [orderId, setOrderId] = useState("");

  const isSubmitting = navigation.state === "submitting";

  const formatCurrency = (amount: number, currency: string) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
    }).format(amount);

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "24px" }}>Cashback Transaction Test</h1>

      <div
        style={{
          backgroundColor: "#f0f9ff",
          border: "1px solid #0ea5e9",
          padding: "16px",
          borderRadius: "6px",
          marginBottom: "24px",
          fontSize: "14px",
        }}
      >
        <strong>How to find an Order ID:</strong>
        <ol style={{ marginTop: "8px", marginBottom: "0", paddingLeft: "20px" }}>
          <li>Go to your Shopify Admin → Orders</li>
          <li>Click on any order</li>
          <li>
            The Order ID is in the URL: <code>/admin/orders/<strong>1234567890</strong></code>
          </li>
          <li>Or use the order number without the # (e.g., "1001")</li>
        </ol>
        <p style={{ marginTop: "12px", marginBottom: "0" }}>
          <strong>Required permissions:</strong> <code>read_orders</code>
        </p>
      </div>

      <Form method="post" style={{ marginBottom: "32px" }}>
        <div style={{ marginBottom: "16px" }}>
          <label
            style={{ display: "block", marginBottom: "8px", fontWeight: "500" }}
          >
            Order ID
          </label>
          <input
            type="text"
            name="orderId"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="Enter order ID (e.g., 5678901234567)"
            required
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #ddd",
              borderRadius: "6px",
              fontSize: "16px",
            }}
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !orderId}
          style={{
            padding: "10px 20px",
            backgroundColor: isSubmitting || !orderId ? "#ccc" : "#0070f3",
            color: "white",
            border: "none",
            borderRadius: "6px",
            fontSize: "16px",
            cursor: isSubmitting || !orderId ? "not-allowed" : "pointer",
          }}
        >
          {isSubmitting ? "Analyzing..." : "Analyze Order"}
        </button>
      </Form>

      {actionData && "error" in actionData && (
        <div
          style={{
            backgroundColor: "#fee",
            border: "1px solid #fcc",
            padding: "16px",
            borderRadius: "6px",
            marginBottom: "24px",
          }}
        >
          <strong>Error:</strong> {actionData.error}
        </div>
      )}

      {actionData && "success" in actionData && (
        <div>
          <h2 style={{ fontSize: "20px", marginBottom: "16px" }}>
            Order {actionData.orderName}
          </h2>

          {/* Payment Breakdown */}
          <div
            style={{
              backgroundColor: "#f5f5f5",
              padding: "20px",
              borderRadius: "8px",
              marginBottom: "24px",
            }}
          >
            <h3 style={{ fontSize: "16px", marginBottom: "16px" }}>
              Payment Breakdown
            </h3>

            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Order Total:</span>
                <strong>
                  {formatCurrency(
                    actionData.analysis.orderTotal,
                    actionData.analysis.currency
                  )}
                </strong>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "#666",
                }}
              >
                <span>− Gift Cards:</span>
                <span>
                  {formatCurrency(
                    actionData.analysis.giftCardAmount,
                    actionData.analysis.currency
                  )}
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "#666",
                }}
              >
                <span>− Store Credits:</span>
                <span>
                  {formatCurrency(
                    actionData.analysis.storeCreditAmount,
                    actionData.analysis.currency
                  )}
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingTop: "12px",
                  borderTop: "1px solid #ddd",
                  fontWeight: "bold",
                  color: "#0070f3",
                }}
              >
                <span>= Cashback Eligible Amount:</span>
                <span>
                  {formatCurrency(
                    actionData.analysis.cashbackEligibleAmount,
                    actionData.analysis.currency
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Transaction Details */}
          <div>
            <h3 style={{ fontSize: "16px", marginBottom: "12px" }}>
              Transactions
            </h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "8px", textAlign: "left" }}>Gateway</th>
                  <th style={{ padding: "8px", textAlign: "left" }}>Type</th>
                  <th style={{ padding: "8px", textAlign: "left" }}>Status</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {actionData.analysis.transactions.map((t, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "8px" }}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "14px",
                          backgroundColor: t.gateway
                            .toLowerCase()
                            .includes("gift_card")
                            ? "#fef3c7"
                            : t.gateway.toLowerCase() === "shopify_store_credit"
                            ? "#ddd6fe"
                            : "#d1fae5",
                          color: t.gateway.toLowerCase().includes("gift_card")
                            ? "#92400e"
                            : t.gateway.toLowerCase() === "shopify_store_credit"
                            ? "#5b21b6"
                            : "#065f46",
                        }}
                      >
                        {t.gateway}
                      </span>
                    </td>
                    <td style={{ padding: "8px" }}>{t.kind}</td>
                    <td style={{ padding: "8px" }}>{t.status}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>
                      {formatCurrency(t.amount, actionData.analysis.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
