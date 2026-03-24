import type { LoaderFunctionArgs } from "@remix-run/node";
import { defer } from "@remix-run/node";
import { useLoaderData, Await } from "@remix-run/react";
import { Suspense } from "react";
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
  SkeletonBodyText,
  SkeletonDisplayText,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { AnalyticsService } from "../services/analytics.server";
import type {
  BusinessGrowthMetrics,
  TierActivityMetrics,
  StoreCreditMetrics,
  ProgramHealthMetrics,
} from "../services/analytics.server";
import { StatCard } from "../components/StatCard";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const service = new AnalyticsService(session.shop);

  // Program health + tier activity are lighter — resolve immediately
  // Business growth + store credit are heavier — defer/stream them
  const [tierActivity, programHealth] = await Promise.all([
    service.getTierActivityMetrics(),
    service.getProgramHealthMetrics(),
  ]);

  return defer({
    tierActivity,
    programHealth,
    shopDomain: session.shop,
    // Deferred — these stream in after the shell renders
    businessGrowth: service.getBusinessGrowthMetrics(),
    storeCredit: service.getStoreCreditMetrics(),
  });
}

// Utility functions
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function LoadingSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="400">
          <SkeletonDisplayText size="small" />
          <SkeletonBodyText lines={lines} />
        </BlockStack>
      </Box>
    </Card>
  );
}

// Tier Performance Table
function TierPerformanceTable({ tiers }: { tiers: TierActivityMetrics["tierMetrics"] }) {
  const rows = tiers.map((tier) => [
    tier.tierName,
    `${tier.totalCustomers}`,
    formatPercent(tier.percentOfBase),
    formatCurrency(tier.avgAnnualSpend),
    formatCurrency(tier.avgOrderValue),
    `${tier.avgPurchaseFrequency.toFixed(1)}`,
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
  ]);

  return (
    <DataTable
      columnContentTypes={[
        "text",
        "numeric",
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
        "Purchase Freq",
        "Retention",
        "Health",
      ]}
      rows={rows}
    />
  );
}

// Business Growth Section (deferred)
function BusinessGrowthSection({ data }: { data: BusinessGrowthMetrics }) {
  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        📈 Business Growth Metrics
      </Text>

      <Text as="h3" variant="headingMd">
        Revenue Impact
      </Text>
      <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
        <StatCard
          title="Member Revenue"
          value={formatCurrency(data.revenue.totalFromMembers)}
        />
        <StatCard
          title="Non-Member Revenue"
          value={formatCurrency(data.revenue.totalFromNonMembers)}
          subtitle="For comparison"
        />
        <StatCard
          title="Incremental Revenue"
          value={formatCurrency(data.revenue.incrementalRevenue)}
          trend={data.revenue.incrementalRevenue > 0 ? "up" : "down"}
        />
        <StatCard
          title="Revenue per Member"
          value={formatCurrency(data.revenue.revenuePerMember)}
        />
        <StatCard
          title="MoM Growth"
          value={formatPercent(data.revenue.monthOverMonthGrowth)}
          trend={data.revenue.monthOverMonthGrowth > 0 ? "up" : "down"}
          trendValue={
            (data.revenue.monthOverMonthGrowth > 0 ? "+" : "") +
            formatPercent(data.revenue.monthOverMonthGrowth)
          }
        />
        <StatCard
          title="YoY Growth"
          value={formatPercent(data.revenue.yearOverYearGrowth)}
          trend={data.revenue.yearOverYearGrowth > 0 ? "up" : "down"}
          trendValue={
            (data.revenue.yearOverYearGrowth > 0 ? "+" : "") +
            formatPercent(data.revenue.yearOverYearGrowth)
          }
        />
      </InlineGrid>

      <Divider />

      <Text as="h3" variant="headingMd">
        Customer Lifetime Value
      </Text>
      <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
        <StatCard
          title="Avg CLV (Members)"
          value={formatCurrency(data.clv.averageClvMembers)}
        />
        <StatCard
          title="Avg CLV (Non-Members)"
          value={formatCurrency(data.clv.averageClvNonMembers)}
        />
        <StatCard
          title="CLV Multiplier"
          value={`${data.clv.clvMultiplier.toFixed(2)}x`}
          subtitle="Members vs Non-Members"
          trend={data.clv.clvMultiplier > 1.5 ? "up" : "down"}
        />
        <StatCard
          title="Projected 12-Month CLV"
          value={formatCurrency(data.clv.projected12MonthClv)}
        />
      </InlineGrid>

      <Divider />

      <Text as="h3" variant="headingMd">
        Purchase Frequency
      </Text>
      <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
        <StatCard
          title="Days Between (Members)"
          value={`${data.purchaseFrequency.avgDaysBetweenPurchasesMembers.toFixed(0)} days`}
        />
        <StatCard
          title="Days Between (Non-Members)"
          value={`${data.purchaseFrequency.avgDaysBetweenPurchasesNonMembers.toFixed(0)} days`}
        />
        <StatCard
          title="Purchases/Member/Month"
          value={data.purchaseFrequency.purchasesPerMemberPerMonth.toFixed(2)}
        />
        <StatCard
          title="Purchases/Member/Year"
          value={data.purchaseFrequency.purchasesPerMemberPerYear.toFixed(1)}
        />
        <StatCard
          title="Repeat Purchase Rate"
          value={formatPercent(data.purchaseFrequency.repeatPurchaseRate)}
          trend={data.purchaseFrequency.repeatPurchaseRate > 60 ? "up" : "down"}
        />
        <StatCard
          title="First→Second Purchase"
          value={formatPercent(data.purchaseFrequency.firstToSecondPurchaseRate)}
          subtitle="Conversion rate"
        />
      </InlineGrid>
    </BlockStack>
  );
}

