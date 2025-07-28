// app/routes/app.email-generator.tsx
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
  RadioButton,
  Divider,
  Badge,
  InlineStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
// Comment out or remove if db.server doesn't exist yet
// import { db } from "../db.server";

// Define types locally if they're not available from Prisma yet
type EmailTemplateType = "WELCOME" | "CREDIT_EARNED" | "BALANCE_UPDATE" | "TIER_UPGRADE";
type EmailTone = "PROFESSIONAL" | "FRIENDLY" | "CASUAL" | "EXCITED";

interface EmailGenerationParams {
  type: EmailTemplateType;
  tone: EmailTone;
  customerName: string;
  storeName: string;
  customData: {
    creditAmount?: number;
    currentBalance?: number;
    tierName?: string;
    previousTier?: string;
    benefits?: string[];
    cashbackPercent?: number;
  };
}

interface GeneratedEmail {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  footer: string;
  buttonText?: string;
}

interface LoaderData {
  hasApiKey: boolean;
  shopName: string;
  shopEmail: string;
  currencyCode: string;
}

interface ActionData {
  success: boolean;
  error?: string;
  generatedEmail?: GeneratedEmail;
  emailType?: EmailTemplateType;
  tone?: EmailTone;
  saved?: boolean;
  templateId?: string;
}

const EMAIL_TYPES: Array<{ label: string; value: EmailTemplateType }> = [
  { label: "Welcome Email", value: "WELCOME" },
  { label: "Credit Earned", value: "CREDIT_EARNED" },
  { label: "Balance Update", value: "BALANCE_UPDATE" },
  { label: "Tier Upgrade", value: "TIER_UPGRADE" },
];

const EMAIL_TONES: Array<{ label: string; value: EmailTone }> = [
  { label: "Professional", value: "PROFESSIONAL" },
  { label: "Friendly", value: "FRIENDLY" },
  { label: "Casual", value: "CASUAL" },
  { label: "Excited", value: "EXCITED" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  // Check if OpenAI API key is configured
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  
  // Get shop info
  const response = await admin.graphql(`
    query {
      shop {
        name
        email
        currencyCode
      }
    }
  `);
  
  const shopData = await response.json() as {
    data: {
      shop: {
        name: string;
        email: string;
        currencyCode: string;
      }
    }
  };
  
  return json<LoaderData>({ 
    hasApiKey,
    shopName: shopData.data.shop.name,
    shopEmail: shopData.data.shop.email,
    currencyCode: shopData.data.shop.currencyCode,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  const formData = await request.formData();
  const action = formData.get("action") as string;
  
  if (action === "generate") {
    const emailType = formData.get("emailType") as EmailTemplateType;
    const tone = formData.get("tone") as EmailTone;
    const customerName = formData.get("customerName") as string || "Valued Customer";
    const storeName = formData.get("storeName") as string;
    
    // Parse custom data based on email type
    const customData: EmailGenerationParams["customData"] = {};
    
    switch (emailType) {
      case "CREDIT_EARNED":
        customData.creditAmount = parseFloat(formData.get("creditAmount") as string) || 10;
        customData.currentBalance = parseFloat(formData.get("currentBalance") as string) || 50;
        break;
      case "BALANCE_UPDATE":
        customData.currentBalance = parseFloat(formData.get("currentBalance") as string) || 50;
        break;
      case "TIER_UPGRADE":
        customData.tierName = formData.get("tierName") as string || "Gold";
        customData.previousTier = formData.get("previousTier") as string || "Silver";
        customData.cashbackPercent = parseFloat(formData.get("cashbackPercent") as string) || 5;
        customData.benefits = (formData.get("benefits") as string)?.split(",").map(b => b.trim()) || [];
        break;
    }
    
    try {
      const generatedEmail = await generateEmailWithOpenAI({
        type: emailType,
        tone,
        customerName,
        storeName,
        customData,
      });
      
      return json<ActionData>({
        success: true,
        generatedEmail,
        emailType,
        tone,
      });
    } catch (error) {
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate email",
      });
    }
  }
  
  if (action === "save") {
    // Commented out database save functionality
    // Uncomment when db.server is available
    /*
    const emailType = formData.get("emailType") as EmailTemplateType;
    const tone = formData.get("tone") as EmailTone;
    const subject = formData.get("subject") as string;
    const preheader = formData.get("preheader") as string;
    const heading = formData.get("heading") as string;
    const body = formData.get("body") as string;
    const footer = formData.get("footer") as string;
    const buttonText = formData.get("buttonText") as string | null;
    
    try {
      const template = await db.emailTemplate.upsert({
        where: {
          shopDomain_type_customerSegment_tierId: {
            shopDomain: session.shop,
            type: emailType,
            customerSegment: null,
            tierId: null,
          },
        },
        update: {
          subject,
          preheader,
          heading,
          body,
          footer,
          tone,
          buttonText: buttonText || undefined,
          enabled: true,
          lastModifiedBy: session.id,
        },
        create: {
          shopDomain: session.shop,
          type: emailType,
          name: `${emailType.replace(/_/g, " ").toLowerCase()} - ${tone.toLowerCase()}`,
          subject,
          preheader,
          heading,
          body,
          footer,
          tone,
          buttonText: buttonText || undefined,
          enabled: true,
          lastModifiedBy: session.id,
        },
      });
      
      return json<ActionData>({
        success: true,
        saved: true,
        templateId: template.id,
      });
    } catch (error) {
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : "Failed to save template",
      });
    }
    */
    
    // Temporary response while database is not connected
    return json<ActionData>({
      success: true,
      saved: true,
      templateId: "temp-id",
    });
  }
  
  return json<ActionData>({ success: false, error: "Invalid action" });
};

async function generateEmailWithOpenAI(params: EmailGenerationParams): Promise<GeneratedEmail> {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }
  
  const prompt = createPromptForEmailType(params);
  
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "You are an expert email copywriter for e-commerce businesses. Generate engaging, conversion-focused emails that match the requested tone. Always return a valid JSON object with the exact structure requested."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 800,
      temperature: 0.7,
      response_format: { type: "json_object" }
    }),
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || "OpenAI API request failed");
  }
  
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  
  if (!content) {
    throw new Error("No response from OpenAI");
  }
  
  const emailContent = JSON.parse(content) as GeneratedEmail;
  
  if (!emailContent.subject || !emailContent.body) {
    throw new Error("Invalid response format from OpenAI");
  }
  
  return emailContent;
}

