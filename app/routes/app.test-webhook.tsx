// app/routes/app.test-webhook.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { useState } from "react";
import db from "../db.server";
import { evaluateCustomerTier, assignInitialTier, getCustomerTierInfo } from "../services/customer-tier.server";

type TestScenario = {
  name: string;
  description: string;
  orderData: any;
};

type ActionResponse = 
  | { error: string; success?: never }
  | { 
      success: true;
      scenario: string;
      results: {
        expectedCashback: number;
        actualCashback: number;
        eligibleAmount: number;
        customer: any;
        transaction: any;
      };
      error?: never;
    };

// Predefined test scenarios
const TEST_SCENARIOS: TestScenario[] = [
  {
    name: "Regular Payment Only",
    description: "Order paid entirely with credit card (£50.00)",
    orderData: {
      id: "TEST-ORDER-001",
      total_price: "50.00",
      currency: "GBP",
      financial_status: "paid",
      test: true,
      customer: {
        id: "TEST-CUSTOMER-001",
        email: "test@example.com"
      },
      transactions: [
        {
          gateway: "shopify_payments",
          status: "SUCCESS",
          kind: "CAPTURE",
          amount: "50.00"
        }
      ]
    }
  },
  {
    name: "Mixed Payment (Card + Gift Card)",
    description: "Order with £30 credit card + £20 gift card (£50 total)",
    orderData: {
      id: "TEST-ORDER-002",
      total_price: "50.00",
      total_gift_cards_amount: "20.00",
      currency: "GBP",
      financial_status: "paid",
      test: true,
      customer: {
        id: "TEST-CUSTOMER-002",
        email: "mixed@example.com"
      },
      transactions: [
        {
          gateway: "gift_card",
          status: "SUCCESS",
          kind: "SALE",
          amount: "20.00"
        },
        {
          gateway: "shopify_payments",
          status: "SUCCESS",
          kind: "CAPTURE",
          amount: "30.00"
        }
      ]
    }
  },
  {
    name: "Mixed Payment (Card + Store Credit)",
    description: "Order with £35 credit card + £15 store credit (£50 total)",
    orderData: {
      id: "TEST-ORDER-003",
      total_price: "50.00",
      currency: "GBP",
      financial_status: "paid",
      test: true,
      customer: {
        id: "TEST-CUSTOMER-003",
        email: "store-credit@example.com"
      },
      transactions: [
        {
          gateway: "shopify_store_credit",
          status: "SUCCESS",
          kind: "CAPTURE",
          amount: "15.00"
        },
        {
          gateway: "shopify_payments",
          status: "SUCCESS",
          kind: "CAPTURE",
          amount: "35.00"
        }
      ]
    }
  },
  {
    name: "Complex Mixed Payment",
    description: "Order with £25 card + £15 gift card + £10 store credit (£50 total)",
    orderData: {
      id: "TEST-ORDER-004",
      total_price: "50.00",
      total_gift_cards_amount: "15.00",
      currency: "GBP",
      financial_status: "paid",
      test: true,
      customer: {
        id: "TEST-CUSTOMER-004",
        email: "complex@example.com"
      },
      transactions: [
        {
          gateway: "gift_card",
          status: "SUCCESS",
          kind: "SALE",
          amount: "15.00"
        },
        {
          gateway: "shopify_store_credit",
          status: "SUCCESS",
          kind: "CAPTURE",
          amount: "10.00"
        },
        {
          gateway: "shopify_payments",
          status: "SUCCESS",
          kind: "CAPTURE",
          amount: "25.00"
        }
      ]
    }
  },
  {
    name: "Gift Card Only",
    description: "Order paid entirely with gift card (£50) - Should NOT earn cashback",
    orderData: {
      id: "TEST-ORDER-005",
      total_price: "50.00",
      total_gift_cards_amount: "50.00",
      currency: "GBP",
      financial_status: "paid",
      test: true,
      customer: {
        id: "TEST-CUSTOMER-005",
        email: "giftonly@example.com"
      },
      transactions: [
        {
          gateway: "gift_card",
          status: "SUCCESS",
          kind: "SALE",
          amount: "50.00"
        }
      ]
    }
  },
  {
    name: "Authorization + Capture",
    description: "Order with separate AUTH and CAPTURE transactions",
    orderData: {
      id: "TEST-ORDER-006",
      total_price: "50.00",
      currency: "GBP",
      financial_status: "paid",
      test: true,
      customer: {
        id: "TEST-CUSTOMER-006",
        email: "authcapture@example.com"
      },
      transactions: [
        {
          id: "AUTH-001",
          gateway: "shopify_payments",
          status: "SUCCESS",
          kind: "AUTHORIZATION",
          amount: "50.00"
        },
        {
          id: "CAP-001",
          gateway: "shopify_payments",
          status: "SUCCESS",
          kind: "CAPTURE",
          amount: "50.00",
          parentTransaction: { id: "AUTH-001" }
        }
      ]
    }
  }
];

