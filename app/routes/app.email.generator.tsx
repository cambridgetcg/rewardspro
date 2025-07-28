// app/routes/app.notifications.email.tsx
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  Button,
  EmptyState,
  BlockStack,
  InlineGrid,
  Box,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  const templates = await prisma.emailTemplate.findMany({
    where: { shopDomain: session.shop },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { emailLogs: true }
      }
    }
  });
  
  return json({ templates });
};

export default function EmailTemplates() {
  const { templates } = useLoaderData<typeof loader>();
  
  const rows = templates.map((template) => [
    template.name,
    template.enabled ? (
      <Badge tone="success">Active</Badge>
    ) : (
      <Badge>Inactive</Badge>
    ),
    template.type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
    template.tone.charAt(0) + template.tone.slice(1).toLowerCase(),
    template._count.emailLogs.toString(),
    <Button
      variant="plain"
      url={`/app/notifications/email/${template.id}/edit`}
    >
      Edit
    </Button>
  ]);
  
  return (
    <Page
      title="Email Templates"
      primaryAction={{
        content: "Generate with AI",
        icon: "✨",
        url: "/app/notifications/email/generator"
      }}
      secondaryActions={[
        {
          content: "Create Manually",
          url: "/app/notifications/email/new"
        }
      ]}
    >
      <Layout>
        {templates.length === 0 ? (
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Create your first email template"
                action={{
                  content: "Generate with AI",
                  url: "/app/notifications/email/generator"
                }}
                secondaryAction={{
                  content: "Create manually",
                  url: "/app/notifications/email/new"
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Email templates help you communicate with customers about their tier status and store credits.
                  Use AI to generate professional templates in seconds.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        ) : (
          <>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineGrid columns={4} gap="400">
                    <Box>
                      <Text variant="headingSm" as="h3">Total Templates</Text>
                      <Text variant="heading2xl" as="p">{templates.length}</Text>
                    </Box>
                    <Box>
                      <Text variant="headingSm" as="h3">Active</Text>
                      <Text variant="heading2xl" as="p" tone="success">
                        {templates.filter(t => t.enabled).length}
                      </Text>
                    </Box>
                    <Box>
                      <Text variant="headingSm" as="h3">Total Sent</Text>
                      <Text variant="heading2xl" as="p">
                        {templates.reduce((sum, t) => sum + t._count.emailLogs, 0)}
                      </Text>
                    </Box>
                    <Box>
                      <Text variant="headingSm" as="h3">Template Types</Text>
                      <Text variant="heading2xl" as="p">
                        {new Set(templates.map(t => t.type)).size}
                      </Text>
                    </Box>
                  </InlineGrid>
                </BlockStack>
              </Card>
            </Layout.Section>
            
            <Layout.Section>
              <Card>
                <DataTable
                  columnContentTypes={[
                    'text',
                    'text',
                    'text',
                    'text',
                    'numeric',
                    'text',
                  ]}
                  headings={[
                    'Template Name',
                    'Status',
                    'Type',
                    'Tone',
                    'Emails Sent',
                    'Actions',
                  ]}
                  rows={rows}
                />
              </Card>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}