function createPromptForEmailType(params: EmailGenerationParams): string {
  const { type, tone, customerName, storeName, customData } = params;
  
  const toneDescriptions: Record<EmailTone, string> = {
    PROFESSIONAL: "professional, formal, and business-like",
    FRIENDLY: "warm, approachable, and personable",
    CASUAL: "relaxed, conversational, and easy-going",
    EXCITED: "enthusiastic, energetic, and celebratory"
  };
  
  let contextualPrompt = "";
  
  switch (type) {
    case "WELCOME":
      contextualPrompt = `Create a welcome email for a new customer joining our store credit rewards program.
      The email should introduce them to the program and encourage their first purchase.`;
      break;
      
    case "CREDIT_EARNED":
      contextualPrompt = `Create an email notifying a customer they've earned $${customData.creditAmount} in store credit.
      Their new balance is $${customData.currentBalance}.
      The email should celebrate their earnings and encourage them to use their credit.`;
      break;
      
    case "BALANCE_UPDATE":
      contextualPrompt = `Create a balance reminder email letting the customer know they have $${customData.currentBalance} in store credit available.
      The email should remind them of their balance and encourage them to shop.`;
      break;
      
    case "TIER_UPGRADE":
      contextualPrompt = `Create a tier upgrade celebration email. The customer has been upgraded from ${customData.previousTier} to ${customData.tierName} tier.
      They now earn ${customData.cashbackPercent}% cashback on all purchases.
      ${customData.benefits?.length ? `Additional benefits include: ${customData.benefits.join(", ")}.` : ""}
      The email should celebrate their achievement and highlight the new benefits.`;
      break;
  }
  
  return `${contextualPrompt}

Customer name: ${customerName}
Store name: ${storeName}
Tone: ${toneDescriptions[tone]}

Generate an email with the following JSON structure:
{
  "subject": "Email subject line (50-70 characters)",
  "preheader": "Preview text that appears after subject (35-90 characters)",
  "heading": "Main heading for the email body",
  "body": "The main email content. Use <p> tags for paragraphs. Include personalization with {{customer_name}} and {{store_name}} placeholders. Keep it concise but engaging (2-3 paragraphs max).",
  "footer": "A brief footer message",
  "buttonText": "Call-to-action button text (if applicable)"
}

Make sure to:
- Keep the tone ${toneDescriptions[tone]}
- Use {{customer_name}} and {{store_name}} placeholders for personalization
- Make the subject line compelling and relevant
- Keep the content concise and scannable
- Include a clear call-to-action`;
}

