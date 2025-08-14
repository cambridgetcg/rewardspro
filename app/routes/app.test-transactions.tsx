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
          type: string;
          gateway: string;
          amount: number;
          kind: string;
          status: string;
        }>;
      };
      rawResponse: any; // Added to store the raw GraphQL response
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
    // Enhanced query to get more payment details
    const query = `#graphql
      query GetOrderPaidAmount($id: ID!) {
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
          
          # Subtotal (before discounts and shipping)
          subtotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          
          # Total discounts
          totalDiscountsSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          
          # Tax amount
          totalTaxSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          
          # Shipping cost
          totalShippingPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          
          # Payment gateway names (helpful for identification)
          paymentGatewayNames
          
          # Financial status
          displayFinancialStatus
          
          # Transactions - using gateway field for identification
          transactions(first: 250) {
            id
            gateway             # Payment gateway name (gift_card, shopify_store_credit, etc.)
            status              # SUCCESS, FAILED, etc.
            kind                # SALE, CAPTURE, REFUND, ...
            test                # Is this a test transaction
            errorCode           # Error code if failed
            processedAt         # When it was processed
            amountSet {
              shopMoney { 
                amount 
                currencyCode
              }
            }
            # Additional transaction details
            parentTransaction {
              id
            }
          }
          
          # Additional payment info
          refundable
          fullyPaid
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
    
    // Calculate payment breakdown using the gateway field
    let giftCardAmount = 0;
    let storeCreditAmount = 0;
    
    console.log("\n=== CASHBACK CALCULATION (GATEWAY-BASED METHOD) ===");
    console.log(`Order Total: ${order.totalPriceSet.shopMoney.amount} ${order.currencyCode}`);
    console.log(`Payment Gateways: ${order.paymentGatewayNames?.join(', ') || 'none'}`);
    console.log(`\nAnalyzing transactions by gateway:`);
    
    // Filter and process transactions
    const processedTransactions = transactions
      .filter((tx: any) => {
        // Keep only successful sales/captures
        const isSuccessful = tx.status === 'SUCCESS';
        const isSaleOrCapture = ['SALE', 'CAPTURE'].includes(tx.kind);
        return isSuccessful && isSaleOrCapture;
      })
      .map((tx: any) => {
        const amount = parseFloat(tx.amountSet.shopMoney.amount);
        const gateway = tx.gateway.toLowerCase();
        
        console.log(`\nTransaction ID: ${tx.id}`);
        console.log(`  Gateway: ${tx.gateway}`);
        console.log(`  Kind: ${tx.kind}`);
        console.log(`  Status: ${tx.status}`);
        console.log(`  Amount: ${amount} ${tx.amountSet.shopMoney.currencyCode}`);
        
        // Use gateway field to identify gift cards and store credits
        if (gateway === 'gift_card' || gateway.includes('gift_card')) {
          giftCardAmount += amount;
          console.log(`  → Identified as GIFT CARD by gateway (excluded from cashback)`);
        } else if (gateway === 'shopify_store_credit' || gateway.includes('store_credit')) {
          storeCreditAmount += amount;
          console.log(`  → Identified as STORE CREDIT by gateway (excluded from cashback)`);
        } else {
          console.log(`  → Regular payment (gateway: ${tx.gateway}) - eligible for cashback`);
        }
        
        return {
          id: tx.id,
          type: gateway.includes('gift_card') ? 'GIFT_CARD' : 
                gateway.includes('store_credit') ? 'STORE_CREDIT' : 'EXTERNAL',
          gateway: tx.gateway,
          amount,
          kind: tx.kind,
          status: tx.status
        };
      });
    
    // Calculate using subtraction
    const orderTotal = parseFloat(order.totalPriceSet.shopMoney.amount);
    const cashbackEligibleAmount = orderTotal - giftCardAmount - storeCreditAmount;
    
    // Alternative calculation: sum only external payments
    const externalPaymentAmount = processedTransactions
      .filter((tx: any) => tx.type === 'EXTERNAL')
      .reduce((sum: number, tx: any) => sum + tx.amount, 0);
    
    console.log("\n=== FINAL CALCULATION ===");
    console.log(`Order Total: ${orderTotal} ${order.currencyCode}`);
    console.log(`- Gift Cards: ${giftCardAmount} ${order.currencyCode}`);
    console.log(`- Store Credits: ${storeCreditAmount} ${order.currencyCode}`);
    console.log(`= Cashback Eligible (subtraction): ${cashbackEligibleAmount} ${order.currencyCode}`);
    console.log(`= External Payments (direct sum): ${externalPaymentAmount} ${order.currencyCode}`);
    console.log("========================\n");
    
    return json<ActionResponse>({
      success: true,
      orderId: order.id,
      orderName: order.name,
      analysis: {
        orderTotal,
        giftCardAmount,
        storeCreditAmount,
        cashbackEligibleAmount: externalPaymentAmount, // Using the direct sum method
        currency: order.currencyCode,
        transactions: processedTransactions
      },
      rawResponse: result // Include the raw GraphQL response
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
  const [showRawResponse, setShowRawResponse] = useState(false);
  
  const isSubmitting = navigation.state === "submitting";
  
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };
  
  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "24px" }}>
        Cashback Transaction Test (Gateway-Based Method)
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
        <p style={{ marginTop: "8px", marginBottom: "0" }}>
          <strong>Note:</strong> This implementation uses the <code>gateway</code> field on transactions to identify gift_card and shopify_store_credit transactions.
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
                fontWeight: "bold",
                color: "#0070f3"
              }}>
                <span>= Cashback Eligible Amount:</span>
                <span>{formatCurrency(actionData.analysis.cashbackEligibleAmount, actionData.analysis.currency)}</span>
              </div>
            </div>
          </div>
          
          {/* Transaction Details */}
          <div style={{ marginBottom: "24px" }}>
            <h3 style={{ fontSize: "16px", marginBottom: "12px" }}>Transactions</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #ddd" }}>
                  <th style={{ padding: "8px", textAlign: "left" as const }}>Type</th>
                  <th style={{ padding: "8px", textAlign: "left" as const }}>Gateway</th>
                  <th style={{ padding: "8px", textAlign: "left" as const }}>Kind</th>
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
                        backgroundColor: t.type === 'GIFT_CARD' ? '#fef3c7' : 
                                       t.type === 'STORE_CREDIT' ? '#ddd6fe' : '#d1fae5',
                        color: t.type === 'GIFT_CARD' ? '#92400e' : 
                               t.type === 'STORE_CREDIT' ? '#5b21b6' : '#065f46'
                      }}>
                        {t.type}
                      </span>
                    </td>
                    <td style={{ padding: "8px", fontSize: "14px" }}>{t.gateway}</td>
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
          
          {/* Raw GraphQL Response Section */}
          <div style={{
            backgroundColor: "#f9fafb",
            border: "1px solid #e5e7eb",
            padding: "16px",
            borderRadius: "6px",
            marginBottom: "24px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h3 style={{ fontSize: "16px", margin: 0 }}>Raw GraphQL Response</h3>
              <button
                onClick={() => setShowRawResponse(!showRawResponse)}
                style={{
                  padding: "6px 12px",
                  backgroundColor: "#fff",
                  color: "#0070f3",
                  border: "1px solid #0070f3",
                  borderRadius: "4px",
                  fontSize: "14px",
                  cursor: "pointer"
                }}
              >
                {showRawResponse ? 'Hide' : 'Show'} Raw Response
              </button>
            </div>
            
            {showRawResponse && (
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(actionData.rawResponse, null, 2));
                    alert('Copied to clipboard!');
                  }}
                  style={{
                    position: "absolute",
                    top: "8px",
                    right: "8px",
                    padding: "4px 8px",
                    backgroundColor: "#0070f3",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "12px",
                    cursor: "pointer"
                  }}
                >
                  Copy
                </button>
                <pre style={{
                  backgroundColor: "#1f2937",
                  color: "#e5e7eb",
                  padding: "16px",
                  borderRadius: "6px",
                  overflow: "auto",
                  maxHeight: "500px",
                  fontSize: "13px",
                  lineHeight: "1.5"
                }}>
                  {JSON.stringify(actionData.rawResponse, null, 2)}
                </pre>
              </div>
            )}
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
              This amount represents the sum of all external payments (excluding transactions with gateway "gift_card" or "shopify_store_credit").
            </p>
          </div>
          
          {/* Additional Order Details from Raw Response */}
          {actionData.rawResponse?.data?.order && (
            <div style={{
              backgroundColor: "#f0f4f8",
              border: "1px solid #cbd5e0",
              padding: "16px",
              borderRadius: "6px",
              marginTop: "16px"
            }}>
              <h4 style={{ margin: "0 0 12px 0", fontSize: "14px" }}>Additional Order Details</h4>
              <div style={{ display: "grid", gap: "8px", fontSize: "14px" }}>
                <div>
                  <strong>Financial Status:</strong> {actionData.rawResponse.data.order.displayFinancialStatus}
                </div>
                <div>
                  <strong>Fully Paid:</strong> {actionData.rawResponse.data.order.fullyPaid ? 'Yes' : 'No'}
                </div>
                <div>
                  <strong>Refundable:</strong> {actionData.rawResponse.data.order.refundable ? 'Yes' : 'No'}
                </div>
                {actionData.rawResponse.data.order.subtotalPriceSet && (
                  <div>
                    <strong>Subtotal:</strong> {formatCurrency(
                      parseFloat(actionData.rawResponse.data.order.subtotalPriceSet.shopMoney.amount),
                      actionData.rawResponse.data.order.currencyCode
                    )}
                  </div>
                )}
                {actionData.rawResponse.data.order.totalDiscountsSet && (
                  <div>
                    <strong>Total Discounts:</strong> {formatCurrency(
                      parseFloat(actionData.rawResponse.data.order.totalDiscountsSet.shopMoney.amount),
                      actionData.rawResponse.data.order.currencyCode
                    )}
                  </div>
                )}
                {actionData.rawResponse.data.order.totalShippingPriceSet && (
                  <div>
                    <strong>Shipping:</strong> {formatCurrency(
                      parseFloat(actionData.rawResponse.data.order.totalShippingPriceSet.shopMoney.amount),
                      actionData.rawResponse.data.order.currencyCode
                    )}
                  </div>
                )}
                {actionData.rawResponse.data.order.totalTaxSet && (
                  <div>
                    <strong>Tax:</strong> {formatCurrency(
                      parseFloat(actionData.rawResponse.data.order.totalTaxSet.shopMoney.amount),
                      actionData.rawResponse.data.order.currencyCode
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          
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