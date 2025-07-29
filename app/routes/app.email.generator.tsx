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
  Checkbox,
  ColorPicker,
  type HSBAColor,
} from "@shopify/polaris";
import {
  ViewIcon,
  DeleteIcon,
  CheckIcon,
  XIcon,
  EditIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { EmailTemplate as PrismaEmailTemplate } from "@prisma/client";

// Helper function to convert HSB to Hex
function hsbToHex(hsba: HSBAColor): string {
  const { hue, saturation, brightness } = hsba;
  
  // Convert HSB to RGB
  const h = hue;
  const s = saturation;
  const b = brightness;
  
  const c = b * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = b - c;
  
  let r = 0, g = 0, b2 = 0;
  
  if (h >= 0 && h < 60) {
    r = c; g = x; b2 = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b2 = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b2 = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b2 = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b2 = c;
  } else if (h >= 300 && h < 360) {
    r = c; g = 0; b2 = x;
  }
  
  // Convert to 0-255 range
  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b2 = Math.round((b2 + m) * 255);
  
  // Convert to hex
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b2)}`;
}

// Helper function to convert Hex to HSB
function hexToHsb(hex: string): HSBAColor {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Parse hex values
  const r = parseInt(hex.substr(0, 2), 16) / 255;
  const g = parseInt(hex.substr(2, 2), 16) / 255;
  const b = parseInt(hex.substr(4, 2), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  
  let hue = 0;
  let saturation = 0;
  const brightness = max;
  
  if (delta !== 0) {
    saturation = delta / max;
    
    if (max === r) {
      hue = ((g - b) / delta) % 6;
    } else if (max === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    
    hue = hue * 60;
    if (hue < 0) hue += 360;
  }
  
  return {
    hue,
    saturation,
    brightness,
    alpha: 1
  };
}

// Use Prisma enums
type EmailTemplateType = "WELCOME" | "CREDIT_EARNED" | "BALANCE_UPDATE" | "TIER_UPGRADE" | "TIER_DOWNGRADE" | "TIER_PROGRESS" | "CREDIT_EXPIRY_WARNING";
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
  buttonUrl?: string;
}

// Type for serialized template from JSON response
type SerializedEmailTemplate = Omit<PrismaEmailTemplate, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

interface LoaderData {
  hasApiKey: boolean;
  shopName: string;
  shopEmail: string;
  currencyCode: string;
  templates: SerializedEmailTemplate[];
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
  { label: "Tier Downgrade", value: "TIER_DOWNGRADE" },
  { label: "Tier Progress", value: "TIER_PROGRESS" },
  { label: "Credit Expiry Warning", value: "CREDIT_EXPIRY_WARNING" },
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
  const templates = await db.emailTemplate.findMany({
    where: { 
      shopDomain: session.shop,
      customerSegment: null, // Only show general templates
      tierId: null // Not tier-specific
    },
    orderBy: { updatedAt: 'desc' },
  });
  
  // Convert dates to strings for JSON serialization
  const serializedTemplates: SerializedEmailTemplate[] = templates.map(template => ({
    ...template,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  }));
  
  return json<LoaderData>({ 
    hasApiKey,
    shopName: shopData.data.shop.name,
    shopEmail: shopData.data.shop.email,
    currencyCode: shopData.data.shop.currencyCode,
    templates: serializedTemplates,
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
      case "TIER_DOWNGRADE":
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
    const emailType = formData.get("emailType") as EmailTemplateType;
    const tone = formData.get("tone") as EmailTone;
    const subject = formData.get("subject") as string;
    const preheader = formData.get("preheader") as string;
    const heading = formData.get("heading") as string;
    const body = formData.get("body") as string;
    const footer = formData.get("footer") as string;
    const buttonText = formData.get("buttonText") as string | null;
    const buttonUrl = formData.get("buttonUrl") as string | null;
    const includeStoreLogo = formData.get("includeStoreLogo") === "true";
    const includeUnsubscribe = formData.get("includeUnsubscribe") === "true";
    const primaryColor = formData.get("primaryColor") as string || "#1a1a1a";
    
    try {
      // Check if template already exists for this type/tone combination
      const existingTemplate = await db.emailTemplate.findFirst({
        where: {
          shopDomain: session.shop,
          type: emailType,
          tone: tone,
          customerSegment: null,
          tierId: null,
        },
      });
      
      const template = existingTemplate
        ? await db.emailTemplate.update({
            where: { id: existingTemplate.id },
            data: {
              subject,
              preheader,
              heading,
              body,
              footer,
              buttonText,
              buttonUrl,
              includeStoreLogo,
              includeUnsubscribe,
              primaryColor,
              enabled: true,
              lastModifiedBy: session.id,
            },
          })
        : await db.emailTemplate.create({
            data: {
              shopDomain: session.shop,
              type: emailType,
              name: `${emailType.replace(/_/g, " ").toLowerCase()} - ${tone.toLowerCase()}`,
              subject,
              preheader,
              heading,
              body,
              footer,
              tone,
              buttonText,
              buttonUrl,
              includeStoreLogo,
              includeUnsubscribe,
              primaryColor,
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
      console.error("Save error:", error);
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : "Failed to save template",
      });
    }
  }
  
  if (action === "delete") {
    const templateId = formData.get("templateId") as string;
    
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
  }
  
  if (action === "toggle") {
    const templateId = formData.get("templateId") as string;
    const enabled = formData.get("enabled") === "true";
    
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
  }
  
  if (action === "update") {
    const templateId = formData.get("templateId") as string;
    const subject = formData.get("subject") as string;
    const preheader = formData.get("preheader") as string;
    const heading = formData.get("heading") as string;
    const body = formData.get("body") as string;
    const footer = formData.get("footer") as string;
    const buttonText = formData.get("buttonText") as string | null;
    const buttonUrl = formData.get("buttonUrl") as string | null;
    const includeStoreLogo = formData.get("includeStoreLogo") === "true";
    const includeUnsubscribe = formData.get("includeUnsubscribe") === "true";
    const primaryColor = formData.get("primaryColor") as string;
    
    try {
      await db.emailTemplate.update({
        where: { id: templateId },
        data: {
          subject,
          preheader,
          heading,
          body,
          footer,
          buttonText,
          buttonUrl,
          includeStoreLogo,
          includeUnsubscribe,
          primaryColor,
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
      
    case "TIER_DOWNGRADE":
      contextualPrompt = `Create a tier downgrade notification email. The customer has moved from ${customData.previousTier} to ${customData.tierName} tier.
      They now earn ${customData.cashbackPercent}% cashback on purchases.
      The email should be encouraging and motivate them to reach the higher tier again.`;
      break;
      
    case "TIER_PROGRESS":
      contextualPrompt = `Create a tier progress update email. The customer is currently in ${customData.tierName} tier.
      The email should show their progress and encourage more purchases to reach the next tier.`;
      break;
      
    case "CREDIT_EXPIRY_WARNING":
      contextualPrompt = `Create a credit expiry warning email. The customer has $${customData.currentBalance} that will expire soon.
      The email should create urgency without being pushy.`;
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
  "buttonText": "Call-to-action button text (if applicable)",
  "buttonUrl": "Button URL (use {{store_url}} placeholder, e.g., '{{store_url}}/collections/all')"
}

Make sure to:
- Keep the tone ${toneDescriptions[tone]}
- Use {{customer_name}} and {{store_name}} placeholders for personalization
- Make the subject line compelling and relevant
- Keep the content concise and scannable
- Include a clear call-to-action
- For buttonUrl, use {{store_url}} as the base URL`;
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
  const [selectedTemplate, setSelectedTemplate] = useState<SerializedEmailTemplate | null>(null);
  
  // Edit form states
  const [editSubject, setEditSubject] = useState("");
  const [editPreheader, setEditPreheader] = useState("");
  const [editHeading, setEditHeading] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editFooter, setEditFooter] = useState("");
  const [editButtonText, setEditButtonText] = useState("");
  const [editButtonUrl, setEditButtonUrl] = useState("");
  const [editIncludeLogo, setEditIncludeLogo] = useState(true);
  const [editIncludeUnsubscribe, setEditIncludeUnsubscribe] = useState(true);
  const [editPrimaryColor, setEditPrimaryColor] = useState("#1a1a1a");
  
  // Generated email form states
  const [genSubject, setGenSubject] = useState("");
  const [genPreheader, setGenPreheader] = useState("");
  const [genHeading, setGenHeading] = useState("");
  const [genBody, setGenBody] = useState("");
  const [genFooter, setGenFooter] = useState("");
  const [genButtonText, setGenButtonText] = useState("");
  const [genButtonUrl, setGenButtonUrl] = useState("");
  const [genIncludeLogo, setGenIncludeLogo] = useState(true);
  const [genIncludeUnsubscribe, setGenIncludeUnsubscribe] = useState(true);
  const [genPrimaryColor, setGenPrimaryColor] = useState("#1a1a1a");
  
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
      setGenButtonUrl(actionData.generatedEmail.buttonUrl || "");
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
  
  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  
  const getEmailTypeLabel = (type: EmailTemplateType) => {
    return EMAIL_TYPES.find(t => t.value === type)?.label || type.replace(/_/g, ' ');
  };
  
  const handleToggleTemplate = (template: SerializedEmailTemplate) => {
    const formData = new FormData();
    formData.append("action", "toggle");
    formData.append("templateId", template.id);
    formData.append("enabled", template.enabled.toString());
    submit(formData, { method: "post" });
  };
  
  const handleDeleteTemplate = (template: SerializedEmailTemplate) => {
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
  
  const handlePreviewTemplate = (template: SerializedEmailTemplate) => {
    setSelectedTemplate(template);
    setPreviewModalActive(true);
  };
  
  const handleEditTemplate = (template: SerializedEmailTemplate) => {
    setSelectedTemplate(template);
    setEditSubject(template.subject);
    setEditPreheader(template.preheader);
    setEditHeading(template.heading);
    setEditBody(template.body);
    setEditFooter(template.footer);
    setEditButtonText(template.buttonText || "");
    setEditButtonUrl(template.buttonUrl || "");
    setEditIncludeLogo(template.includeStoreLogo);
    setEditIncludeUnsubscribe(template.includeUnsubscribe);
    setEditPrimaryColor(template.primaryColor);
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
      formData.append("buttonUrl", editButtonUrl);
      formData.append("includeStoreLogo", editIncludeLogo.toString());
      formData.append("includeUnsubscribe", editIncludeUnsubscribe.toString());
      formData.append("primaryColor", editPrimaryColor);
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
                    
                    {(emailType === "BALANCE_UPDATE" || emailType === "CREDIT_EXPIRY_WARNING") && (
                      <TextField
                        label={`Current Balance (${currencyCode})`}
                        value={currentBalance}
                        onChange={setCurrentBalance}
                        name="currentBalance"
                        type="number"
                        autoComplete="off"
                      />
                    )}
                    
                    {(emailType === "TIER_UPGRADE" || emailType === "TIER_DOWNGRADE" || emailType === "TIER_PROGRESS") && (
                      <>
                        <TextField
                          label={emailType === "TIER_PROGRESS" ? "Current Tier" : "New Tier Name"}
                          value={tierName}
                          onChange={setTierName}
                          name="tierName"
                          autoComplete="off"
                        />
                        {emailType !== "TIER_PROGRESS" && (
                          <TextField
                            label="Previous Tier"
                            value={previousTier}
                            onChange={setPreviousTier}
                            name="previousTier"
                            autoComplete="off"
                          />
                        )}
                        <TextField
                          label="Cashback Percent"
                          value={cashbackPercent}
                          onChange={setCashbackPercent}
                          name="cashbackPercent"
                          type="number"
                          suffix="%"
                          autoComplete="off"
                        />
                        {emailType === "TIER_UPGRADE" && (
                          <TextField
                            label="Additional Benefits (comma-separated)"
                            value={benefits}
                            onChange={setBenefits}
                            name="benefits"
                            multiline={2}
                            autoComplete="off"
                          />
                        )}
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
                        <input type="hidden" name="buttonUrl" value={genButtonUrl} />
                        <input type="hidden" name="includeStoreLogo" value={genIncludeLogo.toString()} />
                        <input type="hidden" name="includeUnsubscribe" value={genIncludeUnsubscribe.toString()} />
                        <input type="hidden" name="primaryColor" value={genPrimaryColor} />
                        
                        <Banner>
                          <p>
                            <strong>Available variables:</strong> {"{{customer_name}}, {{store_name}}, {{current_balance}}, {{credit_amount}}, {{tier_name}}, {{previous_tier}}, {{order_id}}, {{currency}}, {{store_url}}"}
                          </p>
                        </Banner>
                        
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
                          <>
                            <TextField
                              label="Button Text"
                              value={genButtonText}
                              onChange={setGenButtonText}
                              autoComplete="off"
                            />
                            <TextField
                              label="Button URL"
                              value={genButtonUrl}
                              onChange={setGenButtonUrl}
                              autoComplete="off"
                              helpText="Use {{store_url}} for your shop URL"
                            />
                          </>
                        )}
                        
                        <InlineStack gap="400">
                          <Checkbox
                            label="Include store logo"
                            checked={genIncludeLogo}
                            onChange={setGenIncludeLogo}
                          />
                          <Checkbox
                            label="Include unsubscribe link"
                            checked={genIncludeUnsubscribe}
                            onChange={setGenIncludeUnsubscribe}
                          />
                        </InlineStack>
                        
                        <BlockStack gap="200">
                          <Text as="p" variant="bodyMd">Primary Color</Text>
                          <div style={{ maxWidth: '300px' }}>
                            <ColorPicker
                              onChange={(color) => setGenPrimaryColor(hsbToHex(color))}
                              color={hexToHsb(genPrimaryColor)}
                              allowAlpha={false}
                            />
                          </div>
                        </BlockStack>
                        
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
                      <Text as="h3" variant="headingSm">Live Preview</Text>
                      <div style={{
                        border: '1px solid #e0e0e0',
                        borderRadius: '8px',
                        padding: '20px',
                        backgroundColor: '#f9f9f9'
                      }}>
                        {genIncludeLogo && (
                          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                            <div style={{
                              display: 'inline-block',
                              padding: '20px',
                              backgroundColor: '#e0e0e0',
                              borderRadius: '4px'
                            }}>
                              {shopName} Logo
                            </div>
                          </div>
                        )}
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
                              backgroundColor: genPrimaryColor,
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
                          {genIncludeUnsubscribe && (
                            <p style={{ marginTop: '10px', fontSize: '12px' }}>
                              <a href="#" style={{ color: '#666' }}>Unsubscribe</a> | 
                              <a href="#" style={{ color: '#666' }}> Update Preferences</a>
                            </p>
                          )}
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
                  {selectedTemplate.includeStoreLogo && (
                    <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                      <div style={{
                        display: 'inline-block',
                        padding: '20px',
                        backgroundColor: '#e0e0e0',
                        borderRadius: '4px'
                      }}>
                        {shopName} Logo
                      </div>
                    </div>
                  )}
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
                        backgroundColor: selectedTemplate.primaryColor,
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
                    {selectedTemplate.includeUnsubscribe && (
                      <p style={{ marginTop: '10px', fontSize: '12px' }}>
                        <a href="#" style={{ color: '#666' }}>Unsubscribe</a> | 
                        <a href="#" style={{ color: '#666' }}> Update Preferences</a>
                      </p>
                    )}
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
                <InlineStack gap="200">
                  <Badge>{selectedTemplate.type}</Badge>
                  <Badge>{selectedTemplate.tone}</Badge>
                  <Badge tone={selectedTemplate.enabled ? "success" : undefined}>
                    {selectedTemplate.enabled ? "Active" : "Inactive"}
                  </Badge>
                </InlineStack>
                
                <Banner>
                  <p>
                    <strong>Available variables:</strong> {"{{customer_name}}, {{store_name}}, {{current_balance}}, {{credit_amount}}, {{tier_name}}, {{previous_tier}}, {{order_id}}, {{currency}}, {{store_url}}"}
                  </p>
                </Banner>
                
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
                
                <TextField
                  label="Button URL"
                  value={editButtonUrl}
                  onChange={setEditButtonUrl}
                  autoComplete="off"
                  helpText="Use {{store_url}} for your shop URL"
                />
                
                <InlineStack gap="400">
                  <Checkbox
                    label="Include store logo"
                    checked={editIncludeLogo}
                    onChange={setEditIncludeLogo}
                  />
                  <Checkbox
                    label="Include unsubscribe link"
                    checked={editIncludeUnsubscribe}
                    onChange={setEditIncludeUnsubscribe}
                  />
                </InlineStack>
                
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">Primary Color</Text>
                  <div style={{ maxWidth: '300px' }}>
                    <ColorPicker
                      onChange={(color) => setEditPrimaryColor(hsbToHex(color))}
                      color={hexToHsb(editPrimaryColor)}
                      allowAlpha={false}
                    />
                  </div>
                </BlockStack>
                
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
                    {editIncludeLogo && (
                      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                        <div style={{
                          display: 'inline-block',
                          padding: '20px',
                          backgroundColor: '#e0e0e0',
                          borderRadius: '4px'
                        }}>
                          {shopName} Logo
                        </div>
                      </div>
                    )}
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
                          backgroundColor: editPrimaryColor,
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
                      {editIncludeUnsubscribe && (
                        <p style={{ marginTop: '10px', fontSize: '12px' }}>
                          <a href="#" style={{ color: '#666' }}>Unsubscribe</a> | 
                          <a href="#" style={{ color: '#666' }}> Update Preferences</a>
                        </p>
                      )}
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