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
  currentDate: string;
  presetDates: {
    threeMonths: string;
    sixMonths: string;
    twelveMonths: string;
  };
}

interface ActionData {
  success?: boolean;
  error?: string;
  testResult?: {
    query: string;
    variables: any;
    queryString: string;
    response: any;
    ordersSummary?: {
      totalOrders: number;
      oldestOrder?: {
        name: string;
        createdAt: string;
      };
      newestOrder?: {
        name: string;
        createdAt: string;
      };
      dateDistribution?: {
        withinRange: number;
        outsideRange: number;
      };
    };
    databaseTest?: {
      attemptedInserts: number;
      successfulInserts: number;
      skippedDuplicates: number;
      errors: string[];
    };
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
  
  const oldestTransaction = await prisma.cashbackTransaction.findFirst({
    where: { shopDomain: session.shop },
    orderBy: { createdAt: 'asc' },
    include: { customer: true }
  });
  
  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  
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
    },
    currentDate: now.toISOString(),
    presetDates: {
      threeMonths: threeMonthsAgo.toISOString().split('T')[0],
      sixMonths: sixMonthsAgo.toISOString().split('T')[0],
      twelveMonths: twelveMonthsAgo.toISOString().split('T')[0]
    }
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get('_action') as string;
  
  if (action === 'test-date-filter') {
    try {
      const filterType = formData.get('filterType') as string;
      const customDate = formData.get('customDate') as string;
      const testDatabase = formData.get('testDatabase') === 'true';
      
      let startDate: string;
      const now = new Date();
      
      switch (filterType) {
        case '3months':
          const threeMonths = new Date(now);
          threeMonths.setMonth(threeMonths.getMonth() - 3);
          startDate = threeMonths.toISOString().split('T')[0];
          break;
        case '6months':
          const sixMonths = new Date(now);
          sixMonths.setMonth(sixMonths.getMonth() - 6);
          startDate = sixMonths.toISOString().split('T')[0];
          break;
        case '12months':
          const twelveMonths = new Date(now);
          twelveMonths.setFullYear(twelveMonths.getFullYear() - 1);
          startDate = twelveMonths.toISOString().split('T')[0];
          break;
        case 'custom':
          startDate = customDate;
          break;
        default:
          throw new Error('Invalid filter type');
      }
      
      // Build the query string - THIS IS THE KEY PART TO DEBUG
      const queryString = `created_at:>='${startDate}T00:00:00Z' AND financial_status:paid`;
      
      // Also test alternative query formats
      const alternativeQueries = [
        `created_at:>'${startDate}' AND financial_status:paid`,
        `created_at:>=${startDate} AND financial_status:paid`,
        `financial_status:paid AND created_at:>='${startDate}'`,
      ];
      
      console.log('Testing primary query:', queryString);
      console.log('Start date:', startDate);
      console.log('Alternative queries:', alternativeQueries);
      
      // Test the main query
      const ordersQuery = `
        query GetOrdersWithDateFilter($query: String) {
          orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: false) {
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
              endCursor
            }
          }
        }
      `;
      
      const response = await admin.graphql(ordersQuery, {
        variables: {
          query: queryString
        }
      });
      
      const responseData = await response.json();
      console.log('GraphQL Response:', JSON.stringify(responseData, null, 2));
      
      // Process the results
      let ordersSummary: any = null;
      let databaseTest: any = null;
      
      if (responseData.data?.orders?.edges) {
        const orders = responseData.data.orders.edges.map((edge: any) => edge.node);
        const startDateObj = new Date(startDate);
        
        // Analyze the orders
        const withinRange = orders.filter((order: TestOrder) => 
          new Date(order.createdAt) >= startDateObj
        ).length;
        
        const outsideRange = orders.filter((order: TestOrder) => 
          new Date(order.createdAt) < startDateObj
        ).length;
        
        ordersSummary = {
          totalOrders: orders.length,
          oldestOrder: orders.length > 0 ? {
            name: orders[0].name,
            createdAt: orders[0].createdAt
          } : undefined,
          newestOrder: orders.length > 0 ? {
            name: orders[orders.length - 1].name,
            createdAt: orders[orders.length - 1].createdAt
          } : undefined,
          dateDistribution: {
            withinRange,
            outsideRange
          }
        };
        
        // Test database insertion if requested
        if (testDatabase && orders.length > 0) {
          const dbResults = {
            attemptedInserts: 0,
            successfulInserts: 0,
            skippedDuplicates: 0,
            errors: [] as string[]
          };
          
          // Test with first 5 orders
          const testOrders = orders.slice(0, 5);
          
          for (const order of testOrders) {
            if (!order.customer) {
              dbResults.errors.push(`Order ${order.name} has no customer`);
              continue;
            }
            
            dbResults.attemptedInserts++;
            
            try {
              const shopifyOrderId = order.id.split('/').pop()!;
              const shopifyCustomerId = order.customer.id.split('/').pop()!;
              const orderAmount = parseFloat(order.totalPriceSet.shopMoney.amount);
              
              // Create or get customer
              const customer = await prisma.customer.upsert({
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
              
              // Check if transaction exists
              const existingTransaction = await prisma.cashbackTransaction.findUnique({
                where: {
                  shopDomain_shopifyOrderId: {
                    shopDomain: session.shop,
                    shopifyOrderId
                  }
                }
              });
              
              if (existingTransaction) {
                dbResults.skippedDuplicates++;
              } else {
                // Create transaction
                await prisma.cashbackTransaction.create({
                  data: {
                    shopDomain: session.shop,
                    customerId: customer.id,
                    shopifyOrderId,
                    orderAmount,
                    cashbackAmount: 0,
                    cashbackPercent: 0,
                    status: TransactionStatus.COMPLETED,
                    createdAt: new Date(order.createdAt)
                  }
                });
                dbResults.successfulInserts++;
              }
            } catch (error) {
              dbResults.errors.push(
                `Order ${order.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
              );
            }
          }
          
          databaseTest = dbResults;
        }
      }
      
      return json<ActionData>({
        success: true,
        testResult: {
          query: ordersQuery,
          variables: { query: queryString },
          queryString,
          response: responseData,
          ordersSummary,
          databaseTest
        }
      });
      
    } catch (error) {
      console.error('Date filter test error:', error);
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  if (action === 'test-query-formats') {
    try {
      const startDate = formData.get('startDate') as string;
      
      // Test different query formats to see which one works correctly
      const queryFormats = [
        {
          name: 'ISO with T and Z',
          query: `created_at:>='${startDate}T00:00:00Z' AND financial_status:paid`
        },
        {
          name: 'Date only with >=',
          query: `created_at:>='${startDate}' AND financial_status:paid`
        },
        {
          name: 'Date only with >',
          query: `created_at:>'${startDate}' AND financial_status:paid`
        },
        {
          name: 'With quotes around date',
          query: `created_at:>"${startDate}" AND financial_status:paid`
        },
        {
          name: 'Financial status first',
          query: `financial_status:paid AND created_at:>='${startDate}'`
        },
        {
          name: 'Using updated_at instead',
          query: `updated_at:>='${startDate}' AND financial_status:paid`
        }
      ];
      
      const results = [];
      
      for (const format of queryFormats) {
        try {
          const testQuery = `
            query TestQueryFormat($query: String) {
              orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: false) {
                edges {
                  node {
                    id
                    name
                    createdAt
                  }
                }
              }
            }
          `;
          
          const response = await admin.graphql(testQuery, {
            variables: { query: format.query }
          });
          
          const data = await response.json();
          
          results.push({
            format: format.name,
            query: format.query,
            success: !!data.data?.orders,
            orderCount: data.data?.orders?.edges?.length || 0,
            oldestOrder: data.data?.orders?.edges?.[0]?.node?.createdAt,
            error: (data as any).errors?.[0]?.message
          });
        } catch (error) {
          results.push({
            format: format.name,
            query: format.query,
            success: false,
            orderCount: 0,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
      
      return json<ActionData>({
        success: true,
        testResult: {
          query: 'Multiple query format tests',
          variables: { startDate },
          queryString: `Testing ${queryFormats.length} different query formats`,
          response: { results }
        }
      });
      
    } catch (error) {
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  if (action === 'clear-test-data') {
    try {
      // Clear test transactions from the last hour
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);
      
      const deleted = await prisma.cashbackTransaction.deleteMany({
        where: {
          shopDomain: session.shop,
          createdAt: {
            gte: oneHourAgo
          }
        }
      });
      
      return json<ActionData>({
        success: true,
        testResult: {
          query: 'Clear test data',
          variables: {},
          queryString: 'Deleted recent test transactions',
          response: { deletedCount: deleted.count }
        }
      });
    } catch (error) {
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  return json<ActionData>({ success: false, error: 'Invalid action' });
}

export default function ImportTest() {
  const { shopDomain, stats, currentDate, presetDates } = useLoaderData<LoaderData>();
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
    buttonSecondary: {
      backgroundColor: '#6b7280'
    },
    buttonDanger: {
      backgroundColor: '#ef4444'
    },
    input: {
      padding: '8px 12px',
      border: '1px solid #e5e7eb',
      borderRadius: '4px',
      fontSize: '14px',
      marginRight: '8px'
    },
    select: {
      padding: '8px 12px',
      border: '1px solid #e5e7eb',
      borderRadius: '4px',
      fontSize: '14px',
      marginRight: '8px',
      backgroundColor: 'white'
    },
    checkbox: {
      marginRight: '8px',
      width: '16px',
      height: '16px'
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
    warningMessage: {
      backgroundColor: '#fef3c7',
      color: '#92400e',
      padding: '12px',
      borderRadius: '6px',
      marginTop: '16px',
      border: '1px solid #f59e0b'
    },
    infoBox: {
      backgroundColor: '#dbeafe',
      border: '1px solid #93c5fd',
      padding: '12px',
      borderRadius: '6px',
      marginBottom: '16px',
      fontSize: '14px',
      color: '#1e40af'
    },
    summaryTable: {
      width: '100%',
      marginTop: '16px',
      borderCollapse: 'collapse' as const
    },
    summaryRow: {
      borderBottom: '1px solid #e5e7eb'
    },
    summaryCell: {
      padding: '8px',
      textAlign: 'left' as const,
      fontSize: '14px'
    },
    summaryCellLabel: {
      fontWeight: '600',
      color: '#4b5563'
    }
  };
  
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Import Testing Dashboard - Date Filters</h1>
        <p style={styles.subtitle}>
          Debug date filtering issues and test database insertion behavior
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
      
      {/* Current Date Info */}
      <div style={styles.testSection}>
        <h2 style={styles.sectionTitle}>📅 Date Reference</h2>
        <table style={styles.summaryTable}>
          <tbody>
            <tr style={styles.summaryRow}>
              <td style={{ ...styles.summaryCell, ...styles.summaryCellLabel }}>Current Date:</td>
              <td style={styles.summaryCell}>{new Date(currentDate).toLocaleString()}</td>
            </tr>
            <tr style={styles.summaryRow}>
              <td style={{ ...styles.summaryCell, ...styles.summaryCellLabel }}>3 Months Ago:</td>
              <td style={styles.summaryCell}>{presetDates.threeMonths} ({new Date(presetDates.threeMonths).toLocaleDateString()})</td>
            </tr>
            <tr style={styles.summaryRow}>
              <td style={{ ...styles.summaryCell, ...styles.summaryCellLabel }}>6 Months Ago:</td>
              <td style={styles.summaryCell}>{presetDates.sixMonths} ({new Date(presetDates.sixMonths).toLocaleDateString()})</td>
            </tr>
            <tr style={styles.summaryRow}>
              <td style={{ ...styles.summaryCell, ...styles.summaryCellLabel }}>12 Months Ago:</td>
              <td style={styles.summaryCell}>{presetDates.twelveMonths} ({new Date(presetDates.twelveMonths).toLocaleDateString()})</td>
            </tr>
          </tbody>
        </table>
      </div>
      
      {/* Test Date Filtering */}
      <div style={styles.testSection}>
        <h2 style={styles.sectionTitle}>Test 1: Date Filter Behavior</h2>
        <div style={styles.infoBox}>
          This test will show exactly what orders Shopify returns for each date filter option.
          It will also analyze if orders are within the expected date range.
        </div>
        <Form method="post">
          <input type="hidden" name="_action" value="test-date-filter" />
          
          <select name="filterType" style={styles.select}>
            <option value="3months">Last 3 Months</option>
            <option value="6months">Last 6 Months</option>
            <option value="12months">Last 12 Months</option>
            <option value="custom">Custom Date</option>
          </select>
          
          <input
            type="date"
            name="customDate"
            defaultValue={presetDates.threeMonths}
            style={styles.input}
          />
          
          <label style={{ marginRight: '16px' }}>
            <input
              type="checkbox"
              name="testDatabase"
              value="true"
              style={styles.checkbox}
            />
            Test database insertion (first 5 orders)
          </label>
          
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...styles.button,
              ...(isSubmitting ? styles.buttonDisabled : {})
            }}
          >
            {isSubmitting ? 'Testing...' : 'Test Date Filter'}
          </button>
        </Form>
      </div>
      
      {/* Test Query Formats */}
      <div style={styles.testSection}>
        <h2 style={styles.sectionTitle}>Test 2: Query Format Comparison</h2>
        <div style={styles.infoBox}>
          Tests different date query formats to identify which one works correctly with Shopify's API.
        </div>
        <Form method="post">
          <input type="hidden" name="_action" value="test-query-formats" />
          
          <input
            type="date"
            name="startDate"
            defaultValue={presetDates.threeMonths}
            style={styles.input}
          />
          
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...styles.button,
              ...(isSubmitting ? styles.buttonDisabled : {})
            }}
          >
            {isSubmitting ? 'Testing...' : 'Test All Query Formats'}
          </button>
        </Form>
      </div>
      
      {/* Clear Test Data */}
      <div style={styles.testSection}>
        <h2 style={styles.sectionTitle}>Test 3: Clear Recent Test Data</h2>
        <div style={styles.infoBox}>
          Remove test transactions created in the last hour to clean up after testing.
        </div>
        <Form method="post">
          <input type="hidden" name="_action" value="clear-test-data" />
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...styles.button,
              ...styles.buttonDanger,
              ...(isSubmitting ? styles.buttonDisabled : {})
            }}
          >
            {isSubmitting ? 'Clearing...' : 'Clear Test Data'}
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
              {actionData.testResult.queryString && (
                <>
                  <h3 style={{ marginTop: '20px', marginBottom: '8px', fontWeight: '600' }}>
                    Query String Used:
                  </h3>
                  <pre style={styles.codeBlock}>
                    {actionData.testResult.queryString}
                  </pre>
                </>
              )}
              
              {actionData.testResult.ordersSummary && (
                <>
                  <h3 style={{ marginTop: '20px', marginBottom: '8px', fontWeight: '600' }}>
                    Orders Analysis:
                  </h3>
                  <table style={styles.summaryTable}>
                    <tbody>
                      <tr style={styles.summaryRow}>
                        <td style={{ ...styles.summaryCell, ...styles.summaryCellLabel }}>Total Orders Returned:</td>
                        <td style={styles.summaryCell}>{actionData.testResult.ordersSummary.totalOrders}</td>
                      </tr>
                      {actionData.testResult.ordersSummary.oldestOrder && (
                        <tr style={styles.summaryRow}>
                          <td style={{ ...styles.summaryCell, ...styles.summaryCellLabel }}>Oldest Order:</td>
                          <td style={styles.summaryCell}>
                            {actionData.testResult.ordersSummary.oldestOrder.name} - {new Date(actionData.testResult.ordersSummary.oldestOrder.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      )}
                      {actionData.testResult.ordersSummary.newestOrder && (
                        <tr style={styles.summaryRow}>
                          <td style={{ ...styles.summaryCell, ...styles.summaryCellLabel }}>Newest Order:</td>
                          <td style={styles.summaryCell}>
                            {actionData.testResult.ordersSummary.newestOrder.name} - {new Date(actionData.testResult.ordersSummary.newestOrder.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      )}
                      {actionData.testResult.ordersSummary.dateDistribution && (
                        <>
                          <tr style={styles.summaryRow}>
                            <td style={{ ...styles.summaryCell, ...styles.summaryCellLabel }}>Orders Within Date Range:</td>
                            <td style={styles.summaryCell}>
                              {actionData.testResult.ordersSummary.dateDistribution.withinRange}
                              {actionData.testResult.ordersSummary.dateDistribution.withinRange === actionData.testResult.ordersSummary.totalOrders && 
                                <span style={{ color: '#10b981', marginLeft: '8px' }}>✓ All orders are within range</span>
                              }
                            </td>
                          </tr>
                          <tr style={styles.summaryRow}>
                            <td style={{ ...styles.summaryCell, ...styles.summaryCellLabel }}>Orders Outside Date Range:</td>
                            <td style={styles.summaryCell}>
                              {actionData.testResult.ordersSummary.dateDistribution.outsideRange}
                              {actionData.testResult.ordersSummary.dateDistribution.outsideRange > 0 && 
                                <span style={{ color: '#ef4444', marginLeft: '8px' }}>⚠️ Orders outside expected range!</span>
                              }
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                  
                  {actionData.testResult.ordersSummary.dateDistribution && actionData.testResult.ordersSummary.dateDistribution.outsideRange > 0 && (
                    <div style={styles.warningMessage}>
                      ⚠️ <strong>Date Filter Issue Detected:</strong> The query returned {actionData.testResult.ordersSummary.dateDistribution.outsideRange} orders 
                      that are outside the expected date range. This suggests the Shopify query filter may not be working as expected.
                    </div>
                  )}
                </>
              )}
              
              {actionData.testResult.databaseTest && (
                <>
                  <h3 style={{ marginTop: '20px', marginBottom: '8px', fontWeight: '600' }}>
                    Database Test Results:
                  </h3>
                  <table style={styles.summaryTable}>
                    <tbody>
                      <tr style={styles.summaryRow}>
                        <td style={{ ...styles.summaryCell, ...styles.summaryCellLabel }}>Attempted Inserts:</td>
                        <td style={styles.summaryCell}>{actionData.testResult.databaseTest.attemptedInserts}</td>
                      </tr>
                      <tr style={styles.summaryRow}>
                        <td style={{ ...styles.summaryCell, ...styles.summaryCellLabel }}>Successful Inserts:</td>
                        <td style={styles.summaryCell}>{actionData.testResult.databaseTest.successfulInserts}</td>
                      </tr>
                      <tr style={styles.summaryRow}>
                        <td style={{ ...styles.summaryCell, ...styles.summaryCellLabel }}>Skipped (Duplicates):</td>
                        <td style={styles.summaryCell}>{actionData.testResult.databaseTest.skippedDuplicates}</td>
                      </tr>
                    </tbody>
                  </table>
                  
                  {actionData.testResult.databaseTest.errors.length > 0 && (
                    <div style={styles.errorMessage}>
                      <strong>Database Errors:</strong>
                      <ul style={{ marginTop: '8px', marginLeft: '20px' }}>
                        {actionData.testResult.databaseTest.errors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              
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
                Full GraphQL Response:
              </h3>
              <pre style={styles.codeBlock}>
                {JSON.stringify(actionData.testResult.response, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
      
      {/* Debugging Help */}
      <div style={styles.testSection}>
        <h2 style={styles.sectionTitle}>Common Date Filter Issues</h2>
        <ul style={{ marginLeft: '20px', lineHeight: '1.8', fontSize: '14px' }}>
          <li><strong>Shopify ignores date filters:</strong> This can happen if the query syntax is incorrect</li>
          <li><strong>All orders returned:</strong> The API might default to all orders if the filter fails</li>
          <li><strong>Timezone issues:</strong> Shopify uses UTC, ensure dates are properly formatted</li>
          <li><strong>Query order matters:</strong> Try putting financial_status first or last</li>
          <li><strong>Date format:</strong> ISO 8601 format (YYYY-MM-DD) is most reliable</li>
        </ul>
        
        <h3 style={{ marginTop: '16px', marginBottom: '8px', fontWeight: '600' }}>
          Recommended Solution:
        </h3>
        <div style={styles.infoBox}>
          If date filtering isn't working correctly, the safest approach is to:
          <ol style={{ marginLeft: '20px', marginTop: '8px' }}>
            <li>Fetch all orders without date filter</li>
            <li>Filter by date in your application code after fetching</li>
            <li>This ensures accurate date filtering even if Shopify's query is unreliable</li>
          </ol>
        </div>
      </div>
    </div>
  );
}