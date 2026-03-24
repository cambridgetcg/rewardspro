import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineGrid,
  InlineStack,
  Badge,
  Box,
  Banner,
  Button,
  DataTable,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";
import { HeroMetric } from "../components/HeroMetric";
import { StatCard } from "../components/StatCard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const [
    totalCustomers,
    totalMembers,
    hasTiers,
    hasTransactions,
    currentRevenue,
    lastRevenue,
    totalCredit,
    creditEarned30d,
    recentTransactions,
  ] = await Promise.all([
    prisma.customer.count({ where: { shopDomain } }),
    prisma.customer.count({
      where: { shopDomain, membershipHistory: { some: { isActive: true } } },
    }),
    prisma.tier.count({ where: { shopDomain, isActive: true } }).then((c) => c > 0),
    prisma.cashbackTransaction.count({ where: { shopDomain } }).then((c) => c > 0),
    prisma.cashbackTransaction.aggregate({
      where: {
        shopDomain,
        createdAt: { gte: thirtyDaysAgo },
        status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] },
      },
      _sum: { orderAmount: true, cashbackAmount: true },
      _count: true,
    }),
    prisma.cashbackTransaction.aggregate({
      where: {
        shopDomain,
        createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] },
      },
      _sum: { orderAmount: true },
    }),
    prisma.customer.aggregate({
      where: { shopDomain },
      _sum: { storeCredit: true },
    }),
    prisma.cashbackTransaction.aggregate({
      where: { shopDomain, createdAt: { gte: thirtyDaysAgo } },
      _sum: { cashbackAmount: true },
    }),
    prisma.cashbackTransaction.findMany({
      where: {
        shopDomain,
        status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { customer: { select: { email: true } } },
    }),
  ]);

  const currentRev = currentRevenue._sum.orderAmount || 0;
  const lastRev = lastRevenue._sum.orderAmount || 0;
  const mom = lastRev > 0 ? ((currentRev - lastRev) / lastRev) * 100 : 0;

  return json({
    shopDomain,
    setup: { hasTiers, hasTransactions, hasCustomers: totalCustomers > 0 },
    hero: {
      revenue30d: currentRev,
      mom,
      orders30d: currentRevenue._count,
      cashback30d: currentRevenue._sum.cashbackAmount || 0,
    },
    stats: {
      totalCustomers,
      totalMembers,
      totalCredit: totalCredit._sum.storeCredit || 0,
      creditEarned30d: creditEarned30d._sum.cashbackAmount || 0,
    },
    recentTransactions: recentTransactions.map((t) => ({
      id: t.id,
      email: t.customer.email,
      orderId: t.shopifyOrderId,
      amount: t.orderAmount,
      cashback: t.cashbackAmount,
      date: t.createdAt,
    })),
  });
};

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function Dashboard() {
  const { setup, hero, stats, recentTransactions } =
    useLoaderData<typeof loader>();

  const needsSetup = !setup.hasTiers;

  return (
    <Page title="Dashboard">
      <Layout>
        {/* Setup banner — dismissible, not the whole page */}
        {needsSetup && (
          <Layout.Section>
            <Banner
              title="Finish setting up RewardsPro"
              tone="warning"
              action={{ content: "Configure Tiers", url: "/app/tiers" }}
            >
              <BlockStack gap="100">
                {!setup.hasTiers && (
                  <Text as="p">
                    → Create at least one cashback tier to start rewarding customers.
                  </Text>
                )}
                {!setup.hasTransactions && setup.hasTiers && (
                  <Text as="p">
                    → Cashback will be calculated automatically when orders come in, or import historical orders.
                  </Text>
                )}
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}

        {/* Hero: Revenue this month */}
        <Layout.Section>
          <HeroMetric
            label="Revenue (30 days)"
            value={fmt(hero.revenue30d)}
            change={
              hero.mom !== 0
                ? {
                    value: `${Math.abs(hero.mom).toFixed(1)}% MoM`,
                    trend: hero.mom > 0 ? "up" : "down",
                  }
                : undefined
            }
            aside={[
              { label: "Orders", value: String(hero.orders30d) },
              { label: "Cashback Paid", value: fmt(hero.cashback30d) },
            ]}
          />
        </Layout.Section>

        {/* Key metrics */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
            <StatCard title="Customers" value={String(stats.totalCustomers)} />
            <StatCard title="Members" value={String(stats.totalMembers)} />
            <StatCard title="Credit Outstanding" value={fmt(stats.totalCredit)} />
            <StatCard title="Credit Earned (30d)" value={fmt(stats.creditEarned30d)} />
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Divider />
        </Layout.Section>

        {/* Recent Transactions */}
        <Layout.Section>
          <Card padding="0">
            <Box padding="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Recent Transactions
                </Text>
                <Button variant="plain" url="/app/analytics">
                  View Analytics →
                </Button>
              </InlineStack>
            </Box>
            {recentTransactions.length > 0 ? (
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "numeric",
                  "numeric",
                  "text",
                ]}
                headings={["Customer", "Order", "Amount", "Cashback", "Date"]}
                rows={recentTransactions.map((t) => [
                  t.email,
                  `#${t.orderId}`,
                  fmt(t.amount),
                  <Text key={t.id} as="span" tone="success">
                    +{fmt(t.cashback)}
                  </Text>,
                  new Date(t.date).toLocaleDateString(),
                ])}
              />
            ) : (
              <Box padding="600">
                <Text as="p" tone="subdued" alignment="center">
                  No transactions yet. They'll appear here as orders come in.
                </Text>
              </Box>
            )}
          </Card>
        </Layout.Section>

        {/* Quick actions */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
            <Card>
              <Box padding="300">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Manage Tiers</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Configure cashback rates and spending thresholds
                  </Text>
                  <Button url="/app/tiers" fullWidth>Tiers →</Button>
                </BlockStack>
              </Box>
            </Card>
            <Card>
              <Box padding="300">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Customers</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    View tiers, credit balances, and spending
                  </Text>
                  <Button url="/app/customers/tiers" fullWidth>Customers →</Button>
                </BlockStack>
              </Box>
            </Card>
            <Card>
              <Box padding="300">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Import Orders</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Backfill cashback from historical orders
                  </Text>
                  <Button url="/app/import-orders" fullWidth>Import →</Button>
                </BlockStack>
              </Box>
            </Card>
          </InlineGrid>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
