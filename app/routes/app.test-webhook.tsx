// app/routes/app.test-webhook.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigation, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { useState } from "react";
import db from "../db.server";

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
      webhookResponse: any;
      databaseCheck: {
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

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  
  // Get recent test transactions from database for verification
  const recentTransactions = await db.cashbackTransaction.findMany({
    where: {
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
    recentTransactions 
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
          shopifyOrderId: {
            startsWith: "TEST-ORDER"
          }
        }
      });
      
      // Delete test customers
      await db.customer.deleteMany({
        where: {
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
  
  // Run test scenario
  const scenarioIndex = parseInt(formData.get("scenarioIndex") as string);
  const scenario = TEST_SCENARIOS[scenarioIndex];
  
  if (!scenario || !scenario.orderData) {
    return json<ActionResponse>({ error: "Invalid scenario or missing order data" });
  }
  
  try {
    console.log(`\n=== RUNNING TEST SCENARIO: ${scenario.name} ===`);
    
    // Create a mock GraphQL client that returns our test data
    const mockAdmin = {
      graphql: async (query: string, options?: any) => {
        // Mock the order query response
        if (query.includes("GetOrderPaymentDetails")) {
          const orderId = scenario.orderData.id;
          return {
            json: async () => ({
              data: {
                order: {
                  id: `gid://shopify/Order/${orderId}`,
                  totalReceivedSet: {
                    shopMoney: {
                      amount: scenario.orderData.total_price,
                      currencyCode: scenario.orderData.currency
                    }
                  },
                  transactions: scenario.orderData.transactions.map((tx: any, index: number) => ({
                    id: `gid://shopify/OrderTransaction/${orderId}-${index}`,
                    gateway: tx.gateway,
                    status: tx.status,
                    kind: tx.kind,
                    amountSet: {
                      shopMoney: {
                        amount: tx.amount,
                        currencyCode: scenario.orderData.currency
                      }
                    },
                    parentTransaction: tx.parentTransaction || null
                  }))
                }
              }
            })
          };
        }
        
        // Mock customer update (for tags)
        if (query.includes("customerUpdate")) {
          return {
            json: async () => ({
              data: {
                customerUpdate: {
                  customer: { id: "mock", tags: [] },
                  userErrors: []
                }
              }
            })
          };
        }
        
        // Mock store credit issuance
        if (query.includes("storeCreditAccountCredit")) {
          return {
            json: async () => ({
              data: {
                storeCreditAccountCredit: {
                  storeCreditAccountTransaction: {
                    id: `gid://shopify/StoreCreditTransaction/MOCK-${Date.now()}`,
                    amount: { amount: "0.00", currencyCode: "GBP" },
                    balanceAfterTransaction: { amount: "0.00", currencyCode: "GBP" },
                    account: { id: "mock", balance: { amount: "0.00", currencyCode: "GBP" } }
                  },
                  userErrors: []
                }
              }
            })
          };
        }
        
        return { json: async () => ({ data: null }) };
      }
    };
    
    // Import and call the webhook action directly
    const { action: webhookAction } = await import("./webhooks.orders.paid");
    
    // Create a mock request for the webhook
    const webhookRequest = new Request("https://test.com/webhooks/orders/paid", {
      method: "POST",
      headers: {
        "X-Shopify-Topic": "orders/paid",
        "X-Shopify-Shop-Domain": session.shop,
        "X-Shopify-Webhook-Id": `test-${Date.now()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(scenario.orderData)
    });
    
    // Mock the authenticate.webhook function
    const originalAuth = require("../shopify.server").authenticate;
    require("../shopify.server").authenticate = {
      webhook: async () => ({
        topic: "orders/paid",
        shop: session.shop,
        payload: scenario.orderData,
        admin: mockAdmin
      })
    };
    
    // Execute the webhook
    const webhookResponse = await webhookAction({ 
      request: webhookRequest,
      params: {},
      context: {}
    } as ActionFunctionArgs);
    
    // Restore original authenticate
    require("../shopify.server").authenticate = originalAuth;
    
    // Check the database for the created records
    const customer = await db.customer.findUnique({
      where: {
        shopDomain_shopifyCustomerId: {
          shopDomain: session.shop,
          shopifyCustomerId: scenario.orderData.customer.id
        }
      }
    });
    
    const transaction = await db.cashbackTransaction.findUnique({
      where: {
        shopDomain_shopifyOrderId: {
          shopDomain: session.shop,
          shopifyOrderId: scenario.orderData.id
        }
      }
    });
    
    return json<ActionResponse>({
      success: true,
      scenario: scenario.name,
      webhookResponse: {
        status: webhookResponse.status,
        statusText: webhookResponse.statusText
      },
      databaseCheck: {
        customer,
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
  const submit = useSubmit();
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
    
    const totalPrice = parseFloat(scenario.orderData.total_price || "0");
    let eligibleAmount = totalPrice;
    
    // Subtract gift cards
    if (scenario.orderData.total_gift_cards_amount) {
      eligibleAmount -= parseFloat(scenario.orderData.total_gift_cards_amount);
    }
    
    // Subtract store credit from transactions
    scenario.orderData.transactions?.forEach((tx: any) => {
      if (tx.gateway === "shopify_store_credit" && tx.status === "SUCCESS") {
        eligibleAmount -= parseFloat(tx.amount);
      }
    });
    
    return Math.max(0, eligibleAmount);
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
        <strong>🧪 Test Your Webhook Logic</strong>
        <p style={{ marginTop: "8px", marginBottom: "0" }}>
          This page allows you to test your webhook with various payment scenarios without creating real orders.
          Each scenario simulates different payment method combinations to ensure cashback is calculated correctly.
        </p>
      </div>
      
      {/* Test Scenarios */}
      <div style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "18px", marginBottom: "16px" }}>Select Test Scenario</h2>
        
        <div style={{ display: "grid", gap: "12px" }}>
          {scenarios.map((scenario, index) => {
            if (!scenario.orderData) return null;
            
            const expectedCashback = calculateExpectedCashback(scenario);
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
                    <div style={{ fontSize: "14px", color: "#666" }}>Expected Cashback on:</div>
                    <div style={{ fontSize: "18px", fontWeight: "600", color: expectedCashback > 0 ? "#059669" : "#dc2626" }}>
                      {formatCurrency(expectedCashback)}
                    </div>
                    <div style={{ fontSize: "12px", color: "#666" }}>
                      (1% = {formatCurrency(expectedCashback * 0.01)})
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
          backgroundColor: "#f0fdf4",
          border: "1px solid #22c55e",
          padding: "20px",
          borderRadius: "8px",
          marginBottom: "24px"
        }}>
          <h3 style={{ margin: "0 0 16px 0", color: "#166534" }}>
            ✅ Test Completed: {actionData.scenario}
          </h3>
          
          <div style={{ display: "grid", gap: "16px" }}>
            <div>
              <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>Webhook Response:</h4>
              <div style={{ fontSize: "14px", padding: "8px", backgroundColor: "white", borderRadius: "4px" }}>
                Status: {actionData.webhookResponse.status} {actionData.webhookResponse.statusText}
              </div>
            </div>
            
            {actionData.databaseCheck.transaction && (
              <div>
                <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>Transaction Created:</h4>
                <div style={{ fontSize: "14px", padding: "8px", backgroundColor: "white", borderRadius: "4px" }}>
                  <div>Order Amount: {formatCurrency(actionData.databaseCheck.transaction.orderAmount)}</div>
                  <div>Cashback Rate: {actionData.databaseCheck.transaction.cashbackPercent}%</div>
                  <div style={{ fontWeight: "600", color: "#059669" }}>
                    Cashback Amount: {formatCurrency(actionData.databaseCheck.transaction.cashbackAmount)}
                  </div>
                  <div>Status: {actionData.databaseCheck.transaction.status}</div>
                </div>
              </div>
            )}
            
            {actionData.databaseCheck.customer && (
              <div>
                <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>Customer Balance:</h4>
                <div style={{ fontSize: "14px", padding: "8px", backgroundColor: "white", borderRadius: "4px" }}>
                  <div>Store Credit: {formatCurrency(actionData.databaseCheck.customer.storeCredit)}</div>
                  <div>Total Earned: {formatCurrency(actionData.databaseCheck.customer.totalEarned)}</div>
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
                <th style={{ padding: "8px", textAlign: "right" }}>Order Amount</th>
                <th style={{ padding: "8px", textAlign: "right" }}>Cashback</th>
                <th style={{ padding: "8px", textAlign: "left" }}>Status</th>
                <th style={{ padding: "8px", textAlign: "left" }}>Created</th>
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
                  <td style={{ padding: "8px", textAlign: "right", fontSize: "14px", fontWeight: "600", color: "#059669" }}>
                    {formatCurrency(tx.cashbackAmount)}
                  </td>
                  <td style={{ padding: "8px" }}>
                    <span style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      backgroundColor: tx.status === "SYNCED_TO_SHOPIFY" ? "#d1fae5" : "#fef3c7",
                      color: tx.status === "SYNCED_TO_SHOPIFY" ? "#065f46" : "#92400e"
                    }}>
                      {tx.status}
                    </span>
                  </td>
                  <td style={{ padding: "8px", fontSize: "14px" }}>
                    {new Date(tx.createdAt).toLocaleString()}
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