// Store Credit Section (deferred)
function StoreCreditSection({ data }: { data: StoreCreditMetrics }) {
  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        💰 Store Credit Activity
      </Text>

      <Text as="h3" variant="headingMd">
        Credits Earned
      </Text>
      <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
        <StatCard
          title="Total Earned (All Time)"
          value={formatCurrency(data.earned.totalAllTime)}
        />
        <StatCard
          title="Current Period"
          value={formatCurrency(data.earned.currentPeriod)}
          subtitle="Last 30 days"
        />
        <StatCard
          title="Last Period"
          value={formatCurrency(data.earned.lastPeriod)}
          subtitle="30-60 days ago"
        />
        <StatCard
          title="Avg per Member"
          value={formatCurrency(data.earned.avgPerMember)}
        />
        <StatCard
          title="Avg per Transaction"
          value={formatCurrency(data.earned.avgPerTransaction)}
        />
        <StatCard
          title="Transactions Earning"
          value={formatNumber(data.earned.transactionsEarningCredits)}
          subtitle={`${formatPercent(data.earned.percentTransactionsEarning)} of total`}
        />
      </InlineGrid>

      <Divider />

      <Text as="h3" variant="headingMd">
        Credits Redeemed
      </Text>
      <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
        <StatCard
          title="Total Redeemed"
          value={formatCurrency(data.redeemed.totalAllTime)}
        />
        <StatCard
          title="Current Period"
          value={formatCurrency(data.redeemed.currentPeriod)}
          subtitle="Last 30 days"
        />
        <StatCard
          title="Avg Redemption"
          value={formatCurrency(data.redeemed.avgRedemptionValue)}
          subtitle="Per transaction"
        />
        <StatCard
          title="Orders Using Credits"
          value={formatNumber(data.redeemed.ordersUsingCredits)}
          subtitle={`${formatPercent(data.redeemed.percentOrdersUsingCredits)} of orders`}
        />
      </InlineGrid>

      <Divider />

      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">
              Credit Economics
            </Text>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Redemption Rate
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold">
                  {formatPercent(data.economics.redemptionRate)}
                </Text>
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Breakage Rate
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold">
                  {formatPercent(data.economics.breakageRate)}
                </Text>
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Outstanding Liability
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="caution">
                  {formatCurrency(data.economics.outstandingLiability)}
                </Text>
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Avg Balance/Member
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold">
                  {formatCurrency(data.economics.avgBalancePerMember)}
                </Text>
              </BlockStack>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Members w/ Balance
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold">
                  {data.economics.membersWithBalance}
                </Text>
                <Badge>
                  {formatPercent(data.economics.percentMembersWithBalance)}
                </Badge>
              </BlockStack>
            </InlineGrid>
          </BlockStack>
        </Box>
      </Card>
    </BlockStack>
  );
}

