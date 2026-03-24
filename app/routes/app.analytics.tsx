import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineGrid,
  Badge,
  Box,
  Divider,
  ProgressBar,
  DataTable,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getAnalyticsDashboard } from "../services/analytics.server";
import { StatCard } from "../components/StatCard";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const data = await getAnalyticsDashboard(session.shop);
  return json(data);
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export default function Analytics() {
  const { overview, tierActivity, storeCredit } =
    useLoaderData<typeof loader>();

  return (
    <Page
      title="Analytics"
      subtitle="Key metrics for your rewards program"
    >
      <Layout>
        {/* ── Overview ── */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Overview
            </Text>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
              <StatCard
                title="Member Revenue"
                value={formatCurrency(overview.memberRevenue)}
              />
              <StatCard
                title="Revenue per Member"
                value={formatCurrency(overview.revenuePerMember)}
              />
              <StatCard
                title="MoM Growth"
                value={formatPercent(overview.monthOverMonthGrowth)}
                trend={overview.monthOverMonthGrowth > 0 ? "up" : "down"}
                trendValue={
                  (overview.monthOverMonthGrowth > 0 ? "+" : "") +
                  formatPercent(overview.monthOverMonthGrowth)
                }
              />
              <StatCard
                title="Members"
                value={String(overview.memberCount)}
              />
              <StatCard
                title="Repeat Purchase Rate"
                value={formatPercent(overview.repeatPurchaseRate)}
                trend={overview.repeatPurchaseRate > 50 ? "up" : "down"}
              />
              <StatCard
                title="Purchases / Member / Year"
                value={overview.purchasesPerMemberPerYear.toFixed(1)}
              />
            </InlineGrid>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Divider />
        </Layout.Section>

        {/* ── Tier Performance ── */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Tier Performance
            </Text>

            <Card>
              <Box padding="400">
                <DataTable
                  columnContentTypes={[
                    "text",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                    "numeric",
                    "text",
                  ]}
                  headings={[
                    "Tier",
                    "Customers",
                    "% of Base",
                    "Avg Annual Spend",
                    "AOV",
                    "Retention",
                    "Health",
                  ]}
                  rows={tierActivity.tierMetrics.map((tier) => [
                    tier.tierName,
                    String(tier.totalCustomers),
                    formatPercent(tier.percentOfBase),
                    formatCurrency(tier.avgAnnualSpend),
                    formatCurrency(tier.avgOrderValue),
                    formatPercent(tier.retentionRate),
                    <Badge
                      key={tier.tierId}
                      tone={
                        tier.retentionRate > 70
                          ? "success"
                          : tier.retentionRate > 50
                            ? "attention"
                            : "critical"
                      }
                    >
                      {tier.retentionRate > 70
                        ? "High"
                        : tier.retentionRate > 50
                          ? "Medium"
                          : "Low"}
                    </Badge>,
                  ])}
                />
              </Box>
            </Card>

            {/* Tier movement + revenue side by side */}
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <Card>
                <Box padding="400">
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      Movement (30 days)
                    </Text>
                    <InlineGrid columns={2} gap="400">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Upgraded
                        </Text>
                        <Text
                          as="p"
                          variant="headingLg"
                          fontWeight="bold"
                          tone="success"
                        >
                          {tierActivity.tierMovement.upgradedCount}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="200">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Downgraded
                        </Text>
                        <Text
                          as="p"
                          variant="headingLg"
                          fontWeight="bold"
                          tone="critical"
                        >
                          {tierActivity.tierMovement.downgradedCount}
                        </Text>
                      </BlockStack>
                    </InlineGrid>
                  </BlockStack>
                </Box>
              </Card>

              <Card>
                <Box padding="400">
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      Revenue by Tier
                    </Text>
                    {tierActivity.tierRevenue.map((tier) => (
                      <BlockStack gap="100" key={tier.tierId}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <Text as="p" variant="bodySm">
                            {tier.tierName}
                          </Text>
                          <Text
                            as="p"
                            variant="bodySm"
                            fontWeight="semibold"
                          >
                            {formatPercent(tier.percentOfTotalRevenue)}
                          </Text>
                        </div>
                        <ProgressBar
                          progress={tier.percentOfTotalRevenue}
                          size="small"
                        />
                      </BlockStack>
                    ))}
                  </BlockStack>
                </Box>
              </Card>
            </InlineGrid>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Divider />
        </Layout.Section>

        {/* ── Store Credit Health ── */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Store Credit
            </Text>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
              <StatCard
                title="Total Earned"
                value={formatCurrency(storeCredit.totalEarned)}
              />
              <StatCard
                title="Earned (30 days)"
                value={formatCurrency(storeCredit.currentPeriodEarned)}
              />
              <StatCard
                title="Avg per Transaction"
                value={formatCurrency(storeCredit.avgPerTransaction)}
              />
              <StatCard
                title="Total Redeemed"
                value={formatCurrency(storeCredit.totalRedeemed)}
              />
              <StatCard
                title="Redemption Rate"
                value={formatPercent(storeCredit.redemptionRate)}
                trend={storeCredit.redemptionRate > 50 ? "up" : "down"}
              />
              <StatCard
                title="Outstanding Liability"
                value={formatCurrency(storeCredit.outstandingLiability)}
              />
            </InlineGrid>

            <Card>
              <Box padding="400">
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Members with Balance
                    </Text>
                    <Text as="p" variant="headingMd" fontWeight="bold">
                      {storeCredit.membersWithBalance}
                    </Text>
                    <Badge>
                      {formatPercent(storeCredit.percentMembersWithBalance)}
                    </Badge>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Credit Orders (30 days)
                    </Text>
                    <Text as="p" variant="headingMd" fontWeight="bold">
                      {storeCredit.ordersUsingCredits}
                    </Text>
                  </BlockStack>
                </InlineGrid>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
