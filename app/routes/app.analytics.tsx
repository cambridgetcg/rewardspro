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
  InlineStack,
  Badge,
  Box,
  Divider,
  ProgressBar,
  IndexTable,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getAnalyticsDashboard } from "../services/analytics.server";
import { HeroMetric } from "../components/HeroMetric";
import { StatCard } from "../components/StatCard";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const data = await getAnalyticsDashboard(session.shop);
  return json(data);
}

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}
function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

export default function Analytics() {
  const { overview, tierActivity, storeCredit } =
    useLoaderData<typeof loader>();

  return (
    <Page title="Analytics">
      <Layout>
        {/* Hero: Member Revenue */}
        <Layout.Section>
          <HeroMetric
            label="Member Revenue"
            value={fmt(overview.memberRevenue)}
            change={
              overview.monthOverMonthGrowth !== 0
                ? {
                    value: pct(Math.abs(overview.monthOverMonthGrowth)),
                    trend: overview.monthOverMonthGrowth > 0 ? "up" : "down",
                  }
                : undefined
            }
            aside={[
              { label: "Per Member", value: fmt(overview.revenuePerMember) },
              { label: "Members", value: String(overview.memberCount) },
              { label: "Repeat Rate", value: pct(overview.repeatPurchaseRate) },
            ]}
          />
        </Layout.Section>

        {/* Supporting metrics */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
            <StatCard
              title="Purchases / Member / Year"
              value={overview.purchasesPerMemberPerYear.toFixed(1)}
            />
            <StatCard
              title="Credit Earned (30d)"
              value={fmt(overview.creditEarnedThisPeriod)}
            />
            <StatCard
              title="Outstanding Liability"
              value={fmt(overview.outstandingLiability)}
            />
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Divider />
        </Layout.Section>

        {/* Tier Performance */}
        <Layout.Section>
          <Card padding="0">
            <Box padding="300">
              <Text as="h2" variant="headingMd">
                Tier Performance
              </Text>
            </Box>
            <IndexTable
              resourceName={{ singular: "tier", plural: "tiers" }}
              itemCount={tierActivity.tierMetrics.length}
              headings={[
                { title: "Tier" },
                { title: "Customers", alignment: "end" },
                { title: "% of Base", alignment: "end" },
                { title: "Avg Spend", alignment: "end" },
                { title: "AOV", alignment: "end" },
                { title: "Retention", alignment: "end" },
                { title: "Health" },
              ]}
              selectable={false}
            >
              {tierActivity.tierMetrics.map((tier, i) => (
                <IndexTable.Row id={tier.tierId} key={tier.tierId} position={i}>
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">{tier.tierName}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" alignment="end">{tier.totalCustomers}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" alignment="end">{pct(tier.percentOfBase)}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" alignment="end">{fmt(tier.avgAnnualSpend)}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" alignment="end">{fmt(tier.avgOrderValue)}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" alignment="end">{pct(tier.retentionRate)}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge
                      tone={
                        tier.retentionRate > 70
                          ? "success"
                          : tier.retentionRate > 50
                            ? "attention"
                            : "critical"
                      }
                    >
                      {tier.retentionRate > 70 ? "High" : tier.retentionRate > 50 ? "Medium" : "Low"}
                    </Badge>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>

        {/* Movement + Revenue side by side */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
            <Card>
              <Box padding="300">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Movement (30d)</Text>
                  <InlineGrid columns={2} gap="300">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Upgraded</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                        {tierActivity.tierMovement.upgradedCount}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Downgraded</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                        {tierActivity.tierMovement.downgradedCount}
                      </Text>
                    </BlockStack>
                  </InlineGrid>
                </BlockStack>
              </Box>
            </Card>

            <Card>
              <Box padding="300">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">Revenue by Tier</Text>
                  {tierActivity.tierRevenue.map((t) => (
                    <BlockStack gap="050" key={t.tierId}>
                      <InlineStack align="space-between">
                        <Text as="p" variant="bodySm">{t.tierName}</Text>
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          {pct(t.percentOfTotalRevenue)}
                        </Text>
                      </InlineStack>
                      <ProgressBar progress={t.percentOfTotalRevenue} size="small" />
                    </BlockStack>
                  ))}
                </BlockStack>
              </Box>
            </Card>
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Divider />
        </Layout.Section>

        {/* Store Credit */}
        <Layout.Section>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Store Credit</Text>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="300">
              <StatCard title="Total Earned" value={fmt(storeCredit.totalEarned)} />
              <StatCard title="Earned (30d)" value={fmt(storeCredit.currentPeriodEarned)} />
              <StatCard title="Avg / Transaction" value={fmt(storeCredit.avgPerTransaction)} />
              <StatCard
                title="Redeemed"
                value={fmt(storeCredit.totalRedeemed)}
              />
              <StatCard
                title="Redemption Rate"
                value={pct(storeCredit.redemptionRate)}
                trend={storeCredit.redemptionRate > 50 ? "up" : "down"}
              />
              <StatCard
                title="Liability"
                value={fmt(storeCredit.outstandingLiability)}
              />
            </InlineGrid>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
