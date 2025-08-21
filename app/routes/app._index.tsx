import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Button,
  Banner,
  List,
  Badge,
  InlineGrid,
  Box,
  CalloutCard,
  MediaCard,
  VideoThumbnail,
  Icon,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  StoreIcon,
  CodeIcon,
  ViewIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Get basic stats to show setup progress
  const [hasCustomers, hasTiers, hasTransactions] = await Promise.all([
    db.customer.count().then(count => count > 0),
    db.tier.count({ where: { shopDomain: session.shop } }).then(count => count > 0),
    db.cashbackTransaction.count().then(count => count > 0),
  ]);

  const setupProgress = {
    hasCustomers,
    hasTiers,
    hasTransactions,
    widgetInstalled: false // We can't automatically detect this
  };

  return json({
    shopDomain: session.shop,
    setupProgress
  });
};

export default function Index() {
  const { shopDomain, setupProgress } = useLoaderData<typeof loader>();
  
  const setupSteps = [
    {
      completed: setupProgress.hasTiers,
      title: "Configure Cashback Tiers",
      description: "Set up your reward tiers with different cashback percentages",
      action: "/app/tiers"
    },
    {
      completed: false, // Widget installation can't be auto-detected
      title: "Install RewardsPro Widget",
      description: "Add the widget to your store theme to display cashback rates",
      action: null
    },
    {
      completed: setupProgress.hasCustomers,
      title: "Import Customers",
      description: "Your customers will be automatically synced when they make purchases",
      action: "/app/customers/tiers"
    },
    {
      completed: setupProgress.hasTransactions,
      title: "Process First Transaction",
      description: "Cashback will be calculated automatically on new orders",
      action: null
    }
  ];

  const completedSteps = setupSteps.filter(step => step.completed).length;
  const totalSteps = setupSteps.length;
  const setupComplete = completedSteps === totalSteps;

  return (
    <Page title="Welcome to RewardsPro">
      <Layout>
        {/* Setup Progress Banner */}
        <Layout.Section>
          <Banner
            title="Setup Progress"
            tone={setupComplete ? "success" : "info"}
            icon={setupComplete ? CheckCircleIcon : AlertCircleIcon}
          >
            <Text as="p">
              {setupComplete 
                ? "Great! Your RewardsPro app is fully configured."
                : `You've completed ${completedSteps} of ${totalSteps} setup steps.`}
            </Text>
          </Banner>
        </Layout.Section>

        {/* Widget Installation Guide */}
        <Layout.Section>
          <CalloutCard
            title="🎯 Critical Setup: Install the RewardsPro Widget"
            illustration="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            primaryAction={{
              content: "Open Theme Customizer",
              url: `https://${shopDomain}/admin/themes/current/editor`,
              external: true,
            }}
          >
            <Text as="p" variant="bodyMd">
              The RewardsPro widget displays cashback rates to your customers on product pages. 
              Without it, customers won't see their potential rewards!
            </Text>
          </CalloutCard>
        </Layout.Section>

        {/* Installation Steps */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <BlockStack gap="500">
                <Text as="h2" variant="headingLg">
                  How to Install the Widget (2 minutes)
                </Text>
                
                <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                  <Card>
                    <Box padding="400">
                      <BlockStack gap="300">
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          width: '48px',
                          height: '48px',
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          borderRadius: '12px',
                          marginBottom: '8px'
                        }}>
                          <Icon source={StoreIcon} tone="base" />
                        </div>
                        <Text as="h3" variant="headingMd">
                          Step 1: Open Theme Editor
                        </Text>
                        <Text as="p" tone="subdued">
                          Click "Open Theme Customizer" above or go to:
                        </Text>
                        <Badge tone="info">
                          Online Store → Themes → Customize
                        </Badge>
                      </BlockStack>
                    </Box>
                  </Card>

                  <Card>
                    <Box padding="400">
                      <BlockStack gap="300">
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          width: '48px',
                          height: '48px',
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          borderRadius: '12px',
                          marginBottom: '8px'
                        }}>
                          <Icon source={CodeIcon} tone="base" />
                        </div>
                        <Text as="h3" variant="headingMd">
                          Step 2: Add App Block
                        </Text>
                        <List type="bullet">
                          <List.Item>Navigate to a product page</List.Item>
                          <List.Item>Click "Add block" in the product section</List.Item>
                          <List.Item>Search for "RewardsPro"</List.Item>
                          <List.Item>Select "Rewards Widget"</List.Item>
                        </List>
                      </BlockStack>
                    </Box>
                  </Card>

                  <Card>
                    <Box padding="400">
                      <BlockStack gap="300">
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          width: '48px',
                          height: '48px',
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          borderRadius: '12px',
                          marginBottom: '8px'
                        }}>
                          <Icon source={ViewIcon} tone="base" />
                        </div>
                        <Text as="h3" variant="headingMd">
                          Step 3: Position & Save
                        </Text>
                        <Text as="p" tone="subdued">
                          Drag the widget to your preferred position (we recommend below the "Add to Cart" button), then click "Save" in the top right.
                        </Text>
                      </BlockStack>
                    </Box>
                  </Card>
                </InlineGrid>

                <Banner tone="warning">
                  <Text as="p" fontWeight="semibold">
                    Important: The widget must be added to display cashback percentages to customers!
                  </Text>
                </Banner>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        {/* What the Widget Does */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">
                    What the Widget Shows
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" fontWeight="semibold">Cashback Rate:</Text> Displays the customer's current tier percentage
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="semibold">Potential Earnings:</Text> Shows how much they'll earn from this purchase
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="semibold">Current Balance:</Text> Their available store credit (if logged in)
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="semibold">Tier Status:</Text> Current tier name and benefits
                    </List.Item>
                  </List>
                  <Text as="p" tone="subdued">
                    The widget automatically updates based on customer tier and product price.
                  </Text>
                </BlockStack>
              </Box>
            </Card>

            <Card>
              <Box padding="400">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">
                    Setup Checklist
                  </Text>
                  {setupSteps.map((step, index) => (
                    <div key={index} style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '12px',
                      padding: '8px',
                      background: step.completed ? '#f0fdf4' : '#fafafa',
                      borderRadius: '8px'
                    }}>
                      <Icon 
                        source={CheckCircleIcon} 
                        tone={step.completed ? "success" : "subdued"}
                      />
                      <div style={{ flex: 1 }}>
                        <Text as="p" fontWeight="semibold">
                          {step.title}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {step.description}
                        </Text>
                      </div>
                      {step.action && !step.completed && (
                        <Button url={step.action} size="slim">
                          Setup
                        </Button>
                      )}
                    </div>
                  ))}
                </BlockStack>
              </Box>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {/* Quick Actions */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  Next Steps
                </Text>
                <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                  <Button url="/app/tiers" fullWidth>
                    Configure Tiers
                  </Button>
                  <Button url="/app/customers/tiers" fullWidth>
                    Manage Customers
                  </Button>
                  <Button url="/app/dashboard" fullWidth>
                    View Dashboard
                  </Button>
                  <Button url="/app/email/generator" fullWidth>
                    Setup Emails
                  </Button>
                </InlineGrid>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>

        {/* Help Section */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Need Help?
                </Text>
                <Text as="p" tone="subdued">
                  If you're having trouble installing the widget or have questions about RewardsPro:
                </Text>
                <List type="bullet">
                  <List.Item>Check our documentation for detailed guides</List.Item>
                  <List.Item>Contact support at support@rewardspro.app</List.Item>
                  <List.Item>Visit the Shopify App Store for FAQs</List.Item>
                </List>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}