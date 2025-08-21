import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, useNavigate } from "@remix-run/react";
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
  Spinner,
  EmptyState
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";
import { assignTierManually, evaluateCustomerTier } from "../services/customer-tier.server";

interface CustomerData {
  id: string;
  email: string;
  shopifyCustomerId: string;
  storeCredit: number;
  totalEarned: number;
  currentTier: {
    id: string;
    name: string;
    cashbackPercent: number;
  } | null;
  annualSpending: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  // Get customers with tier info
  const customers = await prisma.customer.findMany({
    where: { shopDomain },
    include: {
      membershipHistory: {
        where: { isActive: true },
        include: { tier: true }
      },
      transactions: {
        where: {
          createdAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
          status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
        }
      }
    },
    orderBy: { storeCredit: 'desc' }
  });
  
  // Format customer data
  const customersWithData: CustomerData[] = customers.map(customer => {
    const annualSpending = customer.transactions.reduce((sum, t) => sum + t.orderAmount, 0);
    const currentMembership = customer.membershipHistory[0];
    
    return {
      id: customer.id,
      email: customer.email,
      shopifyCustomerId: customer.shopifyCustomerId,
      storeCredit: customer.storeCredit,
      totalEarned: customer.totalEarned,
      currentTier: currentMembership?.tier ? {
        id: currentMembership.tier.id,
        name: currentMembership.tier.name,
        cashbackPercent: currentMembership.tier.cashbackPercent
      } : null,
      annualSpending
    };
  });
  
  // Get available tiers
  const tiers = await prisma.tier.findMany({
    where: { shopDomain, isActive: true },
    orderBy: { cashbackPercent: 'asc' }
  });
  
  return {
    customers: customersWithData,
    tiers,
    stats: {
      totalCustomers: customers.length,
      customersWithCredit: customers.filter(c => c.storeCredit > 0).length,
      customersWithTiers: customers.filter(c => c.membershipHistory.length > 0).length,
    }
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;
  
  if (actionType === "assignTier") {
    const customerId = formData.get("customerId") as string;
    const tierId = formData.get("tierId") as string;
    const reason = formData.get("reason") as string || "Manual assignment via admin";
    
    try {
      await assignTierManually(customerId, tierId, shopDomain, `${shopDomain}-admin`, reason);
      return { success: true, message: "Tier assigned successfully" };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to assign tier" 
      };
    }
  }
  
  if (actionType === "evaluateTier") {
    const customerId = formData.get("customerId") as string;
    try {
      await evaluateCustomerTier(customerId, shopDomain);
      return { success: true, message: "Customer tier evaluated" };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to evaluate tier" 
      };
    }
  }
  
  if (actionType === "evaluateAll") {
    try {
      const customers = await prisma.customer.findMany({ where: { shopDomain } });
      let evaluated = 0;
      for (const customer of customers) {
        await evaluateCustomerTier(customer.id, shopDomain);
        evaluated++;
      }
      return { success: true, message: `Evaluated ${evaluated} customers` };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Failed to evaluate tiers" 
      };
    }
  }
  
  // Handle store credit adjustment
  const customerId = formData.get("customerId") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const creditAction = formData.get("creditAction") as string;
  
  if (!customerId || !amount || amount <= 0) {
    return { success: false, error: "Invalid amount" };
  }
  
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });
    
    if (!customer || customer.shopDomain !== shopDomain) {
      throw new Error("Customer not found");
    }
    
    const mutation = creditAction === "add" 
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
    
    const variables = creditAction === "add"
      ? {
          id: `gid://shopify/Customer/${customer.shopifyCustomerId}`,
          creditInput: { creditAmount: { amount: amount.toFixed(2), currencyCode: "USD" } }
        }
      : {
          id: `gid://shopify/Customer/${customer.shopifyCustomerId}`,
          debitInput: { debitAmount: { amount: amount.toFixed(2), currencyCode: "USD" } }
        };
    
    const response = await admin.graphql(mutation, { variables });
    const result = await response.json();
    
    const mutationResult = creditAction === "add" 
      ? result.data?.storeCreditAccountCredit
      : result.data?.storeCreditAccountDebit;
    
    if (mutationResult?.userErrors?.length > 0) {
      throw new Error(mutationResult.userErrors[0].message);
    }
    
    // Update local database
    const newBalance = creditAction === "add" 
      ? customer.storeCredit + amount 
      : customer.storeCredit - amount;
    
    await prisma.customer.update({
      where: { id: customerId },
      data: { storeCredit: newBalance }
    });
    
    return { 
      success: true, 
      message: `Successfully ${creditAction === "add" ? "added" : "removed"} $${amount.toFixed(2)}`
    };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to adjust credit"
    };
  }
};

