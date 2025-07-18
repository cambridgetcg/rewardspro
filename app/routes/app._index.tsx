// app/routes/app._index.tsx
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  DataTable,
  Box,
  InlineGrid,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // Get statistics
  const [totalCustomers, totalTransactions, stats] = await Promise.all([
    db.customer.count(),
    db.cashbackTransaction.count(),
    db.customer.aggregate({
      _sum: {
        storeCredit: true,
        totalEarned: true
      }
    })
  ]);

  // Get recent transactions
  const recentTransactions = await db.cashbackTransaction.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: { customer: true }
  });

  return json({
    stats: {
      totalCustomers,
      totalTransactions,
      totalStoreCredit: stats._sum.storeCredit || 0,
      totalEarned: stats._sum.totalEarned || 0
    },
    recentTransactions: recentTransactions.map(t => ({
      id: t.id,
      customerEmail: t.customer.email,
      orderId: t.shopifyOrderId,
      orderAmount: t.orderAmount,
      cashbackAmount: t.cashbackAmount,
      date: t.createdAt
    }))
  });
};

export default function Index() {
  const { stats, recentTransactions } = useLoaderData<typeof loader>();

  const rows = recentTransactions.map(transaction => [
    transaction.customerEmail,
    `#${transaction.orderId}`,
    `$${transaction.orderAmount.toFixed(2)}`,
    `$${transaction.cashbackAmount.toFixed(2)}`,
    new Date(transaction.date).toLocaleDateString()
  ]);

  return (
    <Page title="RewardsPro Dashboard">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <InlineGrid columns={4} gap="400">
              <Card>
                <Box padding="400">
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">Total Customers</Text>
                    <Text variant="heading2xl" as="p">{stats.totalCustomers}</Text>
                  </BlockStack>
                </Box>
              </Card>
              
              <Card>
                <Box padding="400">
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">Total Transactions</Text>
                    <Text variant="heading2xl" as="p">{stats.totalTransactions}</Text>
                  </BlockStack>
                </Box>
              </Card>
              
              <Card>
                <Box padding="400">
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">Active Store Credit</Text>
                    <Text variant="heading2xl" as="p">${stats.totalStoreCredit.toFixed(2)}</Text>
                  </BlockStack>
                </Box>
              </Card>
              
              <Card>
                <Box padding="400">
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3">Total Earned</Text>
                    <Text variant="heading2xl" as="p">${stats.totalEarned.toFixed(2)}</Text>
                  </BlockStack>
                </Box>
              </Card>
            </InlineGrid>

            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text variant="headingLg" as="h2">Recent Cashback Transactions</Text>
                  <Badge tone="info">10% Cashback on All Orders</Badge>
                  
                  {rows.length > 0 ? (
                    <DataTable
                      columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                      headings={['Customer', 'Order ID', 'Order Amount', 'Cashback', 'Date']}
                      rows={rows}
                    />
                  ) : (
                    <Text as="p" tone="subdued">No transactions yet</Text>
                  )}
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}