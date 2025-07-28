// app/routes/app.email-generator.tsx
import { useState, useEffect } from "react";
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation, useLoaderData, useSubmit } from "@remix-run/react";
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
  Tabs,
  DataTable,
  Modal,
  TextContainer,
  Icon,
} from "@shopify/polaris";
import {
  ViewIcon,
  DeleteIcon,
  CheckIcon,
  XIcon,
  EditIcon,
} from "@shopify/polaris-icons";
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

interface EmailTemplate {
  id: string;
  type: EmailTemplateType;
  name: string;
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  footer: string;
  tone: EmailTone;
  buttonText: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LoaderData {
  hasApiKey: boolean;
  shopName: string;
  shopEmail: string;
  currencyCode: string;
  templates: EmailTemplate[];
}

interface ActionData {
  success: boolean;
  error?: string;
  generatedEmail?: GeneratedEmail;
  emailType?: EmailTemplateType;
  tone?: EmailTone;
  saved?: boolean;
  templateId?: string;
  deleted?: boolean;
  toggled?: boolean;
  updated?: boolean;
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
  const { admin, session } = await authenticate.admin(request);
  
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
  
  // Fetch existing templates
  // TODO: Uncomment when db is available
  /*
  const templates = await db.emailTemplate.findMany({
    where: { shopDomain: session.shop },
    orderBy: { updatedAt: 'desc' },
  });
  */
  
