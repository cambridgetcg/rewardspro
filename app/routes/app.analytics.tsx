import type { LoaderFunctionArgs } from "@remix-run/node";
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
  Icon,
} from "@shopify/polaris";
import {
  TrendingUpIcon,
  TrendingDownIcon,
  CashDollarIcon,
  CustomersIcon,
  AnalyticsIcon,
  CalendarIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getAnalyticsDashboard } from "../services/analytics.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const analytics = await getAnalyticsDashboard(session.shop);
  
  return {
    ...analytics,
    shopDomain: session.shop
  };
}

// Utility functions
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

// Metric Card Component
function MetricCard({ 
  title, 
  value, 
  subtitle, 
  trend, 
  trendValue,
  icon 
}: {
  title: string;
  value: string;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: any;
}) {
  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="300">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {icon && <Icon source={icon} tone="base" />}
            <Text as="h3" variant="headingSm" tone="subdued">
              {title}
            </Text>
          </div>
          <Text as="p" variant="heading2xl" fontWeight="bold">
            {value}
          </Text>
          {(subtitle || trendValue) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {trend && (
                <Icon 
                  source={trend === 'up' ? TrendingUpIcon : TrendingDownIcon} 
                  tone={trend === 'up' ? 'success' : 'critical'}
                />
              )}
              {trendValue && (
                <Badge tone={trend === 'up' ? 'success' : trend === 'down' ? 'critical' : 'info'}>
                  {trendValue}
                </Badge>
              )}
              {subtitle && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {subtitle}
                </Text>
              )}
            </div>
          )}
        </BlockStack>
      </Box>
    </Card>
  );
}

// Tier Performance Table Component
function TierPerformanceTable({ tiers }: { tiers: any[] }) {
  const rows = tiers.map(tier => [
    tier.tierName,
    `${tier.totalCustomers}`,
    formatPercent(tier.percentOfBase),
    formatCurrency(tier.avgAnnualSpend),
    formatCurrency(tier.avgOrderValue),
    `${tier.avgPurchaseFrequency.toFixed(1)}`,
    formatPercent(tier.retentionRate),
    <Badge tone={tier.retentionRate > 70 ? "success" : tier.retentionRate > 50 ? "warning" : "critical"}>
      {tier.retentionRate > 70 ? "High" : tier.retentionRate > 50 ? "Medium" : "Low"}
    </Badge>
  ]);

  return (
    <DataTable
      columnContentTypes={['text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric', 'text']}
      headings={['Tier', 'Customers', '% of Base', 'Avg Annual Spend', 'AOV', 'Purchase Freq', 'Retention', 'Health']}
      rows={rows}
    />
  );
}