export default function Analytics() {
  const { businessGrowth, tierActivity, storeCredit, programHealth } =
    useLoaderData<typeof loader>();

  return (
    <Page
      title="Analytics Dashboard"
      subtitle="Comprehensive metrics for your rewards program"
    >
      <Layout>
        {/* Business Growth — deferred, streams in */}
        <Layout.Section>
          <Suspense
            fallback={
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  📈 Business Growth Metrics
                </Text>
                <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
                  <LoadingSkeleton />
                  <LoadingSkeleton />
                  <LoadingSkeleton />
                </InlineGrid>
              </BlockStack>
            }
          >
            <Await resolve={businessGrowth}>
              {(data) => <BusinessGrowthSection data={data as BusinessGrowthMetrics} />}
            </Await>
          </Suspense>
        </Layout.Section>

        {/* Tier Activity — rendered immediately */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              🎯 Customer Activity by Tier
            </Text>

            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">
                    Tier Performance Metrics
                  </Text>
                  <TierPerformanceTable tiers={tierActivity.tierMetrics} />
                </BlockStack>
              </Box>
            </Card>

            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">
                    Tier Movement (Last 30 Days)
                  </Text>
                  <InlineGrid
                    columns={{ xs: 2, md: 3, lg: 6 }}
                    gap="400"
                  >
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
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        At Risk
                      </Text>
                      <Text
                        as="p"
                        variant="headingLg"
                        fontWeight="bold"
                        tone="caution"
                      >
                        {tierActivity.tierMovement.atRiskCount}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Close to Upgrade
                      </Text>
                      <Text
                        as="p"
                        variant="headingLg"
                        fontWeight="bold"
                      >
                        {tierActivity.tierMovement.closeToUpgradeCount}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Upgrade Rate
                      </Text>
                      <Badge tone="success">
                        {formatPercent(tierActivity.tierMovement.upgradeRate)}
                      </Badge>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Downgrade Rate
                      </Text>
                      <Badge tone="critical">
                        {formatPercent(
                          tierActivity.tierMovement.downgradeRate,
                        )}
                      </Badge>
                    </BlockStack>
                  </InlineGrid>
                </BlockStack>
              </Box>
            </Card>

            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">
                    Revenue Contribution by Tier
                  </Text>
                  {tierActivity.tierRevenue.map((tier) => (
                    <div key={tier.tierId}>
                      <BlockStack gap="200">
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <Text
                            as="p"
                            variant="bodyMd"
                            fontWeight="semibold"
                          >
                            {tier.tierName}
                          </Text>
                          <div
                            style={{
                              display: "flex",
                              gap: "12px",
                              alignItems: "center",
                            }}
                          >
                            <Badge>{`${formatPercent(tier.percentOfTotalRevenue)} of total`}</Badge>
                            <Text
                              as="p"
                              variant="bodyMd"
                              fontWeight="bold"
                            >
                              {formatCurrency(tier.totalRevenue)}
                            </Text>
                          </div>
                        </div>
                        <ProgressBar
                          progress={tier.percentOfTotalRevenue}
                          size="small"
                        />
                      </BlockStack>
                    </div>
                  ))}
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Store Credit — deferred, streams in */}
        <Layout.Section>
          <Suspense
            fallback={
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  💰 Store Credit Activity
                </Text>
                <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
                  <LoadingSkeleton />
                  <LoadingSkeleton />
                  <LoadingSkeleton />
                </InlineGrid>
              </BlockStack>
            }
          >
            <Await resolve={storeCredit}>
              {(data) => <StoreCreditSection data={data as StoreCreditMetrics} />}
            </Await>
          </Suspense>
        </Layout.Section>

        {/* Program Health — rendered immediately */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              ❤️ Program Health
            </Text>

            <InlineGrid
              columns={{ xs: 1, sm: 2, md: 3, lg: 6 }}
              gap="400"
            >
              <StatCard
                title="Total Members"
                value={formatNumber(programHealth.totalMembers)}
              />
              <StatCard
                title="Active (30d)"
                value={formatNumber(programHealth.activeMembers30Day)}
                subtitle={`${programHealth.totalMembers > 0 ? ((programHealth.activeMembers30Day / programHealth.totalMembers) * 100).toFixed(0) : 0}% of total`}
              />
              <StatCard
                title="Active (90d)"
                value={formatNumber(programHealth.activeMembers90Day)}
                subtitle={`${programHealth.totalMembers > 0 ? ((programHealth.activeMembers90Day / programHealth.totalMembers) * 100).toFixed(0) : 0}% of total`}
              />
              <StatCard
                title="New Members"
                value={formatNumber(programHealth.newMembersThisPeriod)}
                subtitle="Last 30 days"
              />
              <StatCard
                title="Enrollment Rate"
                value={formatPercent(programHealth.enrollmentRate)}
                trend={programHealth.enrollmentRate > 30 ? "up" : "down"}
              />
              <StatCard
                title="Activation Rate"
                value={formatPercent(programHealth.activationRate)}
                subtitle="Made first purchase"
                trend={programHealth.activationRate > 70 ? "up" : "down"}
              />
            </InlineGrid>

            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">
                    Activity Trends
                  </Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Daily Active Members (Last 30 Days)
                    </Text>
                    <div
                      style={{
                        display: "flex",
                        gap: "2px",
                        alignItems: "flex-end",
                        height: "60px",
                      }}
                    >
                      {programHealth.dailyActiveMembers.map(
                        (value, index) => (
                          <div
                            key={index}
                            style={{
                              flex: 1,
                              background: "#4F46E5",
                              height: `${(value / Math.max(...programHealth.dailyActiveMembers)) * 100}%`,
                              borderRadius: "2px",
                              minHeight: "2px",
                            }}
                          />
                        ),
                      )}
                    </div>
                  </BlockStack>

                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Weekly Revenue Trend (Last 12 Weeks)
                    </Text>
                    <div
                      style={{
                        display: "flex",
                        gap: "4px",
                        alignItems: "flex-end",
                        height: "60px",
                      }}
                    >
                      {programHealth.weeklyRevenue.map(
                        (value, index) => (
                          <div
                            key={index}
                            style={{
                              flex: 1,
                              background: "#10B981",
                              height: `${(value / Math.max(...programHealth.weeklyRevenue)) * 100}%`,
                              borderRadius: "2px",
                              minHeight: "2px",
                            }}
                          />
                        ),
                      )}
                    </div>
                  </BlockStack>
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Industry Benchmarks — rendered immediately (uses deferred data) */}
        <Layout.Section>
          <Suspense fallback={<LoadingSkeleton lines={4} />}>
            <Await resolve={businessGrowth}>
              {(bgData) => (
                <Suspense fallback={<LoadingSkeleton lines={4} />}>
                  <Await resolve={storeCredit}>
                    {(scData) => {
                      const bg = bgData as BusinessGrowthMetrics;
                      const sc = scData as StoreCreditMetrics;
                      return (
                        <Card>
                          <Box padding="400">
                            <BlockStack gap="400">
                              <Text as="h2" variant="headingLg">
                                📊 Industry Benchmarks
                              </Text>
                              <InlineGrid
                                columns={{ xs: 1, sm: 3 }}
                                gap="400"
                              >
                                <BlockStack gap="200">
                                  <Text
                                    as="p"
                                    variant="bodySm"
                                    tone="subdued"
                                  >
                                    Your Redemption Rate
                                  </Text>
                                  <Text
                                    as="p"
                                    variant="headingMd"
                                    fontWeight="bold"
                                  >
                                    {formatPercent(
                                      sc.economics.redemptionRate,
                                    )}
                                  </Text>
                                  <Text
                                    as="p"
                                    variant="bodySm"
                                    tone="subdued"
                                  >
                                    Industry Average: 65-75%
                                  </Text>
                                  <Badge
                                    tone={
                                      sc.economics.redemptionRate >= 65
                                        ? "success"
                                        : "attention"
                                    }
                                  >
                                    {sc.economics.redemptionRate >= 65
                                      ? "Above Average"
                                      : "Below Average"}
                                  </Badge>
                                </BlockStack>

                                <BlockStack gap="200">
                                  <Text
                                    as="p"
                                    variant="bodySm"
                                    tone="subdued"
                                  >
                                    Your CLV Multiplier
                                  </Text>
                                  <Text
                                    as="p"
                                    variant="headingMd"
                                    fontWeight="bold"
                                  >
                                    {bg.clv.clvMultiplier.toFixed(2)}x
                                  </Text>
                                  <Text
                                    as="p"
                                    variant="bodySm"
                                    tone="subdued"
                                  >
                                    Industry Average: 2.5-3.5x
                                  </Text>
                                  <Badge
                                    tone={
                                      bg.clv.clvMultiplier >= 2.5
                                        ? "success"
                                        : "attention"
                                    }
                                  >
                                    {bg.clv.clvMultiplier >= 2.5
                                      ? "Above Average"
                                      : "Below Average"}
                                  </Badge>
                                </BlockStack>

                                <BlockStack gap="200">
                                  <Text
                                    as="p"
                                    variant="bodySm"
                                    tone="subdued"
                                  >
                                    Your Purchase Frequency
                                  </Text>
                                  <Text
                                    as="p"
                                    variant="headingMd"
                                    fontWeight="bold"
                                  >
                                    {bg.purchaseFrequency.purchasesPerMemberPerYear.toFixed(
                                      1,
                                    )}
                                    /year
                                  </Text>
                                  <Text
                                    as="p"
                                    variant="bodySm"
                                    tone="subdued"
                                  >
                                    Industry Average: 3-5/year
                                  </Text>
                                  <Badge
                                    tone={
                                      bg.purchaseFrequency
                                        .purchasesPerMemberPerYear >= 3
                                        ? "success"
                                        : "attention"
                                    }
                                  >
                                    {bg.purchaseFrequency
                                      .purchasesPerMemberPerYear >= 3
                                      ? "Above Average"
                                      : "Below Average"}
                                  </Badge>
                                </BlockStack>
                              </InlineGrid>
                            </BlockStack>
                          </Box>
                        </Card>
                      );
                    }}
                  </Await>
                </Suspense>
              )}
            </Await>
          </Suspense>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
