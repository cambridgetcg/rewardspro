// app/routes/app.test-transactions.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { useState } from "react";

// Type definitions based on Shopify GraphQL API documentation
interface ShopifyTransaction {
  id: string;
  kind: string; // SALE, REFUND, CAPTURE, AUTHORIZATION, VOID, etc.
  gateway: string; // The payment gateway identifier
  formattedGateway: string; // Human-readable gateway name
  status: string; // SUCCESS, FAILURE, PENDING, ERROR
  test: boolean;
  processedAt: string | null;
  createdAt: string;
  errorCode: string | null;
  authorizationCode: string | null;
  accountNumber: string | null; // Masked account number
  amountSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
    presentmentMoney?: {
      amount: string;
      currencyCode: string;
    };
  };
  fees: Array<{
    amount: {
      amount: string;
      currencyCode: string;
    };
    flatFee?: {
      amount: string;
      currencyCode: string;
    };
    flatFeeName?: string;
    percentage?: number;
    type: string;
  }>;
  maximumRefundableV2?: {
    amount: string;
    currencyCode: string;
  };
  parentTransaction?: {
    id: string;
    kind: string;
    gateway: string;
    amountSet: {
      shopMoney: {
        amount: string;
        currencyCode: string;
      };
    };
  };
  paymentDetails?: {
    creditCardCompany?: string;
    creditCardNumber?: string;
    avsResultCode?: string;
    cvvResultCode?: string;
    creditCardName?: string;
    creditCardWallet?: string;
  };
  receiptJson?: string;
  settlementCurrency?: string;
  settlementCurrencyRate?: string;
  paymentIcon?: {
    url: string;
    altText: string;
  };
  manualPaymentGateway: boolean;
  manuallyCapturable: boolean;
  multiCapturable: boolean;
}

