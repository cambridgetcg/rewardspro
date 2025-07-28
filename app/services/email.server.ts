// app/services/email.server.ts
// Comment out the db import if it doesn't exist yet
// import { db } from "../db.server";

// Define types locally if Prisma types aren't available yet
type EmailTemplateType = 
  | "WELCOME" 
  | "CREDIT_EARNED" 
  | "BALANCE_UPDATE" 
  | "TIER_UPGRADE"
  | "TIER_DOWNGRADE"
  | "TIER_PROGRESS"
  | "CREDIT_EXPIRY_WARNING";

type EmailStatus = 
  | "PENDING"
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "OPENED"
  | "CLICKED"
  | "BOUNCED"
  | "FAILED"
  | "UNSUBSCRIBED";

type EmailFrequency = 
  | "DAILY"
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "NEVER";

interface Customer {
  id: string;
  email: string;
  storeCredit: number;
  totalEarned: number;
  shopDomain: string;
  emailPreferences?: CustomerEmailPreferences | null;
  membershipHistory?: Array<{
    id: string;
    isActive: boolean;
    tierId: string;
    tier: {
      id: string;
      name: string;
      cashbackPercent: number;
    };
  }>;
}

interface CustomerEmailPreferences {
  creditEarnedOptIn: boolean;
  balanceUpdateOptIn: boolean;
  tierProgressOptIn: boolean;
  marketingOptIn: boolean;
}

interface EmailTemplate {
  id: string;
  shopDomain: string;
  type: EmailTemplateType;
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  footer: string;
  primaryColor: string;
  buttonText: string | null;
  buttonUrl: string | null;
  includeStoreLogo: boolean;
  includeUnsubscribe: boolean;
  enabled: boolean;
  tierId: string | null;
  customerSegment: string | null;
}

interface SendEmailParams {
  customerId: string;
  templateType: EmailTemplateType;
  customData?: Record<string, any>;
  shopDomain: string;
}