  // Mock templates for development
  const templates: EmailTemplate[] = [
    {
      id: "1",
      type: "WELCOME",
      name: "Welcome - Friendly",
      subject: "Welcome to {{store_name}}'s Rewards Program!",
      preheader: "Start earning cashback on every purchase",
      heading: "Welcome aboard, {{customer_name}}!",
      body: "<p>We're thrilled to have you join our rewards program. From now on, every purchase you make earns you cash back!</p><p>Shop now and watch your rewards grow.</p>",
      footer: "Thank you for being a valued customer.",
      tone: "FRIENDLY",
      buttonText: "Start Shopping",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "2",
      type: "CREDIT_EARNED",
      name: "Credit Earned - Excited",
      subject: "🎉 You just earned ${{credit_amount}}!",
      preheader: "Your balance is now ${{current_balance}}",
      heading: "Cha-ching! 💰",
      body: "<p>Great news, {{customer_name}}! You've just earned <strong>${{credit_amount}}</strong> in store credit from your recent purchase.</p><p>Your new balance is <strong>${{current_balance}}</strong>. Why not treat yourself?</p>",
      footer: "Happy shopping!",
      tone: "EXCITED",
      buttonText: "Use My Credit",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  
  return json<LoaderData>({ 
    hasApiKey,
    shopName: shopData.data.shop.name,
    shopEmail: shopData.data.shop.email,
    currencyCode: shopData.data.shop.currencyCode,
    templates,
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
    // TODO: Uncomment when db is available
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
  
  if (action === "delete") {
    const templateId = formData.get("templateId") as string;
    
    // TODO: Uncomment when db is available
    /*
    try {
      await db.emailTemplate.delete({
        where: { id: templateId },
      });
      
      return json<ActionData>({
        success: true,
        deleted: true,
      });
    } catch (error) {
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete template",
      });
    }
    */
    
    return json<ActionData>({
      success: true,
      deleted: true,
    });
  }
  
  if (action === "toggle") {
    const templateId = formData.get("templateId") as string;
    const enabled = formData.get("enabled") === "true";
    
    // TODO: Uncomment when db is available
    /*
    try {
      await db.emailTemplate.update({
        where: { id: templateId },
        data: { enabled: !enabled },
      });
      
      return json<ActionData>({
        success: true,
        toggled: true,
      });
    } catch (error) {
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : "Failed to toggle template",
      });
    }
    */
    
    return json<ActionData>({
      success: true,
      toggled: true,
    });
  }
  
  if (action === "update") {
    const templateId = formData.get("templateId") as string;
    const subject = formData.get("subject") as string;
    const preheader = formData.get("preheader") as string;
    const heading = formData.get("heading") as string;
    const body = formData.get("body") as string;
    const footer = formData.get("footer") as string;
    const buttonText = formData.get("buttonText") as string | null;
    
    // TODO: Uncomment when db is available
    /*
    try {
      await db.emailTemplate.update({
        where: { id: templateId },
        data: {
          subject,
          preheader,
          heading,
          body,
          footer,
          buttonText: buttonText || undefined,
          updatedAt: new Date(),
          lastModifiedBy: session.id,
        },
      });
      
      return json<ActionData>({
        success: true,
        updated: true,
      });
    } catch (error) {
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : "Failed to update template",
      });
    }
    */
    
    return json<ActionData>({
      success: true,
      updated: true,
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
  const { hasApiKey, shopName, currencyCode, templates } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  
  const [selectedTab, setSelectedTab] = useState(0);
  const [previewModalActive, setPreviewModalActive] = useState(false);
  const [deleteModalActive, setDeleteModalActive] = useState(false);
  const [editModalActive, setEditModalActive] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  
  // Edit form states
  const [editSubject, setEditSubject] = useState("");
  const [editPreheader, setEditPreheader] = useState("");
  const [editHeading, setEditHeading] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editFooter, setEditFooter] = useState("");
  const [editButtonText, setEditButtonText] = useState("");
  
  // Generated email form states
  const [genSubject, setGenSubject] = useState("");
  const [genPreheader, setGenPreheader] = useState("");
  const [genHeading, setGenHeading] = useState("");
  const [genBody, setGenBody] = useState("");
  const [genFooter, setGenFooter] = useState("");
  const [genButtonText, setGenButtonText] = useState("");
  
  const [emailType, setEmailType] = useState<EmailTemplateType>("WELCOME");
  const [tone, setTone] = useState<EmailTone>("FRIENDLY");
  const [customerName, setCustomerName] = useState("Sarah");
  const [creditAmount, setCreditAmount] = useState("25");
  const [currentBalance, setCurrentBalance] = useState("75");
  const [tierName, setTierName] = useState("Gold");
  const [previousTier, setPreviousTier] = useState("Silver");
  const [cashbackPercent, setCashbackPercent] = useState("5");
  const [benefits, setBenefits] = useState("Early access to sales, Free shipping on all orders, Birthday bonus");
  
  // Update generated email states when new email is generated
  useEffect(() => {
    if (actionData?.generatedEmail && actionData?.success) {
      setGenSubject(actionData.generatedEmail.subject);
      setGenPreheader(actionData.generatedEmail.preheader);
      setGenHeading(actionData.generatedEmail.heading);
      setGenBody(actionData.generatedEmail.body);
      setGenFooter(actionData.generatedEmail.footer);
      setGenButtonText(actionData.generatedEmail.buttonText || "");
    }
  }, [actionData]);
  
  const isGenerating = navigation.state === "submitting" && navigation.formData?.get("action") === "generate";
  const isSaving = navigation.state === "submitting" && navigation.formData?.get("action") === "save";
  const isUpdating = navigation.state === "submitting" && navigation.formData?.get("action") === "update";
  
  const tabs = [
    {
      id: "generate",
      content: "Generate New",
      accessibilityLabel: "Generate new email template",
      panelID: "generate-panel",
    },
    {
      id: "templates",
      content: "Saved Templates",
      badge: templates.length.toString(),
      accessibilityLabel: "View saved templates",
      panelID: "templates-panel",
    },
  ];
  
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  
  const getEmailTypeLabel = (type: EmailTemplateType) => {
    return EMAIL_TYPES.find(t => t.value === type)?.label || type;
  };
  
  const handleToggleTemplate = (template: EmailTemplate) => {
    const formData = new FormData();
    formData.append("action", "toggle");
    formData.append("templateId", template.id);
    formData.append("enabled", template.enabled.toString());
    submit(formData, { method: "post" });
  };
  
  const handleDeleteTemplate = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setDeleteModalActive(true);
  };
  
  const confirmDelete = () => {
    if (selectedTemplate) {
      const formData = new FormData();
      formData.append("action", "delete");
      formData.append("templateId", selectedTemplate.id);
      submit(formData, { method: "post" });
    }
    setDeleteModalActive(false);
    setSelectedTemplate(null);
  };
  
  const handlePreviewTemplate = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setPreviewModalActive(true);
  };
  
  const handleEditTemplate = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setEditSubject(template.subject);
    setEditPreheader(template.preheader);
    setEditHeading(template.heading);
    setEditBody(template.body);
    setEditFooter(template.footer);
    setEditButtonText(template.buttonText || "");
    setEditModalActive(true);
  };
  
  const handleUpdateTemplate = () => {
    if (selectedTemplate) {
      const formData = new FormData();
      formData.append("action", "update");
      formData.append("templateId", selectedTemplate.id);
      formData.append("subject", editSubject);
      formData.append("preheader", editPreheader);
      formData.append("heading", editHeading);
      formData.append("body", editBody);
      formData.append("footer", editFooter);
      formData.append("buttonText", editButtonText);
      submit(formData, { method: "post" });
      setEditModalActive(false);
      setSelectedTemplate(null);
    }
  };
  
  const rows = templates.map((template) => [
    <InlineStack gap="200" blockAlign="center" key={`type-${template.id}`}>
      <Text as="span" variant="bodyMd" fontWeight="semibold">{getEmailTypeLabel(template.type)}</Text>
      <Badge tone={template.enabled ? "success" : undefined}>
        {template.enabled ? "Active" : "Inactive"}
      </Badge>
    </InlineStack>,
    <Badge key={`tone-${template.id}`}>{template.tone}</Badge>,
    template.subject.substring(0, 50) + (template.subject.length > 50 ? "..." : ""),
    formatDate(template.updatedAt),
    <InlineStack gap="200" key={`actions-${template.id}`}>
      <Button
        icon={ViewIcon}
        variant="tertiary"
        onClick={() => handlePreviewTemplate(template)}
        accessibilityLabel="Preview template"
      />
      <Button
        icon={EditIcon}
        variant="tertiary"
        onClick={() => handleEditTemplate(template)}
        accessibilityLabel="Edit template"
      />
      <Button
        icon={template.enabled ? XIcon : CheckIcon}
        variant="tertiary"
        onClick={() => handleToggleTemplate(template)}
        accessibilityLabel={template.enabled ? "Disable template" : "Enable template"}
      />
      <Button
        icon={DeleteIcon}
        variant="tertiary"
        tone="critical"
        onClick={() => handleDeleteTemplate(template)}
        accessibilityLabel="Delete template"
      />
    </InlineStack>,
  ]);
  
  return (
    <Page title="Email Template Generator">
      <BlockStack gap="600">
        {!hasApiKey && (
          <Banner tone="warning">
            OpenAI API key not configured. Add OPENAI_API_KEY to your .env file to enable email generation.
          </Banner>
        )}
        
        {actionData?.error && (
          <Banner tone="critical">{actionData.error}</Banner>
        )}
        
        {actionData?.saved && (
          <Banner tone="success">Template saved successfully!</Banner>
        )}
        
        {actionData?.deleted && (
          <Banner tone="success">Template deleted successfully!</Banner>
        )}
        
        {actionData?.toggled && (
          <Banner tone="success">Template status updated!</Banner>
        )}
        
        {actionData?.updated && (
          <Banner tone="success">Template updated successfully!</Banner>
        )}
        
        <Card>
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <div style={{ display: selectedTab === 0 ? 'block' : 'none' }}>
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
                    
                    <Banner>
                  <p>
                    <strong>Available variables:</strong> {"{{customer_name}}, {{store_name}}, {{current_balance}}, {{credit_amount}}, {{tier_name}}, {{previous_tier}}, {{order_id}}, {{currency}}"}
                  </p>
                </Banner>
                
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
                
                {actionData?.generatedEmail && (
                  <>
                    <Divider />
                    
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">Generated Email (Editable)</Text>
                      <InlineStack gap="200">
                        <Badge>{actionData.emailType}</Badge>
                        <Badge>{actionData.tone}</Badge>
                      </InlineStack>
                    </InlineStack>
                    
                    <Form method="post">
                      <FormLayout>
                        <input type="hidden" name="action" value="save" />
                        <input type="hidden" name="emailType" value={actionData.emailType} />
                        <input type="hidden" name="tone" value={actionData.tone} />
                        
                        <input type="hidden" name="subject" value={genSubject} />
                        <input type="hidden" name="preheader" value={genPreheader} />
                        <input type="hidden" name="heading" value={genHeading} />
                        <input type="hidden" name="body" value={genBody} />
                        <input type="hidden" name="footer" value={genFooter} />
                        <input type="hidden" name="buttonText" value={genButtonText} />
                        
                        <TextField
                          label="Subject Line"
                          value={genSubject}
                          onChange={setGenSubject}
                          autoComplete="off"
                          helpText="You can edit this before saving"
                        />
                        
                        <TextField
                          label="Preheader Text"
                          value={genPreheader}
                          onChange={setGenPreheader}
                          autoComplete="off"
                        />
                        
                        <TextField
                          label="Email Heading"
                          value={genHeading}
                          onChange={setGenHeading}
                          autoComplete="off"
                        />
                        
                        <TextField
                          label="Email Body"
                          value={genBody}
                          onChange={setGenBody}
                          multiline={6}
                          autoComplete="off"
                          helpText="Edit the content as needed before saving"
                        />
                        
                        <TextField
                          label="Footer"
                          value={genFooter}
                          onChange={setGenFooter}
                          autoComplete="off"
                        />
                        
                        {(actionData.generatedEmail.buttonText || genButtonText) && (
                          <TextField
                            label="Button Text"
                            value={genButtonText}
                            onChange={setGenButtonText}
                            autoComplete="off"
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
                            onClick={() => window.location.reload()}
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
                          <strong>Subject:</strong> {genSubject}
                        </div>
                        <div style={{ marginBottom: '20px', color: '#666', fontSize: '14px' }}>
                          <strong>Preview:</strong> {genPreheader}
                        </div>
                        <h2 style={{ marginBottom: '15px' }}>{genHeading}</h2>
                        <div 
                          dangerouslySetInnerHTML={{ 
                            __html: genBody
                              .replace(/\{\{customer_name\}\}/g, customerName)
                              .replace(/\{\{store_name\}\}/g, shopName)
                          }} 
                        />
                        {genButtonText && (
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
                              {genButtonText}
                            </button>
                          </div>
                        )}
                        <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #e0e0e0', color: '#666', fontSize: '14px' }}>
                          {genFooter}
                        </div>
                      </div>
                    </BlockStack>
                  </>
                )}
              </BlockStack>
            </div>
            
            <div style={{ display: selectedTab === 1 ? 'block' : 'none' }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Saved Email Templates</Text>
                
                {templates.length === 0 ? (
                  <Banner>
                    No templates saved yet. Generate your first template to get started!
                  </Banner>
                ) : (
                  <DataTable
                    columnContentTypes={[
                      'text',
                      'text',
                      'text',
                      'text',
                      'text',
                    ]}
                    headings={[
                      'Type',
                      'Tone',
                      'Subject',
                      'Last Updated',
                      'Actions',
                    ]}
                    rows={rows}
                  />
                )}
              </BlockStack>
            </div>
          </Tabs>
        </Card>
        
        <Modal
          open={previewModalActive}
          onClose={() => setPreviewModalActive(false)}
          title={selectedTemplate ? `Preview: ${getEmailTypeLabel(selectedTemplate.type)}` : 'Preview'}
          size="large"
        >
          <Modal.Section>
            {selectedTemplate && (
              <BlockStack gap="400">
                <InlineStack gap="200">
                  <Badge>{selectedTemplate.tone}</Badge>
                  <Badge tone={selectedTemplate.enabled ? "success" : undefined}>
                    {selectedTemplate.enabled ? "Active" : "Inactive"}
                  </Badge>
                </InlineStack>
                
                <div style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: '8px',
                  padding: '20px',
                  backgroundColor: '#f9f9f9'
                }}>
                  <div style={{ marginBottom: '10px' }}>
                    <strong>Subject:</strong> {selectedTemplate.subject}
                  </div>
                  <div style={{ marginBottom: '20px', color: '#666', fontSize: '14px' }}>
                    <strong>Preview:</strong> {selectedTemplate.preheader}
                  </div>
                  <h2 style={{ marginBottom: '15px' }}>{selectedTemplate.heading}</h2>
                  <div dangerouslySetInnerHTML={{ __html: selectedTemplate.body }} />
                  {selectedTemplate.buttonText && (
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
                        {selectedTemplate.buttonText}
                      </button>
                    </div>
                  )}
                  <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #e0e0e0', color: '#666', fontSize: '14px' }}>
                    {selectedTemplate.footer}
                  </div>
                </div>
              </BlockStack>
            )}
          </Modal.Section>
        </Modal>
        
        <Modal
          open={deleteModalActive}
          onClose={() => setDeleteModalActive(false)}
          title="Delete template?"
          primaryAction={{
            content: 'Delete',
            onAction: confirmDelete,
            destructive: true,
          }}
          secondaryActions={[
            {
              content: 'Cancel',
              onAction: () => setDeleteModalActive(false),
            },
          ]}
        >
          <Modal.Section>
            <TextContainer>
              <p>
                Are you sure you want to delete the "{selectedTemplate && getEmailTypeLabel(selectedTemplate.type)}" template? 
                This action cannot be undone.
              </p>
            </TextContainer>
          </Modal.Section>
        </Modal>
        
        <Modal
          open={editModalActive}
          onClose={() => setEditModalActive(false)}
          title={selectedTemplate ? `Edit: ${getEmailTypeLabel(selectedTemplate.type)}` : 'Edit Template'}
          size="large"
          primaryAction={{
            content: 'Save Changes',
            onAction: handleUpdateTemplate,
            loading: isUpdating,
          }}
          secondaryActions={[
            {
              content: 'Cancel',
              onAction: () => setEditModalActive(false),
            },
          ]}
        >
          <Modal.Section>
            {selectedTemplate && (
              <FormLayout>
                <TextField
                  label="Subject Line"
                  value={editSubject}
                  onChange={setEditSubject}
                  autoComplete="off"
                  helpText="Use {{customer_name}} and {{store_name}} for personalization"
                />
                
                <TextField
                  label="Preheader Text"
                  value={editPreheader}
                  onChange={setEditPreheader}
                  autoComplete="off"
                  helpText="Preview text that appears after the subject line"
                />
                
                <TextField
                  label="Email Heading"
                  value={editHeading}
                  onChange={setEditHeading}
                  autoComplete="off"
                />
                
                <TextField
                  label="Email Body"
                  value={editBody}
                  onChange={setEditBody}
                  multiline={8}
                  autoComplete="off"
                  helpText="Use HTML tags like <p>, <strong>, <em> for formatting"
                />
                
                <TextField
                  label="Footer"
                  value={editFooter}
                  onChange={setEditFooter}
                  autoComplete="off"
                />
                
                <TextField
                  label="Button Text (optional)"
                  value={editButtonText}
                  onChange={setEditButtonText}
                  autoComplete="off"
                  helpText="Leave empty if no button is needed"
                />
                
                <Divider />
                
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Live Preview</Text>
                  <div style={{
                    border: '1px solid #e0e0e0',
                    borderRadius: '8px',
                    padding: '20px',
                    backgroundColor: '#f9f9f9',
                    maxHeight: '400px',
                    overflow: 'auto'
                  }}>
                    <div style={{ marginBottom: '10px' }}>
                      <strong>Subject:</strong> {editSubject}
                    </div>
                    <div style={{ marginBottom: '20px', color: '#666', fontSize: '14px' }}>
                      <strong>Preview:</strong> {editPreheader}
                    </div>
                    <h2 style={{ marginBottom: '15px' }}>{editHeading}</h2>
                    <div dangerouslySetInnerHTML={{ __html: editBody }} />
                    {editButtonText && (
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
                          {editButtonText}
                        </button>
                      </div>
                    )}
                    <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #e0e0e0', color: '#666', fontSize: '14px' }}>
                      {editFooter}
                    </div>
                  </div>
                </BlockStack>
              </FormLayout>
            )}
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}