type ActionResponse = 
  | { error: string; details?: any; success?: never }
  | { 
      success: true; 
      orderId: string; 
      orderName: string;
      rawResponse: any; 
      transactionAnalysis: {
        totalTransactions: number;
        paymentGateways: string[];
        transactionsByGateway: Record<string, {
          transactions: ShopifyTransaction[];
          totalAmount: number;
          currency: string;
        }>;
        giftCardTransactions: ShopifyTransaction[];
        storeCreditTransactions: ShopifyTransaction[];
        regularPaymentTransactions: ShopifyTransaction[];
        totalGiftCardAmount: number;
        totalStoreCreditAmount: number;
        totalRegularPaymentAmount: number;
        orderTotal: number;
        currency: string;
      };
      error?: never;
    };

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({ message: "Ready to test order transactions" });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const orderId = formData.get("orderId") as string;
  
  if (!orderId) {
    return json<ActionResponse>({ error: "Order ID is required" });
  }
  
  try {
    // Comprehensive GraphQL query based on Shopify documentation
    const query = `#graphql
      query getOrderTransactionDetails($id: ID!) {
        order(id: $id) {
          id
          name
          createdAt
          processedAt
          test
          confirmed
          fullyPaid
          unpaid
          refundable
          
          # Financial summary
          displayFinancialStatus
          currencyCode
          presentmentCurrencyCode
          
          # All price information
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
          totalDiscountsSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalShippingPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalTaxSet {
            shopMoney {
              amount
              currencyCode
            }
          }
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
          totalReceivedSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalRefundedSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalOutstandingSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          netPaymentSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          
          # Payment gateway information
          paymentGatewayNames
          
          # Customer information
          customer {
            id
            email
            firstName
            lastName
          }
          
          # All transactions with complete details
          transactions(first: 100) {
            id
            kind
            gateway
            formattedGateway
            status
            test
            processedAt
            createdAt
            errorCode
            authorizationCode
            accountNumber
            manualPaymentGateway
            manuallyCapturable
            multiCapturable
            
            # Amount information
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
            
            # Maximum refundable (for refund calculations)
            maximumRefundableV2 {
              amount
              currencyCode
            }
            
            # Transaction fees
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
              percentage
              type
            }
            
            # Parent transaction (for captures/refunds)
            parentTransaction {
              id
              kind
              gateway
              amountSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
            
            # Payment details
            paymentDetails {
              ... on CardPaymentDetails {
                creditCardCompany
                creditCardNumber
                avsResultCode
                cvvResultCode
                creditCardName
                creditCardWallet
              }
            }
            
            # Payment icon
            paymentIcon {
              url
              altText
            }
            
            # Receipt data
            receiptJson
            
            # Settlement information
            settlementCurrency
            settlementCurrencyRate
          }
          
          # Refund information
          refunds {
            id
            createdAt
            note
            totalRefundedSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            transactions {
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
          
          # Line items for context
          lineItems(first: 10) {
            nodes {
              id
              name
              quantity
              sku
              originalTotalSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalDiscountSet {
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
    
    // Use the appropriate ID format
    const gid = orderId.startsWith('gid://') ? orderId : `gid://shopify/Order/${orderId}`;
    const variables = { id: gid };
    
    const response = await admin.graphql(query, { variables });
    const result = await response.json();
    
    if (result.errors) {
      return json<ActionResponse>({ 
        error: "GraphQL errors occurred", 
        details: result.errors 
      });
    }
    
    if (!result.data?.order) {
      return json<ActionResponse>({ 
        error: "Order not found",
        details: { orderId: gid }
      });
    }
    
    const order = result.data.order;
    const transactions: ShopifyTransaction[] = order.transactions || [];
    
    // Analyze transactions
    const transactionsByGateway: Record<string, {
      transactions: ShopifyTransaction[];
      totalAmount: number;
      currency: string;
    }> = {};
    
    const giftCardTransactions: ShopifyTransaction[] = [];
    const storeCreditTransactions: ShopifyTransaction[] = [];
    const regularPaymentTransactions: ShopifyTransaction[] = [];
    
    let totalGiftCardAmount = 0;
    let totalStoreCreditAmount = 0;
    let totalRegularPaymentAmount = 0;
    
    // Process each transaction
    transactions.forEach((transaction) => {
      // Only count successful sale transactions
      if (transaction.status === 'SUCCESS' && transaction.kind === 'SALE') {
        const amount = parseFloat(transaction.amountSet.shopMoney.amount);
        const gateway = transaction.gateway || 'unknown';
        const currency = transaction.amountSet.shopMoney.currencyCode;
        
        // Group by gateway
        if (!transactionsByGateway[gateway]) {
          transactionsByGateway[gateway] = {
            transactions: [],
            totalAmount: 0,
            currency
          };
        }
        transactionsByGateway[gateway].transactions.push(transaction);
        transactionsByGateway[gateway].totalAmount += amount;
        
        // Identify payment type
        const gatewayLower = gateway.toLowerCase();
        const formattedGatewayLower = (transaction.formattedGateway || '').toLowerCase();
        
        // Check for gift cards
        if (gatewayLower === 'gift_card' || 
            gatewayLower.includes('gift') || 
            formattedGatewayLower.includes('gift')) {
          giftCardTransactions.push(transaction);
          totalGiftCardAmount += amount;
        }
        // Check for store credit
        else if (gatewayLower === 'store_credit' || 
                 gatewayLower.includes('credit') ||
                 formattedGatewayLower.includes('store credit') ||
                 formattedGatewayLower.includes('cash on delivery')) {
          storeCreditTransactions.push(transaction);
          totalStoreCreditAmount += amount;
        }
        // Regular payment methods
        else {
          regularPaymentTransactions.push(transaction);
          totalRegularPaymentAmount += amount;
        }
        
        // Additional check: parse receipt JSON if available
        if (transaction.receiptJson) {
          try {
            const receipt = JSON.parse(transaction.receiptJson);
            // Look for gift card indicators in receipt
            if (receipt.gift_card || receipt.payment_method?.includes('gift')) {
              // Move to gift card if not already there
              if (!giftCardTransactions.includes(transaction)) {
                regularPaymentTransactions.splice(regularPaymentTransactions.indexOf(transaction), 1);
                giftCardTransactions.push(transaction);
                totalRegularPaymentAmount -= amount;
                totalGiftCardAmount += amount;
              }
            }
          } catch (e) {
            // Invalid JSON, skip
          }
        }
      }
    });
    
    const orderTotal = parseFloat(order.totalPriceSet.shopMoney.amount);
    const currency = order.currencyCode;
    
    return json<ActionResponse>({
      success: true,
      orderId: order.id,
      orderName: order.name,
      rawResponse: result,
      transactionAnalysis: {
        totalTransactions: transactions.length,
        paymentGateways: order.paymentGatewayNames || [],
        transactionsByGateway,
        giftCardTransactions,
        storeCreditTransactions,
        regularPaymentTransactions,
        totalGiftCardAmount,
        totalStoreCreditAmount,
        totalRegularPaymentAmount,
        orderTotal,
        currency
      }
    });
    
  } catch (error) {
    console.error("GraphQL error:", error);
    return json<ActionResponse>({
      error: error instanceof Error ? error.message : "Failed to fetch order data",
      details: error
    });
  }
}

