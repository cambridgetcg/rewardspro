import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  Form,
  useNavigation,
  Link,
} from "@remix-run/react";
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
  DataTable,
  Banner,
  ProgressBar,
  Divider,
  Tabs,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getCustomerTierInfo } from "../services/customer-tier.server";
import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";
import type { LedgerEntryType, LedgerSource } from "@prisma/client";
import { useState, useEffect } from "react";
import { StatCard } from "../components/StatCard";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const customerId = params.id;
  const shopDomain = session.shop;

  if (!customerId) {
    throw new Response("Customer ID required", { status: 400 });
  }

  // Parallel: customer data + tier info + stats + Shopify credit accounts
  const [customer, tierInfo, lifetimeStats] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        transactions: {
          where: {
            status: {
              in: [
                TransactionStatus.COMPLETED,
                TransactionStatus.SYNCED_TO_SHOPIFY,
              ],
            },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        creditLedger: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    }),
    getCustomerTierInfo(customerId, shopDomain),
    prisma.cashbackTransaction.aggregate({
      where: {
        customerId,
        status: {
          in: [
            TransactionStatus.COMPLETED,
            TransactionStatus.SYNCED_TO_SHOPIFY,
          ],
        },
      },
      _sum: { orderAmount: true, cashbackAmount: true },
      _avg: { orderAmount: true },
      _count: true,
    }),
  ]);

  if (!customer || customer.shopDomain !== shopDomain) {
    throw new Response("Customer not found", { status: 404 });
  }

  // Fetch Shopify store credit accounts
  let storeCreditAccounts: Array<{
    id: string;
    amount: string;
    currency: string;
  }> = [];
  try {
    const response = await admin.graphql(
      `#graphql
      query getCredit($id: ID!) {
        customer(id: $id) {
          storeCreditAccounts(first: 10) {
            edges { node { id balance { amount currencyCode } } }
          }
        }
      }`,
      {
        variables: {
          id: `gid://shopify/Customer/${customer.shopifyCustomerId}`,
        },
      },
    );
    const result = await response.json();
    storeCreditAccounts =
      result.data?.customer?.storeCreditAccounts?.edges?.map(
        (e: any) => ({
          id: e.node.id,
          amount: e.node.balance.amount,
          currency: e.node.balance.currencyCode,
        }),
      ) || [];
  } catch {
    // Shopify API failure is non-fatal
  }

  return json({
    customer,
    tierInfo,
    stats: {
      lifetimeSpending: lifetimeStats._sum.orderAmount || 0,
      lifetimeCashback: lifetimeStats._sum.cashbackAmount || 0,
      avgOrderValue: lifetimeStats._avg.orderAmount || 0,
      orderCount: lifetimeStats._count,
    },
    storeCreditAccounts,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const customerId = params.id;

  if (!customerId) {
    return json({ success: false, error: "Customer ID required" });
  }

  const formData = await request.formData();
  if (formData.get("actionType") !== "sync") {
    return json({ success: false, error: "Invalid action" });
  }

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer || customer.shopDomain !== session.shop) {
      return json({ success: false, error: "Customer not found" });
    }

    const response = await admin.graphql(
      `#graphql
      query getCredit($id: ID!) {
        customer(id: $id) {
          storeCreditAccounts(first: 10) {
            edges { node { balance { amount currencyCode } } }
          }
        }
      }`,
      {
        variables: {
          id: `gid://shopify/Customer/${customer.shopifyCustomerId}`,
        },
      },
    );
    const result = await response.json();
    const accounts =
      result.data?.customer?.storeCreditAccounts?.edges || [];
    let totalBalance = 0;
    for (const edge of accounts) {
      totalBalance += parseFloat(edge.node.balance.amount);
    }

    const changed = Math.abs(totalBalance - customer.storeCredit) > 0.01;

    if (changed) {
      await prisma.$transaction([
        prisma.storeCreditLedger.create({
          data: {
            customerId: customer.id,
            shopDomain: session.shop,
            amount: totalBalance - customer.storeCredit,
            balance: totalBalance,
            type: "SHOPIFY_SYNC",
            source: "SHOPIFY_ADMIN",
            description: `Sync: $${customer.storeCredit.toFixed(2)} → $${totalBalance.toFixed(2)}`,
            reconciledAt: new Date(),
          },
        }),
        prisma.customer.update({
          where: { id: customerId },
          data: { storeCredit: totalBalance, lastSyncedAt: new Date() },
        }),
      ]);
    } else {
      await prisma.customer.update({
        where: { id: customerId },
        data: { lastSyncedAt: new Date() },
      });
    }

    return json({
      success: true,
      message: changed
        ? `Synced: $${customer.storeCredit.toFixed(2)} → $${totalBalance.toFixed(2)}`
        : `Already up to date ($${totalBalance.toFixed(2)})`,
    });
  } catch (error) {
    return json({
      success: false,
      error:
        error instanceof Error ? error.message : "Sync failed",
    });
  }
}

