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
    
    // Calculate payment breakdown
    let giftCardAmount = 0;
    let storeCreditAmount = 0;
    let regularPaymentAmount = 0;
    
    console.log("\n=== PAYMENT CALCULATION BREAKDOWN ===");
    console.log(`Order Total: ${order.totalPriceSet.shopMoney.amount} ${order.currencyCode}`);
    console.log(`Total Transactions: ${transactions.length}`);
    console.log("\nProcessing transactions:");
    
    const processedTransactions = transactions
      .filter((t: any) => {
        const isSuccessful = t.status === 'SUCCESS';
        const isSale = t.kind === 'SALE';
        console.log(`\nTransaction ${t.id}:`);
        console.log(`  Status: ${t.status} (Success: ${isSuccessful})`);
        console.log(`  Kind: ${t.kind} (Sale: ${isSale})`);
        console.log(`  Include in calculation: ${isSuccessful && isSale}`);
        return isSuccessful && isSale;
      })
      .map((t: any) => {
        const amount = parseFloat(t.amountSet.shopMoney.amount);
        const gateway = t.gateway.toLowerCase();
        const originalGateway = t.gateway;
        
        console.log(`\nProcessing Transaction:`);
        console.log(`  Gateway: "${originalGateway}" (lowercase: "${gateway}")`);
        console.log(`  Amount: ${amount} ${t.amountSet.shopMoney.currencyCode}`);
        
        // Identify payment type
        if (gateway === 'gift_card' || gateway.includes('gift')) {
          giftCardAmount += amount;
          console.log(`  → Identified as GIFT CARD`);
          console.log(`  → Gift card total now: ${giftCardAmount}`);
        } else if (gateway === 'store_credit' || gateway.includes('credit')) {
          storeCreditAmount += amount;
          console.log(`  → Identified as STORE CREDIT`);
          console.log(`  → Store credit total now: ${storeCreditAmount}`);
        } else {
          regularPaymentAmount += amount;
          console.log(`  → Identified as REGULAR PAYMENT`);
          console.log(`  → Regular payment total now: ${regularPaymentAmount}`);
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
    
    console.log("\n=== FINAL CALCULATION SUMMARY ===");
    console.log(`Order Total: ${orderTotal}`);
    console.log(`Gift Card Amount: ${giftCardAmount}`);
    console.log(`Store Credit Amount: ${storeCreditAmount}`);
    console.log(`Regular Payment Amount: ${regularPaymentAmount}`);
    console.log(`Cashback Eligible Amount: ${cashbackEligibleAmount}`);
    console.log(`\nVerification: ${giftCardAmount} + ${storeCreditAmount} + ${regularPaymentAmount} = ${giftCardAmount + storeCreditAmount + regularPaymentAmount}`);
    console.log(`Should equal order total: ${orderTotal}`);
    console.log(`Difference: ${Math.abs(orderTotal - (giftCardAmount + storeCreditAmount + regularPaymentAmount))}`);
    console.log("================================\n");
    
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
          
          {/* Debug Information */}
          <div style={{
            backgroundColor: "#f9fafb",
            border: "1px solid #e5e7eb",
            padding: "16px",
            borderRadius: "6px",
            marginTop: "24px",
            fontSize: "13px"
          }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: "14px" }}>Debug Information</h4>
            <p style={{ margin: "4px 0" }}>
              <strong>Order ID:</strong> {actionData.orderId}
            </p>
            <p style={{ margin: "4px 0" }}>
              <strong>Total Transactions Found:</strong> {actionData.analysis.transactions.length}
            </p>
            <p style={{ margin: "4px 0" }}>
              <strong>Calculation:</strong><br />
              Gift Cards ({formatCurrency(actionData.analysis.giftCardAmount, actionData.analysis.currency)}) + 
              Store Credits ({formatCurrency(actionData.analysis.storeCreditAmount, actionData.analysis.currency)}) + 
              Regular Payments ({formatCurrency(actionData.analysis.cashbackEligibleAmount, actionData.analysis.currency)}) = 
              {formatCurrency(
                actionData.analysis.giftCardAmount + 
                actionData.analysis.storeCreditAmount + 
                actionData.analysis.cashbackEligibleAmount, 
                actionData.analysis.currency
              )}
            </p>
            <p style={{ margin: "4px 0", color: "#dc2626" }}>
              <strong>Check your browser console for detailed calculation logs!</strong>
            </p>
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
          
          {/* Debug Information */}
          <div style={{
            backgroundColor: "#f9fafb",
            border: "1px solid #e5e7eb",
            padding: "16px",
            borderRadius: "6px",
            marginTop: "24px",
            fontSize: "13px"
          }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: "14px" }}>Debug Information</h4>
            <p style={{ margin: "4px 0" }}>
              <strong>Order ID:</strong> {actionData.orderId}
            </p>
            <p style={{ margin: "4px 0" }}>
              <strong>Total Transactions Found:</strong> {actionData.analysis.transactions.length}
            </p>
            <p style={{ margin: "4px 0" }}>
              <strong>Calculation:</strong><br />
              Gift Cards ({formatCurrency(actionData.analysis.giftCardAmount, actionData.analysis.currency)}) + 
              Store Credits ({formatCurrency(actionData.analysis.storeCreditAmount, actionData.analysis.currency)}) + 
              Regular Payments ({formatCurrency(actionData.analysis.cashbackEligibleAmount, actionData.analysis.currency)}) = 
              {formatCurrency(
                actionData.analysis.giftCardAmount + 
                actionData.analysis.storeCreditAmount + 
                actionData.analysis.cashbackEligibleAmount, 
                actionData.analysis.currency
              )}
            </p>
            <p style={{ margin: "4px 0", color: "#dc2626" }}>
              <strong>Check your browser console for detailed calculation logs!</strong>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}