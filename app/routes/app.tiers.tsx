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
  IndexTable,
  Button,
  TextField,
  Select,
  BlockStack,
  InlineStack,
  Text,
  Banner,
  Badge,
  Box,
  EmptyState,
  FormLayout,
  Collapsible,
  Modal,
} from "@shopify/polaris";
import { HeroMetric } from "../components/HeroMetric";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const [tierDistribution, totalCustomers, totalCashback] = await Promise.all([
    getTierDistribution(session.shop),
    prisma.customer.count({ where: { shopDomain: session.shop } }),
    prisma.cashbackTransaction.aggregate({
      where: { shopDomain: session.shop },
      _sum: { cashbackAmount: true },
    }),
  ]);

  const tiers = tierDistribution || [];
  const totalMembers = tiers.reduce((s, t) => s + t.memberCount, 0);

  return json({
    tiers,
    hero: {
      totalMembers,
      totalCustomers,
      activeTiers: tiers.filter((t) => t.isActive).length,
      totalCashback: totalCashback._sum.cashbackAmount || 0,
    },
  });
}

type ActionResponse =
  | { success: true; message?: string }
  | { success: false; error: string };

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("_action");

  try {
    if (action === "create") {
      const name = formData.get("name") as string;
      const cashbackPercent = parseFloat(formData.get("cashbackPercent") as string);
      const evaluationPeriod = formData.get("evaluationPeriod") as EvaluationPeriod;

      const exists = await prisma.tier.findFirst({
        where: { shopDomain: session.shop, name },
      });
      if (exists) {
        return json<ActionResponse>({ success: false, error: "Name already exists" }, { status: 400 });
      }

      await prisma.tier.create({
        data: {
          shopDomain: session.shop,
          name,
          minSpend: formData.get("minSpend") ? parseFloat(formData.get("minSpend") as string) : null,
          cashbackPercent,
          evaluationPeriod: evaluationPeriod || EvaluationPeriod.ANNUAL,
          isActive: true,
        },
      });
      return json<ActionResponse>({ success: true, message: "Tier created" });
    }

    if (action === "update") {
      const tierId = formData.get("tierId") as string;
      const name = formData.get("name") as string;
      const current = await prisma.tier.findUnique({
        where: { id: tierId, shopDomain: session.shop },
      });
      if (!current) return json<ActionResponse>({ success: false, error: "Not found" }, { status: 404 });

      if (name && name !== current.name) {
        const dup = await prisma.tier.findFirst({
          where: { shopDomain: session.shop, name, id: { not: tierId } },
        });
        if (dup) return json<ActionResponse>({ success: false, error: "Name already exists" }, { status: 400 });
      }

      await prisma.tier.update({
        where: { id: tierId, shopDomain: session.shop },
        data: {
          name: name || current.name,
          minSpend: formData.get("minSpend") ? parseFloat(formData.get("minSpend") as string) : null,
          cashbackPercent: parseFloat(formData.get("cashbackPercent") as string),
          evaluationPeriod: (formData.get("evaluationPeriod") as EvaluationPeriod) || current.evaluationPeriod,
          isActive: formData.get("isActive") === "true",
        },
      });
      return json<ActionResponse>({ success: true, message: "Tier updated" });
    }

    if (action === "delete") {
      const tierId = formData.get("tierId") as string;
      const members = await prisma.customerMembership.count({ where: { tierId, isActive: true } });
      if (members > 0) {
        return json<ActionResponse>({ success: false, error: "Has active members" }, { status: 400 });
      }
      await prisma.tier.delete({ where: { id: tierId, shopDomain: session.shop } });
      return json<ActionResponse>({ success: true, message: "Tier deleted" });
    }

    if (action === "evaluateAll") {
      const r = await batchEvaluateCustomerTiers(session.shop);
      return json<ActionResponse>({ success: true, message: `${r.successful} of ${r.totalProcessed} evaluated` });
    }

    if (action === "handleExpired") {
      const r = await handleExpiredMemberships(session.shop);
      return json<ActionResponse>({ success: true, message: `${r.filter((x) => x.success).length} processed` });
    }
  } catch (error) {
    return json<ActionResponse>({ success: false, error: "An error occurred" }, { status: 500 });
  }

  return json<ActionResponse>({ success: true });
}

