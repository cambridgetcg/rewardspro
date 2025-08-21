import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineGrid,
  DataTable,
  SkeletonBodyText,
  SkeletonDisplayText,
} from "@shopify/polaris";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getDashboardData } from "../services/dashboard-simple.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  try {
    const dashboardData = await getDashboardData(session);
    return { dashboardData, error: null };
  } catch (error) {
    console.error("Dashboard error:", error);
    return { 
      dashboardData: null, 
      error: "Failed to load dashboard data" 
    };
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function Dashboard() {
  const navigation = useNavigation();
  const { dashboardData, error } = useLoaderData<typeof loader>();
  
  // Loading state
  if (navigation.state === "loading") {
    return (
      <Page title="Dashboard">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={3} />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }
  
  // Error state
  if (error || !dashboardData) {
    return (
      <Page title="Dashboard">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  Unable to load dashboard
                </Text>
                <Text as="p" tone="critical">
                  {error || "Unknown error occurred"}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }
  
  const { stats, tierDistribution, recentTransactions, todaysCashback, monthlyTrend } = dashboardData;
  
  // Prepare transaction table data
  const transactionRows = recentTransactions.map(t => [
    formatDate(t.createdAt),
    t.customerEmail,
    formatCurrency(t.orderAmount),
    formatCurrency(t.cashbackAmount),
  ]);
  
  return (
    <Page title="Dashboard">
      <Layout>
        {/* Key Metrics */}
        <Layout.Section>
          <InlineGrid columns={2} gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Total Customers
                </Text>
                <Text as="p" variant="heading2xl" fontWeight="bold">
                  {stats.totalCustomers}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {stats.activeCustomers} active members
                </Text>
              </BlockStack>
            </Card>
            
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Total Cashback Earned
                </Text>
                <Text as="p" variant="heading2xl" fontWeight="bold">
                  {formatCurrency(stats.totalCashbackEarned)}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  All time earnings
                </Text>
              </BlockStack>
            </Card>
            
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Today's Cashback
                </Text>
                <Text as="p" variant="heading2xl" fontWeight="bold">
                  {formatCurrency(todaysCashback)}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Since midnight
                </Text>
              </BlockStack>
            </Card>
            
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Average Cashback Rate
                </Text>
                <Text as="p" variant="heading2xl" fontWeight="bold">
                  {formatPercent(stats.averageCashbackPercent)}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Across all tiers
                </Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>
        
        {/* Monthly Summary */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                This Month
              </Text>
              <InlineGrid columns={2} gap="400">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Cashback Earned
                  </Text>
                  <Text as="p" variant="headingXl" fontWeight="bold">
                    {formatCurrency(monthlyTrend.earned)}
                  </Text>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Total Transactions
                  </Text>
                  <Text as="p" variant="headingXl" fontWeight="bold">
                    {monthlyTrend.transactions}
                  </Text>
                </BlockStack>
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>
        
        {/* Tier Distribution */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                Tier Distribution
              </Text>
              {tierDistribution.length > 0 ? (
                <BlockStack gap="300">
                  {tierDistribution.map((tier) => (
                    <BlockStack key={tier.name} gap="200">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {tier.name}
                      </Text>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                      }}>
                        <div style={{
                          flex: 1,
                          height: '8px',
                          background: '#F1F1F1',
                          borderRadius: '4px',
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            height: '100%',
                            background: '#4F46E5',
                            width: `${Math.min((tier.count / Math.max(stats.totalCustomers, 1)) * 100, 100)}%`
                          }} />
                        </div>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {tier.count} members • {formatPercent(tier.cashbackPercent)}
                        </Text>
                      </div>
                    </BlockStack>
                  ))}
                </BlockStack>
              ) : (
                <Text as="p" tone="subdued">
                  No tiers configured yet
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        
        {/* Recent Transactions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                Recent Transactions
              </Text>
              {recentTransactions.length > 0 ? (
                <DataTable
                  columnContentTypes={['text', 'text', 'numeric', 'numeric']}
                  headings={['Date', 'Customer', 'Order', 'Cashback']}
                  rows={transactionRows}
                />
              ) : (
                <Text as="p" tone="subdued">
                  No transactions yet
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}