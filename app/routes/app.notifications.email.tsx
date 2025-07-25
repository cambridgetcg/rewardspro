// app/routes/app.notifications.email.tsx
import { useState, useEffect } from "react";
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Email template types
type EmailTemplateType = 'CREDIT_EARNED' | 'BALANCE_UPDATE' | 'TIER_PROGRESS';

interface EmailTemplate {
  id?: string;
  type: EmailTemplateType;
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  footer: string;
  tone: 'professional' | 'friendly' | 'casual' | 'excited';
  includeStoreLogo: boolean;
  includeUnsubscribe: boolean;
  primaryColor: string;
  buttonText: string;
  buttonUrl: string;
  enabled: boolean;
}

interface TemplateVariable {
  key: string;
  description: string;
  example: string;
}

// Available template variables for each email type
const TEMPLATE_VARIABLES: Record<EmailTemplateType, TemplateVariable[]> = {
  CREDIT_EARNED: [
    { key: '{{customer_name}}', description: 'Customer first name', example: 'John' },
    { key: '{{credit_amount}}', description: 'Amount of credit earned', example: '$25.00' },
    { key: '{{order_number}}', description: 'Order number', example: '#1234' },
    { key: '{{total_balance}}', description: 'Total store credit balance', example: '$125.00' },
    { key: '{{cashback_percent}}', description: 'Cashback percentage', example: '5%' },
    { key: '{{shop_name}}', description: 'Your shop name', example: 'My Store' }
  ],
  BALANCE_UPDATE: [
    { key: '{{customer_name}}', description: 'Customer first name', example: 'John' },
    { key: '{{current_balance}}', description: 'Current store credit balance', example: '$125.00' },
    { key: '{{last_earned}}', description: 'Last credit earned', example: '$25.00' },
    { key: '{{last_earned_date}}', description: 'Date of last earning', example: 'Jan 15, 2024' },
    { key: '{{expiry_date}}', description: 'Credit expiry date (if applicable)', example: 'Dec 31, 2024' },
    { key: '{{shop_name}}', description: 'Your shop name', example: 'My Store' }
  ],
  TIER_PROGRESS: [
    { key: '{{customer_name}}', description: 'Customer first name', example: 'John' },
    { key: '{{current_tier}}', description: 'Current tier name', example: 'Silver' },
    { key: '{{next_tier}}', description: 'Next tier name', example: 'Gold' },
    { key: '{{current_cashback}}', description: 'Current cashback rate', example: '5%' },
    { key: '{{next_cashback}}', description: 'Next tier cashback rate', example: '7%' },
    { key: '{{amount_to_next}}', description: 'Amount needed for next tier', example: '$250.00' },
    { key: '{{progress_percent}}', description: 'Progress percentage', example: '75%' },
    { key: '{{annual_spending}}', description: 'Annual spending amount', example: '$750.00' },
    { key: '{{shop_name}}', description: 'Your shop name', example: 'My Store' }
  ]
};