// Helper function to calculate cashback eligible amount (duplicated from webhook)
function calculateCashbackEligibleAmount(transactions: any[]): number {
  let giftCardAmount = 0;
  let storeCreditAmount = 0;
  let externalPaymentAmount = 0;
  
  // Process only successful SALE or CAPTURE transactions
  const processedTransactions = transactions
    .filter((tx: any) => {
      const isSuccessful = tx.status === 'SUCCESS';
      const isSaleOrCapture = ['SALE', 'CAPTURE'].includes(tx.kind);
      return isSuccessful && isSaleOrCapture;
    })
    .filter((tx: any) => {
      // For CAPTURE transactions, check if we already processed the AUTHORIZATION
      if (tx.kind === 'CAPTURE' && tx.parentTransaction) {
        // Skip if the parent AUTHORIZATION was already counted
        const parentAuth = transactions.find(
          (t: any) => t.id === tx.parentTransaction.id && t.kind === 'AUTHORIZATION'
        );
        if (parentAuth) {
          // We'll process the CAPTURE instead of the AUTH
          return true;
        }
      }
      // For SALE transactions or CAPTURE without AUTH, include them
      return tx.kind === 'SALE' || tx.kind === 'CAPTURE';
    });
  
  // Group transactions by gateway and sum amounts
  processedTransactions.forEach((tx: any) => {
    const amount = parseFloat(tx.amount);
    const gateway = tx.gateway.toLowerCase();
    
    if (gateway === 'gift_card' || gateway.includes('gift_card')) {
      giftCardAmount += amount;
    } else if (gateway === 'shopify_store_credit' || gateway.includes('store_credit')) {
      storeCreditAmount += amount;
    } else {
      externalPaymentAmount += amount;
    }
  });
  
  return externalPaymentAmount;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  // Get recent test transactions from database for verification
  const recentTransactions = await db.cashbackTransaction.findMany({
    where: {
      shopDomain: session.shop,
      shopifyOrderId: {
        startsWith: "TEST-ORDER"
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 10,
    include: {
      customer: true
    }
  });
  
  return json({ 
    scenarios: TEST_SCENARIOS,
    recentTransactions,
    shop: session.shop
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const action = formData.get("action") as string;
  
  if (action === "cleanup") {
    // Clean up test data
    try {
      // Delete test transactions
      await db.cashbackTransaction.deleteMany({
        where: {
          shopDomain: session.shop,
          shopifyOrderId: {
            startsWith: "TEST-ORDER"
          }
        }
      });
      
      // Delete test customers
      await db.customer.deleteMany({
        where: {
          shopDomain: session.shop,
          shopifyCustomerId: {
            startsWith: "TEST-CUSTOMER"
          }
        }
      });
      
      return json({ success: true, message: "Test data cleaned up successfully" });
    } catch (error) {
      return json({ error: `Cleanup failed: ${error}` });
    }
  }
  
  // Run test scenario - simulate webhook logic directly
  const scenarioIndex = parseInt(formData.get("scenarioIndex") as string);
  const scenario = TEST_SCENARIOS[scenarioIndex];
  
  if (!scenario || !scenario.orderData) {
    return json<ActionResponse>({ error: "Invalid scenario or missing order data" });
  }
  
  try {
    console.log(`\n=== RUNNING TEST SCENARIO: ${scenario.name} ===`);
    
    const order = scenario.orderData;
    const customerId = order.customer.id;
    const customerEmail = order.customer.email;
    const orderId = order.id;
    const currency = order.currency || "GBP";
    
    // Calculate eligible amount based on transactions
    const cashbackEligibleAmount = calculateCashbackEligibleAmount(order.transactions || []);
    
    console.log(`Cashback Eligible Amount: ${cashbackEligibleAmount}`);
    
    // Skip if no eligible amount
    if (cashbackEligibleAmount <= 0) {
      console.log("No cashback eligible amount");
      
      return json<ActionResponse>({
        success: true,
        scenario: scenario.name,
        results: {
          expectedCashback: 0,
          actualCashback: 0,
          eligibleAmount: 0,
          customer: null,
          transaction: null
        }
      });
    }
    
    // Find or create customer
    let customer = await db.customer.findUnique({
      where: { 
        shopDomain_shopifyCustomerId: {
          shopDomain: session.shop,
          shopifyCustomerId: customerId
        }
      }
    });
    
    let isNewCustomer = false;
    if (!customer) {
      console.log(`Creating new test customer: ${customerEmail}`);
      customer = await db.customer.create({
        data: {
          shopDomain: session.shop,
          shopifyCustomerId: customerId,
          email: customerEmail,
          storeCredit: 0,
          totalEarned: 0
        }
      });
      isNewCustomer = true;
    }
    
    // Check if we already processed this order
    const existingTransaction = await db.cashbackTransaction.findUnique({
      where: { 
        shopDomain_shopifyOrderId: {
          shopDomain: session.shop,
          shopifyOrderId: orderId
        }
      }
    });
    
    if (existingTransaction) {
      // Delete it for testing purposes
      await db.cashbackTransaction.delete({
        where: { id: existingTransaction.id }
      });
      console.log("Deleted existing transaction for re-testing");
    }
    
    // Assign initial tier to new customers
    if (isNewCustomer) {
      console.log("Assigning initial tier to new customer...");
      await assignInitialTier(customer.id, session.shop);
    }
    
    // Get customer's current tier for cashback calculation
    const tierInfo = await getCustomerTierInfo(customer.id, session.shop);
    const cashbackPercent = tierInfo?.membership.tier.cashbackPercent || 1; // Default 1% if no tier
    const cashbackAmount = cashbackEligibleAmount * (cashbackPercent / 100);
    
    console.log(`Cashback Calculation:`);
    console.log(`  Tier: ${tierInfo?.membership.tier.name || 'None'}`);
    console.log(`  Rate: ${cashbackPercent}%`);
    console.log(`  Amount: ${cashbackAmount.toFixed(2)} ${currency}`);
    
    // Create transaction and update customer balance
    const [transaction, updatedCustomer] = await db.$transaction([
      // Create cashback transaction record
      db.cashbackTransaction.create({
        data: {
          shopDomain: session.shop,
          customerId: customer.id,
          shopifyOrderId: orderId,
          orderAmount: cashbackEligibleAmount,
          cashbackAmount,
          cashbackPercent: cashbackPercent,
          status: "COMPLETED" // Use valid status from enum
        }
      }),
      // Update customer balance
      db.customer.update({
        where: { id: customer.id },
        data: {
          storeCredit: { increment: cashbackAmount },
          totalEarned: { increment: cashbackAmount }
        }
      })
    ]);
    
    console.log(`✅ Test cashback credited!`);
    console.log(`   Transaction ID: ${transaction.id}`);
    console.log(`   Customer: ${customerEmail}`);
    console.log(`   Cashback: ${cashbackAmount.toFixed(2)} ${currency}`);
    
    // Evaluate tier upgrade
    const updatedMembership = await evaluateCustomerTier(customer.id, session.shop);
    
    if (updatedMembership && tierInfo && tierInfo.membership.tierId !== updatedMembership.tierId) {
      console.log(`🎉 Customer tier would be upgraded!`);
      console.log(`   From: ${tierInfo.membership.tier.name}`);
      console.log(`   To: ${updatedMembership.tier.name}`);
    }
    
    return json<ActionResponse>({
      success: true,
      scenario: scenario.name,
      results: {
        expectedCashback: cashbackEligibleAmount * (cashbackPercent / 100),
        actualCashback: cashbackAmount,
        eligibleAmount: cashbackEligibleAmount,
        customer: updatedCustomer,
        transaction
      }
    });
    
  } catch (error) {
    console.error("Test scenario failed:", error);
    return json<ActionResponse>({
      error: `Test failed: ${error instanceof Error ? error.message : "Unknown error"}`
    });
  }
}

export default function TestWebhook() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const [selectedScenario, setSelectedScenario] = useState<number>(0);
  
  // Type-safe access to scenarios and transactions
  const scenarios = loaderData.scenarios || [];
  const recentTransactions = loaderData.recentTransactions || [];
  
  const isSubmitting = navigation.state === "submitting";
  
  const formatCurrency = (amount: number, currency: string = "GBP") => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };
  
  const calculateExpectedCashback = (scenario: typeof scenarios[0]) => {
    if (!scenario.orderData) return 0;
    
    const eligibleAmount = calculateCashbackEligibleAmount(scenario.orderData.transactions || []);
    return eligibleAmount * 0.01; // 1% default rate
  };
  
  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "24px" }}>
        Webhook Testing Suite
      </h1>
      
      {/* Instructions */}
      <div style={{
        backgroundColor: "#f0f9ff",
        border: "1px solid #0ea5e9",
        padding: "16px",
        borderRadius: "6px",
        marginBottom: "24px",
        fontSize: "14px"
      }}>
        <strong>🧪 Test Your Cashback Calculations</strong>
        <p style={{ marginTop: "8px", marginBottom: "8px" }}>
          This page simulates the webhook logic directly without making actual webhook calls.
          It creates test transactions in your database to verify cashback calculations are correct.
        </p>
        <p style={{ margin: "0", color: "#0c4a6e" }}>
          <strong>Note:</strong> Test data is prefixed with "TEST-" and can be cleaned up using the cleanup button.
        </p>
      </div>
      
      {/* Test Scenarios */}
      <div style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "18px", marginBottom: "16px" }}>Select Test Scenario</h2>
        
        <div style={{ display: "grid", gap: "12px" }}>
          {scenarios.map((scenario, index) => {
            if (!scenario.orderData) return null;
            
            const expectedCashback = calculateExpectedCashback(scenario);
            const eligibleAmount = calculateCashbackEligibleAmount(scenario.orderData.transactions || []);
            const isSelected = selectedScenario === index;
            
            return (
              <div
                key={index}
                onClick={() => setSelectedScenario(index)}
                style={{
                  padding: "16px",
                  border: `2px solid ${isSelected ? "#0070f3" : "#ddd"}`,
                  borderRadius: "8px",
                  backgroundColor: isSelected ? "#f0f9ff" : "#fff",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px 0", fontSize: "16px", fontWeight: "600" }}>
                      {scenario.name}
                    </h3>
                    <p style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#666" }}>
                      {scenario.description}
                    </p>
                    <div style={{ fontSize: "13px", color: "#666" }}>
                      <span>Order ID: {scenario.orderData.id}</span>
                      <span style={{ marginLeft: "16px" }}>Customer: {scenario.orderData.customer?.email}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", minWidth: "150px" }}>
                    <div style={{ fontSize: "14px", color: "#666" }}>Eligible Amount:</div>
                    <div style={{ fontSize: "18px", fontWeight: "600", color: eligibleAmount > 0 ? "#059669" : "#dc2626" }}>
                      {formatCurrency(eligibleAmount)}
                    </div>
                    <div style={{ fontSize: "12px", color: "#666" }}>
                      Expected: {formatCurrency(expectedCashback)}
                    </div>
                  </div>
                </div>
                
                {/* Transaction breakdown */}
                <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #e5e7eb" }}>
                  <div style={{ fontSize: "13px", fontWeight: "500", marginBottom: "4px" }}>Transactions:</div>
                  {scenario.orderData.transactions?.map((tx: any, txIndex: number) => (
                    <div key={txIndex} style={{ fontSize: "12px", color: "#666", marginLeft: "12px" }}>
                      • {tx.gateway}: {formatCurrency(parseFloat(tx.amount))} ({tx.kind})
                      {tx.gateway === "gift_card" && " ❌ No cashback"}
                      {tx.gateway === "shopify_store_credit" && " ❌ No cashback"}
                      {tx.gateway === "shopify_payments" && " ✅ Cashback eligible"}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        
        <Form method="post" style={{ marginTop: "16px" }}>
          <input type="hidden" name="scenarioIndex" value={selectedScenario} />
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              padding: "10px 20px",
              backgroundColor: isSubmitting ? "#ccc" : "#0070f3",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontSize: "16px",
              cursor: isSubmitting ? "not-allowed" : "pointer"
            }}
          >
            {isSubmitting ? "Running Test..." : "Run Selected Test"}
          </button>
        </Form>
      </div>
      
      {/* Test Results */}
      {actionData && 'success' in actionData && (
        <div style={{
          backgroundColor: actionData.results.actualCashback > 0 ? "#f0fdf4" : "#fef3c7",
          border: `1px solid ${actionData.results.actualCashback > 0 ? "#22c55e" : "#fbbf24"}`,
          padding: "20px",
          borderRadius: "8px",
          marginBottom: "24px"
        }}>
          <h3 style={{ margin: "0 0 16px 0", color: actionData.results.actualCashback > 0 ? "#166534" : "#92400e" }}>
            {actionData.results.actualCashback > 0 ? "✅" : "⚠️"} Test Completed: {actionData.scenario}
          </h3>
          
          <div style={{ display: "grid", gap: "16px" }}>
            <div>
              <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>Calculation Results:</h4>
              <div style={{ fontSize: "14px", padding: "12px", backgroundColor: "white", borderRadius: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span>Eligible Amount:</span>
                  <strong>{formatCurrency(actionData.results.eligibleAmount)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span>Expected Cashback (1%):</span>
                  <span>{formatCurrency(actionData.results.expectedCashback)}</span>
                </div>
                <div style={{ 
                  display: "flex", 
                  justifyContent: "space-between", 
                  paddingTop: "8px", 
                  borderTop: "1px solid #e5e7eb",
                  fontWeight: "600",
                  color: "#059669"
                }}>
                  <span>Actual Cashback:</span>
                  <span>{formatCurrency(actionData.results.actualCashback)}</span>
                </div>
                {Math.abs(actionData.results.expectedCashback - actionData.results.actualCashback) > 0.01 && (
                  <div style={{ marginTop: "8px", padding: "8px", backgroundColor: "#fef3c7", borderRadius: "4px", fontSize: "12px" }}>
                    ⚠️ Difference detected - may be due to tier-based rates
                  </div>
                )}
              </div>
            </div>
            
            {actionData.results.transaction && (
              <div>
                <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>Transaction Created:</h4>
                <div style={{ fontSize: "14px", padding: "12px", backgroundColor: "white", borderRadius: "4px" }}>
                  <div>Transaction ID: {actionData.results.transaction.id}</div>
                  <div>Order Amount: {formatCurrency(actionData.results.transaction.orderAmount)}</div>
                  <div>Cashback Rate: {actionData.results.transaction.cashbackPercent}%</div>
                  <div>Status: {actionData.results.transaction.status}</div>
                </div>
              </div>
            )}
            
            {actionData.results.customer && (
              <div>
                <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>Customer Balance Updated:</h4>
                <div style={{ fontSize: "14px", padding: "12px", backgroundColor: "white", borderRadius: "4px" }}>
                  <div>Customer: {actionData.results.customer.email}</div>
                  <div>Store Credit Balance: {formatCurrency(actionData.results.customer.storeCredit)}</div>
                  <div>Total Earned: {formatCurrency(actionData.results.customer.totalEarned)}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
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
      
      {/* Recent Test Transactions */}
      {recentTransactions.length > 0 && (
        <div style={{ marginTop: "32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "18px", margin: 0 }}>Recent Test Transactions</h2>
            <Form method="post">
              <input type="hidden" name="action" value="cleanup" />
              <button
                type="submit"
                style={{
                  padding: "6px 12px",
                  backgroundColor: "#dc2626",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "14px",
                  cursor: "pointer"
                }}
                onClick={(e) => {
                  if (!confirm("This will delete all test transactions and customers. Continue?")) {
                    e.preventDefault();
                  }
                }}
              >
                Clean Up Test Data
              </button>
            </Form>
          </div>
          
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #ddd" }}>
                <th style={{ padding: "8px", textAlign: "left" }}>Order ID</th>
                <th style={{ padding: "8px", textAlign: "left" }}>Customer</th>
                <th style={{ padding: "8px", textAlign: "right" }}>Eligible Amount</th>
                <th style={{ padding: "8px", textAlign: "center" }}>Rate</th>
                <th style={{ padding: "8px", textAlign: "right" }}>Cashback</th>
                <th style={{ padding: "8px", textAlign: "left" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.map((tx) => (
                <tr key={tx.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "8px", fontSize: "14px" }}>{tx.shopifyOrderId}</td>
                  <td style={{ padding: "8px", fontSize: "14px" }}>{tx.customer.email}</td>
                  <td style={{ padding: "8px", textAlign: "right", fontSize: "14px" }}>
                    {formatCurrency(tx.orderAmount)}
                  </td>
                  <td style={{ padding: "8px", textAlign: "center", fontSize: "14px" }}>
                    {tx.cashbackPercent}%
                  </td>
                  <td style={{ padding: "8px", textAlign: "right", fontSize: "14px", fontWeight: "600", color: "#059669" }}>
                    {formatCurrency(tx.cashbackAmount)}
                  </td>
                  <td style={{ padding: "8px" }}>
                    <span style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      backgroundColor: "#e0f2fe",
                      color: "#075985"
                    }}>
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}