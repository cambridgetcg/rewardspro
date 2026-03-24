import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  useSubmit,
  useNavigate,
  useSearchParams,
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
  Text,
  Banner,
  Modal,
  EmptyState,
  Box,
  InlineStack,
  Pagination,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";
import {
  assignTierManually,
  evaluateCustomerTier,
} from "../services/customer-tier.server";
import { StatCard } from "../components/StatCard";

const PAGE_SIZE = 25;

interface CustomerRow {
  id: string;
  email: string;
  shopifyCustomerId: string;
  storeCredit: number;
  totalEarned: number;
  tierName: string | null;
  tierCashbackPercent: number | null;
  tierId: string | null;
  annualSpending: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const search = url.searchParams.get("search") || "";
  const tierFilter = url.searchParams.get("tier") || "all";

  // Build where clause
  const where: any = { shopDomain };
  if (search) {
    where.email = { contains: search, mode: "insensitive" };
  }
  if (tierFilter === "none") {
    where.membershipHistory = { none: { isActive: true } };
  } else if (tierFilter && tierFilter !== "all") {
    where.membershipHistory = { some: { isActive: true, tierId: tierFilter } };
  }

  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  // Parallel: total count + paginated customers + stats + tiers
  const [totalCount, customers, stats, tiers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { storeCredit: "desc" },
      include: {
        membershipHistory: {
          where: { isActive: true },
          include: { tier: true },
          take: 1,
        },
      },
    }),
    prisma.customer.aggregate({
      where: { shopDomain },
      _count: true,
    }).then(async (total) => {
      const [withCredit, withTiers] = await Promise.all([
        prisma.customer.count({
          where: { shopDomain, storeCredit: { gt: 0 } },
        }),
        prisma.customerMembership.groupBy({
          by: ["customerId"],
          where: {
            isActive: true,
            customer: { shopDomain },
          },
        }).then((g) => g.length),
      ]);
      return {
        totalCustomers: total._count,
        customersWithCredit: withCredit,
        customersWithTiers: withTiers,
      };
    }),
    prisma.tier.findMany({
      where: { shopDomain, isActive: true },
      orderBy: { cashbackPercent: "asc" },
    }),
  ]);

  // Get annual spending for these specific customers via aggregate
  const customerIds = customers.map((c) => c.id);
  const spendingByCustomer: Record<string, number> = {};

  if (customerIds.length > 0) {
    const spendingResults = await prisma.cashbackTransaction.groupBy({
      by: ["customerId"],
      where: {
        customerId: { in: customerIds },
        createdAt: { gte: oneYearAgo },
        status: {
          in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY],
        },
      },
      _sum: { orderAmount: true },
    });
    for (const r of spendingResults) {
      spendingByCustomer[r.customerId] = r._sum.orderAmount || 0;
    }
  }

  const rows: CustomerRow[] = customers.map((customer) => {
    const membership = customer.membershipHistory[0];
    return {
      id: customer.id,
      email: customer.email,
      shopifyCustomerId: customer.shopifyCustomerId,
      storeCredit: customer.storeCredit,
      totalEarned: customer.totalEarned,
      tierName: membership?.tier?.name ?? null,
      tierCashbackPercent: membership?.tier?.cashbackPercent ?? null,
      tierId: membership?.tier?.id ?? null,
      annualSpending: spendingByCustomer[customer.id] || 0,
    };
  });

  return json({
    customers: rows,
    tiers,
    stats,
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
    },
    filters: { search, tier: tierFilter },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;

  if (actionType === "assignTier") {
    const customerId = formData.get("customerId") as string;
    const tierId = formData.get("tierId") as string;
    const reason =
      (formData.get("reason") as string) || "Manual assignment via admin";

    try {
      await assignTierManually(
        customerId,
        tierId,
        shopDomain,
        `${shopDomain}-admin`,
        reason,
      );
      return json({ success: true, message: "Tier assigned successfully" });
    } catch (error) {
      return json({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to assign tier",
      });
    }
  }

  if (actionType === "evaluateTier") {
    const customerId = formData.get("customerId") as string;
    try {
      await evaluateCustomerTier(customerId, shopDomain);
      return json({ success: true, message: "Customer tier evaluated" });
    } catch (error) {
      return json({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to evaluate tier",
      });
    }
  }

  if (actionType === "evaluateAll") {
    try {
      const customers = await prisma.customer.findMany({
        where: { shopDomain },
        select: { id: true },
      });
      let evaluated = 0;
      for (const customer of customers) {
        await evaluateCustomerTier(customer.id, shopDomain);
        evaluated++;
      }
      return json({
        success: true,
        message: `Evaluated ${evaluated} customers`,
      });
    } catch (error) {
      return json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to evaluate tiers",
      });
    }
  }

  // Handle store credit adjustment
  const customerId = formData.get("customerId") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const creditAction = formData.get("creditAction") as string;

  if (!customerId || !amount || amount <= 0) {
    return json({ success: false, error: "Invalid amount" });
  }

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer || customer.shopDomain !== shopDomain) {
      throw new Error("Customer not found");
    }

    const mutation =
      creditAction === "add"
        ? `#graphql
        mutation storeCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
          storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
            storeCreditAccountTransaction { id }
            userErrors { message }
          }
        }`
        : `#graphql
        mutation storeCreditAccountDebit($id: ID!, $debitInput: StoreCreditAccountDebitInput!) {
          storeCreditAccountDebit(id: $id, debitInput: $debitInput) {
            storeCreditAccountTransaction { id }
            userErrors { message }
          }
        }`;

    const variables =
      creditAction === "add"
        ? {
            id: `gid://shopify/Customer/${customer.shopifyCustomerId}`,
            creditInput: {
              creditAmount: {
                amount: amount.toFixed(2),
                currencyCode: "USD",
              },
            },
          }
        : {
            id: `gid://shopify/Customer/${customer.shopifyCustomerId}`,
            debitInput: {
              debitAmount: {
                amount: amount.toFixed(2),
                currencyCode: "USD",
              },
            },
          };

    const response = await admin.graphql(mutation, { variables });
    const result = await response.json();

    const mutationResult =
      creditAction === "add"
        ? result.data?.storeCreditAccountCredit
        : result.data?.storeCreditAccountDebit;

    if (mutationResult?.userErrors?.length > 0) {
      throw new Error(mutationResult.userErrors[0].message);
    }

    const newBalance =
      creditAction === "add"
        ? customer.storeCredit + amount
        : customer.storeCredit - amount;

    await prisma.customer.update({
      where: { id: customerId },
      data: { storeCredit: newBalance },
    });

    return json({
      success: true,
      message: `Successfully ${creditAction === "add" ? "added" : "removed"} $${amount.toFixed(2)}`,
    });
  } catch (error) {
    return json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to adjust credit",
    });
  }
};

