import { useState, useEffect, useCallback } from "react";
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  useSubmit,
  useNavigate,
  useSearchParams,
  Form,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Button,
  TextField,
  Select,
  BlockStack,
  InlineGrid,
  InlineStack,
  Text,
  Banner,
  Modal,
  EmptyState,
  Box,
  Badge,
  Pagination,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import type { LedgerEntryType, LedgerSource } from "@prisma/client";
import { StatCard } from "../components/StatCard";

const PAGE_SIZE = 25;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const search = url.searchParams.get("search") || "";
  const sort = url.searchParams.get("sort") || "credit-desc";

  // Build where clause
  const where: any = { shopDomain };
  if (search) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" } },
      { shopifyCustomerId: { contains: search } },
    ];
  }

  // Build orderBy
  const orderBy: any =
    sort === "credit-asc"
      ? { storeCredit: "asc" }
      : sort === "email-asc"
        ? { email: "asc" }
        : sort === "email-desc"
          ? { email: "desc" }
          : { storeCredit: "desc" };

  // Parallel: stats (aggregates) + paginated customers + recent activity
  const [totalCount, stats, customers, recentActivity] = await Promise.all([
    prisma.customer.count({ where }),
    Promise.all([
      prisma.customer.count({ where: { shopDomain } }),
      prisma.customer.count({
        where: { shopDomain, storeCredit: { gt: 0 } },
      }),
      prisma.customer.aggregate({
        where: { shopDomain },
        _sum: { storeCredit: true },
      }),
      prisma.customer.count({
        where: {
          shopDomain,
          OR: [
            { lastSyncedAt: null },
            {
              lastSyncedAt: {
                lt: new Date(Date.now() - 24 * 60 * 60 * 1000),
              },
            },
          ],
        },
      }),
    ]).then(([total, withCredit, creditAgg, stale]) => ({
      totalCustomers: total,
      customersWithCredit: withCredit,
      totalStoreCredit: creditAgg._sum.storeCredit || 0,
      staleCustomers: stale,
    })),
    prisma.customer.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy,
      select: {
        id: true,
        email: true,
        shopifyCustomerId: true,
        storeCredit: true,
        totalEarned: true,
        lastSyncedAt: true,
      },
    }),
    prisma.storeCreditLedger.findMany({
      where: { shopDomain },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        customer: { select: { email: true } },
      },
    }),
  ]);

  return json({
    customers,
    stats,
    recentActivity,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
    },
    filters: { search, sort },
    shopDomain,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;

  if (actionType === "bulk-sync") {
    const syncType = formData.get("syncType") as string;
    try {
      const customersToSync = await prisma.customer.findMany({
        where: {
          shopDomain,
          ...(syncType === "stale"
            ? {
                OR: [
                  { lastSyncedAt: null },
                  {
                    lastSyncedAt: {
                      lt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                    },
                  },
                ],
              }
            : {}),
        },
        take: 50,
      });

      let updated = 0;
      let errors = 0;

      for (const customer of customersToSync) {
        try {
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

          if (Math.abs(totalBalance - customer.storeCredit) > 0.01) {
            await prisma.$transaction([
              prisma.storeCreditLedger.create({
                data: {
                  customerId: customer.id,
                  shopDomain,
                  amount: totalBalance - customer.storeCredit,
                  balance: totalBalance,
                  type: "SHOPIFY_SYNC",
                  source: "SHOPIFY_ADMIN",
                  description: `Bulk sync: ${customer.storeCredit.toFixed(2)} → ${totalBalance.toFixed(2)}`,
                  reconciledAt: new Date(),
                },
              }),
              prisma.customer.update({
                where: { id: customer.id },
                data: {
                  storeCredit: totalBalance,
                  lastSyncedAt: new Date(),
                },
              }),
            ]);
            updated++;
          } else {
            await prisma.customer.update({
              where: { id: customer.id },
              data: { lastSyncedAt: new Date() },
            });
          }
        } catch {
          errors++;
        }
      }

      return json({
        success: true,
        message: `Sync complete: ${updated} updated, ${errors} errors, ${customersToSync.length} processed`,
      });
    } catch (error) {
      return json({
        success: false,
        error: "Failed to perform bulk sync",
      });
    }
  }

  // Credit adjustment
  const customerId = formData.get("customerId") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const currency = (formData.get("currency") as string) || "USD";
  const creditAction = formData.get("creditAction") as string;
  const description = formData.get("description") as string;

  if (!customerId || !amount || amount <= 0) {
    return json({ success: false, error: "Valid customer and positive amount required" });
  }

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer || customer.shopDomain !== shopDomain) {
      throw new Error("Customer not found");
    }
    if (creditAction === "remove" && amount > customer.storeCredit) {
      throw new Error(
        `Cannot remove $${amount.toFixed(2)}. Balance is $${customer.storeCredit.toFixed(2)}`,
      );
    }

    const mutation =
      creditAction === "add"
        ? `#graphql
        mutation credit($id: ID!, $input: StoreCreditAccountCreditInput!) {
          storeCreditAccountCredit(id: $id, creditInput: $input) {
            storeCreditAccountTransaction { id }
            userErrors { message }
          }
        }`
        : `#graphql
        mutation debit($id: ID!, $input: StoreCreditAccountDebitInput!) {
          storeCreditAccountDebit(id: $id, debitInput: $input) {
            storeCreditAccountTransaction { id }
            userErrors { message }
          }
        }`;

    const inputKey = creditAction === "add" ? "creditAmount" : "debitAmount";
    const response = await admin.graphql(mutation, {
      variables: {
        id: `gid://shopify/Customer/${customer.shopifyCustomerId}`,
        input: { [inputKey]: { amount: amount.toFixed(2), currencyCode: currency } },
      },
    });
    const gqlResult = await response.json();
    const mutResult =
      creditAction === "add"
        ? gqlResult.data?.storeCreditAccountCredit
        : gqlResult.data?.storeCreditAccountDebit;

    if (mutResult?.userErrors?.length > 0) {
      throw new Error(mutResult.userErrors[0].message);
    }

    const ledgerAmount = creditAction === "add" ? amount : -amount;
    const newBalance = customer.storeCredit + ledgerAmount;

    await prisma.$transaction([
      prisma.storeCreditLedger.create({
        data: {
          customerId: customer.id,
          shopDomain,
          amount: ledgerAmount,
          balance: newBalance,
          type: "MANUAL_ADJUSTMENT",
          source: "APP_MANUAL",
          shopifyReference: mutResult?.storeCreditAccountTransaction?.id,
          description: description || `Manual ${creditAction} via admin`,
          reconciledAt: new Date(),
        },
      }),
      prisma.customer.update({
        where: { id: customerId },
        data: { storeCredit: newBalance, lastSyncedAt: new Date() },
      }),
    ]);

    const word = creditAction === "add" ? "added to" : "removed from";
    return json({
      success: true,
      message: `$${amount.toFixed(2)} ${word} ${customer.email}. New balance: $${newBalance.toFixed(2)}`,
    });
  } catch (error) {
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to adjust credit",
    });
  }
};