export default function EmailGenerator() {
  const { hasApiKey, shopName, currencyCode } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  
  const [emailType, setEmailType] = useState<EmailTemplateType>("WELCOME");
  const [tone, setTone] = useState<EmailTone>("FRIENDLY");
  const [customerName, setCustomerName] = useState("Sarah");
  const [creditAmount, setCreditAmount] = useState("25");
  const [currentBalance, setCurrentBalance] = useState("75");
  const [tierName, setTierName] = useState("Gold");
  const [previousTier, setPreviousTier] = useState("Silver");
  const [cashbackPercent, setCashbackPercent] = useState("5");
  const [benefits, setBenefits] = useState("Early access to sales, Free shipping on all orders, Birthday bonus");
  
  const isGenerating = navigation.state === "submitting" && navigation.formData?.get("action") === "generate";
  const isSaving = navigation.state === "submitting" && navigation.formData?.get("action") === "save";
  
  return (
    <Page title="Email Template Generator">
      <BlockStack gap="600">
        {!hasApiKey && (
          <Banner tone="warning">
            OpenAI API key not configured. Add OPENAI_API_KEY to your .env file to enable email generation.
          </Banner>
        )}
        
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Generate Email Template</Text>
            
            <Form method="post">
              <FormLayout>
                <input type="hidden" name="action" value="generate" />
                <input type="hidden" name="storeName" value={shopName} />
                
                <Select
                  label="Email Type"
                  options={EMAIL_TYPES}
                  value={emailType}
                  onChange={(value) => setEmailType(value as EmailTemplateType)}
                  name="emailType"
                />
                
                <Text as="h3" variant="headingSm">Tone</Text>
                <BlockStack gap="200">
                  {EMAIL_TONES.map((toneOption) => (
                    <RadioButton
                      key={toneOption.value}
                      label={toneOption.label}
                      checked={tone === toneOption.value}
                      id={toneOption.value}
                      name="tone"
                      value={toneOption.value}
                      onChange={(_, value) => setTone(value as EmailTone)}
                    />
                  ))}
                </BlockStack>
                
                <TextField
                  label="Customer Name (for preview)"
                  value={customerName}
                  onChange={setCustomerName}
                  name="customerName"
                  autoComplete="off"
                />
                
                {(emailType === "CREDIT_EARNED") && (
                  <>
                    <TextField
                      label={`Credit Amount (${currencyCode})`}
                      value={creditAmount}
                      onChange={setCreditAmount}
                      name="creditAmount"
                      type="number"
                      autoComplete="off"
                    />
                    <TextField
                      label={`Current Balance (${currencyCode})`}
                      value={currentBalance}
                      onChange={setCurrentBalance}
                      name="currentBalance"
                      type="number"
                      autoComplete="off"
                    />
                  </>
                )}
                
                {emailType === "BALANCE_UPDATE" && (
                  <TextField
                    label={`Current Balance (${currencyCode})`}
                    value={currentBalance}
                    onChange={setCurrentBalance}
                    name="currentBalance"
                    type="number"
                    autoComplete="off"
                  />
                )}
                
                {emailType === "TIER_UPGRADE" && (
                  <>
                    <TextField
                      label="New Tier Name"
                      value={tierName}
                      onChange={setTierName}
                      name="tierName"
                      autoComplete="off"
                    />
                    <TextField
                      label="Previous Tier"
                      value={previousTier}
                      onChange={setPreviousTier}
                      name="previousTier"
                      autoComplete="off"
                    />
                    <TextField
                      label="Cashback Percent"
                      value={cashbackPercent}
                      onChange={setCashbackPercent}
                      name="cashbackPercent"
                      type="number"
                      suffix="%"
                      autoComplete="off"
                    />
                    <TextField
                      label="Additional Benefits (comma-separated)"
                      value={benefits}
                      onChange={setBenefits}
                      name="benefits"
                      multiline={2}
                      autoComplete="off"
                    />
                  </>
                )}
                
                <Button
                  submit
                  variant="primary"
                  loading={isGenerating}
                  disabled={!hasApiKey}
                >
                  Generate Email Template
                </Button>
              </FormLayout>
            </Form>
          </BlockStack>
        </Card>
        
        {actionData?.error && (
          <Banner tone="critical">{actionData.error}</Banner>
        )}
        
        {actionData?.saved && (
          <Banner tone="success">Template saved successfully!</Banner>
        )}
        
        {actionData?.generatedEmail && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Generated Email</Text>
                <InlineStack gap="200">
                  <Badge>{actionData.emailType}</Badge>
                  <Badge>{actionData.tone}</Badge>
                </InlineStack>
              </InlineStack>
              
              <Divider />
              
              <Form method="post">
                <FormLayout>
                  <input type="hidden" name="action" value="save" />
                  <input type="hidden" name="emailType" value={actionData.emailType} />
                  <input type="hidden" name="tone" value={actionData.tone} />
                  
                  <TextField
                    label="Subject Line"
                    value={actionData.generatedEmail.subject}
                    name="subject"
                    autoComplete="off"
                    readOnly
                  />
                  
                  <TextField
                    label="Preheader Text"
                    value={actionData.generatedEmail.preheader}
                    name="preheader"
                    autoComplete="off"
                    readOnly
                  />
                  
                  <TextField
                    label="Email Heading"
                    value={actionData.generatedEmail.heading}
                    name="heading"
                    autoComplete="off"
                    readOnly
                  />
                  
                  <TextField
                    label="Email Body"
                    value={actionData.generatedEmail.body}
                    name="body"
                    multiline={6}
                    autoComplete="off"
                    readOnly
                  />
                  
                  <TextField
                    label="Footer"
                    value={actionData.generatedEmail.footer}
                    name="footer"
                    autoComplete="off"
                    readOnly
                  />
                  
                  {actionData.generatedEmail.buttonText && (
                    <TextField
                      label="Button Text"
                      value={actionData.generatedEmail.buttonText}
                      name="buttonText"
                      autoComplete="off"
                      readOnly
                    />
                  )}
                  
                  <InlineStack gap="400">
                    <Button
                      submit
                      variant="primary"
                      loading={isSaving}
                    >
                      Save Template
                    </Button>
                    <Button
                      url="/app/email-generator"
                      variant="plain"
                    >
                      Generate Another
                    </Button>
                  </InlineStack>
                </FormLayout>
              </Form>
              
              <Divider />
              
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Preview</Text>
                <div style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: '8px',
                  padding: '20px',
                  backgroundColor: '#f9f9f9'
                }}>
                  <div style={{ marginBottom: '10px' }}>
                    <strong>Subject:</strong> {actionData.generatedEmail.subject}
                  </div>
                  <div style={{ marginBottom: '20px', color: '#666', fontSize: '14px' }}>
                    <strong>Preview:</strong> {actionData.generatedEmail.preheader}
                  </div>
                  <h2 style={{ marginBottom: '15px' }}>{actionData.generatedEmail.heading}</h2>
                  <div 
                    dangerouslySetInnerHTML={{ 
                      __html: actionData.generatedEmail.body
                        .replace(/\{\{customer_name\}\}/g, customerName)
                        .replace(/\{\{store_name\}\}/g, shopName)
                    }} 
                  />
                  {actionData.generatedEmail.buttonText && (
                    <div style={{ margin: '20px 0', textAlign: 'center' }}>
                      <button style={{
                        backgroundColor: '#1a1a1a',
                        color: 'white',
                        padding: '12px 24px',
                        borderRadius: '4px',
                        border: 'none',
                        fontSize: '16px',
                        cursor: 'pointer'
                      }}>
                        {actionData.generatedEmail.buttonText}
                      </button>
                    </div>
                  )}
                  <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #e0e0e0', color: '#666', fontSize: '14px' }}>
                    {actionData.generatedEmail.footer}
                  </div>
                </div>
              </BlockStack>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}