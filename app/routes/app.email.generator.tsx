// app/routes/app.test-openai-minimal.tsx
// Minimal version with fewer potential type issues

import { useState } from "react";
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  BlockStack,
  Banner,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const hasKey = !!process.env.OPENAI_API_KEY;
  return json({ hasKey });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  
  const formData = await request.formData();
  const prompt = formData.get("prompt") as string;
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    return json({ error: "No API key configured", result: null });
  }
  
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.7,
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || "API request failed");
    }
    
    return json({
      error: null,
      result: data.choices[0]?.message?.content || "No response",
    });
    
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Unknown error",
      result: null,
    });
  }
};

export default function TestOpenAIMinimal() {
  const { hasKey } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [prompt, setPrompt] = useState("Write a friendly welcome email for a new customer.");
  
  return (
    <Page title="OpenAI API Test (Minimal)">
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">Configuration Status</Text>
          <Text as="p">
            API Key: {hasKey ? "✅ Configured" : "❌ Not configured"}
          </Text>
          
          {!hasKey && (
            <Banner tone="warning">
              Add OPENAI_API_KEY to your .env file
            </Banner>
          )}
          
          <Form method="post">
            <FormLayout>
              <TextField
                label="Test Prompt"
                value={prompt}
                onChange={setPrompt}
                name="prompt"
                multiline={3}
                autoComplete="off"
              />
              
              <Button
                submit
                variant="primary"
                loading={navigation.state === "submitting"}
                disabled={!hasKey}
              >
                Test API
              </Button>
            </FormLayout>
          </Form>
          
          {actionData?.error && (
            <Banner tone="critical">{actionData.error}</Banner>
          )}
          
          {actionData?.result && (
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">API Response:</Text>
                <div style={{ 
                  padding: '12px', 
                  backgroundColor: '#f3f4f6', 
                  borderRadius: '8px',
                  whiteSpace: 'pre-wrap'
                }}>
                  {actionData.result}
                </div>
              </BlockStack>
            </Card>
          )}
        </BlockStack>
      </Card>
    </Page>
  );
}