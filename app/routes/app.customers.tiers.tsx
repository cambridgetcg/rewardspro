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
  IndexTable,
  TextField,
  Select,
  BlockStack,
  Text,
  Banner,
  EmptySearchResult,
  Box,
  InlineStack,
  Pagination,
  Badge,
  useIndexResourceState,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";
import {
  assignTierManually,
  evaluateCustomerTier,
} from "../services/customer-tier.server";
import { HeroMetric } from "../components/HeroMetric";

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
  lastSyncedAt: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const search = url.searchParams.get("search") || "";
  const tierFilter = url.searchParams.get("tier") || "all";

  const where: any = { shopDomain };
  if (search) {
    where.OR = [
      { email: { contains: search, mode: "insensitive" } },
      { shopifyCustomerId: { contains: search } },
    ];
  }
  if (tierFilter === "none") {
    where.membershipHistory = { none: { isActive: true } };
  } else if (tierFilter && tierFilter !== "all") {
    where.membershipHistory = { some: { isActive: true, tierId: tierFilter } };
  }

  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  const [totalCount, customers, heroStats, tiers] = await Promise.all([
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
    Promise.all([
      prisma.customer.aggregate({
        where: { shopDomain },
        _sum: { storeCredit: true },
        _count: true,
      }),
      prisma.customer.count({
        where: { shopDomain, storeCredit: { gt: 0 } },
      }),
      prisma.customerMembership.groupBy({
        by: ["customerId"],
        where: { isActive: true, customer: { shopDomain } },
      }),
    ]).then(([agg, withCredit, tiered]) => ({
      totalCustomers: agg._count,
      totalCredit: agg._sum.storeCredit || 0,
      withCredit,
      withTiers: tiered.length,
    })),
    prisma.tier.findMany({
      where: { shopDomain, isActive: true },
      orderBy: { cashbackPercent: "asc" },
    }),
  ]);

  // Annual spending for this page of customers
  const customerIds = customers.map((c) => c.id);
  const spendingByCustomer: Record<string, number> = {};
  if (customerIds.length > 0) {
    const results = await prisma.cashbackTransaction.groupBy({
      by: ["customerId"],
      where: {
        customerId: { in: customerIds },
        createdAt: { gte: oneYearAgo },
        status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] },
      },
      _sum: { orderAmount: true },
    });
    for (const r of results) {
      spendingByCustomer[r.customerId] = r._sum.orderAmount || 0;
    }
  }

  const rows: CustomerRow[] = customers.map((c) => {
    const m = c.membershipHistory[0];
    return {
      id: c.id,
      email: c.email,
      shopifyCustomerId: c.shopifyCustomerId,
      storeCredit: c.storeCredit,
      totalEarned: c.totalEarned,
      tierName: m?.tier?.name ?? null,
      tierCashbackPercent: m?.tier?.cashbackPercent ?? null,
      tierId: m?.tier?.id ?? null,
      annualSpending: spendingByCustomer[c.id] || 0,
      lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
    };
  });

  return json({
    customers: rows,
    tiers,
    heroStats,
    pagination: {
      page,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
    },
    filters: { search, tier: tierFilter },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;

  if (actionType === "evaluateAll") {
    try {
      const ids = await prisma.customer.findMany({
        where: { shopDomain },
        select: { id: true },
      });
      let evaluated = 0;
      for (const { id } of ids) {
        await evaluateCustomerTier(id, shopDomain);
        evaluated++;
      }
      return json({ success: true, message: `Evaluated ${evaluated} customers` });
    } catch (error) {
      return json({
        success: false,
        error: error instanceof Error ? error.message : "Failed",
      });
    }
  }

  return json({ success: false, error: "Unknown action" });
};

function formatCurrency(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function Customers() {
  const { customers, tiers, heroStats, pagination, filters } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();


  const [bannerVisible, setBannerVisible] = useState(false);

  const isSubmitting = navigation.state === "submitting";

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
      if (value && value !== "all" && value !== "") params.set(key, value);
      else params.delete(key);
      if (key !== "page") params.delete("page");
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const resourceName = { singular: "customer", plural: "customers" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(customers);

  return (
    <Page
      title="Customers"
      primaryAction={{
        content: "Evaluate All Tiers",
        loading: isSubmitting,
        onAction: () => {
          const fd = new FormData();
          fd.append("actionType", "evaluateAll");
          submit(fd, { method: "post" });
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
              {"message" in actionData ? actionData.message : ""}
              {"error" in actionData ? actionData.error : ""}
            </Banner>
          </Layout.Section>
        )}

        {/* Hero: Total Store Credit Outstanding */}
        <Layout.Section>
          <HeroMetric
            label="Total Store Credit Outstanding"
            value={formatCurrency(heroStats.totalCredit)}
            aside={[
              { label: "Customers", value: String(heroStats.totalCustomers) },
              { label: "With Credit", value: String(heroStats.withCredit) },
              { label: "With Tiers", value: String(heroStats.withTiers) },
            ]}
          />
        </Layout.Section>

        {/* Filters + Table */}
        <Layout.Section>
          <Card padding="0">
            <Box padding="300">
              <InlineStack gap="300">
                <div style={{ flex: 1 }}>
                  <TextField
                    label=""
                    labelHidden
                    value={filters.search}
                    onChange={(v) => updateFilter("search", v)}
                    placeholder="Search by email or ID..."
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => updateFilter("search", "")}
                  />
                </div>
                <div style={{ width: "200px" }}>
                  <Select
                    label=""
                    labelHidden
                    options={[
                      { label: "All tiers", value: "all" },
                      { label: "No tier", value: "none" },
                      ...tiers.map((t) => ({
                        label: `${t.name} (${t.cashbackPercent}%)`,
                        value: t.id,
                      })),
                    ]}
                    value={filters.tier}
                    onChange={(v) => updateFilter("tier", v)}
                  />
                </div>
              </InlineStack>
            </Box>

            <IndexTable
              resourceName={resourceName}
              itemCount={customers.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Customer" },
                { title: "Tier" },
                { title: "Store Credit", alignment: "end" },
                { title: "Annual Spending", alignment: "end" },
              ]}
              selectable={false}
              emptyState={
                <EmptySearchResult
                  title="No customers found"
                  description="Try adjusting your search or filters"
                  withIllustration
                />
              }
            >
              {customers.map((c, i) => (
                <IndexTable.Row
                  id={c.id}
                  key={c.id}
                  position={i}
                  onClick={() => navigate(`/app/customers/${c.id}`)}
                >
                  <IndexTable.Cell>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {c.email}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {c.tierName ? (
                      <Badge>{`${c.tierName} (${c.tierCashbackPercent ?? 0}%)`}</Badge>
                    ) : (
                      <Text as="span" tone="subdued">—</Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text
                      as="span"
                      alignment="end"
                      fontWeight={c.storeCredit > 0 ? "semibold" : "regular"}
                      tone={c.storeCredit > 0 ? "success" : "subdued"}
                    >
                      {formatCurrency(c.storeCredit)}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" alignment="end">
                      {formatCurrency(c.annualSpending)}
                    </Text>
                  </IndexTable.Cell>

                </IndexTable.Row>
              ))}
            </IndexTable>

            {pagination.totalPages > 1 && (
              <Box padding="300" borderBlockStartWidth="025" borderColor="border">
                <InlineStack align="center" gap="300">
                  <Pagination
                    hasPrevious={pagination.page > 1}
                    hasNext={pagination.page < pagination.totalPages}
                    onPrevious={() => updateFilter("page", String(pagination.page - 1))}
                    onNext={() => updateFilter("page", String(pagination.page + 1))}
                  />
                  <Text as="p" variant="bodySm" tone="subdued">
                    {pagination.page} / {pagination.totalPages} ({pagination.totalCount})
                  </Text>
                </InlineStack>
              </Box>
            )}
          </Card>
        </Layout.Section>
      </Layout>


    </Page>
  );
}
