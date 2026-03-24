import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import {
  useLoaderData,
  Form,
  useNavigation,
  useActionData,
} from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect } from "react";
import {
  processOrdersImport,
} from "../services/order-import.server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineGrid,
  InlineStack,
  Text,
  Banner,
  Box,
  RadioButton,
  TextField,
  Button,
  Checkbox,
  Collapsible,
  Badge,
  ProgressBar,
  Divider,
} from "@shopify/polaris";
import { StatCard } from "../components/StatCard";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const [totalOrders, totalCustomers, lastMigration, oldestOrder, activeTiers] =
    await Promise.all([
      prisma.cashbackTransaction.count({
        where: { shopDomain: session.shop },
      }),
      prisma.customer.count({ where: { shopDomain: session.shop } }),
      prisma.migrationHistory.findFirst({
        where: { shopDomain: session.shop, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
      }),
      prisma.cashbackTransaction.findFirst({
        where: { shopDomain: session.shop },
        orderBy: { createdAt: "asc" },
      }),
      prisma.tier.count({
        where: { shopDomain: session.shop, isActive: true },
      }),
    ]);

  return json({
    shopDomain: session.shop,
    stats: {
      totalOrders,
      totalCustomers,
      lastImportDate: lastMigration?.completedAt?.toISOString() || null,
      oldestOrderDate: oldestOrder?.createdAt
        ? new Date(oldestOrder.createdAt).toISOString()
        : null,
    },
    hasActiveTiers: activeTiers > 0,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const _action = formData.get("_action") as string;

  if (_action !== "import") {
    return json({ success: false, error: "Invalid action" });
  }

  const startTime = Date.now();

  try {
    const dateRange = formData.get("dateRange") as string;
    const customStart = formData.get("customStartDate") as string;
    const customEnd = formData.get("customEndDate") as string;
    const importType = formData.get("importType") as string;
    const updateTiers = formData.get("updateTiers") === "true";

    let startDate: Date;
    let endDate = new Date();

    switch (dateRange) {
      case "1month":
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case "3months":
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case "6months":
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 6);
        break;
      case "1year":
        startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      case "custom":
        startDate = new Date(customStart);
        if (customEnd) endDate = new Date(customEnd);
        break;
      case "all":
        startDate = new Date("2000-01-01");
        break;
      default:
        throw new Error("Invalid date range");
    }

    const result = await processOrdersImport({
      shopDomain: session.shop,
      admin,
      startDate,
      endDate,
      importType: importType as "new" | "all",
      updateTiers,
    });

    const duration = Date.now() - startTime;

    await prisma.migrationHistory.create({
      data: {
        shopDomain: session.shop,
        status: "COMPLETED",
        totalRecords: result.totalOrders,
        processedRecords: result.processedOrders,
        failedRecords: result.totalOrders - result.processedOrders,
        errors: result.errors.length > 0 ? result.errors : undefined,
        metadata: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          importType,
          updateTiers,
        },
        startedAt: new Date(Date.now() - duration),
        completedAt: new Date(),
      },
    });

    return json({ success: true, importResult: { ...result, duration } });
  } catch (error) {
    await prisma.migrationHistory.create({
      data: {
        shopDomain: session.shop,
        status: "FAILED",
        totalRecords: 0,
        processedRecords: 0,
        failedRecords: 0,
        errors: [
          error instanceof Error ? error.message : "Unknown error",
        ],
        startedAt: new Date(Date.now() - (Date.now() - startTime)),
        completedAt: new Date(),
      },
    });

    return json({
      success: false,
      error: error instanceof Error ? error.message : "Import failed",
    });
  }
}

const DATE_OPTIONS = [
  { value: "1month", label: "Last Month", desc: "Last 30 days" },
  { value: "3months", label: "Last 3 Months", desc: "Last 90 days" },
  { value: "6months", label: "Last 6 Months", desc: "Last 180 days" },
  { value: "1year", label: "Last Year", desc: "Last 365 days" },
  { value: "all", label: "All Time", desc: "All historical orders" },
  { value: "custom", label: "Custom Range", desc: "Specify dates" },
];