export default function TestTransactions() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const [orderId, setOrderId] = useState("");
  
  const isSubmitting = navigation.state === "submitting";
  
  const styles = {
    container: {
      maxWidth: "1400px",
      margin: "0 auto",
      padding: "40px 24px"
    },
    header: {
      marginBottom: "32px"
    },
    title: {
      fontSize: "28px",
      fontWeight: "700",
      marginBottom: "8px",
      color: "#1a1a1a"
    },
    subtitle: {
      fontSize: "16px",
      color: "#666"
    },
    form: {
      backgroundColor: "#f8f9fa",
      padding: "24px",
      borderRadius: "12px",
      marginBottom: "32px",
      border: "1px solid #e5e7eb"
    },
    formGroup: {
      marginBottom: "20px"
    },
    label: {
      display: "block",
      fontSize: "14px",
      fontWeight: "600",
      marginBottom: "8px",
      color: "#374151"
    },
    input: {
      width: "100%",
      padding: "10px 14px",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      fontSize: "15px",
      backgroundColor: "white"
    },
    button: {
      padding: "12px 24px",
      backgroundColor: "#3b82f6",
      color: "white",
      border: "none",
      borderRadius: "8px",
      fontSize: "16px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "all 0.2s"
    },
    buttonDisabled: {
      backgroundColor: "#9ca3af",
      cursor: "not-allowed"
    },
    results: {
      backgroundColor: "#1e293b",
      color: "#e2e8f0",
      padding: "24px",
      borderRadius: "12px",
      fontFamily: "monospace",
      fontSize: "13px",
      lineHeight: "1.5",
      overflow: "auto",
      maxHeight: "600px"
    },
    error: {
      backgroundColor: "#fef2f2",
      border: "1px solid #fecaca",
      color: "#991b1b",
      padding: "16px",
      borderRadius: "8px",
      marginBottom: "20px"
    },
    analysisSection: {
      backgroundColor: "#ffffff",
      border: "1px solid #e5e7eb",
      borderRadius: "12px",
      padding: "24px",
      marginBottom: "24px"
    },
    analysisTitle: {
      fontSize: "20px",
      fontWeight: "600",
      marginBottom: "20px",
      color: "#1a1a1a"
    },
    summaryGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
      gap: "16px",
      marginBottom: "24px"
    },
    summaryCard: {
      backgroundColor: "#f8f9fa",
      padding: "16px",
      borderRadius: "8px",
      border: "1px solid #e5e7eb"
    },
    summaryLabel: {
      fontSize: "12px",
      color: "#6b7280",
      marginBottom: "4px"
    },
    summaryValue: {
      fontSize: "20px",
      fontWeight: "600",
      color: "#1a1a1a"
    },
    transactionTable: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "14px",
      marginTop: "16px"
    },
    th: {
      textAlign: "left",
      padding: "12px",
      borderBottom: "2px solid #e5e7eb",
      fontWeight: "600",
      backgroundColor: "#f8f9fa"
    },
    td: {
      padding: "12px",
      borderBottom: "1px solid #f3f4f6"
    },
    gatewayBadge: {
      display: "inline-block",
      padding: "4px 8px",
      borderRadius: "4px",
      fontSize: "12px",
      fontWeight: "500"
    },
    giftCardBadge: {
      backgroundColor: "#fef3c7",
      color: "#92400e"
    },
    storeCreditBadge: {
      backgroundColor: "#ddd6fe",
      color: "#5b21b6"
    },
    regularBadge: {
      backgroundColor: "#d1fae5",
      color: "#065f46"
    },
    statusBadge: {
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: "4px",
      fontSize: "12px",
      fontWeight: "500"
    },
    successStatus: {
      backgroundColor: "#d1fae5",
      color: "#065f46"
    },
    failureStatus: {
      backgroundColor: "#fee2e2",
      color: "#991b1b"
    },
    helpText: {
      fontSize: "13px",
      color: "#6b7280",
      marginTop: "8px"
    }
  };
  
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };
  
  const getGatewayBadgeStyle = (gateway: string) => {
    const lower = gateway.toLowerCase();
    if (lower.includes('gift')) return styles.giftCardBadge;
    if (lower.includes('credit')) return styles.storeCreditBadge;
    return styles.regularBadge;
  };
  
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Order Transaction Gateway Test</h1>
        <p style={styles.subtitle}>
          Analyze Shopify order transactions to identify gift cards, store credits, and regular payments
        </p>
      </div>
      
      <Form method="post" style={styles.form}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Order ID</label>
          <input
            type="text"
            name="orderId"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="Enter order ID (e.g., 5678901234567 or gid://shopify/Order/5678901234567)"
            required
            style={styles.input}
          />
          <p style={styles.helpText}>
            Test with an order that has multiple payment methods, including gift cards or store credits
          </p>
        </div>
        
        <button
          type="submit"
          disabled={isSubmitting || !orderId}
          style={{
            ...styles.button,
            ...(isSubmitting || !orderId ? styles.buttonDisabled : {})
          }}
        >
          {isSubmitting ? "Analyzing..." : "Analyze Order Transactions"}
        </button>
      </Form>
      
      {actionData && 'error' in actionData && (
        <div style={styles.error}>
          <strong>Error:</strong> {actionData.error}
          {actionData.details && (
            <pre style={{ marginTop: "12px", fontSize: "12px" }}>
              {JSON.stringify(actionData.details, null, 2)}
            </pre>
          )}
        </div>
      )}
      
      {actionData && 'success' in actionData && (
        <>
          {/* Transaction Analysis */}
          <div style={styles.analysisSection}>
            <h2 style={styles.analysisTitle}>Transaction Analysis for {actionData.orderName}</h2>
            
            {/* Summary Cards */}
            <div style={styles.summaryGrid}>
              <div style={styles.summaryCard}>
                <div style={styles.summaryLabel}>Order Total</div>
                <div style={styles.summaryValue}>
                  {formatCurrency(actionData.transactionAnalysis.orderTotal, actionData.transactionAnalysis.currency)}
                </div>
              </div>
              
              <div style={styles.summaryCard}>
                <div style={styles.summaryLabel}>Gift Card Payments</div>
                <div style={styles.summaryValue}>
                  {formatCurrency(actionData.transactionAnalysis.totalGiftCardAmount, actionData.transactionAnalysis.currency)}
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
                  {actionData.transactionAnalysis.giftCardTransactions.length} transaction(s)
                </div>
              </div>
              
              <div style={styles.summaryCard}>
                <div style={styles.summaryLabel}>Store Credit Payments</div>
                <div style={styles.summaryValue}>
                  {formatCurrency(actionData.transactionAnalysis.totalStoreCreditAmount, actionData.transactionAnalysis.currency)}
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
                  {actionData.transactionAnalysis.storeCreditTransactions.length} transaction(s)
                </div>
              </div>
              
              <div style={styles.summaryCard}>
                <div style={styles.summaryLabel}>Regular Payments</div>
                <div style={styles.summaryValue}>
                  {formatCurrency(actionData.transactionAnalysis.totalRegularPaymentAmount, actionData.transactionAnalysis.currency)}
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
                  {actionData.transactionAnalysis.regularPaymentTransactions.length} transaction(s)
                </div>
              </div>
              
              <div style={styles.summaryCard}>
                <div style={styles.summaryLabel}>Cashback Eligible Amount</div>
                <div style={styles.summaryValue}>
                  {formatCurrency(actionData.transactionAnalysis.totalRegularPaymentAmount, actionData.transactionAnalysis.currency)}
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
                  Excludes gift cards & store credits
                </div>
              </div>
            </div>
            
            {/* Payment Gateway Names */}
            <div style={{ marginBottom: "24px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "8px" }}>
                Payment Gateway Names (from order)
              </h3>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {actionData.transactionAnalysis.paymentGateways.map((gateway, index) => (
                  <span key={index} style={{
                    ...styles.gatewayBadge,
                    ...getGatewayBadgeStyle(gateway)
                  }}>
                    {gateway}
                  </span>
                ))}
              </div>
            </div>
            
            {/* Transactions by Gateway */}
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px" }}>
                Transactions by Gateway
              </h3>
              {Object.entries(actionData.transactionAnalysis.transactionsByGateway).map(([gateway, data]) => (
                <div key={gateway} style={{ marginBottom: "24px" }}>
                  <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>
                    <span style={{
                      ...styles.gatewayBadge,
                      ...getGatewayBadgeStyle(gateway)
                    }}>
                      {gateway}
                    </span>
                    <span style={{ marginLeft: "12px", fontWeight: "400" }}>
                      Total: {formatCurrency(data.totalAmount, data.currency)}
                    </span>
                  </h4>
                  <table style={styles.transactionTable}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Transaction ID</th>
                        <th style={styles.th}>Kind</th>
                        <th style={styles.th}>Status</th>
                        <th style={styles.th}>Amount</th>
                        <th style={styles.th}>Gateway</th>
                        <th style={styles.th}>Formatted Gateway</th>
                        <th style={styles.th}>Account</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.transactions.map((transaction) => (
                        <tr key={transaction.id}>
                          <td style={styles.td}>{transaction.id.split('/').pop()}</td>
                          <td style={styles.td}>{transaction.kind}</td>
                          <td style={styles.td}>
                            <span style={{
                              ...styles.statusBadge,
                              ...(transaction.status === 'SUCCESS' ? styles.successStatus : styles.failureStatus)
                            }}>
                              {transaction.status}
                            </span>
                          </td>
                          <td style={styles.td}>
                            {formatCurrency(parseFloat(transaction.amountSet.shopMoney.amount), transaction.amountSet.shopMoney.currencyCode)}
                          </td>
                          <td style={styles.td}>{transaction.gateway}</td>
                          <td style={styles.td}>{transaction.formattedGateway || '-'}</td>
                          <td style={styles.td}>{transaction.accountNumber || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
          
          {/* Raw Response */}
          <div>
            <h3 style={{ marginBottom: "12px", fontSize: "18px", fontWeight: "600" }}>
              Raw GraphQL Response
            </h3>
            <pre style={styles.results}>
              {JSON.stringify(actionData.rawResponse, null, 2)}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}