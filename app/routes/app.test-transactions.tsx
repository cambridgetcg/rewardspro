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
        // All pricing fields for comparison
        allPricingFields: {
          totalPriceSet: number;
          currentTotalPriceSet: number;
          originalTotalPriceSet: number;
          totalReceivedSet: number;
          netPaymentSet: number;
          totalOutstandingSet: number;
          subtotalPriceSet: number;
          currentSubtotalPriceSet: number;
          totalRefundedSet: number;
          totalCapturableSet: number;
          totalDiscountsSet: number;
          currentTotalDiscountsSet: number;
          totalTaxSet: number;
          currentTotalTaxSet: number;
          totalShippingPriceSet: number;
          currentShippingPriceSet: number;
          totalTipReceivedSet: number;
          totalDutiesSet: number;
          currentTotalDutiesSet: number;
          totalAdditionalFeesSet: number;
          currentTotalAdditionalFeesSet: number;
        };
      };
      rawResponse: any;
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
    // Comprehensive query to get ALL pricing-related fields
    const query = `#graphql
      query GetOrderComprehensivePricing($id: ID!) {
        order(id: $id) {
          id
          name
          currencyCode
          
          # MAIN TOTAL FIELDS
          # Total price before returns (includes taxes and discounts)
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Current total after returns
          currentTotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Original total at creation time
          originalTotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # PAYMENT FIELDS
          # Total amount actually received from customer
          totalReceivedSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Net payment (received minus refunded)
          netPaymentSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Amount still outstanding
          totalOutstandingSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Amount that can be captured
          totalCapturableSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # SUBTOTAL FIELDS
          # Subtotal before returns
          subtotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Current subtotal after returns
          currentSubtotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # REFUND FIELDS
          # Total amount refunded
          totalRefundedSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Refunded shipping
          totalRefundedShippingSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Refund discrepancy
          refundDiscrepancySet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # DISCOUNT FIELDS
          # Total discounts before returns
          totalDiscountsSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Current total discounts
          currentTotalDiscountsSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Cart-level discounts
          cartDiscountAmountSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Current cart-level discounts
          currentCartDiscountAmountSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # TAX FIELDS
          # Total tax before returns
          totalTaxSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Current total tax
          currentTotalTaxSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # SHIPPING FIELDS
          # Total shipping price
          totalShippingPriceSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Current shipping price
          currentShippingPriceSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # TIP FIELDS
          # Total tips received
          totalTipReceivedSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # DUTIES AND FEES
          # Original total duties
          originalTotalDutiesSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Current total duties
          currentTotalDutiesSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Original additional fees
          originalTotalAdditionalFeesSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Current additional fees
          currentTotalAdditionalFeesSet {
            shopMoney {
              amount
              currencyCode
            }
            presentmentMoney {
              amount
              currencyCode
            }
          }
          
          # Cash rounding adjustment - Note: Has a different structure, skipping for now
          
          # BOOLEAN FLAGS
          taxesIncluded
          taxExempt
          dutiesIncluded
          fullyPaid
          unpaid
          test
          confirmed
          capturable
          refundable
          restockable
          
          # STATUS FIELDS
          displayFinancialStatus
          displayFulfillmentStatus
          cancelReason
          cancelledAt
          closedAt
          processedAt
          
          # Payment gateway names
          paymentGatewayNames
          
          # TRANSACTIONS WITH ALL FIELDS
          transactions(first: 250) {
            id
            gateway
            status
            kind
            test
            errorCode
            processedAt
            createdAt
            authorizationCode
            authorizationExpiresAt
            # The amount and currency
            amountSet {
              shopMoney { 
                amount 
                currencyCode
              }
              presentmentMoney {
                amount
                currencyCode
              }
            }
            # Fees charged by payment gateway
            fees {
              amount {
                amount
                currencyCode
              }
              flatFee {
                amount
                currencyCode
              }
              flatFeeName
              # percentage field removed - not available
              type
            }
            # Maximum amount that can be refunded
            maximumRefundableV2 {
              amount
              currencyCode
            }
            # Parent transaction reference
            parentTransaction {
              id
            }
            # User who performed the transaction
            user {
              id
              email
              firstName
              lastName
            }
          }
          
          # ADDITIONAL NOTES:
          # - CashRoundingAdjustment has a different structure and is rarely used
          # - PaymentDetails requires more complex fragment handling
          # - receipt field is not available on OrderTransaction
          # - percentage is not directly available on TransactionFee
          
          # Additional context
          discountCodes
          note
          poNumber
          tags
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
    
    // Extract all pricing fields for comparison
    const extractAmount = (priceSet: any) => {
      if (!priceSet || !priceSet.shopMoney) return 0;
      return parseFloat(priceSet.shopMoney.amount);
    };
    
    const allPricingFields = {
      totalPriceSet: extractAmount(order.totalPriceSet),
      currentTotalPriceSet: extractAmount(order.currentTotalPriceSet),
      originalTotalPriceSet: extractAmount(order.originalTotalPriceSet),
      totalReceivedSet: extractAmount(order.totalReceivedSet),
      netPaymentSet: extractAmount(order.netPaymentSet),
      totalOutstandingSet: extractAmount(order.totalOutstandingSet),
      subtotalPriceSet: extractAmount(order.subtotalPriceSet),
      currentSubtotalPriceSet: extractAmount(order.currentSubtotalPriceSet),
      totalRefundedSet: extractAmount(order.totalRefundedSet),
      totalCapturableSet: extractAmount(order.totalCapturableSet),
      totalDiscountsSet: extractAmount(order.totalDiscountsSet),
      currentTotalDiscountsSet: extractAmount(order.currentTotalDiscountsSet),
      totalTaxSet: extractAmount(order.totalTaxSet),
      currentTotalTaxSet: extractAmount(order.currentTotalTaxSet),
      totalShippingPriceSet: extractAmount(order.totalShippingPriceSet),
      currentShippingPriceSet: extractAmount(order.currentShippingPriceSet),
      totalTipReceivedSet: extractAmount(order.totalTipReceivedSet),
      totalDutiesSet: extractAmount(order.originalTotalDutiesSet),
      currentTotalDutiesSet: extractAmount(order.currentTotalDutiesSet),
      totalAdditionalFeesSet: extractAmount(order.originalTotalAdditionalFeesSet),
      currentTotalAdditionalFeesSet: extractAmount(order.currentTotalAdditionalFeesSet),
    };
    
    // Calculate payment breakdown using the gateway field
    let giftCardAmount = 0;
    let storeCreditAmount = 0;
    
    console.log("\n=== COMPREHENSIVE PRICING ANALYSIS ===");
    console.log("\nAll Pricing Fields:");
    Object.entries(allPricingFields).forEach(([key, value]) => {
      console.log(`  ${key}: ${value} ${order.currencyCode}`);
    });
    
    console.log("\n=== TRANSACTION ANALYSIS ===");
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
        console.log(`  Test: ${tx.test}`);
        console.log(`  Processed At: ${tx.processedAt}`);
        if (tx.fees && tx.fees.length > 0) {
          console.log(`  Fees: ${JSON.stringify(tx.fees)}`);
        }
        if (tx.maximumRefundableV2) {
          console.log(`  Maximum Refundable: ${tx.maximumRefundableV2.amount} ${tx.maximumRefundableV2.currencyCode}`);
        }
        
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
    
    // Calculate using different methods
    const orderTotal = extractAmount(order.totalPriceSet);
    const totalReceived = extractAmount(order.totalReceivedSet);
    const netPayment = extractAmount(order.netPaymentSet);
    
    // Method 1: Subtract gift cards and store credit from total price
    const cashbackEligibleMethod1 = orderTotal - giftCardAmount - storeCreditAmount;
    
    // Method 2: Subtract from total received
    const cashbackEligibleMethod2 = totalReceived - giftCardAmount - storeCreditAmount;
    
    // Method 3: Subtract from net payment
    const cashbackEligibleMethod3 = netPayment - giftCardAmount - storeCreditAmount;
    
    // Method 4: Sum only external payments
    const externalPaymentAmount = processedTransactions
      .filter((tx: any) => tx.type === 'EXTERNAL')
      .reduce((sum: number, tx: any) => sum + tx.amount, 0);
    
    console.log("\n=== CASHBACK CALCULATION COMPARISON ===");
    console.log(`Order Total (totalPriceSet): ${orderTotal} ${order.currencyCode}`);
    console.log(`Total Received (totalReceivedSet): ${totalReceived} ${order.currencyCode}`);
    console.log(`Net Payment (netPaymentSet): ${netPayment} ${order.currencyCode}`);
    console.log(`- Gift Cards: ${giftCardAmount} ${order.currencyCode}`);
    console.log(`- Store Credits: ${storeCreditAmount} ${order.currencyCode}`);
    console.log("\nCashback Eligible Amount Options:");
    console.log(`  Method 1 (totalPrice - gift/credit): ${cashbackEligibleMethod1} ${order.currencyCode}`);
    console.log(`  Method 2 (totalReceived - gift/credit): ${cashbackEligibleMethod2} ${order.currencyCode}`);
    console.log(`  Method 3 (netPayment - gift/credit): ${cashbackEligibleMethod3} ${order.currencyCode}`);
    console.log(`  Method 4 (sum external payments): ${externalPaymentAmount} ${order.currencyCode}`);
    console.log("========================\n");
    
    return json<ActionResponse>({
      success: true,
      orderId: order.id,
      orderName: order.name,
      analysis: {
        orderTotal,
        giftCardAmount,
        storeCreditAmount,
        cashbackEligibleAmount: externalPaymentAmount, // Using method 4 by default
        currency: order.currencyCode,
        transactions: processedTransactions,
        allPricingFields
      },
      rawResponse: result
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
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "24px" }}>
        Comprehensive Order Pricing Analysis
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
          <li>Click on any order (preferably one with gift cards or store credit)</li>
          <li>The Order ID is in the URL: /admin/orders/<strong>1234567890</strong></li>
          <li>Or use the order number without the # (e.g., "1001" instead of "#1001")</li>
        </ol>
        <p style={{ marginTop: "8px", marginBottom: "0" }}>
          <strong>This test will fetch ALL pricing fields</strong> to help determine the correct amount for cashback calculation.
        </p>
        <p style={{ marginTop: "8px", marginBottom: "0", color: "#7c3aed" }}>
          <strong>Note:</strong> Gift cards are identified by the gateway field value "gift_card" and store credits by "shopify_store_credit" in transactions.
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
          
          {/* ALL PRICING FIELDS COMPARISON */}
          <div style={{
            backgroundColor: "#fffbeb",
            border: "1px solid #fbbf24",
            padding: "20px",
            borderRadius: "8px",
            marginBottom: "24px"
          }}>
            <h3 style={{ fontSize: "16px", marginBottom: "16px", color: "#92400e" }}>
              📊 All Pricing Fields Comparison
            </h3>
            
            <div style={{ display: "grid", gap: "8px", fontSize: "14px" }}>
              <div style={{ fontWeight: "bold", borderBottom: "2px solid #fbbf24", paddingBottom: "8px" }}>
                Main Totals:
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>totalPriceSet (before returns):</span>
                <strong>{formatCurrency(actionData.analysis.allPricingFields.totalPriceSet, actionData.analysis.currency)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>currentTotalPriceSet (after returns):</span>
                <strong>{formatCurrency(actionData.analysis.allPricingFields.currentTotalPriceSet, actionData.analysis.currency)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>originalTotalPriceSet (at creation):</span>
                <strong>{formatCurrency(actionData.analysis.allPricingFields.originalTotalPriceSet, actionData.analysis.currency)}</strong>
              </div>
              
              <div style={{ fontWeight: "bold", borderBottom: "2px solid #fbbf24", paddingBottom: "8px", marginTop: "12px" }}>
                Payment Fields:
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", backgroundColor: "#fef3c7", padding: "4px 8px", borderRadius: "4px" }}>
                <span>totalReceivedSet (actual payment):</span>
                <strong>{formatCurrency(actionData.analysis.allPricingFields.totalReceivedSet, actionData.analysis.currency)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", backgroundColor: "#fef3c7", padding: "4px 8px", borderRadius: "4px" }}>
                <span>netPaymentSet (received - refunded):</span>
                <strong>{formatCurrency(actionData.analysis.allPricingFields.netPaymentSet, actionData.analysis.currency)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>totalOutstandingSet:</span>
                <strong>{formatCurrency(actionData.analysis.allPricingFields.totalOutstandingSet, actionData.analysis.currency)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>totalCapturableSet:</span>
                <strong>{formatCurrency(actionData.analysis.allPricingFields.totalCapturableSet, actionData.analysis.currency)}</strong>
              </div>
              
              <div style={{ fontWeight: "bold", borderBottom: "2px solid #fbbf24", paddingBottom: "8px", marginTop: "12px" }}>
                Other Fields:
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>subtotalPriceSet:</span>
                <span>{formatCurrency(actionData.analysis.allPricingFields.subtotalPriceSet, actionData.analysis.currency)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>totalRefundedSet:</span>
                <span>{formatCurrency(actionData.analysis.allPricingFields.totalRefundedSet, actionData.analysis.currency)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>totalDiscountsSet:</span>
                <span>{formatCurrency(actionData.analysis.allPricingFields.totalDiscountsSet, actionData.analysis.currency)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>totalTaxSet:</span>
                <span>{formatCurrency(actionData.analysis.allPricingFields.totalTaxSet, actionData.analysis.currency)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>totalShippingPriceSet:</span>
                <span>{formatCurrency(actionData.analysis.allPricingFields.totalShippingPriceSet, actionData.analysis.currency)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>totalTipReceivedSet:</span>
                <span>{formatCurrency(actionData.analysis.allPricingFields.totalTipReceivedSet, actionData.analysis.currency)}</span>
              </div>
            </div>
          </div>
          
          {/* CASHBACK CALCULATION OPTIONS */}
          <div style={{
            backgroundColor: "#e0f2fe",
            border: "1px solid #0284c7",
            padding: "20px",
            borderRadius: "8px",
            marginBottom: "24px"
          }}>
            <h3 style={{ fontSize: "16px", marginBottom: "16px", color: "#075985" }}>
              💰 Cashback Calculation Options
            </h3>
            
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span>Gift Cards Detected:</span>
                <strong>{formatCurrency(actionData.analysis.giftCardAmount, actionData.analysis.currency)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span>Store Credits Detected:</span>
                <strong>{formatCurrency(actionData.analysis.storeCreditAmount, actionData.analysis.currency)}</strong>
              </div>
            </div>
            
            <div style={{ display: "grid", gap: "12px", fontSize: "14px" }}>
              <div style={{ padding: "12px", backgroundColor: "white", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
                <div style={{ fontWeight: "bold", marginBottom: "4px" }}>Method 1: totalPriceSet - gift/credit</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{formatCurrency(actionData.analysis.allPricingFields.totalPriceSet, actionData.analysis.currency)} - {formatCurrency(actionData.analysis.giftCardAmount + actionData.analysis.storeCreditAmount, actionData.analysis.currency)} =</span>
                  <strong>{formatCurrency(actionData.analysis.allPricingFields.totalPriceSet - actionData.analysis.giftCardAmount - actionData.analysis.storeCreditAmount, actionData.analysis.currency)}</strong>
                </div>
              </div>
              
              <div style={{ padding: "12px", backgroundColor: "#f0fdf4", borderRadius: "6px", border: "2px solid #22c55e" }}>
                <div style={{ fontWeight: "bold", marginBottom: "4px", color: "#166534" }}>Method 2: totalReceivedSet - gift/credit (RECOMMENDED)</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{formatCurrency(actionData.analysis.allPricingFields.totalReceivedSet, actionData.analysis.currency)} - {formatCurrency(actionData.analysis.giftCardAmount + actionData.analysis.storeCreditAmount, actionData.analysis.currency)} =</span>
                  <strong style={{ color: "#166534" }}>{formatCurrency(actionData.analysis.allPricingFields.totalReceivedSet - actionData.analysis.giftCardAmount - actionData.analysis.storeCreditAmount, actionData.analysis.currency)}</strong>
                </div>
                <div style={{ fontSize: "12px", marginTop: "4px", color: "#166534" }}>
                  ✓ Uses actual amount received from customer
                </div>
              </div>
              
              <div style={{ padding: "12px", backgroundColor: "white", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
                <div style={{ fontWeight: "bold", marginBottom: "4px" }}>Method 3: netPaymentSet - gift/credit</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{formatCurrency(actionData.analysis.allPricingFields.netPaymentSet, actionData.analysis.currency)} - {formatCurrency(actionData.analysis.giftCardAmount + actionData.analysis.storeCreditAmount, actionData.analysis.currency)} =</span>
                  <strong>{formatCurrency(actionData.analysis.allPricingFields.netPaymentSet - actionData.analysis.giftCardAmount - actionData.analysis.storeCreditAmount, actionData.analysis.currency)}</strong>
                </div>
              </div>
              
              <div style={{ padding: "12px", backgroundColor: "white", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
                <div style={{ fontWeight: "bold", marginBottom: "4px" }}>Method 4: Sum of external payments only</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Direct calculation from transactions:</span>
                  <strong>{formatCurrency(actionData.analysis.cashbackEligibleAmount, actionData.analysis.currency)}</strong>
                </div>
              </div>
            </div>
          </div>
          
          {/* Transaction Details */}
          <div style={{ marginBottom: "24px" }}>
            <h3 style={{ fontSize: "16px", marginBottom: "12px" }}>Transaction Details</h3>
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
                    cursor: "pointer",
                    zIndex: 10
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
            <p style={{ margin: "8px 0 0 0" }}>
              <strong>Recommendation:</strong> Use <code>totalReceivedSet</code> instead of <code>totalPriceSet</code> for cashback calculation, 
              as it represents the actual amount received from the customer.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}