export default function ImportOrders() {
  const { stats, hasActiveTiers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [dateRange, setDateRange] = useState("3months");
  const [importType, setImportType] = useState("new");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData) {
      setBannerVisible(true);
      if (actionData.success) {
        const t = setTimeout(() => setBannerVisible(false), 10000);
        return () => clearTimeout(t);
      }
    }
  }, [actionData]);

  const result = actionData?.success ? (actionData as any).importResult : null;

  return (
    <Page
      title="Import Orders"
      subtitle="Import historical orders and calculate cashback"
    >
      <Layout>
        {!hasActiveTiers && (
          <Layout.Section>
            <Banner tone="warning">
              <Text as="p" fontWeight="semibold">
                No Active Tiers
              </Text>
              <Text as="p">
                Set up at least one active tier before importing orders.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {bannerVisible && actionData && !actionData.success && (
          <Layout.Section>
            <Banner
              tone="critical"
              onDismiss={() => setBannerVisible(false)}
            >
              {(actionData as any).error}
            </Banner>
          </Layout.Section>
        )}

        {/* Stats */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <StatCard
              title="Total Orders"
              value={String(stats.totalOrders)}
            />
            <StatCard
              title="Total Customers"
              value={String(stats.totalCustomers)}
            />
            <StatCard
              title="Last Import"
              value={
                stats.lastImportDate
                  ? new Date(stats.lastImportDate).toLocaleDateString()
                  : "Never"
              }
            />
            <StatCard
              title="Oldest Order"
              value={
                stats.oldestOrderDate
                  ? new Date(
                      stats.oldestOrderDate,
                    ).toLocaleDateString()
                  : "N/A"
              }
            />
          </InlineGrid>
        </Layout.Section>

        {/* Import Form */}
        <Layout.Section>
          <Card>
            <Form method="post">
              <input type="hidden" name="_action" value="import" />
              <Box padding="400">
                <BlockStack gap="500">
                  <Text as="h2" variant="headingMd">
                    Import Settings
                  </Text>

                  {/* Date Range */}
                  <BlockStack gap="300">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      Date Range
                    </Text>
                    {DATE_OPTIONS.map((opt) => (
                      <RadioButton
                        key={opt.value}
                        label={opt.label}
                        helpText={opt.desc}
                        checked={dateRange === opt.value}
                        id={`date-${opt.value}`}
                        name="dateRange"
                        value={opt.value}
                        onChange={() => setDateRange(opt.value)}
                      />
                    ))}
                  </BlockStack>

                  {dateRange === "custom" && (
                    <InlineGrid columns={2} gap="400">
                      <TextField
                        label="Start Date"
                        type="date"
                        name="customStartDate"
                        autoComplete="off"
                        requiredIndicator
                      />
                      <TextField
                        label="End Date (optional)"
                        type="date"
                        name="customEndDate"
                        autoComplete="off"
                        helpText="Leave empty for today"
                      />
                    </InlineGrid>
                  )}

                  {/* Advanced Options */}
                  <Button
                    variant="plain"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                  >
                    {showAdvanced ? "Hide" : "Show"} Advanced Options
                  </Button>

                  <Collapsible
                    open={showAdvanced}
                    id="advanced-options"
                  >
                    <BlockStack gap="300">
                      <Text
                        as="p"
                        variant="bodyMd"
                        fontWeight="semibold"
                      >
                        Import Type
                      </Text>
                      <RadioButton
                        label="New Orders Only"
                        helpText="Skip already-imported orders (recommended)"
                        checked={importType === "new"}
                        id="import-new"
                        name="importType"
                        value="new"
                        onChange={() => setImportType("new")}
                      />
                      <RadioButton
                        label="All Orders"
                        helpText="Re-import all orders in range"
                        checked={importType === "all"}
                        id="import-all"
                        name="importType"
                        value="all"
                        onChange={() => setImportType("all")}
                      />
                      <Checkbox
                        label="Auto-update customer tiers after import"
                        name="updateTiers"
                        value="true"
                        checked
                      />
                    </BlockStack>
                  </Collapsible>

                  <Button
                    submit
                    variant="primary"
                    loading={isSubmitting}
                    disabled={!hasActiveTiers}
                    fullWidth
                  >
                    {isSubmitting
                      ? "Importing Orders..."
                      : "Start Import"}
                  </Button>
                </BlockStack>
              </Box>
            </Form>
          </Card>
        </Layout.Section>

        {/* Progress */}
        {isSubmitting && (
          <Layout.Section>
            <Card>
              <Box padding="400">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Importing...
                  </Text>
                  <ProgressBar progress={30} size="small" />
                  <Text as="p" variant="bodySm" tone="subdued">
                    This may take a few minutes for large imports.
                  </Text>
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>
        )}

        {/* Results */}
        {bannerVisible && result && (
          <Layout.Section>
            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Banner tone="success">
                    Import completed in{" "}
                    {(result.duration / 1000).toFixed(1)}s
                  </Banner>

                  <InlineGrid
                    columns={{ xs: 2, sm: 3, md: 4 }}
                    gap="400"
                  >
                    <StatCard
                      title="Orders Found"
                      value={String(result.totalOrders)}
                    />
                    <StatCard
                      title="Processed"
                      value={String(result.processedOrders)}
                    />
                    <StatCard
                      title="New Customers"
                      value={String(result.newCustomers)}
                    />
                    <StatCard
                      title="New Transactions"
                      value={String(result.newTransactions)}
                    />
                    <StatCard
                      title="Skipped"
                      value={String(result.skippedTransactions)}
                    />
                    <StatCard
                      title="Tiers Updated"
                      value={String(result.tiersUpdated)}
                    />
                  </InlineGrid>

                  {result.errors?.length > 0 && (
                    <Banner tone="warning">
                      {result.errors.length} errors occurred during
                      import.
                    </Banner>
                  )}
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