export default function CustomerTiers() {
  const { customers, tiers, stats, pagination, filters } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();

  const [modalActive, setModalActive] = useState(false);
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerRow | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditAction, setCreditAction] = useState<"add" | "remove">("add");
  const [bannerVisible, setBannerVisible] = useState(false);

  const isSubmitting = navigation.state === "submitting";

  // Show banner on action result
  useEffect(() => {
    if (actionData) {
      setBannerVisible(true);
      if (actionData.success) {
        const t = setTimeout(() => setBannerVisible(false), 5000);
        return () => clearTimeout(t);
      }
    }
  }, [actionData]);

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value && value !== "all" && value !== "") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Reset to page 1 on filter change
      if (key !== "page") {
        params.delete("page");
      }
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const rows = customers.map((customer) => [
    customer.email,
    customer.tierName
      ? `${customer.tierName} (${customer.tierCashbackPercent}%)`
      : "—",
    `$${customer.storeCredit.toFixed(2)}`,
    `$${customer.annualSpending.toFixed(2)}`,
    customer.id,
  ]);

  return (
    <Page
      title="Customer Tiers"
      primaryAction={{
        content: "Evaluate All Tiers",
        onAction: () => {
          const formData = new FormData();
          formData.append("actionType", "evaluateAll");
          submit(formData, { method: "post" });
        },
        loading: isSubmitting,
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

        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
            <StatCard
              title="Total Customers"
              value={String(stats.totalCustomers)}
            />
            <StatCard
              title="With Tiers"
              value={String(stats.customersWithTiers)}
            />
            <StatCard
              title="Have Store Credit"
              value={String(stats.customersWithCredit)}
            />
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                <TextField
                  label="Search customers"
                  value={filters.search}
                  onChange={(v) => updateFilter("search", v)}
                  placeholder="Email address..."
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => updateFilter("search", "")}
                />
                <Select
                  label="Filter by tier"
                  options={[
                    { label: "All customers", value: "all" },
                    { label: "No tier", value: "none" },
                    ...tiers.map((tier) => ({
                      label: `${tier.name} (${tier.cashbackPercent}%)`,
                      value: tier.id,
                    })),
                  ]}
                  value={filters.tier}
                  onChange={(v) => updateFilter("tier", v)}
                />
              </InlineGrid>

              {customers.length > 0 ? (
                <>
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "text",
                      "numeric",
                      "numeric",
                      "text",
                    ]}
                    headings={[
                      "Customer",
                      "Current Tier",
                      "Store Credit",
                      "Annual Spending",
                      "Actions",
                    ]}
                    rows={rows.map((row) => {
                      const customerId = row[4] as string;
                      const customer = customers.find(
                        (c) => c.id === customerId,
                      );
                      return [
                        ...row.slice(0, 4),
                        <BlockStack gap="200" key={customerId}>
                          <Button
                            size="slim"
                            onClick={() => {
                              setSelectedCustomer(customer!);
                              setModalActive(true);
                            }}
                          >
                            Adjust Credit
                          </Button>
                          <Button
                            size="slim"
                            variant="plain"
                            onClick={() =>
                              navigate(`/app/customers/${customerId}`)
                            }
                          >
                            View Details
                          </Button>
                        </BlockStack>,
                      ];
                    })}
                  />

                  <Box padding="400">
                    <InlineStack align="center" gap="400">
                      <Pagination
                        hasPrevious={pagination.page > 1}
                        hasNext={pagination.page < pagination.totalPages}
                        onPrevious={() =>
                          updateFilter(
                            "page",
                            String(pagination.page - 1),
                          )
                        }
                        onNext={() =>
                          updateFilter(
                            "page",
                            String(pagination.page + 1),
                          )
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
                  <p>Try adjusting your search or filters</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={modalActive}
        onClose={() => setModalActive(false)}
        title={`Adjust Store Credit: ${selectedCustomer?.email}`}
        primaryAction={{
          content:
            creditAction === "add" ? "Add Credit" : "Remove Credit",
          onAction: () => {
            if (selectedCustomer && creditAmount) {
              const formData = new FormData();
              formData.append("actionType", "credit");
              formData.append("customerId", selectedCustomer.id);
              formData.append("amount", creditAmount);
              formData.append("creditAction", creditAction);
              submit(formData, { method: "post" });
              setModalActive(false);
              setCreditAmount("");
            }
          },
          disabled: !creditAmount || parseFloat(creditAmount) <= 0,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setModalActive(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" variant="bodyMd">
              Current balance: ${selectedCustomer?.storeCredit.toFixed(2)}
            </Text>
            <Select
              label="Action"
              options={[
                { label: "Add credit", value: "add" },
                { label: "Remove credit", value: "remove" },
              ]}
              value={creditAction}
              onChange={(value) =>
                setCreditAction(value as "add" | "remove")
              }
            />
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
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