export default function CustomerTiers() {
  const { customers, tiers, stats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();
  
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTier, setSelectedTier] = useState("all");
  const [modalActive, setModalActive] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerData | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditAction, setCreditAction] = useState<"add" | "remove">("add");
  
  const isSubmitting = navigation.state === "submitting";
  
  // Filter customers
  const filteredCustomers = customers.filter(customer => {
    const matchesSearch = customer.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTier = selectedTier === "all" || 
      (selectedTier === "none" && !customer.currentTier) ||
      customer.currentTier?.id === selectedTier;
    return matchesSearch && matchesTier;
  });
  
  // Format data for table
  const rows = filteredCustomers.map(customer => [
    customer.email,
    customer.currentTier ? `${customer.currentTier.name} (${customer.currentTier.cashbackPercent}%)` : "—",
    `$${customer.storeCredit.toFixed(2)}`,
    `$${customer.annualSpending.toFixed(2)}`,
    customer.id
  ]);
  
  const handleTierAssignment = () => {
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
  };
  
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
        loading: isSubmitting
      }}
    >
      <Layout>
        {actionData && (
          <Layout.Section>
            <Banner
              tone={actionData.success ? "success" : "critical"}
              onDismiss={() => {}}
            >
              {actionData.success && "message" in actionData ? actionData.message : ""}
              {!actionData.success && "error" in actionData ? actionData.error : ""}
            </Banner>
          </Layout.Section>
        )}
        
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineGrid columns={3} gap="400">
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingLg">
                      {stats.totalCustomers}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Total Customers
                    </Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingLg">
                      {stats.customersWithTiers}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      With Tiers
                    </Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingLg">
                      {stats.customersWithCredit}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Have Store Credit
                    </Text>
                  </BlockStack>
                </Card>
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>
        
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineGrid columns={2} gap="400">
                <TextField
                  label="Search customers"
                  value={searchTerm}
                  onChange={setSearchTerm}
                  placeholder="Email address..."
                  autoComplete="off"
                />
                <Select
                  label="Filter by tier"
                  options={[
                    { label: "All customers", value: "all" },
                    { label: "No tier", value: "none" },
                    ...tiers.map(tier => ({
                      label: `${tier.name} (${tier.cashbackPercent}%)`,
                      value: tier.id
                    }))
                  ]}
                  value={selectedTier}
                  onChange={setSelectedTier}
                />
              </InlineGrid>
              
              {filteredCustomers.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "numeric", "text"]}
                  headings={["Customer", "Current Tier", "Store Credit", "Annual Spending", "Actions"]}
                  rows={rows.map(row => {
                    const customerId = row[4] as string;
                    const customer = customers.find(c => c.id === customerId);
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
                          onClick={() => navigate(`/app/customers/${customerId}`)}
                        >
                          View Details
                        </Button>
                      </BlockStack>
                    ];
                  })}
                />
              ) : (
                <EmptyState
                  heading="No customers found"
                  image=""
                >
                  <p>Try adjusting your search or filters</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
        
        {isSubmitting && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999
          }}>
            <Spinner size="large" />
          </div>
        )}
      </Layout>
      
      <Modal
        open={modalActive}
        onClose={() => setModalActive(false)}
        title={`Adjust Store Credit: ${selectedCustomer?.email}`}
        primaryAction={{
          content: creditAction === "add" ? "Add Credit" : "Remove Credit",
          onAction: handleTierAssignment,
          disabled: !creditAmount || parseFloat(creditAmount) <= 0
        }}
        secondaryActions={[{
          content: "Cancel",
          onAction: () => setModalActive(false)
        }]}
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
                { label: "Remove credit", value: "remove" }
              ]}
              value={creditAction}
              onChange={(value) => setCreditAction(value as "add" | "remove")}
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