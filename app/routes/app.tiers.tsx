import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import {
  useLoaderData,
  Form,
  useNavigation,
  useFetcher,
  useActionData,
} from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect } from "react";
import { EvaluationPeriod } from "@prisma/client";
import {
  getTierDistribution,
  batchEvaluateCustomerTiers,
  handleExpiredMemberships,
} from "../services/customer-tier.server";
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
  Badge,
  Box,
  EmptyState,
  FormLayout,
  Collapsible,
  Checkbox,
} from "@shopify/polaris";
import { StatCard } from "../components/StatCard";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const tierDistribution = await getTierDistribution(session.shop);

  const [totalCustomers, totalCashback] = await Promise.all([
    prisma.customer.count({ where: { shopDomain: session.shop } }),
    prisma.cashbackTransaction.aggregate({
      where: { shopDomain: session.shop },
      _sum: { cashbackAmount: true },
    }),
  ]);

  return json({
    tiers: tierDistribution || [],
    stats: {
      totalCustomers,
      totalCashback: totalCashback._sum.cashbackAmount || 0,
      activeTiers: tierDistribution
        ? tierDistribution.filter((t) => t.isActive).length
        : 0,
      totalMembers: tierDistribution
        ? tierDistribution.reduce((sum, t) => sum + t.memberCount, 0)
        : 0,
    },
  });
}

type ActionResponse =
  | { success: true; message?: string; error?: never }
  | { success: false; error: string; message?: never };

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const action = formData.get("_action");

  try {
    if (action === "update") {
      const tierId = formData.get("tierId") as string;
      const name = formData.get("name") as string;
      const minSpend = formData.get("minSpend");
      const cashbackPercent = formData.get("cashbackPercent");
      const isActive = formData.get("isActive") === "true";

      const currentTier = await prisma.tier.findUnique({
        where: { id: tierId, shopDomain: session.shop },
      });

      if (!currentTier) {
        return json<ActionResponse>(
          { success: false, error: "Tier not found" },
          { status: 404 },
        );
      }

      if (name && name !== currentTier.name) {
        const existingTier = await prisma.tier.findFirst({
          where: {
            shopDomain: session.shop,
            name,
            id: { not: tierId },
          },
        });

        if (existingTier) {
          return json<ActionResponse>(
            {
              success: false,
              error: "A tier with this name already exists",
            },
            { status: 400 },
          );
        }
      }

      await prisma.tier.update({
        where: { id: tierId, shopDomain: session.shop },
        data: {
          name: name || currentTier.name,
          minSpend: minSpend ? parseFloat(minSpend as string) : null,
          cashbackPercent: parseFloat(cashbackPercent as string),
          evaluationPeriod:
            (formData.get("evaluationPeriod") as EvaluationPeriod) ||
            currentTier.evaluationPeriod,
          isActive,
        },
      });

      return json<ActionResponse>({
        success: true,
        message: "Tier updated successfully",
      });
    } else if (action === "create") {
      const name = formData.get("name") as string;
      const cashbackPercent = parseFloat(
        formData.get("cashbackPercent") as string,
      );
      const evaluationPeriod = formData.get(
        "evaluationPeriod",
      ) as EvaluationPeriod;

      const existingTier = await prisma.tier.findFirst({
        where: { shopDomain: session.shop, name },
      });

      if (existingTier) {
        return json<ActionResponse>(
          {
            success: false,
            error: "A tier with this name already exists",
          },
          { status: 400 },
        );
      }

      await prisma.tier.create({
        data: {
          shopDomain: session.shop,
          name,
          minSpend: formData.get("minSpend")
            ? parseFloat(formData.get("minSpend") as string)
            : null,
          cashbackPercent,
          evaluationPeriod: evaluationPeriod || EvaluationPeriod.ANNUAL,
          isActive: true,
        },
      });

      return json<ActionResponse>({
        success: true,
        message: "Tier created successfully",
      });
    } else if (action === "delete") {
      const tierId = formData.get("tierId") as string;

      const memberCount = await prisma.customerMembership.count({
        where: { tierId, isActive: true },
      });

      if (memberCount > 0) {
        return json<ActionResponse>(
          {
            success: false,
            error:
              "Cannot delete tier with active members. Please reassign members first.",
          },
          { status: 400 },
        );
      }

      await prisma.tier.delete({
        where: { id: tierId, shopDomain: session.shop },
      });

      return json<ActionResponse>({
        success: true,
        message: "Tier deleted successfully",
      });
    } else if (action === "evaluateAll") {
      const result = await batchEvaluateCustomerTiers(session.shop);
      return json<ActionResponse>({
        success: true,
        message: `Evaluated ${result.totalProcessed} customers. ${result.successful} updated, ${result.failed} failed.`,
      });
    } else if (action === "handleExpired") {
      const results = await handleExpiredMemberships(session.shop);
      const successful = results.filter((r) => r.success).length;
      return json<ActionResponse>({
        success: true,
        message: `Processed ${results.length} expired memberships. ${successful} updated successfully.`,
      });
    }
  } catch (error) {
    console.error("Tier operation error:", error);
    return json<ActionResponse>(
      { success: false, error: "An error occurred. Please try again." },
      { status: 500 },
    );
  }

  return json<ActionResponse>({ success: true });
}

