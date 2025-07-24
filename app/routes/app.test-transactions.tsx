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
  const orderId = formData.get("orderId") as string;
  
  if (!orderId) {
    return json<ActionResponse>({ error: "Order ID is required" });
  }
  
  // First, let's test if we can make any GraphQL query
  try {
    console.log("Testing GraphQL connection for shop:", session.shop);
    
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
    console.log("Test query result:", testResult);
    
    if (!('data' in testResult) || !testResult.data?.shop) {
      return json<ActionResponse>({ 
        error: "Unable to connect to Shopify GraphQL API. Please check your app permissions." 
      });
    }
  } catch (testError) {
    console.error("GraphQL connection test failed:", testError);
    return json<ActionResponse>({ 
      error: "Failed to connect to Shopify API. Please ensure your app is properly installed." 
    });
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
          
          # Net payment (actual money paid by customer)
          netPaymentSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          
          # Total discounts (might include store credits)
          totalDiscountsSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          
          # Payment gateway names (helpful for identification)
          paymentGatewayNames
          
          # Transactions - for breakdown visibility
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
    console.log("Attempting to fetch order with ID:", gid);
    
    const response = await admin.graphql(query, { variables: { id: gid } });
    const result = await response.json();
    
    console.log("GraphQL Response:", JSON.stringify(result, null, 2));
    
    // Check for GraphQL errors
    if ('errors' in result && result.errors) {
      console.error("GraphQL Errors:", result.errors);
      return json<ActionResponse>({ 
        error: `GraphQL Error: ${(result.errors as any[]).map((e: any) => e.message).join(', ')}` 
      });
    }
    
    if (!('data' in result) || !result.data?.order) {
      console.error("No order data in response:", result);
      return json<ActionResponse>({ 
        error: "Order not found. Please check the order ID and ensure your app has the necessary permissions." 
      });
    }
    
    const order = result.data.order;
    const transactions = order.transactions || [];
    
    // Calculate payment breakdown using NET PAYMENT method
    const orderTotal = parseFloat(order.totalPriceSet.shopMoney.amount);
    const netPayment = parseFloat(order.netPaymentSet.shopMoney.amount);
    const totalDiscounts = parseFloat(order.totalDiscountsSet?.shopMoney?.amount || "0");
    
    console.log("\n=== CASHBACK CALCULATION (NET PAYMENT METHOD) ===");
    console.log(`Order Total: ${orderTotal} ${order.currencyCode}`);
    console.log(`Net Payment (actual money paid): ${netPayment} ${order.currencyCode}`);
    console.log(`Total Discounts: ${totalDiscounts} ${order.currencyCode}`);
    console.log(`Payment Gateways: ${order.paymentGatewayNames?.join(', ') || 'none'}`);
    
    // The cashback eligible amount is simply the net payment
    // Net payment already excludes gift cards and store credits
    const cashbackEligibleAmount = netPayment;
    
    // Process transactions just for visibility
    let giftCardAmount = 0;
    let storeCreditAmount = 0;
    
    console.log(`\nTransaction breakdown for reference:`);
    
    const processedTransactions = transactions
      .filter((t: any) => {
        const isSuccessful = t.status === 'SUCCESS';
        const isSale = t.kind === 'SALE';
        return isSuccessful && isSale;
      })
      .map((t: any) => {
        const amount = parseFloat(t.amountSet.shopMoney.amount);
        const gateway = t.gateway.toLowerCase();
        const originalGateway = t.gateway;
        
        console.log(`Transaction: ${originalGateway} - Amount: ${amount}`);
        
        // Track gift cards and store credits for display
        if (gateway === 'gift_card' || gateway.includes('gift_card')) {
          giftCardAmount += amount;
        }
        
        return {
          id: t.id,
          gateway: t.gateway,
          amount,
          kind: t.kind,
          status: t.status
        };
      });
    
    // Calculate implied store credit from the difference
    // Store Credits = Order Total - Net Payment - Gift Cards
    const impliedNonCashPayments = orderTotal - netPayment;
    storeCreditAmount = impliedNonCashPayments - giftCardAmount;
    
    // Ensure store credit is not negative (in case of rounding errors)
    if (storeCreditAmount < 0) {
      storeCreditAmount = 0;
    }
    
    console.log("\n=== FINAL CALCULATION ===");
    console.log(`Order Total: ${orderTotal} ${order.currencyCode}`);
    console.log(`Net Payment (Cashback Eligible): ${netPayment} ${order.currencyCode}`);
    console.log(`\nBreakdown of non-cash payments:`);
    console.log(`- Total non-cash payments: ${impliedNonCashPayments} ${order.currencyCode}`);
    console.log(`  - Gift Cards identified: ${giftCardAmount} ${order.currencyCode}`);
    console.log(`  - Store Credits (calculated): ${storeCreditAmount} ${order.currencyCode}`);
    console.log(`\nVerification: ${netPayment} + ${giftCardAmount} + ${storeCreditAmount} = ${netPayment + giftCardAmount + storeCreditAmount}`);
    console.log(`Should equal order total: ${orderTotal}`);
    console.log("========================\n");
    
    return json<ActionResponse>({
      success: true,
      orderId: order.id,
      orderName: order.name,
      analysis: {
        orderTotal,
        giftCardAmount,
        storeCreditAmount,
        cashbackEligibleAmount: netPayment, // Net payment is the cashback eligible amount
        currency: order.currencyCode,
        transactions: processedTransactions
      }
    });
    
  } catch (error) {
    console.error("Error in action:", error);
    return json<ActionResponse>({
      error: `Error: ${error instanceof Error ? error.message : "Unknown error occurred"}`
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
      
      <div style={{
        backgroundColor: "#f0f9ff",
        border: "1px solid #0ea5e9",
        padding: "16px",
        borderRadius: "6px",
        marginBottom: "24px",
        fontSize: "14px"
      }}>
        <strong>How to find an Order ID:</strong>
        <ol style={{ marginTop: "8px", marginBottom: "0", paddingLeft: "20px" }}>
          <li>Go to your Shopify Admin → Orders</li>
          <li>Click on any order</li>
          <li>The Order ID is in the URL: /admin/orders/<strong>1234567890</strong></li>
          <li>Or use the order number without the # (e.g., "1001" instead of "#1001")</li>
        </ol>
        <p style={{ marginTop: "12px", marginBottom: "0" }}>
          <strong>Required permissions:</strong> Your app needs <code>read_orders</code> access scope.
        </p>
      </div>
      
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
                <span>− Gift Cards:</span>
                <span>{formatCurrency(actionData.analysis.giftCardAmount, actionData.analysis.currency)}</span>
              </div>
              
              <div style={{ display: "flex", justifyContent: "space-between", color: "#666" }}>
                <span>− Store Credits:</span>
                <span>{formatCurrency(actionData.analysis.storeCreditAmount, actionData.analysis.currency)}</span>
              </div>
              
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                paddingTop: "12px",
                borderTop: "1px solid #ddd",
                fontSize: "14px",
                color: "#666"
              }}>
                <span>Total Non-Cash Payments:</span>
                <span>{formatCurrency(actionData.analysis.giftCardAmount + actionData.analysis.storeCreditAmount, actionData.analysis.currency)}</span>
              </div>
              
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                paddingTop: "12px",
                borderTop: "1px solid #ddd",
                fontWeight: "bold",
                color: "#0070f3"
              }}>
                <span>= Cashback Eligible Amount:</span>
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
                        backgroundColor: t.gateway.toLowerCase().includes('gift_card') ? '#fef3c7' : 
                                       t.gateway.toLowerCase() === 'store_credit' ? '#ddd6fe' : '#d1fae5',
                        color: t.gateway.toLowerCase().includes('gift_card') ? '#92400e' : 
                               t.gateway.toLowerCase() === 'store_credit' ? '#5b21b6' : '#065f46'
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
              For this order, cashback should be calculated on <strong>{formatCurrency(actionData.analysis.cashbackEligibleAmount, actionData.analysis.currency)}</strong>.
              This is the <strong>net payment amount</strong> - the actual money paid by the customer after excluding gift cards, store credits, and other non-monetary payments.
            </p>
            <p style={{ margin: "8px 0 0 0", fontSize: "13px", color: "#666" }}>
              <strong>Simple rule:</strong> Use the <code>netPaymentSet</code> field from Shopify's Order API as the cashback eligible amount.
            </p>
          </div>
          
          {/* Debug Info */}
          <div style={{
            backgroundColor: "#f9fafb",
            border: "1px solid #e5e7eb",
            padding: "16px",
            borderRadius: "6px",
            marginTop: "16px",
            fontSize: "13px"
          }}>
            <p style={{ margin: "0", color: "#dc2626", fontWeight: "600" }}>
              💡 Check your browser console for detailed calculation logs!
            </p>
          </div>
        </div>
      )}
    </div>
  );
}