export default function Analytics() {
  const { businessGrowth, tierActivity, storeCredit, programHealth } = useLoaderData<typeof loader>();

  return (
    <Page 
      title="Analytics Dashboard"
      subtitle="Comprehensive metrics for your rewards program"
    >
      <Layout>
        {/* Business Growth Section */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              📈 Business Growth Metrics
            </Text>
            
            {/* Revenue Metrics */}
            <Text as="h3" variant="headingMd">Revenue Impact</Text>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="400">
              <MetricCard
                title="Member Revenue"
                value={formatCurrency(businessGrowth.revenue.totalFromMembers)}
                icon={CashDollarIcon}
              />
              <MetricCard
                title="Non-Member Revenue"
                value={formatCurrency(businessGrowth.revenue.totalFromNonMembers)}
                subtitle="For comparison"
              />
              <MetricCard
                title="Incremental Revenue"
                value={formatCurrency(businessGrowth.revenue.incrementalRevenue)}
                trend={businessGrowth.revenue.incrementalRevenue > 0 ? 'up' : 'down'}
              />
              <MetricCard
                title="Revenue per Member"
                value={formatCurrency(businessGrowth.revenue.revenuePerMember)}
              />
              <MetricCard
                title="MoM Growth"
                value={formatPercent(businessGrowth.revenue.monthOverMonthGrowth)}
                trend={businessGrowth.revenue.monthOverMonthGrowth > 0 ? 'up' : 'down'}
                trendValue={businessGrowth.revenue.monthOverMonthGrowth > 0 ? '+' + formatPercent(businessGrowth.revenue.monthOverMonthGrowth) : formatPercent(businessGrowth.revenue.monthOverMonthGrowth)}
              />
              <MetricCard
                title="YoY Growth"
                value={formatPercent(businessGrowth.revenue.yearOverYearGrowth)}
                trend={businessGrowth.revenue.yearOverYearGrowth > 0 ? 'up' : 'down'}
                trendValue={businessGrowth.revenue.yearOverYearGrowth > 0 ? '+' + formatPercent(businessGrowth.revenue.yearOverYearGrowth) : formatPercent(businessGrowth.revenue.yearOverYearGrowth)}
              />
            </InlineGrid>

            <Divider />

            {/* CLV Metrics */}
            <Text as="h3" variant="headingMd">Customer Lifetime Value</Text>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
              <MetricCard
                title="Avg CLV (Members)"
                value={formatCurrency(businessGrowth.clv.averageClvMembers)}
                icon={CustomersIcon}
              />
              <MetricCard
                title="Avg CLV (Non-Members)"
                value={formatCurrency(businessGrowth.clv.averageClvNonMembers)}
              />
              <MetricCard
                title="CLV Multiplier"
                value={`${businessGrowth.clv.clvMultiplier.toFixed(2)}x`}
                subtitle="Members vs Non-Members"
                trend={businessGrowth.clv.clvMultiplier > 1.5 ? 'up' : 'down'}
              />
              <MetricCard
                title="Projected 12-Month CLV"
                value={formatCurrency(businessGrowth.clv.projected12MonthClv)}
              />
            </InlineGrid>

            <Divider />

            {/* Purchase Frequency */}
            <Text as="h3" variant="headingMd">Purchase Frequency</Text>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
              <MetricCard
                title="Days Between (Members)"
                value={`${businessGrowth.purchaseFrequency.avgDaysBetweenPurchasesMembers.toFixed(0)} days`}
                icon={CalendarIcon}
              />
              <MetricCard
                title="Days Between (Non-Members)"
                value={`${businessGrowth.purchaseFrequency.avgDaysBetweenPurchasesNonMembers.toFixed(0)} days`}
              />
              <MetricCard
                title="Purchases/Member/Month"
                value={businessGrowth.purchaseFrequency.purchasesPerMemberPerMonth.toFixed(2)}
              />
              <MetricCard
                title="Purchases/Member/Year"
                value={businessGrowth.purchaseFrequency.purchasesPerMemberPerYear.toFixed(1)}
              />
              <MetricCard
                title="Repeat Purchase Rate"
                value={formatPercent(businessGrowth.purchaseFrequency.repeatPurchaseRate)}
                trend={businessGrowth.purchaseFrequency.repeatPurchaseRate > 60 ? 'up' : 'down'}
              />
              <MetricCard
                title="First→Second Purchase"
                value={formatPercent(businessGrowth.purchaseFrequency.firstToSecondPurchaseRate)}
                subtitle="Conversion rate"
              />
            </InlineGrid>
          </BlockStack>
        </Layout.Section>

        {/* Tier Activity Section */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              🎯 Customer Activity by Tier
            </Text>

            {/* Tier Performance Table */}
            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">Tier Performance Metrics</Text>
                  <TierPerformanceTable tiers={tierActivity.tierMetrics} />
                </BlockStack>
              </Box>
            </Card>

            {/* Tier Movement */}
            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">Tier Movement (Last 30 Days)</Text>
                  <InlineGrid columns={{ xs: 2, md: 3, lg: 6 }} gap="400">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">Upgraded</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                        {tierActivity.tierMovement.upgradedCount}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">Downgraded</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                        {tierActivity.tierMovement.downgradedCount}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">At Risk</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="warning">
                        {tierActivity.tierMovement.atRiskCount}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">Close to Upgrade</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="info">
                        {tierActivity.tierMovement.closeToUpgradeCount}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">Upgrade Rate</Text>
                      <Badge tone="success">{formatPercent(tierActivity.tierMovement.upgradeRate)}</Badge>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">Downgrade Rate</Text>
                      <Badge tone="critical">{formatPercent(tierActivity.tierMovement.downgradeRate)}</Badge>
                    </BlockStack>
                  </InlineGrid>
                </BlockStack>
              </Box>
            </Card>

            {/* Tier Revenue Contribution */}
            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">Revenue Contribution by Tier</Text>
                  {tierActivity.tierRevenue.map(tier => (
                    <div key={tier.tierId}>
                      <BlockStack gap="200">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {tier.tierName}
                          </Text>
                          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <Badge>{formatPercent(tier.percentOfTotalRevenue)} of total</Badge>
                            <Text as="p" variant="bodyMd" fontWeight="bold">
                              {formatCurrency(tier.totalRevenue)}
                            </Text>
                          </div>
                        </div>
                        <ProgressBar progress={tier.percentOfTotalRevenue} size="small" />
                      </BlockStack>
                    </div>
                  ))}
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Store Credit Activity */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              💰 Store Credit Activity
            </Text>

            {/* Credits Earned */}
            <Text as="h3" variant="headingMd">Credits Earned</Text>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
              <MetricCard
                title="Total Earned (All Time)"
                value={formatCurrency(storeCredit.earned.totalAllTime)}
                icon={CashDollarIcon}
              />
              <MetricCard
                title="Current Period"
                value={formatCurrency(storeCredit.earned.currentPeriod)}
                subtitle="Last 30 days"
              />
              <MetricCard
                title="Last Period"
                value={formatCurrency(storeCredit.earned.lastPeriod)}
                subtitle="30-60 days ago"
              />
              <MetricCard
                title="Avg per Member"
                value={formatCurrency(storeCredit.earned.avgPerMember)}
              />
              <MetricCard
                title="Avg per Transaction"
                value={formatCurrency(storeCredit.earned.avgPerTransaction)}
              />
              <MetricCard
                title="Transactions Earning"
                value={formatNumber(storeCredit.earned.transactionsEarningCredits)}
                subtitle={`${formatPercent(storeCredit.earned.percentTransactionsEarning)} of total`}
              />
            </InlineGrid>

            <Divider />

            {/* Credits Redeemed */}
            <Text as="h3" variant="headingMd">Credits Redeemed</Text>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
              <MetricCard
                title="Total Redeemed"
                value={formatCurrency(storeCredit.redeemed.totalAllTime)}
              />
              <MetricCard
                title="Current Period"
                value={formatCurrency(storeCredit.redeemed.currentPeriod)}
                subtitle="Last 30 days"
              />
              <MetricCard
                title="Avg Redemption"
                value={formatCurrency(storeCredit.redeemed.avgRedemptionValue)}
                subtitle="Per transaction"
              />
              <MetricCard
                title="Orders Using Credits"
                value={formatNumber(storeCredit.redeemed.ordersUsingCredits)}
                subtitle={`${formatPercent(storeCredit.redeemed.percentOrdersUsingCredits)} of orders`}
              />
              <MetricCard
                title="Days to Redeem"
                value={`${storeCredit.redeemed.avgDaysEarnToRedeem} days`}
                subtitle="Avg earn to redeem"
              />
            </InlineGrid>

            <Divider />

            {/* Credit Economics */}
            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">Credit Economics</Text>
                  <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">Redemption Rate</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {formatPercent(storeCredit.economics.redemptionRate)}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">Breakage Rate</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {formatPercent(storeCredit.economics.breakageRate)}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">Outstanding Liability</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold" tone="warning">
                        {formatCurrency(storeCredit.economics.outstandingLiability)}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">Revenue per Credit $</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        ${storeCredit.economics.revenuePerCreditDollar}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">Avg Balance/Member</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {formatCurrency(storeCredit.economics.avgBalancePerMember)}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">Members w/ Balance</Text>
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {storeCredit.economics.membersWithBalance}
                      </Text>
                      <Badge>{formatPercent(storeCredit.economics.percentMembersWithBalance)}</Badge>
                    </BlockStack>
                  </InlineGrid>
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Program Health */}
        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              ❤️ Program Health
            </Text>

            <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 6 }} gap="400">
              <MetricCard
                title="Total Members"
                value={formatNumber(programHealth.totalMembers)}
                icon={CustomersIcon}
              />
              <MetricCard
                title="Active (30d)"
                value={formatNumber(programHealth.activeMembers30Day)}
                subtitle={`${((programHealth.activeMembers30Day / programHealth.totalMembers) * 100).toFixed(0)}% of total`}
              />
              <MetricCard
                title="Active (90d)"
                value={formatNumber(programHealth.activeMembers90Day)}
                subtitle={`${((programHealth.activeMembers90Day / programHealth.totalMembers) * 100).toFixed(0)}% of total`}
              />
              <MetricCard
                title="New Members"
                value={formatNumber(programHealth.newMembersThisPeriod)}
                subtitle="Last 30 days"
              />
              <MetricCard
                title="Enrollment Rate"
                value={formatPercent(programHealth.enrollmentRate)}
                trend={programHealth.enrollmentRate > 30 ? 'up' : 'down'}
              />
              <MetricCard
                title="Activation Rate"
                value={formatPercent(programHealth.activationRate)}
                subtitle="Made first purchase"
                trend={programHealth.activationRate > 70 ? 'up' : 'down'}
              />
            </InlineGrid>

            {/* Activity Trends */}
            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">Activity Trends</Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Daily Active Members (Last 30 Days)
                    </Text>
                    <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: '60px' }}>
                      {programHealth.dailyActiveMembers.map((value, index) => (
                        <div
                          key={index}
                          style={{
                            flex: 1,
                            background: '#4F46E5',
                            height: `${(value / Math.max(...programHealth.dailyActiveMembers)) * 100}%`,
                            borderRadius: '2px',
                            minHeight: '2px'
                          }}
                        />
                      ))}
                    </div>
                  </BlockStack>
                  
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Weekly Revenue Trend (Last 12 Weeks)
                    </Text>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', height: '60px' }}>
                      {programHealth.weeklyRevenue.map((value, index) => (
                        <div
                          key={index}
                          style={{
                            flex: 1,
                            background: '#10B981',
                            height: `${(value / Math.max(...programHealth.weeklyRevenue)) * 100}%`,
                            borderRadius: '2px',
                            minHeight: '2px'
                          }}
                        />
                      ))}
                    </div>
                  </BlockStack>
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Industry Benchmarks */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  📊 Industry Benchmarks
                </Text>
                <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">Your Redemption Rate</Text>
                    <Text as="p" variant="headingMd" fontWeight="bold">
                      {formatPercent(storeCredit.economics.redemptionRate)}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Industry Average: 65-75%
                    </Text>
                    <Badge tone={storeCredit.economics.redemptionRate >= 65 ? "success" : "warning"}>
                      {storeCredit.economics.redemptionRate >= 65 ? "Above Average" : "Below Average"}
                    </Badge>
                  </BlockStack>
                  
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">Your CLV Multiplier</Text>
                    <Text as="p" variant="headingMd" fontWeight="bold">
                      {businessGrowth.clv.clvMultiplier.toFixed(2)}x
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Industry Average: 2.5-3.5x
                    </Text>
                    <Badge tone={businessGrowth.clv.clvMultiplier >= 2.5 ? "success" : "warning"}>
                      {businessGrowth.clv.clvMultiplier >= 2.5 ? "Above Average" : "Below Average"}
                    </Badge>
                  </BlockStack>
                  
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">Your Purchase Frequency</Text>
                    <Text as="p" variant="headingMd" fontWeight="bold">
                      {businessGrowth.purchaseFrequency.purchasesPerMemberPerYear.toFixed(1)}/year
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Industry Average: 3-5/year
                    </Text>
                    <Badge tone={businessGrowth.purchaseFrequency.purchasesPerMemberPerYear >= 3 ? "success" : "warning"}>
                      {businessGrowth.purchaseFrequency.purchasesPerMemberPerYear >= 3 ? "Above Average" : "Below Average"}
                    </Badge>
                  </BlockStack>
                </InlineGrid>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}