interface EmailContent {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface ShopInfo {
  shopDomain: string;
  businessName: string;
  currency: string;
}

// Mock database service for TypeScript checking
// Replace with actual db import when available
const mockDb = {
  customer: {
    findUnique: async (args: any): Promise<Customer | null> => null,
  },
  emailLog: {
    create: async (args: any): Promise<any> => null,
    update: async (args: any): Promise<any> => null,
    count: async (args: any): Promise<number> => 0,
    groupBy: async (args: any): Promise<any[]> => [],
  },
  emailTemplate: {
    findFirst: async (args: any): Promise<EmailTemplate | null> => null,
  },
  onboarding: {
    findFirst: async (args: any): Promise<ShopInfo | null> => null,
  },
};

// Use mockDb for now, replace with actual db when available
const db = mockDb;

export class EmailService {
  /**
   * Send an email to a customer using a template
   */
  static async sendEmail(params: SendEmailParams): Promise<{ success: boolean; error?: string }> {
    const { customerId, templateType, customData, shopDomain } = params;
    
    try {
      // Get customer details
      const customer = await db.customer.findUnique({
        where: { id: customerId },
        include: {
          emailPreferences: true,
          membershipHistory: {
            where: { isActive: true },
            include: { tier: true }
          }
        }
      });
      
      if (!customer) {
        throw new Error("Customer not found");
      }
      
      // Check email preferences
      if (!this.shouldSendEmail(customer, templateType)) {
        return { success: false, error: "Customer has opted out of this email type" };
      }
      
      // Get the appropriate template
      const template = await this.getTemplate(shopDomain, templateType, customer);
      
      if (!template || !template.enabled) {
        return { success: false, error: "No active template found for this email type" };
      }
      
      // Prepare email content
      const emailContent = await this.prepareEmailContent(template, customer, customData);
      
      // Create email log entry
      const emailLog = await db.emailLog.create({
        data: {
          shopDomain,
          customerId,
          templateId: template.id,
          templateType,
          recipientEmail: customer.email,
          subject: emailContent.subject,
          status: "PENDING" as EmailStatus,
          renderedBody: emailContent.html,
          metadata: {
            storeCredit: customer.storeCredit,
            tierName: customer.membershipHistory?.[0]?.tier.name || "Member",
            ...customData
          }
        }
      });
      
      // Send email (implement your email provider here)
      const sent = await this.sendViaEmailProvider(emailContent);
      
      // Update email log
      if (emailLog?.id) {
        await db.emailLog.update({
          where: { id: emailLog.id },
          data: {
            status: sent ? "SENT" : "FAILED",
            sentAt: sent ? new Date() : null,
            errorMessage: sent ? null : "Failed to send via email provider"
          }
        });
      }
      
      return { success: sent };
      
    } catch (error) {
      console.error("Email sending error:", error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  }
  
  /**
   * Check if we should send this type of email to the customer
   */
  private static shouldSendEmail(
    customer: Customer, 
    templateType: EmailTemplateType
  ): boolean {
    const prefs = customer.emailPreferences;
    
    if (!prefs) return true; // Default to opted in if no preferences
    
    switch (templateType) {
      case "CREDIT_EARNED":
        return prefs.creditEarnedOptIn;
      case "BALANCE_UPDATE":
        return prefs.balanceUpdateOptIn;
      case "TIER_UPGRADE":
      case "TIER_DOWNGRADE":
        return prefs.tierProgressOptIn;
      case "WELCOME":
        return true; // Always send welcome emails
      default:
        return prefs.marketingOptIn;
    }
  }
  
  /**
   * Get the appropriate email template
   */
  private static async getTemplate(
    shopDomain: string,
    templateType: EmailTemplateType,
    customer: Customer
  ): Promise<EmailTemplate | null> {
    // Try to find a specific template for the customer's tier
    const tierId = customer.membershipHistory?.[0]?.tierId;
    
    if (tierId) {
      const tierSpecificTemplate = await db.emailTemplate.findFirst({
        where: {
          shopDomain,
          type: templateType,
          tierId,
          enabled: true
        }
      });
      
      if (tierSpecificTemplate) return tierSpecificTemplate;
    }
    
    // Fall back to general template
    return db.emailTemplate.findFirst({
      where: {
        shopDomain,
        type: templateType,
        tierId: null,
        customerSegment: null,
        enabled: true
      }
    });
  }
  
  /**
   * Prepare email content with variable replacement
   */
  private static async prepareEmailContent(
    template: EmailTemplate,
    customer: Customer,
    customData?: Record<string, any>
  ): Promise<EmailContent> {
    // Get shop info for replacements
    const shop = await db.onboarding.findFirst({
      where: { shopDomain: template.shopDomain }
    });
    
    const replacements: Record<string, string> = {
      "{{customer_name}}": customer.email.split("@")[0], // Use email prefix if no name
      "{{email}}": customer.email,
      "{{store_name}}": shop?.businessName || template.shopDomain,
      "{{current_balance}}": `$${customer.storeCredit.toFixed(2)}`,
      "{{total_earned}}": `$${customer.totalEarned.toFixed(2)}`,
      "{{tier_name}}": customer.membershipHistory?.[0]?.tier.name || "Member",
      "{{currency}}": shop?.currency || "USD",
      ...customData
    };
    
    // Replace variables in all fields
    const replaceVariables = (text: string): string => {
      let result = text;
      for (const [key, value] of Object.entries(replacements)) {
        result = result.replace(new RegExp(key, "g"), String(value));
      }
      return result;
    };
    
    const subject = replaceVariables(template.subject);
    const body = replaceVariables(template.body);
    const footer = replaceVariables(template.footer);
    
    // Build HTML email
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; padding: 20px 0; }
          .content { background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .button { display: inline-block; padding: 12px 24px; background: ${template.primaryColor}; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px 0; color: #666; font-size: 14px; }
          h1 { color: #1a1a1a; margin-bottom: 20px; }
          p { margin-bottom: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          ${template.includeStoreLogo ? `
            <div class="header">
              <h2>${shop?.businessName || template.shopDomain}</h2>
            </div>
          ` : ''}
          
          <div class="content">
            <h1>${replaceVariables(template.heading)}</h1>
            ${body}
            
            ${template.buttonText && template.buttonUrl ? `
              <div style="text-align: center;">
                <a href="${replaceVariables(template.buttonUrl)}" class="button">
                  ${replaceVariables(template.buttonText)}
                </a>
              </div>
            ` : ''}
          </div>
          
          <div class="footer">
            ${footer}
            ${template.includeUnsubscribe ? `
              <p>
                <a href="#" style="color: #666;">Unsubscribe</a> | 
                <a href="#" style="color: #666;">Update Preferences</a>
              </p>
            ` : ''}
          </div>
        </div>
      </body>
      </html>
    `;
    
    return {
      to: customer.email,
      subject,
      html,
      text: `${replaceVariables(template.heading)}\n\n${body.replace(/<[^>]*>/g, '')}\n\n${footer}`
    };
  }
  
  /**
   * Send email via your email provider
   * Implement this based on your email service (SendGrid, AWS SES, etc.)
   */
  private static async sendViaEmailProvider(content: EmailContent): Promise<boolean> {
    // TODO: Implement your email provider integration here
    // Example for SendGrid:
    /*
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    try {
      await sgMail.send({
        to: content.to,
        from: process.env.SENDER_EMAIL,
        subject: content.subject,
        html: content.html,
        text: content.text,
      });
      return true;
    } catch (error) {
      console.error("SendGrid error:", error);
      return false;
    }
    */
    
    // For now, just log and return true for testing
    console.log("Sending email:", {
      to: content.to,
      subject: content.subject
    });
    
    return true; // Change to false to test failure scenarios
  }
  
  /**
   * Send batch emails (e.g., for balance reminders)
   */
  static async sendBatchEmails(
    shopDomain: string,
    templateType: EmailTemplateType,
    customerIds: string[]
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    
    // Process in batches to avoid overwhelming the system
    const batchSize = 10;
    for (let i = 0; i < customerIds.length; i += batchSize) {
      const batch = customerIds.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (customerId) => {
          const result = await this.sendEmail({
            customerId,
            templateType,
            shopDomain
          });
          
          if (result.success) {
            sent++;
          } else {
            failed++;
          }
        })
      );
      
      // Add a small delay between batches
      if (i + batchSize < customerIds.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return { sent, failed };
  }
  
  /**
   * Get email analytics for a shop
   */
  static async getEmailAnalytics(
    shopDomain: string,
    dateFrom?: Date,
    dateTo?: Date
  ): Promise<{
    totalSent: number;
    byType: Array<{ type: EmailTemplateType; count: number }>;
    byStatus: Array<{ status: EmailStatus; count: number }>;
  }> {
    const where: any = { shopDomain };
    
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }
    
    const [totalSent, byType, byStatus] = await Promise.all([
      db.emailLog.count({ where }),
      db.emailLog.groupBy({
        by: ['templateType'],
        where,
        _count: true
      }),
      db.emailLog.groupBy({
        by: ['status'],
        where,
        _count: true
      })
    ]);
    
    return {
      totalSent,
      byType: byType.map((t: any) => ({ 
        type: t.templateType as EmailTemplateType, 
        count: t._count 
      })),
      byStatus: byStatus.map((s: any) => ({ 
        status: s.status as EmailStatus, 
        count: s._count 
      }))
    };
  }
}

// Email automation helpers
export async function sendWelcomeEmail(customerId: string, shopDomain: string): Promise<{ success: boolean; error?: string }> {
  return EmailService.sendEmail({
    customerId,
    shopDomain,
    templateType: "WELCOME"
  });
}

export async function sendCreditEarnedEmail(
  customerId: string, 
  shopDomain: string,
  creditAmount: number,
  orderId: string
): Promise<{ success: boolean; error?: string }> {
  return EmailService.sendEmail({
    customerId,
    shopDomain,
    templateType: "CREDIT_EARNED",
    customData: {
      "{{credit_amount}}": `$${creditAmount.toFixed(2)}`,
      "{{order_id}}": orderId
    }
  });
}

export async function sendTierUpgradeEmail(
  customerId: string,
  shopDomain: string,
  newTierName: string,
  previousTierName: string,
  newBenefits: string[]
): Promise<{ success: boolean; error?: string }> {
  return EmailService.sendEmail({
    customerId,
    shopDomain,
    templateType: "TIER_UPGRADE",
    customData: {
      "{{new_tier}}": newTierName,
      "{{previous_tier}}": previousTierName,
      "{{benefits_list}}": newBenefits.map(b => `• ${b}`).join('\n')
    }
  });
}

export async function sendBalanceReminderEmail(
  customerId: string, 
  shopDomain: string
): Promise<{ success: boolean; error?: string }> {
  return EmailService.sendEmail({
    customerId,
    shopDomain,
    templateType: "BALANCE_UPDATE"
  });
}