// AI prompt templates for generating emails
const AI_PROMPTS: Record<EmailTemplateType, string> = {
  CREDIT_EARNED: `Generate a customer notification email for earning store credit. The email should:
- Thank the customer for their purchase
- Clearly state the amount of credit earned
- Show their total balance
- Encourage future purchases
- Match the specified tone: {tone}
- Include these elements: subject line, preheader text, main heading, body content, and footer
- Use the provided template variables where appropriate`,
  
  BALANCE_UPDATE: `Generate a store credit balance update email. The email should:
- Inform the customer of their current balance
- Show recent credit activity
- Remind them how to use their credit
- Create urgency if appropriate
- Match the specified tone: {tone}
- Include these elements: subject line, preheader text, main heading, body content, and footer
- Use the provided template variables where appropriate`,
  
  TIER_PROGRESS: `Generate a loyalty tier progress email. The email should:
- Congratulate on current tier status
- Show progress to next tier
- Highlight benefits of reaching next tier
- Motivate continued shopping
- Match the specified tone: {tone}
- Include these elements: subject line, preheader text, main heading, body content, and footer
- Use the provided template variables where appropriate`
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  // Get existing email templates from database
  // For this example, we'll use a simplified structure
  // In production, you'd have an EmailTemplate model in Prisma
  const templates: Record<EmailTemplateType, EmailTemplate | null> = {
    CREDIT_EARNED: null,
    BALANCE_UPDATE: null,
    TIER_PROGRESS: null
  };
  
  // Get shop settings (for default values)
  const shopSettings = {
    shopName: shopDomain.split('.')[0],
    primaryColor: '#1a1a1a',
    logoUrl: null
  };
  
  return json({ 
    templates,
    shopSettings,
    templateVariables: TEMPLATE_VARIABLES
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;
  
  if (actionType === "generateWithAI") {
    const templateType = formData.get("templateType") as EmailTemplateType;
    const tone = formData.get("tone") as string || "friendly";
    const additionalInstructions = formData.get("additionalInstructions") as string || "";
    
    try {
      // Here you would integrate with OpenAI API
      // For this example, we'll return a mock response
      const generatedTemplate = await generateEmailWithAI(templateType, tone, additionalInstructions);
      
      return json({ 
        success: true, 
        generatedTemplate,
        message: "Template generated successfully" 
      });
    } catch (error) {
      return json({ 
        success: false, 
        error: "Failed to generate template. Please try again." 
      });
    }
  }
  
  if (actionType === "saveTemplate") {
    const templateType = formData.get("templateType") as EmailTemplateType;
    const templateData: EmailTemplate = {
      type: templateType,
      subject: formData.get("subject") as string,
      preheader: formData.get("preheader") as string,
      heading: formData.get("heading") as string,
      body: formData.get("body") as string,
      footer: formData.get("footer") as string,
      tone: formData.get("tone") as any,
      includeStoreLogo: formData.get("includeStoreLogo") === "true",
      includeUnsubscribe: formData.get("includeUnsubscribe") === "true",
      primaryColor: formData.get("primaryColor") as string,
      buttonText: formData.get("buttonText") as string,
      buttonUrl: formData.get("buttonUrl") as string,
      enabled: formData.get("enabled") === "true"
    };
    
    // Save to database
    // In production, you'd save this to your EmailTemplate model
    
    return json({ 
      success: true, 
      message: "Template saved successfully" 
    });
  }
  
  if (actionType === "sendTestEmail") {
    const templateType = formData.get("templateType") as EmailTemplateType;
    const testEmail = formData.get("testEmail") as string;
    
    // Send test email logic here
    
    return json({ 
      success: true, 
      message: `Test email sent to ${testEmail}` 
    });
  }
  
  return json({ success: false, error: "Invalid action" });
};

// Mock AI generation function
async function generateEmailWithAI(
  templateType: EmailTemplateType, 
  tone: string, 
  additionalInstructions: string
): Promise<EmailTemplate> {
  // In production, this would call OpenAI API
  // For now, return template based on type
  
  const templates: Record<EmailTemplateType, EmailTemplate> = {
    CREDIT_EARNED: {
      type: 'CREDIT_EARNED',
      subject: 'You\'ve earned {{credit_amount}} in store credit!',
      preheader: 'Thank you for your recent purchase',
      heading: 'Congratulations, {{customer_name}}!',
      body: `You've just earned {{credit_amount}} in store credit from your recent order {{order_number}}!\n\nYour new total balance is {{total_balance}}, ready to use on your next purchase.\n\nAs a valued customer with {{cashback_percent}} cashback, every purchase brings you more rewards.`,
      footer: 'Thank you for shopping with {{shop_name}}. Your rewards are automatically applied at checkout.',
      tone: tone as any,
      includeStoreLogo: true,
      includeUnsubscribe: true,
      primaryColor: '#10B981',
      buttonText: 'Shop Now',
      buttonUrl: 'https://{{shop_domain}}',
      enabled: true
    },
    BALANCE_UPDATE: {
      type: 'BALANCE_UPDATE',
      subject: 'Your store credit balance: {{current_balance}}',
      preheader: 'Check your available rewards',
      heading: 'Hello {{customer_name}}, here\'s your credit update',
      body: `You currently have {{current_balance}} in store credit available!\n\nYour last credit of {{last_earned}} was added on {{last_earned_date}}.\n\nDon't let your rewards go to waste - they're automatically applied at checkout for instant savings.`,
      footer: 'Shop at {{shop_name}} and watch your rewards grow!',
      tone: tone as any,
      includeStoreLogo: true,
      includeUnsubscribe: true,
      primaryColor: '#3B82F6',
      buttonText: 'Use My Credit',
      buttonUrl: 'https://{{shop_domain}}',
      enabled: true
    },
    TIER_PROGRESS: {
      type: 'TIER_PROGRESS',
      subject: 'You\'re {{progress_percent}} of the way to {{next_tier}} status!',
      preheader: 'Just {{amount_to_next}} more to unlock {{next_cashback}} cashback',
      heading: 'Great progress, {{customer_name}}!',
      body: `As a {{current_tier}} member earning {{current_cashback}} cashback, you're doing amazing!\n\nYou've spent {{annual_spending}} this year and are just {{amount_to_next}} away from reaching {{next_tier}} status with {{next_cashback}} cashback.\n\nThat's {{progress_percent}} of the way there! Keep going to unlock even better rewards.`,
      footer: 'Continue shopping at {{shop_name}} to reach the next level!',
      tone: tone as any,
      includeStoreLogo: true,
      includeUnsubscribe: true,
      primaryColor: '#8B5CF6',
      buttonText: 'View My Progress',
      buttonUrl: 'https://{{shop_domain}}/account',
      enabled: true
    }
  };
  
  return templates[templateType];
}

export default function EmailNotifications() {
  const { templates, shopSettings, templateVariables } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplateType>('CREDIT_EARNED');
  const [currentTemplate, setCurrentTemplate] = useState<EmailTemplate | null>(
    templates[selectedTemplate] || null
  );
  const [showPreview, setShowPreview] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiTone, setAiTone] = useState<string>('friendly');
  const [aiInstructions, setAiInstructions] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  
  const isSubmitting = navigation.state === "submitting";
  
  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        setNotification({ type: 'success', message: actionData.message || 'Operation successful' });
        if ('generatedTemplate' in actionData && actionData.generatedTemplate) {
          setCurrentTemplate(actionData.generatedTemplate);
          setShowAIModal(false);
        }
      } else if ('error' in actionData) {
        setNotification({ type: 'error', message: actionData.error || 'An error occurred' });
      }
      setTimeout(() => setNotification(null), 5000);
    }
  }, [actionData]);
  
  useEffect(() => {
    setCurrentTemplate(templates[selectedTemplate] || null);
  }, [selectedTemplate, templates]);
  
  const handleTemplateChange = (field: keyof EmailTemplate, value: any) => {
    setCurrentTemplate(prev => prev ? { ...prev, [field]: value } : null);
  };
  
  const insertVariable = (variable: string) => {
    if (!currentTemplate) return;
    const bodyElement = document.getElementById('template-body') as HTMLTextAreaElement;
    if (bodyElement) {
      const start = bodyElement.selectionStart;
      const end = bodyElement.selectionEnd;
      const newBody = currentTemplate.body.substring(0, start) + variable + currentTemplate.body.substring(end);
      handleTemplateChange('body', newBody);
      // Reset cursor position
      setTimeout(() => {
        bodyElement.focus();
        bodyElement.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    }
  };
  
  const getTemplateTypeLabel = (type: EmailTemplateType): string => {
    const labels: Record<EmailTemplateType, string> = {
      CREDIT_EARNED: 'Credit Earned Notification',
      BALANCE_UPDATE: 'Balance Update Reminder',
      TIER_PROGRESS: 'Tier Progress Update'
    };
    return labels[type];
  };
  
  const getTemplateDescription = (type: EmailTemplateType): string => {
    const descriptions: Record<EmailTemplateType, string> = {
      CREDIT_EARNED: 'Sent immediately when a customer earns store credit from a purchase',
      BALANCE_UPDATE: 'Periodic reminder of available store credit balance',
      TIER_PROGRESS: 'Updates on loyalty tier status and progress to next tier'
    };
    return descriptions[type];
  };
  
  const renderEmailPreview = () => {
    if (!currentTemplate) return null;
    
    // Replace variables with example values
    const replaceVariables = (text: string): string => {
      let result = text;
      const variables = templateVariables[selectedTemplate];
      variables.forEach(v => {
        result = result.replace(new RegExp(v.key.replace(/[{}]/g, '\\$&'), 'g'), v.example);
      });
      result = result.replace(/{{shop_domain}}/g, shopSettings.shopName);
      result = result.replace(/{{shop_name}}/g, shopSettings.shopName);
      return result;
    };
    
    return (
      <div style={previewStyles.container}>
        <div style={previewStyles.subject}>
          <strong>Subject:</strong> {replaceVariables(currentTemplate.subject)}
        </div>
        <div style={previewStyles.preheader}>
          {replaceVariables(currentTemplate.preheader)}
        </div>
        <div style={previewStyles.emailBody}>
          {currentTemplate.includeStoreLogo && (
            <div style={previewStyles.logo}>
              {shopSettings.logoUrl ? (
                <img src={shopSettings.logoUrl} alt={shopSettings.shopName} style={{ maxHeight: '60px' }} />
              ) : (
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: currentTemplate.primaryColor }}>
                  {shopSettings.shopName}
                </div>
              )}
            </div>
          )}
          <h1 style={{ ...previewStyles.heading, color: currentTemplate.primaryColor }}>
            {replaceVariables(currentTemplate.heading)}
          </h1>
          <div style={previewStyles.body}>
            {replaceVariables(currentTemplate.body).split('\n').map((line, i) => (
              <p key={i} style={{ margin: '0 0 16px 0' }}>{line}</p>
            ))}
          </div>
          {currentTemplate.buttonText && (
            <div style={previewStyles.buttonContainer}>
              <a 
                href="#" 
                style={{ 
                  ...previewStyles.button, 
                  backgroundColor: currentTemplate.primaryColor 
                }}
              >
                {currentTemplate.buttonText}
              </a>
            </div>
          )}
          <div style={previewStyles.footer}>
            {replaceVariables(currentTemplate.footer)}
            {currentTemplate.includeUnsubscribe && (
              <p style={{ fontSize: '12px', color: '#666', marginTop: '16px' }}>
                <a href="#" style={{ color: '#666' }}>Unsubscribe</a> from these notifications
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };
  
  const styles = {
    container: {
      maxWidth: "1400px",
      margin: "0 auto",
      padding: "32px 24px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: "#1a1a1a",
      backgroundColor: "#f8f9fa",
      minHeight: "100vh"
    },
    header: {
      backgroundColor: "white",
      padding: "32px",
      borderRadius: "12px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      marginBottom: "32px"
    },
    title: {
      fontSize: "32px",
      fontWeight: "700",
      margin: "0 0 8px 0",
      color: "#1a1a1a"
    },
    subtitle: {
      fontSize: "16px",
      color: "#666",
      margin: 0
    },
    mainContent: {
      display: "grid",
      gridTemplateColumns: "300px 1fr",
      gap: "24px",
      alignItems: "start"
    },
    sidebar: {
      backgroundColor: "white",
      borderRadius: "12px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      padding: "24px",
      position: "sticky" as const,
      top: "24px"
    },
    templateList: {
      listStyle: "none",
      padding: 0,
      margin: 0
    },
    templateItem: {
      padding: "16px",
      marginBottom: "8px",
      borderRadius: "8px",
      cursor: "pointer",
      transition: "all 0.2s",
      border: "2px solid transparent"
    },
    templateItemActive: {
      backgroundColor: "#f0f7ff",
      borderColor: "#3b82f6"
    },
    templateName: {
      fontSize: "16px",
      fontWeight: "600",
      marginBottom: "4px"
    },
    templateDesc: {
      fontSize: "13px",
      color: "#666",
      lineHeight: "1.4"
    },
    editorSection: {
      backgroundColor: "white",
      borderRadius: "12px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      overflow: "hidden"
    },
    editorHeader: {
      padding: "24px 32px",
      borderBottom: "1px solid #e0e0e0",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: "#fafafa"
    },
    editorTitle: {
      fontSize: "20px",
      fontWeight: "600",
      margin: 0
    },
    editorActions: {
      display: "flex",
      gap: "12px"
    },
    editorContent: {
      padding: "32px"
    },
    formSection: {
      marginBottom: "32px"
    },
    sectionTitle: {
      fontSize: "18px",
      fontWeight: "600",
      marginBottom: "20px",
      color: "#1a1a1a"
    },
    formGrid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "20px"
    },
    formGroup: {
      marginBottom: "20px"
    },
    label: {
      display: "block",
      fontSize: "14px",
      fontWeight: "600",
      marginBottom: "8px",
      color: "#333"
    },
    input: {
      width: "100%",
      padding: "10px 14px",
      border: "2px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "15px",
      transition: "border-color 0.2s",
      outline: "none"
    },
    textarea: {
      width: "100%",
      padding: "12px 16px",
      border: "2px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "15px",
      transition: "border-color 0.2s",
      outline: "none",
      minHeight: "120px",
      resize: "vertical" as const
    },
    select: {
      width: "100%",
      padding: "10px 14px",
      border: "2px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "15px",
      backgroundColor: "white",
      cursor: "pointer",
      outline: "none"
    },
    checkbox: {
      marginRight: "8px"
    },
    checkboxLabel: {
      fontSize: "14px",
      fontWeight: "400",
      cursor: "pointer"
    },
    variablesSection: {
      backgroundColor: "#f8f9fa",
      padding: "20px",
      borderRadius: "8px",
      marginBottom: "20px"
    },
    variablesTitle: {
      fontSize: "14px",
      fontWeight: "600",
      marginBottom: "12px",
      color: "#333"
    },
    variablesList: {
      display: "flex",
      flexWrap: "wrap" as const,
      gap: "8px"
    },
    variableChip: {
      backgroundColor: "white",
      padding: "6px 12px",
      borderRadius: "20px",
      border: "1px solid #e0e0e0",
      fontSize: "13px",
      cursor: "pointer",
      transition: "all 0.2s",
      fontFamily: "monospace"
    },
    primaryButton: {
      padding: "10px 20px",
      backgroundColor: "#3b82f6",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    secondaryButton: {
      padding: "10px 20px",
      backgroundColor: "transparent",
      color: "#666",
      border: "2px solid #e0e0e0",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s"
    },
    aiButton: {
      padding: "10px 20px",
      backgroundColor: "#8B5CF6",
      color: "white",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      fontSize: "14px",
      fontWeight: "500",
      transition: "all 0.2s",
      display: "flex",
      alignItems: "center",
      gap: "8px"
    },
    notification: {
      padding: "16px 24px",
      borderRadius: "8px",
      marginBottom: "24px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: "15px"
    },
    successNotification: {
      backgroundColor: "#e8f5e9",
      color: "#1b5e20",
      border: "1px solid #66bb6a"
    },
    errorNotification: {
      backgroundColor: "#ffebee",
      color: "#b71c1c",
      border: "1px solid #ef5350"
    },
    modal: {
      position: "fixed" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000
    },
    modalContent: {
      backgroundColor: "white",
      padding: "40px",
      borderRadius: "16px",
      maxWidth: "600px",
      width: "90%",
      maxHeight: "80vh",
      overflowY: "auto" as const,
      boxShadow: "0 20px 40px rgba(0, 0, 0, 0.15)"
    },
    modalTitle: {
      fontSize: "24px",
      fontWeight: "700",
      marginBottom: "8px",
      color: "#1a1a1a"
    },
    modalSubtitle: {
      fontSize: "16px",
      color: "#666",
      marginBottom: "24px"
    },
    modalActions: {
      display: "flex",
      gap: "12px",
      justifyContent: "flex-end",
      marginTop: "32px"
    }
  };
  
  const previewStyles = {
    container: {
      backgroundColor: "#f5f5f5",
      padding: "24px",
      borderRadius: "8px",
      marginTop: "24px"
    },
    subject: {
      fontSize: "14px",
      marginBottom: "8px",
      color: "#666"
    },
    preheader: {
      fontSize: "13px",
      color: "#999",
      marginBottom: "20px",
      fontStyle: "italic" as const
    },
    emailBody: {
      backgroundColor: "white",
      padding: "40px",
      borderRadius: "8px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      maxWidth: "600px",
      margin: "0 auto",
      fontFamily: "Arial, sans-serif"
    },
    logo: {
      textAlign: "center" as const,
      marginBottom: "32px"
    },
    heading: {
      fontSize: "28px",
      fontWeight: "600",
      textAlign: "center" as const,
      marginBottom: "24px",
      lineHeight: "1.3"
    },
    body: {
      fontSize: "16px",
      lineHeight: "1.6",
      color: "#333",
      marginBottom: "32px"
    },
    buttonContainer: {
      textAlign: "center" as const,
      marginBottom: "32px"
    },
    button: {
      display: "inline-block",
      padding: "14px 32px",
      color: "white",
      textDecoration: "none",
      borderRadius: "8px",
      fontSize: "16px",
      fontWeight: "600"
    },
    footer: {
      fontSize: "14px",
      color: "#666",
      textAlign: "center" as const,
      paddingTop: "24px",
      borderTop: "1px solid #e0e0e0"
    }
  };
  
  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Email Notifications</h1>
        <p style={styles.subtitle}>
          Customize automated email notifications sent to customers about their store credit and tier status
        </p>
      </div>
      
      {/* Notification */}
      {notification && (
        <div style={{
          ...styles.notification,
          ...(notification.type === 'success' ? styles.successNotification : styles.errorNotification)
        }}>
          <span>{notification.message}</span>
          <button 
            onClick={() => setNotification(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: 'inherit' }}
          >
            ×
          </button>
        </div>
      )}
      
      <div style={styles.mainContent}>
        {/* Sidebar - Template List */}
        <div style={styles.sidebar}>
          <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "20px" }}>
            Email Templates
          </h3>
          <ul style={styles.templateList}>
            {(['CREDIT_EARNED', 'BALANCE_UPDATE', 'TIER_PROGRESS'] as EmailTemplateType[]).map(type => (
              <li
                key={type}
                style={{
                  ...styles.templateItem,
                  ...(selectedTemplate === type ? styles.templateItemActive : {})
                }}
                onClick={() => setSelectedTemplate(type)}
                onMouseOver={(e) => {
                  if (selectedTemplate !== type) {
                    e.currentTarget.style.backgroundColor = '#f8f9fa';
                  }
                }}
                onMouseOut={(e) => {
                  if (selectedTemplate !== type) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <div style={styles.templateName}>
                  {getTemplateTypeLabel(type)}
                </div>
                <div style={styles.templateDesc}>
                  {getTemplateDescription(type)}
                </div>
                {templates[type] && (
                  <div style={{ marginTop: "8px" }}>
                    <span style={{
                      fontSize: "12px",
                      padding: "2px 8px",
                      borderRadius: "12px",
                      backgroundColor: templates[type]!.enabled ? "#e8f5e9" : "#ffebee",
                      color: templates[type]!.enabled ? "#2e7d32" : "#c62828"
                    }}>
                      {templates[type]!.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
        
        {/* Main Editor */}
        <div style={styles.editorSection}>
          <div style={styles.editorHeader}>
            <h2 style={styles.editorTitle}>
              {getTemplateTypeLabel(selectedTemplate)}
            </h2>
            <div style={styles.editorActions}>
              <button
                onClick={() => setShowAIModal(true)}
                style={styles.aiButton}
                onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
              >
                ✨ Generate with AI
              </button>
              <button
                onClick={() => setShowPreview(!showPreview)}
                style={styles.secondaryButton}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </button>
            </div>
          </div>
          
          <div style={styles.editorContent}>
            {!currentTemplate ? (
              <div style={{ textAlign: "center" as const, padding: "60px 20px", color: "#999" }}>
                <p style={{ fontSize: "18px", marginBottom: "16px" }}>
                  No template configured yet
                </p>
                <button
                  onClick={() => setShowAIModal(true)}
                  style={styles.primaryButton}
                  onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                  onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                >
                  Generate Template with AI
                </button>
              </div>
            ) : (
              <Form method="post">
                <input type="hidden" name="actionType" value="saveTemplate" />
                <input type="hidden" name="templateType" value={selectedTemplate} />
                
                {/* Basic Settings */}
                <div style={styles.formSection}>
                  <h3 style={styles.sectionTitle}>Basic Settings</h3>
                  <div style={styles.formGrid}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Email Status</label>
                      <select
                        name="enabled"
                        value={currentTemplate.enabled ? "true" : "false"}
                        onChange={(e) => handleTemplateChange('enabled', e.target.value === "true")}
                        style={styles.select}
                      >
                        <option value="true">Enabled</option>
                        <option value="false">Disabled</option>
                      </select>
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Tone</label>
                      <select
                        name="tone"
                        value={currentTemplate.tone}
                        onChange={(e) => handleTemplateChange('tone', e.target.value)}
                        style={styles.select}
                      >
                        <option value="professional">Professional</option>
                        <option value="friendly">Friendly</option>
                        <option value="casual">Casual</option>
                        <option value="excited">Excited</option>
                      </select>
                    </div>
                  </div>
                  <div style={styles.formGrid}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Primary Color</label>
                      <input
                        type="color"
                        name="primaryColor"
                        value={currentTemplate.primaryColor}
                        onChange={(e) => handleTemplateChange('primaryColor', e.target.value)}
                        style={{ ...styles.input, height: "42px", cursor: "pointer" }}
                      />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Options</label>
                      <div>
                        <label style={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            name="includeStoreLogo"
                            checked={currentTemplate.includeStoreLogo}
                            onChange={(e) => handleTemplateChange('includeStoreLogo', e.target.checked)}
                            style={styles.checkbox}
                          />
                          Include store logo
                        </label>
                        <br />
                        <label style={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            name="includeUnsubscribe"
                            checked={currentTemplate.includeUnsubscribe}
                            onChange={(e) => handleTemplateChange('includeUnsubscribe', e.target.checked)}
                            style={styles.checkbox}
                          />
                          Include unsubscribe link
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Email Content */}
                <div style={styles.formSection}>
                  <h3 style={styles.sectionTitle}>Email Content</h3>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Subject Line</label>
                    <input
                      type="text"
                      name="subject"
                      value={currentTemplate.subject}
                      onChange={(e) => handleTemplateChange('subject', e.target.value)}
                      style={styles.input}
                      onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                      onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                    />
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Preheader Text</label>
                    <input
                      type="text"
                      name="preheader"
                      value={currentTemplate.preheader}
                      onChange={(e) => handleTemplateChange('preheader', e.target.value)}
                      placeholder="Preview text that appears in inbox"
                      style={styles.input}
                      onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                      onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                    />
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Email Heading</label>
                    <input
                      type="text"
                      name="heading"
                      value={currentTemplate.heading}
                      onChange={(e) => handleTemplateChange('heading', e.target.value)}
                      style={styles.input}
                      onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                      onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                    />
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Email Body</label>
                    <div style={styles.variablesSection}>
                      <div style={styles.variablesTitle}>
                        Click to insert variables:
                      </div>
                      <div style={styles.variablesList}>
                        {templateVariables[selectedTemplate].map(v => (
                          <span
                            key={v.key}
                            style={styles.variableChip}
                            onClick={() => insertVariable(v.key)}
                            onMouseOver={(e) => {
                              e.currentTarget.style.backgroundColor = '#f0f7ff';
                              e.currentTarget.style.borderColor = '#3b82f6';
                            }}
                            onMouseOut={(e) => {
                              e.currentTarget.style.backgroundColor = 'white';
                              e.currentTarget.style.borderColor = '#e0e0e0';
                            }}
                            title={v.description}
                          >
                            {v.key}
                          </span>
                        ))}
                      </div>
                    </div>
                    <textarea
                      id="template-body"
                      name="body"
                      value={currentTemplate.body}
                      onChange={(e) => handleTemplateChange('body', e.target.value)}
                      style={styles.textarea}
                      rows={8}
                      onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                      onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                    />
                  </div>
                  
                  <div style={styles.formGrid}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Button Text</label>
                      <input
                        type="text"
                        name="buttonText"
                        value={currentTemplate.buttonText}
                        onChange={(e) => handleTemplateChange('buttonText', e.target.value)}
                        placeholder="e.g., Shop Now"
                        style={styles.input}
                        onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                        onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                      />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Button URL</label>
                      <input
                        type="text"
                        name="buttonUrl"
                        value={currentTemplate.buttonUrl}
                        onChange={(e) => handleTemplateChange('buttonUrl', e.target.value)}
                        placeholder="e.g., https://{{shop_domain}}"
                        style={styles.input}
                        onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                        onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                      />
                    </div>
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Footer Text</label>
                    <textarea
                      name="footer"
                      value={currentTemplate.footer}
                      onChange={(e) => handleTemplateChange('footer', e.target.value)}
                      style={styles.textarea}
                      rows={3}
                      onFocus={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                      onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                    />
                  </div>
                </div>
                
                {/* Preview */}
                {showPreview && renderEmailPreview()}
                
                {/* Actions */}
                <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", marginTop: "32px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      const formData = new FormData();
                      formData.append('actionType', 'sendTestEmail');
                      formData.append('templateType', selectedTemplate);
                      const testEmail = prompt('Enter email address for test:');
                      if (testEmail) {
                        formData.append('testEmail', testEmail);
                        submit(formData, { method: 'post' });
                      }
                    }}
                    style={styles.secondaryButton}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    Send Test Email
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    style={{
                      ...styles.primaryButton,
                      opacity: isSubmitting ? 0.6 : 1,
                      cursor: isSubmitting ? "not-allowed" : "pointer"
                    }}
                    onMouseOver={(e) => {
                      if (!isSubmitting) e.currentTarget.style.opacity = '0.9';
                    }}
                    onMouseOut={(e) => {
                      if (!isSubmitting) e.currentTarget.style.opacity = '1';
                    }}
                  >
                    {isSubmitting ? "Saving..." : "Save Template"}
                  </button>
                </div>
              </Form>
            )}
          </div>
        </div>
      </div>
      
      {/* AI Generation Modal */}
      {showAIModal && (
        <div style={styles.modal} onClick={() => setShowAIModal(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Generate Email Template with AI</h2>
            <p style={styles.modalSubtitle}>
              Let AI help you create a compelling email template for {getTemplateTypeLabel(selectedTemplate).toLowerCase()}
            </p>
            
            <Form method="post">
              <input type="hidden" name="actionType" value="generateWithAI" />
              <input type="hidden" name="templateType" value={selectedTemplate} />
              
              <div style={styles.formGroup}>
                <label style={styles.label}>Select Tone</label>
                <select
                  name="tone"
                  value={aiTone}
                  onChange={(e) => setAiTone(e.target.value)}
                  style={styles.select}
                >
                  <option value="professional">Professional - Formal and business-like</option>
                  <option value="friendly">Friendly - Warm and approachable</option>
                  <option value="casual">Casual - Relaxed and conversational</option>
                  <option value="excited">Excited - Enthusiastic and energetic</option>
                </select>
              </div>
              
              <div style={styles.formGroup}>
                <label style={styles.label}>Additional Instructions (Optional)</label>
                <textarea
                  name="additionalInstructions"
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                  placeholder="e.g., Emphasize exclusivity, mention free shipping, include urgency..."
                  style={styles.textarea}
                  rows={4}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#8B5CF6'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
                />
              </div>
              
              <div style={styles.formGroup}>
                <label style={styles.label}>Template Variables Available</label>
                <div style={{ ...styles.variablesSection, marginBottom: 0 }}>
                  <div style={styles.variablesList}>
                    {templateVariables[selectedTemplate].map(v => (
                      <span key={v.key} style={styles.variableChip} title={v.description}>
                        {v.key}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              
              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setShowAIModal(false)}
                  style={styles.secondaryButton}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    ...styles.aiButton,
                    opacity: isSubmitting ? 0.6 : 1,
                    cursor: isSubmitting ? "not-allowed" : "pointer"
                  }}
                  onMouseOver={(e) => {
                    if (!isSubmitting) e.currentTarget.style.opacity = '0.9';
                  }}
                  onMouseOut={(e) => {
                    if (!isSubmitting) e.currentTarget.style.opacity = '1';
                  }}
                >
                  {isSubmitting ? "Generating..." : "Generate Template"}
                </button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}