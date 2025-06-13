// app/routes/app.store-credit.tsx
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  Text,
  BlockStack,
  InlineGrid,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  // Get recent customers with balances
  const customersWithCredit = await prisma.customer.findMany({
    where: {
      storeCredit: { gt: 0 }
    },
    orderBy: {
      updatedAt: 'desc'
    },
    take: 10
  });
  
  return json({ customersWithCredit });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const customerId = formData.get("customerId") as string;
  const amount = parseFloat(formData.get("amount") as string);
  const currency = formData.get("currency") as string || "USD";
  
  if (!customerId || !amount) {
    return json({ 
      success: false, 
      error: "Customer ID and amount are required" 
    });
  }
  
  try {
    // Issue store credit via GraphQL
    const response = await admin.graphql(
      `#graphql
      mutation storeCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
        storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
          storeCreditAccountTransaction {
            id
            amount {
              amount
              currencyCode
            }
            balanceAfterTransaction {
              amount
              currencyCode
            }
            account {
              id
              balance {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
            code
          }
        }
      }`,
      {
        variables: {
          id: `gid://shopify/Customer/${customerId}`,
          creditInput: {
            creditAmount: {
              amount: amount.toFixed(2),
              currencyCode: currency
            }
          }
        }
      }
    );
    
    const result = await response.json();
    
    if (result.data?.storeCreditAccountCredit?.userErrors?.length > 0) {
      const errors = result.data.storeCreditAccountCredit.userErrors;
      return json({ 
        success: false, 
        error: errors.map((e: any) => e.message).join(", "),
        errorDetails: errors 
      });
    }
    
    if (result.data?.storeCreditAccountCredit?.storeCreditAccountTransaction) {
      const transaction = result.data.storeCreditAccountCredit.storeCreditAccountTransaction;
      return json({ 
        success: true,
        transaction: {
          id: transaction.id,
          amount: `${transaction.amount.amount} ${transaction.amount.currencyCode}`,
          newBalance: `${transaction.balanceAfterTransaction.amount} ${transaction.balanceAfterTransaction.currencyCode}`
        }
      });
    }
    
    return json({ 
      success: false, 
      error: "Unknown error occurred",
      rawResponse: result 
    });
    
  } catch (error) {
    console.error("Store credit error:", error);
    return json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to issue store credit",
      errorDetails: error
    });
  }
};

export default function StoreCreditTest() {
  const { customersWithCredit } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  
  return (
    <Page title="Store Credit Test">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Manual Store Credit Test
              </Text>
              
              {actionData?.success && (actionData as any).transaction && (
                <Banner tone="success">
                  <p>Store credit issued successfully!</p>
                  <p>Transaction ID: {(actionData as any).transaction.id}</p>
                  <p>Amount: {(actionData as any).transaction.amount}</p>
                  <p>New Balance: {(actionData as any).transaction.newBalance}</p>
                </Banner>
              )}
              
              {actionData && !actionData.success && (
                <Banner tone="critical">
                  <p>{(actionData as any).error}</p>
                  {(actionData as any).errorDetails && (
                    <details>
                      <summary>Error Details</summary>
                      <pre>{JSON.stringify((actionData as any).errorDetails, null, 2)}</pre>
                    </details>
                  )}
                </Banner>
              )}
              
              <Form method="post">
                <FormLayout>
                  <TextField
                    label="Customer ID (Shopify ID without gid://)"
                    name="customerId"
                    type="text"
                    autoComplete="off"
                    placeholder="e.g., 7456532553044"
                    helpText="Enter the numeric customer ID from Shopify"
                  />
                  
                  <InlineGrid columns={2} gap="400">
                    <TextField
                      label="Amount"
                      name="amount"
                      type="number"
                      step={0.01}
                      min="0"
                      autoComplete="off"
                      placeholder="10.00"
                    />
                    
                    <TextField
                      label="Currency"
                      name="currency"
                      type="text"
                      autoComplete="off"
                      value="USD"
                      placeholder="USD"
                    />
                  </InlineGrid>
                  
                  <Button submit variant="primary" loading={isSubmitting}>
                    Issue Store Credit
                  </Button>
                </FormLayout>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>
        
        {customersWithCredit.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Customers with Database Credit
                </Text>
                <BlockStack gap="300">
                  {customersWithCredit.map((customer) => (
                    <Box key={customer.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="200">
                        <Text variant="bodyMd" fontWeight="semibold" as="p">
                          {customer.email}
                        </Text>
                        <Text variant="bodySm" as="p">
                          Shopify ID: {customer.shopifyCustomerId}
                        </Text>
                        <Text variant="bodySm" as="p">
                          Database Credit: ${customer.storeCredit.toFixed(2)}
                        </Text>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}