export default function TierSettings() {
  const { tiers, stats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [bannerVisible, setBannerVisible] = useState(false);

  // Edit form state
  const editingTier = tiers.find((t: any) => t.id === editingTierId);
  const [editName, setEditName] = useState("");
  const [editCashback, setEditCashback] = useState("");
  const [editMinSpend, setEditMinSpend] = useState("");
  const [editEvalPeriod, setEditEvalPeriod] = useState("ANNUAL");

  // Sync edit state when editing tier changes
  useEffect(() => {
    if (editingTier) {
      setEditName(editingTier.name || "");
      setEditCashback(String(editingTier.cashbackPercent));
      setEditMinSpend(editingTier.minSpend ? String(editingTier.minSpend) : "");
      setEditEvalPeriod(editingTier.evaluationPeriod || "ANNUAL");
    }
  }, [editingTierId]);

  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData) {
      setBannerVisible(true);
      if (actionData.success) {
        setShowCreateForm(false);
        setEditingTierId(null);
        const t = setTimeout(() => setBannerVisible(false), 5000);
        return () => clearTimeout(t);
      }
    }
  }, [actionData]);

  return (
    <Page
      title="Tier Management"
      subtitle="Configure customer tiers and rewards"
      primaryAction={{
        content: showCreateForm ? "Cancel" : "+ Add Tier",
        onAction: () => setShowCreateForm(!showCreateForm),
        ...(showCreateForm ? { destructive: true } : {}),
      }}
      secondaryActions={[
        {
          content: "Re-evaluate All",
          onAction: () => {
            const formData = new FormData();
            formData.append("_action", "evaluateAll");
            fetcher.submit(formData, { method: "post" });
          },
          loading: isSubmitting,
        },
        {
          content: "Process Expired",
          onAction: () => {
            const formData = new FormData();
            formData.append("_action", "handleExpired");
            fetcher.submit(formData, { method: "post" });
          },
          loading: isSubmitting,
        },
      ]}
    >
      <Layout>
        {bannerVisible && actionData && (
          <Layout.Section>
            <Banner
              tone={actionData.success ? "success" : "critical"}
              onDismiss={() => setBannerVisible(false)}
            >
              {actionData.success ? actionData.message : actionData.error}
            </Banner>
          </Layout.Section>
        )}

        {/* Stats */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <StatCard
              title="Active Tiers"
              value={String(stats.activeTiers)}
            />
            <StatCard
              title="Total Members"
              value={String(stats.totalMembers)}
            />
            <StatCard
              title="Total Customers"
              value={String(stats.totalCustomers)}
            />
            <StatCard
              title="Total Cashback Earned"
              value={`$${stats.totalCashback.toFixed(2)}`}
            />
          </InlineGrid>
        </Layout.Section>

        {/* Create Form */}
        <Layout.Section>
          <Collapsible open={showCreateForm} id="create-tier-form">
            <Card>
              <Form method="post">
                <input type="hidden" name="_action" value="create" />
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Create New Tier
                  </Text>
                  <FormLayout>
                    <FormLayout.Group>
                      <TextField
                        label="Tier Name"
                        name="name"
                        requiredIndicator
                        placeholder="e.g., Silver, Gold, Platinum"
                        autoComplete="off"
                      />
                      <TextField
                        label="Cashback %"
                        name="cashbackPercent"
                        type="number"
                        requiredIndicator
                        placeholder="5"
                        step={0.1}
                        min={0}
                        max={100}
                        autoComplete="off"
                      />
                    </FormLayout.Group>
                    <FormLayout.Group>
                      <TextField
                        label="Minimum Spend"
                        name="minSpend"
                        type="number"
                        placeholder="0.00"
                        min={0}
                        step={0.01}
                        helpText="Leave empty for base tier"
                        autoComplete="off"
                      />
                      <Select
                        label="Evaluation Period"
                        name="evaluationPeriod"
                        requiredIndicator
                        options={[
                          {
                            label: "12-month rolling",
                            value: "ANNUAL",
                          },
                          {
                            label: "Lifetime (never expires)",
                            value: "LIFETIME",
                          },
                        ]}
                      />
                    </FormLayout.Group>
                  </FormLayout>
                  <InlineStack gap="300">
                    <Button submit loading={isSubmitting} variant="primary">
                      Create Tier
                    </Button>
                    <Button onClick={() => setShowCreateForm(false)}>
                      Cancel
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Form>
            </Card>
          </Collapsible>
        </Layout.Section>

        {/* Tiers Table */}
        <Layout.Section>
          {tiers.length === 0 ? (
            <Card>
              <EmptyState
                heading="No tiers yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{
                  content: "Create First Tier",
                  onAction: () => setShowCreateForm(true),
                }}
              >
                <p>
                  Create your first tier to start rewarding customers
                </p>
              </EmptyState>
            </Card>
          ) : (
            <Card>
              <DataTable
                columnContentTypes={[
                  "text",
                  "numeric",
                  "numeric",
                  "text",
                  "numeric",
                  "numeric",
                  "text",
                  "text",
                ]}
                headings={[
                  "Tier Name",
                  "Cashback %",
                  "Min Spend",
                  "Evaluation",
                  "Members",
                  "Avg Yearly Spend",
                  "Status",
                  "Actions",
                ]}
                rows={tiers.map((tier: any) => {
                  if (editingTierId === tier.id) {
                    // Inline edit — just show a single-row form cue; actual edit is below
                    return [
                      <Text as="span" fontWeight="bold" key="name">
                        {tier.name}
                      </Text>,
                      `${tier.cashbackPercent}%`,
                      tier.minSpend
                        ? `$${tier.minSpend.toFixed(2)}`
                        : "No minimum",
                      tier.evaluationPeriod === "LIFETIME"
                        ? "Lifetime"
                        : "12-month",
                      String(tier.memberCount),
                      `$${tier.avgYearlySpending.toFixed(2)}`,
                      <Badge
                        key="status"
                        tone={tier.isActive ? "success" : "warning"}
                      >
                        {tier.isActive ? "Active" : "Inactive"}
                      </Badge>,
                      <Text key="editing" as="span" tone="subdued">
                        Editing...
                      </Text>,
                    ];
                  }
                  return [
                    <Text as="span" fontWeight="bold" key="name">
                      {tier.name}
                    </Text>,
                    `${tier.cashbackPercent}%`,
                    tier.minSpend
                      ? `$${tier.minSpend.toFixed(2)}`
                      : "No minimum",
                    tier.evaluationPeriod === "LIFETIME"
                      ? "Lifetime"
                      : "12-month",
                    String(tier.memberCount),
                    `$${tier.avgYearlySpending.toFixed(2)}`,
                    <Badge
                      key="status"
                      tone={tier.isActive ? "success" : "warning"}
                    >
                      {tier.isActive ? "Active" : "Inactive"}
                    </Badge>,
                    <InlineStack gap="200" key="actions">
                      <Button
                        size="slim"
                        variant="plain"
                        onClick={() => setEditingTierId(tier.id)}
                      >
                        Edit
                      </Button>
                      <fetcher.Form
                        method="post"
                        style={{ display: "inline" }}
                      >
                        <input
                          type="hidden"
                          name="_action"
                          value="delete"
                        />
                        <input
                          type="hidden"
                          name="tierId"
                          value={tier.id}
                        />
                        <Button
                          size="slim"
                          variant="plain"
                          tone="critical"
                          submit
                          disabled={tier.memberCount > 0}
                        >
                          Delete
                        </Button>
                      </fetcher.Form>
                    </InlineStack>,
                  ];
                })}
              />

              {/* Edit form rendered below the table */}
              {editingTierId && (
                <Box padding="400" borderBlockStartWidth="025" borderColor="border">
                  <Form method="post">
                    <input type="hidden" name="_action" value="update" />
                    <input
                      type="hidden"
                      name="tierId"
                      value={editingTierId}
                    />
                    <BlockStack gap="400">
                      <Text as="h3" variant="headingMd">
                        Edit Tier
                      </Text>
                      <FormLayout>
                        <FormLayout.Group>
                          <TextField
                            label="Tier Name"
                            name="name"
                            value={editName}
                            onChange={setEditName}
                            requiredIndicator
                            autoComplete="off"
                          />
                          <TextField
                            label="Cashback %"
                            name="cashbackPercent"
                            type="number"
                            value={editCashback}
                            onChange={setEditCashback}
                            requiredIndicator
                            step={0.1}
                            min={0}
                            max={100}
                            autoComplete="off"
                          />
                        </FormLayout.Group>
                        <FormLayout.Group>
                          <TextField
                            label="Minimum Spend"
                            name="minSpend"
                            type="number"
                            value={editMinSpend}
                            onChange={setEditMinSpend}
                            placeholder="No minimum"
                            min={0}
                            step={0.01}
                            autoComplete="off"
                          />
                          <Select
                            label="Evaluation Period"
                            name="evaluationPeriod"
                            value={editEvalPeriod}
                            onChange={setEditEvalPeriod}
                            options={[
                              {
                                label: "12-month rolling",
                                value: "ANNUAL",
                              },
                              {
                                label: "Lifetime",
                                value: "LIFETIME",
                              },
                            ]}
                          />
                        </FormLayout.Group>
                        <input
                          type="hidden"
                          name="isActive"
                          value={editingTier?.isActive ? "true" : "false"}
                        />
                      </FormLayout>
                      <InlineStack gap="300">
                        <Button
                          submit
                          loading={isSubmitting}
                          variant="primary"
                        >
                          Save Changes
                        </Button>
                        <Button
                          onClick={() => setEditingTierId(null)}
                        >
                          Cancel
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Form>
                </Box>
              )}
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
