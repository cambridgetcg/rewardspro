// app/routes/app.import-test.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation, useActionData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";

interface TestOrder {
  id: string;
  name: string;
  createdAt: string;
  totalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  displayFinancialStatus: string;
  customer: {
    id: string;
    email: string;
  } | null;
}

interface LoaderData {
  shopDomain: string;
  stats: {
    transactionCount: number;
    customerCount: number;
    oldestTransaction?: {
      orderDate: string;
      orderAmount: number;
      customerEmail: string;
    };
  };
}

interface ActionData {
  success?: boolean;
  error?: string;
  testResult?: {
    query: string;
    variables: any;
    response: any;
    processedOrder?: TestOrder;
    createdCustomer?: any;
    createdTransaction?: any;
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  const transactionCount = await prisma.cashbackTransaction.count({
    where: { shopDomain: session.shop }
  });
  
  const customerCount = await prisma.customer.count({
    where: { shopDomain: session.shop }
  });
  
  // Get oldest transaction for reference
  const oldestTransaction = await prisma.cashbackTransaction.findFirst({
    where: { shopDomain: session.shop },
    orderBy: { createdAt: 'asc' },
    include: { customer: true }
  });
  
  return json<LoaderData>({
    shopDomain: session.shop,
    stats: {
      transactionCount,
      customerCount,
      oldestTransaction: oldestTransaction ? {
        orderDate: oldestTransaction.createdAt.toISOString(),
        orderAmount: oldestTransaction.orderAmount,
        customerEmail: oldestTransaction.customer.email
      } : undefined
    }
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get('_action') as string;
  
  if (action === 'test-oldest') {
    try {
      // Query to get the oldest order
      const oldestOrderQuery = `
        query GetOldestOrder {
          orders(first: 1, sortKey: CREATED_AT, reverse: false, query: "financial_status:paid") {
            edges {
              node {
                id
                name
                createdAt
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                displayFinancialStatus
                customer {
                  id
                  email
                }
              }
            }
          }
        }
      `;
      
      console.log('Executing GraphQL query:', oldestOrderQuery);
      
      const response = await admin.graphql(oldestOrderQuery);
      const responseData = await response.json();
      
      console.log('GraphQL Response:', JSON.stringify(responseData, null, 2));
      
      if (!responseData.data?.orders?.edges?.length) {
        return json<ActionData>({
          success: false,
          error: 'No paid orders found',
          testResult: {
            query: oldestOrderQuery,
            variables: {},
            response: responseData
          }
        });
      }
      
      const order = responseData.data.orders.edges[0].node as TestOrder;
      
      // Process the order
      let createdCustomer = null;
      let createdTransaction = null;
      
      if (order.customer) {
        const shopifyOrderId = order.id.split('/').pop()!;
        const shopifyCustomerId = order.customer.id.split('/').pop()!;
        const orderAmount = parseFloat(order.totalPriceSet.shopMoney.amount);
        
        // Create or get customer
        createdCustomer = await prisma.customer.upsert({
          where: {
            shopDomain_shopifyCustomerId: {
              shopDomain: session.shop,
              shopifyCustomerId
            }
          },
          update: {},
          create: {
            shopDomain: session.shop,
            shopifyCustomerId,
            email: order.customer.email
          }
        });
        
        // Create transaction
        createdTransaction = await prisma.cashbackTransaction.upsert({
          where: {
            shopDomain_shopifyOrderId: {
              shopDomain: session.shop,
              shopifyOrderId
            }
          },
          update: {},
          create: {
            shopDomain: session.shop,
            customerId: createdCustomer.id,
            shopifyOrderId,
            orderAmount,
            cashbackAmount: 0,
            cashbackPercent: 0,
            status: TransactionStatus.COMPLETED,
            createdAt: new Date(order.createdAt)
          }
        });
      }
      
      return json<ActionData>({
        success: true,
        testResult: {
          query: oldestOrderQuery,
          variables: {},
          response: responseData,
          processedOrder: order,
          createdCustomer,
          createdTransaction
        }
      });
      
    } catch (error) {
      console.error('Test import error:', error);
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        testResult: {
          query: 'Failed to execute',
          variables: {},
          response: { error: error instanceof Error ? error.message : 'Unknown error' }
        }
      });
    }
  }
  
  if (action === 'test-date-range') {
    try {
      const dateRange = formData.get('dateRange') as string;
      
      // Query with date filter
      const dateRangeQuery = `
        query GetOrdersInRange($query: String) {
          orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                id
                name
                createdAt
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                displayFinancialStatus
                customer {
                  id
                  email
                }
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `;
      
      const queryString = `created_at:>='${dateRange}T00:00:00Z' AND financial_status:paid`;
      
      console.log('Executing date range query with filter:', queryString);
      
      const response = await admin.graphql(dateRangeQuery, {
        variables: {
          query: queryString
        }
      });
      const responseData = await response.json();
      
      console.log('GraphQL Response:', JSON.stringify(responseData, null, 2));
      
      return json<ActionData>({
        success: true,
        testResult: {
          query: dateRangeQuery,
          variables: { query: queryString },
          response: responseData
        }
      });
      
    } catch (error) {
      console.error('Date range test error:', error);
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  return json<ActionData>({ success: false, error: 'Invalid action' });
}

export default function ImportTest() {
  const { shopDomain, stats } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  
  const styles = {
    container: {
      maxWidth: '1000px',
      margin: '0 auto',
      padding: '40px 24px'
    },
    header: {
      marginBottom: '32px'
    },
    title: {
      fontSize: '28px',
      fontWeight: '700',
      marginBottom: '8px',
      color: '#1a1a1a'
    },
    subtitle: {
      fontSize: '16px',
      color: '#666'
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '16px',
      marginBottom: '32px'
    },
    statCard: {
      backgroundColor: '#f8f9fa',
      padding: '20px',
      borderRadius: '8px',
      textAlign: 'center' as const
    },
    statValue: {
      fontSize: '24px',
      fontWeight: '600',
      color: '#10b981',
      marginBottom: '4px'
    },
    statLabel: {
      fontSize: '14px',
      color: '#666'
    },
    testSection: {
      backgroundColor: 'white',
      padding: '24px',
      borderRadius: '8px',
      border: '1px solid #e5e7eb',
      marginBottom: '24px'
    },
    sectionTitle: {
      fontSize: '18px',
      fontWeight: '600',
      marginBottom: '16px',
      color: '#1a1a1a'
    },
    button: {
      padding: '10px 20px',
      backgroundColor: '#3b82f6',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      marginRight: '12px',
      marginBottom: '12px'
    },
    buttonDisabled: {
      backgroundColor: '#9ca3af',
      cursor: 'not-allowed'
    },
    input: {
      padding: '8px 12px',
      border: '1px solid #e5e7eb',
      borderRadius: '4px',
      fontSize: '14px',
      marginRight: '8px',
      width: '200px'
    },
    codeBlock: {
      backgroundColor: '#f3f4f6',
      padding: '16px',
      borderRadius: '6px',
      fontSize: '13px',
      fontFamily: 'monospace',
      overflow: 'auto',
      marginTop: '16px',
      border: '1px solid #e5e7eb'
    },
    successMessage: {
      backgroundColor: '#d1fae5',
      color: '#065f46',
      padding: '12px',
      borderRadius: '6px',
      marginTop: '16px',
      border: '1px solid #6ee7b7'
    },
    errorMessage: {
      backgroundColor: '#fee2e2',
      color: '#991b1b',
      padding: '12px',
      borderRadius: '6px',
      marginTop: '16px',
      border: '1px solid #fca5a5'
    },
    infoBox: {
      backgroundColor: '#dbeafe',
      border: '1px solid #93c5fd',
      padding: '12px',
      borderRadius: '6px',
      marginBottom: '16px',
      fontSize: '14px',
      color: '#1e40af'
    }
  };
  
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Import Testing Dashboard</h1>
        <p style={styles.subtitle}>
          Test individual GraphQL queries and debug the import process
        </p>
      </div>
      
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.transactionCount}</div>
          <div style={styles.statLabel}>Total Transactions</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.customerCount}</div>
          <div style={styles.statLabel}>Total Customers</div>
        </div>
        {stats.oldestTransaction && (
          <div style={styles.statCard}>
            <div style={styles.statValue}>
              {new Date(stats.oldestTransaction.orderDate).toLocaleDateString()}
            </div>
            <div style={styles.statLabel}>Oldest Transaction</div>
          </div>
        )}
      </div>
      
      {/* Test Oldest Order */}
      <div style={styles.testSection}>
        <h2 style={styles.sectionTitle}>Test 1: Import Oldest Order</h2>
        <div style={styles.infoBox}>
          This test will fetch the oldest paid order from your store and attempt to import it.
          It will show the GraphQL query, response, and any database operations.
        </div>
        <Form method="post">
          <input type="hidden" name="_action" value="test-oldest" />
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...styles.button,
              ...(isSubmitting ? styles.buttonDisabled : {})
            }}
          >
            {isSubmitting ? 'Testing...' : 'Import Oldest Order'}
          </button>
        </Form>
      </div>
      
      {/* Test Date Range Query */}
      <div style={styles.testSection}>
        <h2 style={styles.sectionTitle}>Test 2: Query Orders by Date Range</h2>
        <div style={styles.infoBox}>
          Test the date range query to see what orders are returned for a specific date.
          This helps verify if Shopify is returning historical orders correctly.
        </div>
        <Form method="post">
          <input type="hidden" name="_action" value="test-date-range" />
          <input
            type="date"
            name="dateRange"
            defaultValue={new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
            style={styles.input}
            disabled={isSubmitting}
          />
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...styles.button,
              ...(isSubmitting ? styles.buttonDisabled : {})
            }}
          >
            {isSubmitting ? 'Testing...' : 'Test Date Query'}
          </button>
        </Form>
      </div>
      
      {/* Results Display */}
      {actionData && (
        <div style={styles.testSection}>
          <h2 style={styles.sectionTitle}>Test Results</h2>
          
          {actionData.success && (
            <div style={styles.successMessage}>
              ✅ Test completed successfully
            </div>
          )}
          
          {actionData.error && (
            <div style={styles.errorMessage}>
              ❌ Error: {actionData.error}
            </div>
          )}
          
          {actionData.testResult && (
            <>
              <h3 style={{ marginTop: '20px', marginBottom: '8px', fontWeight: '600' }}>
                GraphQL Query:
              </h3>
              <pre style={styles.codeBlock}>
                {actionData.testResult.query}
              </pre>
              
              {Object.keys(actionData.testResult.variables).length > 0 && (
                <>
                  <h3 style={{ marginTop: '20px', marginBottom: '8px', fontWeight: '600' }}>
                    Variables:
                  </h3>
                  <pre style={styles.codeBlock}>
                    {JSON.stringify(actionData.testResult.variables, null, 2)}
                  </pre>
                </>
              )}
              
              <h3 style={{ marginTop: '20px', marginBottom: '8px', fontWeight: '600' }}>
                GraphQL Response:
              </h3>
              <pre style={styles.codeBlock}>
                {JSON.stringify(actionData.testResult.response, null, 2)}
              </pre>
              
              {actionData.testResult.processedOrder && (
                <>
                  <h3 style={{ marginTop: '20px', marginBottom: '8px', fontWeight: '600' }}>
                    Processed Order:
                  </h3>
                  <pre style={styles.codeBlock}>
                    {JSON.stringify(actionData.testResult.processedOrder, null, 2)}
                  </pre>
                </>
              )}
              
              {actionData.testResult.createdCustomer && (
                <>
                  <h3 style={{ marginTop: '20px', marginBottom: '8px', fontWeight: '600' }}>
                    Created/Updated Customer:
                  </h3>
                  <pre style={styles.codeBlock}>
                    {JSON.stringify(actionData.testResult.createdCustomer, null, 2)}
                  </pre>
                </>
              )}
              
              {actionData.testResult.createdTransaction && (
                <>
                  <h3 style={{ marginTop: '20px', marginBottom: '8px', fontWeight: '600' }}>
                    Created Transaction:
                  </h3>
                  <pre style={styles.codeBlock}>
                    {JSON.stringify(actionData.testResult.createdTransaction, null, 2)}
                  </pre>
                </>
              )}
            </>
          )}
        </div>
      )}
      
      {/* Debug Information */}
      <div style={styles.testSection}>
        <h2 style={styles.sectionTitle}>Debug Information</h2>
        <div style={styles.infoBox}>
          <strong>Shop Domain:</strong> {shopDomain}<br />
          <strong>Current Date:</strong> {new Date().toISOString()}<br />
          <strong>Test Date (1 year ago):</strong> {new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()}
        </div>
        
        <h3 style={{ marginTop: '16px', marginBottom: '8px', fontWeight: '600' }}>
          Common Issues:
        </h3>
        <ul style={{ marginLeft: '20px', lineHeight: '1.8', fontSize: '14px' }}>
          <li><strong>No orders returned:</strong> Shopify may limit historical data access</li>
          <li><strong>Empty customer field:</strong> Guest checkouts or deleted customers</li>
          <li><strong>Date filtering not working:</strong> Check date format and timezone</li>
          <li><strong>Financial status mismatch:</strong> Only 'PAID' orders are imported</li>
        </ul>
      </div>
    </div>
  );
}