// app/routes/app.env-check.tsx
// Just check what environment variables we can see

import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, Text } from "@shopify/polaris";

export const loader = async () => {
  // Log everything to console
  console.log("=== ENVIRONMENT CHECK ===");
  console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY);
  console.log("Exists?", !!process.env.OPENAI_API_KEY);
  console.log("Type:", typeof process.env.OPENAI_API_KEY);
  console.log("Length:", process.env.OPENAI_API_KEY?.length);
  console.log("First 10:", process.env.OPENAI_API_KEY?.substring(0, 10));
  console.log("All OPEN* keys:", Object.keys(process.env).filter(k => k.includes('OPEN')));
  console.log("=======================");
  
  return json({
    hasKey: !!process.env.OPENAI_API_KEY,
    keyLength: process.env.OPENAI_API_KEY?.length || 0,
    keyPreview: process.env.OPENAI_API_KEY?.substring(0, 7) || "missing",
    nodeEnv: process.env.NODE_ENV,
    cwd: process.cwd(),
  });
};

export default function EnvCheck() {
  const data = useLoaderData<typeof loader>();
  
  return (
    <Page title="Environment Check">
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Environment Variables</Text>
          
          <div style={{ fontFamily: 'monospace', background: '#f5f5f5', padding: '16px', borderRadius: '8px' }}>
            <div>OPENAI_API_KEY exists: {data.hasKey ? '✅ YES' : '❌ NO'}</div>
            <div>Key length: {data.keyLength}</div>
            <div>Key preview: {data.keyPreview}...</div>
            <div>Node ENV: {data.nodeEnv}</div>
            <div>Working dir: {data.cwd}</div>
          </div>
          
          <Text as="p" variant="bodySm" tone="subdued">
            Check your terminal for detailed logs
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}