function formatLedgerType(type: LedgerEntryType): string {
  const map: Record<string, string> = {
    MANUAL_ADJUSTMENT: "Manual",
    SHOPIFY_SYNC: "Sync",
    CASHBACK_EARNED: "Cashback",
    ORDER_PAYMENT: "Payment",
    REFUND_CREDIT: "Refund",
    INITIAL_IMPORT: "Import",
  };
  return map[type] || type;
}

function formatLedgerSource(source: LedgerSource): string {
  const map: Record<string, string> = {
    APP_MANUAL: "App",
    APP_CASHBACK: "Cashback",
    SHOPIFY_ADMIN: "Shopify",
    SHOPIFY_ORDER: "Order",
    RECONCILIATION: "System",
  };
  return map[source] || source;
}

export default function CustomerDetail() {
  const { customer, tierInfo, stats, storeCreditAccounts } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [selectedTab, setSelectedTab] = useState(0);
  const [bannerVisible, setBannerVisible] = useState(false);
  const isSyncing = navigation.state === "submitting";

  useEffect(() => {
    if (actionData) {
      setBannerVisible(true);
      if (actionData.success) {
        const t = setTimeout(() => setBannerVisible(false), 5000);
        return () => clearTimeout(t);
      }
    }
  }, [actionData]);

  const tabs = [
    { id: "overview", content: "Overview" },
    {
      id: "transactions",
      content: `Transactions (${stats.orderCount})`,
    },
    {
      id: "ledger",
      content: `Credit Ledger (${customer.creditLedger.length})`,
    },
  ];

  const syncAge = customer.lastSyncedAt
    ? Math.floor(
        (Date.now() - new Date(customer.lastSyncedAt).getTime()) / 3600000,
      )
    : null;
  const syncLabel = syncAge === null
    ? "Never synced"
    : syncAge < 1
      ? "Recently"
      : syncAge < 24
        ? `${syncAge}h ago`
        : `${Math.floor(syncAge / 24)}d ago`;

  return (
    <Page
      title={customer.email}
      backAction={{ content: "Customers", url: "/app/customers/credit" }}
      primaryAction={{
        content: isSyncing ? "Syncing..." : "Sync with Shopify",
        loading: isSyncing,
        onAction: () => {
          const fd = new FormData();
          fd.append("actionType", "sync");
          // Submit via hidden form below
        },
      }}
    >
      <Layout>
        {bannerVisible && actionData && (
          <Layout.Section>
            <Banner
              tone={actionData.success ? "success" : "critical"}
              onDismiss={() => setBannerVisible(false)}
            >
              {"message" in actionData ? actionData.message : "error" in actionData ? actionData.error : ""}
            </Banner>
          </Layout.Section>
        )}

        {/* Credit Balance Card */}
        <Layout.Section>
          <Card>
            <Box padding="600">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Store Credit Balance
                  </Text>
                  <Text as="p" variant="heading3xl" fontWeight="bold">
                    ${customer.storeCredit.toFixed(2)}
                  </Text>
                  <InlineStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Last synced: {syncLabel}
                    </Text>
                    {(syncAge === null || syncAge > 24) && (
                      <Badge tone="warning">Stale</Badge>
                    )}
                  </InlineStack>
                </BlockStack>
                <Form method="post">
                  <input type="hidden" name="actionType" value="sync" />
                  <Button submit loading={isSyncing}>
                    Sync Now
                  </Button>
                </Form>
              </InlineStack>

              {storeCreditAccounts.length > 0 && (
                <>
                  <Box paddingBlockStart="400">
                    <Divider />
                  </Box>
                  <Box paddingBlockStart="400">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Shopify Accounts
                    </Text>
                    <BlockStack gap="200">
                      {storeCreditAccounts.map((acc) => (
                        <InlineStack
                          key={acc.id}
                          align="space-between"
                        >
                          <Text as="span">{acc.currency}</Text>
                          <Text as="span" fontWeight="semibold">
                            ${parseFloat(acc.amount).toFixed(2)}
                          </Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </Box>
                </>
              )}
            </Box>
          </Card>
        </Layout.Section>

        {/* Stats */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <StatCard
              title="Lifetime Spending"
              value={`$${stats.lifetimeSpending.toFixed(2)}`}
            />
            <StatCard
              title="Total Cashback"
              value={`$${stats.lifetimeCashback.toFixed(2)}`}
            />
            <StatCard
              title="Orders"
              value={String(stats.orderCount)}
            />
            <StatCard
              title="Avg Order Value"
              value={`$${stats.avgOrderValue.toFixed(2)}`}
            />
          </InlineGrid>
        </Layout.Section>

        {/* Tier Info */}
        {tierInfo && (
          <Layout.Section>
            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">
                        {tierInfo.membership.tier.name}
                      </Text>
                      <Text as="p" tone="subdued">
                        {tierInfo.membership.tier.cashbackPercent}% cashback •{" "}
                        {tierInfo.membership.tier.evaluationPeriod ===
                        "LIFETIME"
                          ? "Lifetime"
                          : "Annual"}{" "}
                        tier
                      </Text>
                    </BlockStack>
                    <Badge tone="success">Active</Badge>
                  </InlineStack>

                  {tierInfo.progressInfo && (
                    <>
                      <Divider />
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <Text as="p" variant="bodySm">
                            Progress to{" "}
                            {tierInfo.progressInfo.nextTier.name} (
                            {tierInfo.progressInfo.nextTier.cashbackPercent}
                            %)
                          </Text>
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            {tierInfo.progressInfo.progressPercentage.toFixed(0)}%
                          </Text>
                        </InlineStack>
                        <ProgressBar
                          progress={Math.min(
                            tierInfo.progressInfo.progressPercentage,
                            100,
                          )}
                          size="small"
                        />
                        <InlineStack align="space-between">
                          <Text as="p" variant="bodySm" tone="subdued">
                            $
                            {tierInfo.progressInfo.currentSpending.toFixed(2)}{" "}
                            spent
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            $
                            {tierInfo.progressInfo.remainingSpending.toFixed(
                              2,
                            )}{" "}
                            to go
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    </>
                  )}
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>
        )}

        {/* Tabs: Transactions / Ledger */}
        <Layout.Section>
          <Card>
            <Tabs
              tabs={tabs}
              selected={selectedTab}
              onSelect={setSelectedTab}
            >
              <Box padding="400">
                {selectedTab === 0 && (
                  <Text as="p" tone="subdued">
                    Select the Transactions or Credit Ledger tab to view
                    detailed history.
                  </Text>
                )}

                {selectedTab === 1 && (
                  <>
                    {customer.transactions.length > 0 ? (
                      <DataTable
                        columnContentTypes={[
                          "text",
                          "text",
                          "numeric",
                          "numeric",
                          "numeric",
                          "text",
                        ]}
                        headings={[
                          "Date",
                          "Order",
                          "Amount",
                          "Rate",
                          "Cashback",
                          "Status",
                        ]}
                        rows={customer.transactions.map((t) => [
                          new Date(t.createdAt).toLocaleDateString(),
                          `#${t.shopifyOrderId}`,
                          `$${t.orderAmount.toFixed(2)}`,
                          `${t.cashbackPercent}%`,
                          <Text
                            key={t.id}
                            as="span"
                            tone="success"
                          >
                            +${t.cashbackAmount.toFixed(2)}
                          </Text>,
                          <Badge
                            key={`s-${t.id}`}
                            tone={
                              t.status === "SYNCED_TO_SHOPIFY"
                                ? "success"
                                : "info"
                            }
                          >
                            {t.status === "SYNCED_TO_SHOPIFY"
                              ? "Synced"
                              : "Completed"}
                          </Badge>,
                        ])}
                      />
                    ) : (
                      <Text as="p" tone="subdued">
                        No transactions yet.
                      </Text>
                    )}
                  </>
                )}

                {selectedTab === 2 && (
                  <>
                    {customer.creditLedger.length > 0 ? (
                      <DataTable
                        columnContentTypes={[
                          "text",
                          "text",
                          "text",
                          "numeric",
                          "numeric",
                          "text",
                        ]}
                        headings={[
                          "Date",
                          "Type",
                          "Source",
                          "Amount",
                          "Balance",
                          "Description",
                        ]}
                        rows={customer.creditLedger.map((e) => [
                          new Date(e.createdAt).toLocaleDateString(),
                          <Badge key={e.id}>
                            {formatLedgerType(e.type)}
                          </Badge>,
                          formatLedgerSource(e.source),
                          <Text
                            key={`a-${e.id}`}
                            as="span"
                            tone={
                              e.amount >= 0 ? "success" : "critical"
                            }
                          >
                            {e.amount >= 0 ? "+" : ""}
                            {e.amount.toFixed(2)}
                          </Text>,
                          `$${e.balance.toFixed(2)}`,
                          e.description || "—",
                        ])}
                      />
                    ) : (
                      <Text as="p" tone="subdued">
                        No ledger entries yet.
                      </Text>
                    )}
                  </>
                )}
              </Box>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// Need Button import for the sync form
import { Button } from "@shopify/polaris";