function formatCurrency(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function TierSettings() {
  const { tiers, hero } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editTier, setEditTier] = useState<any>(null);
  const [bannerVisible, setBannerVisible] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editCashback, setEditCashback] = useState("");
  const [editMinSpend, setEditMinSpend] = useState("");
  const [editEvalPeriod, setEditEvalPeriod] = useState("ANNUAL");

  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData) {
      setBannerVisible(true);
      if (actionData.success) {
        setShowCreateForm(false);
        setEditTier(null);
        const t = setTimeout(() => setBannerVisible(false), 5000);
        return () => clearTimeout(t);
      }
    }
  }, [actionData]);

  useEffect(() => {
    if (editTier) {
      setEditName(editTier.name || "");
      setEditCashback(String(editTier.cashbackPercent));
      setEditMinSpend(editTier.minSpend ? String(editTier.minSpend) : "");
      setEditEvalPeriod(editTier.evaluationPeriod || "ANNUAL");
    }
  }, [editTier]);

  return (
    <Page
      title="Tiers"
      primaryAction={{
        content: showCreateForm ? "Cancel" : "Add Tier",
        onAction: () => setShowCreateForm(!showCreateForm),
        destructive: showCreateForm,
      }}
      secondaryActions={[
        {
          content: "Re-evaluate All",
          loading: isSubmitting,
          onAction: () => {
            const fd = new FormData();
            fd.append("_action", "evaluateAll");
            fetcher.submit(fd, { method: "post" });
          },
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
              {"message" in actionData ? actionData.message : "error" in actionData ? actionData.error : ""}
            </Banner>
          </Layout.Section>
        )}

        {/* Hero: Active Members */}
        <Layout.Section>
          <HeroMetric
            label="Active Members"
            value={String(hero.totalMembers)}
            aside={[
              { label: "Tiers", value: String(hero.activeTiers) },
              { label: "Customers", value: String(hero.totalCustomers) },
              { label: "Cashback Paid", value: formatCurrency(hero.totalCashback) },
            ]}
          />
        </Layout.Section>

        {/* Create Form */}
        <Layout.Section>
          <Collapsible open={showCreateForm} id="create-tier">
            <Card>
              <Form method="post">
                <input type="hidden" name="_action" value="create" />
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">New Tier</Text>
                  <FormLayout>
                    <FormLayout.Group>
                      <TextField label="Name" name="name" requiredIndicator autoComplete="off" />
                      <TextField label="Cashback %" name="cashbackPercent" type="number" requiredIndicator step={0.1} min={0} max={100} autoComplete="off" />
                    </FormLayout.Group>
                    <FormLayout.Group>
                      <TextField label="Min Spend" name="minSpend" type="number" placeholder="None" min={0} step={0.01} helpText="Leave empty for base tier" autoComplete="off" />
                      <Select label="Period" name="evaluationPeriod" options={[{ label: "12-month", value: "ANNUAL" }, { label: "Lifetime", value: "LIFETIME" }]} />
                    </FormLayout.Group>
                  </FormLayout>
                  <InlineStack gap="200">
                    <Button submit variant="primary" loading={isSubmitting}>Create</Button>
                    <Button onClick={() => setShowCreateForm(false)}>Cancel</Button>
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
                action={{ content: "Create First Tier", onAction: () => setShowCreateForm(true) }}
              >
                <p>Create your first tier to start rewarding customers</p>
              </EmptyState>
            </Card>
          ) : (
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "tier", plural: "tiers" }}
                itemCount={tiers.length}
                headings={[
                  { title: "Tier" },
                  { title: "Cashback" },
                  { title: "Min Spend" },
                  { title: "Period" },
                  { title: "Members", alignment: "end" },
                  { title: "Avg Yearly", alignment: "end" },
                  { title: "Status" },
                  { title: "", alignment: "end" },
                ]}
                selectable={false}
              >
                {tiers.map((tier: any, i: number) => (
                  <IndexTable.Row id={tier.id} key={tier.id} position={i}>
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="semibold">{tier.name}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{tier.cashbackPercent}%</IndexTable.Cell>
                    <IndexTable.Cell>
                      {tier.minSpend ? formatCurrency(tier.minSpend) : "—"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {tier.evaluationPeriod === "LIFETIME" ? "Lifetime" : "12-month"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" alignment="end">{tier.memberCount}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" alignment="end">
                        {formatCurrency(tier.avgYearlySpending)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={tier.isActive ? "success" : "warning"}>
                        {tier.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="200" align="end">
                        <Button size="slim" variant="plain" onClick={() => setEditTier(tier)}>
                          Edit
                        </Button>
                        <fetcher.Form method="post" style={{ display: "inline" }}>
                          <input type="hidden" name="_action" value="delete" />
                          <input type="hidden" name="tierId" value={tier.id} />
                          <Button size="slim" variant="plain" tone="critical" submit disabled={tier.memberCount > 0}>
                            Delete
                          </Button>
                        </fetcher.Form>
                      </InlineStack>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      {/* Edit Modal */}
      <Modal
        open={!!editTier}
        onClose={() => setEditTier(null)}
        title={`Edit: ${editTier?.name}`}
        primaryAction={{
          content: "Save",
          loading: isSubmitting,
          onAction: () => {
            if (!editTier) return;
            const fd = new FormData();
            fd.append("_action", "update");
            fd.append("tierId", editTier.id);
            fd.append("name", editName);
            fd.append("cashbackPercent", editCashback);
            fd.append("minSpend", editMinSpend);
            fd.append("evaluationPeriod", editEvalPeriod);
            fd.append("isActive", editTier.isActive ? "true" : "false");
            fetcher.submit(fd, { method: "post" });
            setEditTier(null);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setEditTier(null) }]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField label="Name" value={editName} onChange={setEditName} autoComplete="off" />
            <TextField label="Cashback %" value={editCashback} onChange={setEditCashback} type="number" step={0.1} min={0} max={100} autoComplete="off" />
            <TextField label="Min Spend" value={editMinSpend} onChange={setEditMinSpend} type="number" placeholder="None" min={0} step={0.01} autoComplete="off" />
            <Select label="Period" value={editEvalPeriod} onChange={setEditEvalPeriod} options={[{ label: "12-month", value: "ANNUAL" }, { label: "Lifetime", value: "LIFETIME" }]} />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