function formatSyncTime(lastSyncedAt: string | null): string {
  if (!lastSyncedAt) return "Never";
  const ms = Date.now() - new Date(lastSyncedAt).getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return "Recently";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
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

export default function StoreCreditManagement() {
  const { customers, stats, recentActivity, pagination, filters, shopDomain } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [modalActive, setModalActive] = useState(false);
  const [syncModalActive, setSyncModalActive] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [creditAction, setCreditAction] = useState<"add" | "remove">("add");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditDescription, setCreditDescription] = useState("");
  const [bannerVisible, setBannerVisible] = useState(false);

  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData) {
      setBannerVisible(true);
      if (actionData.success) {
        setModalActive(false);
        setSyncModalActive(false);
        setCreditAmount("");
        setCreditDescription("");
        const t = setTimeout(() => setBannerVisible(false), 5000);
        return () => clearTimeout(t);
      }
    }
  }, [actionData]);

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value) params.set(key, value);
      else params.delete(key);
      if (key !== "page") params.delete("page");
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  return (
    <Page
      title="Store Credit"
      primaryAction={{
        content: "Sync with Shopify",
        onAction: () => setSyncModalActive(true),
      }}
    >
      <Layout>
        {bannerVisible && actionData && (
          <Layout.Section>
            <Banner
              tone={actionData.success ? "success" : "critical"}
              onDismiss={() => setBannerVisible(false)}
            >
              {actionData.success && "message" in actionData
                ? actionData.message
                : ""}
              {!actionData.success && "error" in actionData
                ? actionData.error
                : ""}
            </Banner>
          </Layout.Section>
        )}

        {/* Stats */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <StatCard
              title="Total Customers"
              value={String(stats.totalCustomers)}
            />
            <StatCard
              title="With Credit"
              value={String(stats.customersWithCredit)}
            />
            <StatCard
              title="Total Credit"
              value={`$${stats.totalStoreCredit.toFixed(2)}`}
            />
            <StatCard
              title="Need Sync"
              value={String(stats.staleCustomers)}
              trend={stats.staleCustomers > 0 ? "down" : "neutral"}
            />
          </InlineGrid>
        </Layout.Section>

        {/* Customer Table */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                <TextField
                  label="Search"
                  value={filters.search}
                  onChange={(v) => updateFilter("search", v)}
                  placeholder="Email or customer ID..."
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => updateFilter("search", "")}
                />
                <Select
                  label="Sort by"
                  options={[
                    { label: "Credit: High to Low", value: "credit-desc" },
                    { label: "Credit: Low to High", value: "credit-asc" },
                    { label: "Email: A to Z", value: "email-asc" },
                    { label: "Email: Z to A", value: "email-desc" },
                  ]}
                  value={filters.sort}
                  onChange={(v) => updateFilter("sort", v)}
                />
              </InlineGrid>

              {customers.length > 0 ? (
                <>
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "numeric",
                      "numeric",
                      "text",
                      "text",
                    ]}
                    headings={[
                      "Customer",
                      "Store Credit",
                      "Total Earned",
                      "Last Synced",
                      "Actions",
                    ]}
                    rows={customers.map((c) => [
                      c.email,
                      `$${c.storeCredit.toFixed(2)}`,
                      `$${c.totalEarned.toFixed(2)}`,
                      <Text
                        key={`sync-${c.id}`}
                        as="span"
                        tone={
                          !c.lastSyncedAt ||
                          Date.now() -
                            new Date(c.lastSyncedAt).getTime() >
                            86400000
                            ? "caution"
                            : "subdued"
                        }
                      >
                        {formatSyncTime(c.lastSyncedAt)}
                      </Text>,
                      <InlineStack gap="200" key={c.id}>
                        <Button
                          size="slim"
                          tone="success"
                          onClick={() => {
                            setSelectedCustomer(c);
                            setCreditAction("add");
                            setModalActive(true);
                          }}
                        >
                          + Add
                        </Button>
                        <Button
                          size="slim"
                          tone="critical"
                          disabled={c.storeCredit === 0}
                          onClick={() => {
                            setSelectedCustomer(c);
                            setCreditAction("remove");
                            setModalActive(true);
                          }}
                        >
                          − Remove
                        </Button>
                        <Button
                          size="slim"
                          variant="plain"
                          onClick={() =>
                            navigate(`/app/customers/${c.id}`)
                          }
                        >
                          Details
                        </Button>
                      </InlineStack>,
                    ])}
                  />
                  <Box padding="400">
                    <InlineStack align="center" gap="400">
                      <Pagination
                        hasPrevious={pagination.page > 1}
                        hasNext={pagination.page < pagination.totalPages}
                        onPrevious={() =>
                          updateFilter("page", String(pagination.page - 1))
                        }
                        onNext={() =>
                          updateFilter("page", String(pagination.page + 1))
                        }
                      />
                      <Text as="p" variant="bodySm" tone="subdued">
                        Page {pagination.page} of {pagination.totalPages} (
                        {pagination.totalCount} customers)
                      </Text>
                    </InlineStack>
                  </Box>
                </>
              ) : (
                <EmptyState heading="No customers found" image="">
                  <p>Try adjusting your search</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Recent Activity
                </Text>
                <DataTable
                  columnContentTypes={[
                    "text",
                    "text",
                    "text",
                    "numeric",
                    "numeric",
                  ]}
                  headings={[
                    "Date",
                    "Customer",
                    "Type",
                    "Amount",
                    "Balance",
                  ]}
                  rows={recentActivity.map((entry) => [
                    new Date(entry.createdAt).toLocaleDateString(),
                    entry.customer.email,
                    <Badge key={entry.id}>
                      {formatLedgerType(entry.type)}
                    </Badge>,
                    <Text
                      key={`amt-${entry.id}`}
                      as="span"
                      tone={entry.amount >= 0 ? "success" : "critical"}
                    >
                      {entry.amount >= 0 ? "+" : ""}
                      {entry.amount.toFixed(2)}
                    </Text>,
                    `$${entry.balance.toFixed(2)}`,
                  ])}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>

      {/* Credit Adjustment Modal */}
      <Modal
        open={modalActive}
        onClose={() => setModalActive(false)}
        title={`${creditAction === "add" ? "Add" : "Remove"} Credit: ${selectedCustomer?.email}`}
        primaryAction={{
          content: creditAction === "add" ? "Add Credit" : "Remove Credit",
          destructive: creditAction === "remove",
          loading: isSubmitting,
          disabled: !creditAmount || parseFloat(creditAmount) <= 0,
          onAction: () => {
            if (!selectedCustomer || !creditAmount) return;
            const fd = new FormData();
            fd.append("actionType", "credit");
            fd.append("customerId", selectedCustomer.id);
            fd.append("amount", creditAmount);
            fd.append("creditAction", creditAction);
            fd.append("currency", "USD");
            fd.append("description", creditDescription);
            submit(fd, { method: "post" });
          },
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setModalActive(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" variant="bodyMd">
              Current balance: $
              {selectedCustomer?.storeCredit.toFixed(2)}
            </Text>
            <TextField
              label="Amount (USD)"
              type="number"
              value={creditAmount}
              onChange={setCreditAmount}
              placeholder="0.00"
              min="0.01"
              step={0.01}
              autoComplete="off"
            />
            <TextField
              label="Description (optional)"
              value={creditDescription}
              onChange={setCreditDescription}
              placeholder={
                creditAction === "add"
                  ? "e.g., Loyalty bonus"
                  : "e.g., Correction"
              }
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Sync Modal */}
      <Modal
        open={syncModalActive}
        onClose={() => setSyncModalActive(false)}
        title="Sync Store Credit Balances"
        primaryAction={{
          content: `Sync Stale (${stats.staleCustomers})`,
          disabled: isSubmitting || stats.staleCustomers === 0,
          loading: isSubmitting,
          onAction: () => {
            const fd = new FormData();
            fd.append("actionType", "bulk-sync");
            fd.append("syncType", "stale");
            submit(fd, { method: "post" });
          },
        }}
        secondaryActions={[
          {
            content: "Sync All",
            loading: isSubmitting,
            onAction: () => {
              const fd = new FormData();
              fd.append("actionType", "bulk-sync");
              fd.append("syncType", "all");
              submit(fd, { method: "post" });
            },
          },
          { content: "Cancel", onAction: () => setSyncModalActive(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Fetches latest store credit balances from Shopify and updates
              local records. Processes up to 50 customers per sync.
            </Text>
            {stats.staleCustomers > 0 ? (
              <Banner tone="warning">
                {stats.staleCustomers} customers haven't been synced in 24+ hours.
              </Banner>
            ) : (
              <Banner tone="success">
                All customers are recently synced.
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
