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
  const { admin } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const orderId = formData.get("orderId") as string;
  
  if (!orderId) {
    return json<ActionResponse>({ error: "Order ID is required" });
  }
  
  try {
    // Minimal query - only fields needed for cashback calculation
    const query = `#graphql
      query getOrderPaymentDetails($id: ID!) {
        order(id: $id) {
          id
          name
          currencyCode
          
          # Total order amount
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          
          # Payment gateway names (helpful for identification)
          paymentGatewayNames
          
          # Transactions - the key data for payment breakdown
          transactions(first: 50) {
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
    `;
    
    const gid = orderId.startsWith('gid://') ? orderId : `gid://shopify/Order/${orderId}`;
    const response = await admin.graphql(query, { variables: { id: gid } });
    const result = await response.json();
    
    if (!result.data?.order) {
      return json<ActionResponse>({ error: "Order not found" });
    }
    
    const order = result.data.order;
    const transactions = order.transactions || [];
    
    // Calculate payment breakdown
    let giftCardAmount = 0;
    let storeCreditAmount = 0;
    let regularPaymentAmount = 0;
    
    const processedTransactions = transactions
      .filter((t: any) => t.status === 'SUCCESS' && t.kind === 'SALE')
      .map((t: any) => {
        const amount = parseFloat(t.amountSet.shopMoney.amount);
        const gateway = t.gateway.toLowerCase();
        
        // Identify payment type
        if (gateway === 'gift_card' || gateway.includes('gift')) {
          giftCardAmount += amount;
        } else if (gateway === 'store_credit' || gateway.includes('credit')) {
          storeCreditAmount += amount;
        } else {
          regularPaymentAmount += amount;
        }
        
        return {
          id: t.id,
          gateway: t.gateway,
          amount,
          kind: t.kind,
          status: t.status
        };
      });
    
    const orderTotal = parseFloat(order.totalPriceSet.shopMoney.amount);
    const cashbackEligibleAmount = regularPaymentAmount;
    
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
        transactions: processedTransactions
      }
    });
    
  } catch (error) {
    console.error("Error:", error);
    return json<ActionResponse>({
      error: error instanceof Error ? error.message : "Failed to fetch order"
    });
  }
}

export default function TestTransactions() {
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const [orderId, setOrderId] = useState("");
  
  const isSubmitting = navigation.state === "submitting";
  
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };
  
  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "24px" }}>
        Cashback Transaction Test
      </h1>
      
      <Form method="post" style={{ marginBottom: "32px" }}>
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", marginBottom: "8px", fontWeight: "500" }}>
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
              fontSize: "16px"
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
            cursor: isSubmitting || !orderId ? "not-allowed" : "pointer"
          }}
        >
          {isSubmitting ? "Analyzing..." : "Analyze Order"}
        </button>
      </Form>
      
      {actionData && 'error' in actionData && (
        <div style={{
          backgroundColor: "#fee",
          border: "1px solid #fcc",
          padding: "16px",
          borderRadius: "6px",
          marginBottom: "24px"
        }}>
          <strong>Error:</strong> {actionData.error}
        </div>
      )}
      
      {actionData && 'success' in actionData && (
        <div>
          <h2 style={{ fontSize: "20px", marginBottom: "16px" }}>
            Order {actionData.orderName}
          </h2>
          
          {/* Payment Breakdown */}
          <div style={{
            backgroundColor: "#f5f5f5",
            padding: "20px",
            borderRadius: "8px",
            marginBottom: "24px"
          }}>
            <h3 style={{ fontSize: "16px", marginBottom: "16px" }}>Payment Breakdown</h3>
            
            <div style={{ display: "grid", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Order Total:</span>
                <strong>{formatCurrency(actionData.analysis.orderTotal, actionData.analysis.currency)}</strong>
              </div>
              
              <div style={{ display: "flex", justifyContent: "space-between", color: "#666" }}>
                <span>- Gift Cards:</span>
                <span>{formatCurrency(actionData.analysis.giftCardAmount, actionData.analysis.currency)}</span>
              </div>
              
              <div style={{ display: "flex", justifyContent: "space-between", color: "#666" }}>
                <span>- Store Credits:</span>
                <span>{formatCurrency(actionData.analysis.storeCreditAmount, actionData.analysis.currency)}</span>
              </div>
              
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                paddingTop: "12px",
                borderTop: "1px solid #ddd",
                fontWeight: "bold",
                color: "#0070f3"
              }}>
                <span>Cashback Eligible Amount:</span>
                <span>{formatCurrency(actionData.analysis.cashbackEligibleAmount, actionData.analysis.currency)}</span>
              </div>
            </div>
          </div>
          
          {/* Transaction Details */}
          <div>
            <h3 style={{ fontSize: "16px", marginBottom: "12px" }}>Transactions</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "8px", textAlign: "left" as const }}>Gateway</th>
                  <th style={{ padding: "8px", textAlign: "left" as const }}>Type</th>
                  <th style={{ padding: "8px", textAlign: "left" as const }}>Status</th>
                  <th style={{ padding: "8px", textAlign: "right" as const }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {actionData.analysis.transactions.map((t, index) => (
                  <tr key={index} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "8px" }}>
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "14px",
                        backgroundColor: t.gateway.includes('gift') ? '#fef3c7' : 
                                       t.gateway.includes('credit') ? '#ddd6fe' : '#d1fae5',
                        color: t.gateway.includes('gift') ? '#92400e' : 
                               t.gateway.includes('credit') ? '#5b21b6' : '#065f46'
                      }}>
                        {t.gateway}
                      </span>
                    </td>
                    <td style={{ padding: "8px" }}>{t.kind}</td>
                    <td style={{ padding: "8px" }}>{t.status}</td>
                    <td style={{ padding: "8px", textAlign: "right" as const }}>
                      {formatCurrency(t.amount, actionData.analysis.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Summary for Implementation */}
          <div style={{
            backgroundColor: "#e6f7ff",
            border: "1px solid #91d5ff",
            padding: "16px",
            borderRadius: "6px",
            marginTop: "24px"
          }}>
            <h4 style={{ margin: "0 0 8px 0", fontSize: "14px" }}>Implementation Summary</h4>
            <p style={{ margin: "0", fontSize: "14px", lineHeight: "1.5" }}>
              For this order, cashback should be calculated on <strong>{formatCurrency(actionData.analysis.cashbackEligibleAmount, actionData.analysis.currency)}</strong>, 
              which excludes gift card payments ({formatCurrency(actionData.analysis.giftCardAmount, actionData.analysis.currency)}) 
              and store credit payments ({formatCurrency(actionData.analysis.storeCreditAmount, actionData.analysis.currency)}).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}