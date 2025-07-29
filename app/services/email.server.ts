// app/services/email.server.ts
import db from "../db.server";
import type { 
  Customer,
  EmailTemplate,
  EmailTemplateType,
  EmailStatus,
  EmailFrequency,
  CustomerEmailPreferences,
  Tier,
  CustomerMembership,
  Onboarding,
  Prisma
} from "@prisma/client";

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

// Extended types for includes
type CustomerWithRelations = Prisma.CustomerGetPayload<{
  include: {
    emailPreferences: true;
    membershipHistory: {
      where: { isActive: true };
      include: { tier: true };
    };
  };
}>;

export class EmailService {
  /**
   * Send an email to a customer using a template
   */
  static async sendEmail(params: SendEmailParams): Promise<{ success: boolean; error?: string }> {
    const { customerId, templateType, customData, shopDomain } = params;
    
    try {
      // Get customer details with relations
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
      const emailContent = await this.prepareEmailContent(template, customer, customData, shopDomain);
      
      // Create email log entry
      const emailLog = await db.emailLog.create({
        data: {
          shopDomain,
          customerId,
          templateId: template.id,
          templateType,
          recipientEmail: customer.email,
          subject: emailContent.subject,
          status: "PENDING",
          renderedBody: emailContent.html,
          metadata: {
            storeCredit: customer.storeCredit,
            tierName: customer.membershipHistory[0]?.tier.name || "Member",
            ...customData
          }
        }
      });
      
      // Send email (implement your email provider here)
      const sent = await this.sendViaEmailProvider(emailContent, shopDomain);
      
      // Update email log
      await db.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: sent ? "SENT" : "FAILED",
          sentAt: sent ? new Date() : null,
          errorMessage: sent ? null : "Failed to send via email provider"
        }
      });
      
      // Update template test count if in test mode
      if (customData?._isTest) {
        await db.emailTemplate.update({
          where: { id: template.id },
          data: { testEmailsSent: { increment: 1 } }
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
    customer: CustomerWithRelations, 
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
      case "TIER_PROGRESS":
        return prefs.tierProgressOptIn;
      case "WELCOME":
        return true; // Always send welcome emails
      case "CREDIT_EXPIRY_WARNING":
        return prefs.balanceUpdateOptIn; // Use balance update preference
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
    customer: CustomerWithRelations
  ): Promise<EmailTemplate | null> {
    // Try to find a specific template for the customer's tier
    const tierId = customer.membershipHistory[0]?.tierId;
    
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
    
    // Check for customer segment specific templates
    // You can add logic here to determine customer segments
    // For example: "vip" for high spenders, "inactive" for dormant customers
    
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
    customer: CustomerWithRelations,
    customData?: Record<string, any>,
    shopDomain?: string
  ): Promise<EmailContent> {
    // Get shop info for replacements
    const shop = await db.onboarding.findFirst({
      where: { shopDomain: template.shopDomain }
    });
    
    // Build store URL - this would be the actual Shopify domain
    const storeUrl = `https://${shopDomain || template.shopDomain}`;
    
    const replacements: Record<string, string> = {
      "{{customer_name}}": this.getCustomerName(customer.email),
      "{{email}}": customer.email,
      "{{store_name}}": shop?.businessName || template.shopDomain.replace('.myshopify.com', ''),
      "{{store_url}}": storeUrl,
      "{{current_balance}}": this.formatCurrency(customer.storeCredit, shop?.currency),
      "{{total_earned}}": this.formatCurrency(customer.totalEarned, shop?.currency),
      "{{tier_name}}": customer.membershipHistory[0]?.tier.name || "Member",
      "{{tier_cashback}}": `${customer.membershipHistory[0]?.tier.cashbackPercent || 0}%`,
      "{{currency}}": shop?.currency || "USD",
      "{{currency_symbol}}": this.getCurrencySymbol(shop?.currency || "USD"),
      ...customData
    };
    
    // Replace variables in all fields
    const replaceVariables = (text: string): string => {
      let result = text;
      for (const [key, value] of Object.entries(replacements)) {
        result = result.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"), String(value));
      }
      return result;
    };
    
    const subject = replaceVariables(template.subject);
    const body = replaceVariables(template.body);
    const footer = replaceVariables(template.footer);
    const heading = replaceVariables(template.heading);
    const buttonText = template.buttonText ? replaceVariables(template.buttonText) : null;
    const buttonUrl = template.buttonUrl ? replaceVariables(template.buttonUrl) : null;
    
    // Build HTML email
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            line-height: 1.6; 
            color: #333; 
            margin: 0;
            padding: 0;
            background-color: #f5f5f5;
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            padding: 20px;
          }
          .header { 
            text-align: center; 
            padding: 20px 0;
          }
          .logo {
            max-width: 200px;
            height: auto;
          }
          .content { 
            background: #ffffff; 
            padding: 30px; 
            border-radius: 8px; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .button { 
            display: inline-block; 
            padding: 12px 24px; 
            background: ${template.primaryColor}; 
            color: white; 
            text-decoration: none; 
            border-radius: 4px; 
            margin: 20px 0;
            font-weight: 500;
          }
          .button:hover {
            opacity: 0.9;
          }
          .footer { 
            text-align: center; 
            padding: 20px 0; 
            color: #666; 
            font-size: 14px;
          }
          .footer a {
            color: #666;
            text-decoration: underline;
          }
          h1 { 
            color: #1a1a1a; 
            margin-bottom: 20px;
            font-size: 28px;
          }
          p { 
            margin-bottom: 15px;
            line-height: 1.6;
          }
          .preheader {
            display: none !important;
            visibility: hidden;
            mso-hide: all;
            font-size: 1px;
            line-height: 1px;
            max-height: 0;
            max-width: 0;
            opacity: 0;
            overflow: hidden;
          }
        </style>
      </head>
      <body>
        <div class="preheader">${template.preheader}</div>
        <div class="container">
          ${template.includeStoreLogo ? `
            <div class="header">
              <img src="${storeUrl}/logo.png" alt="${shop?.businessName || 'Store'} Logo" class="logo" />
            </div>
          ` : ''}
          
          <div class="content">
            <h1>${heading}</h1>
            ${body}
            
            ${buttonText && buttonUrl ? `
              <div style="text-align: center; margin: 30px 0;">
                <a href="${buttonUrl}" class="button" style="color: white;">
                  ${buttonText}
                </a>
              </div>
            ` : ''}
          </div>
          
          <div class="footer">
            ${footer}
            ${template.includeUnsubscribe ? `
              <p style="margin-top: 20px;">
                <a href="${storeUrl}/pages/email-preferences?customer=${customer.id}&token=${this.generateUnsubscribeToken(customer.id)}">Unsubscribe</a> | 
                <a href="${storeUrl}/pages/email-preferences?customer=${customer.id}">Update Preferences</a>
              </p>
            ` : ''}
            ${shop ? `
              <p style="margin-top: 10px; font-size: 12px; color: #999;">
                ${shop.businessName}<br>
                ${shop.country}
              </p>
            ` : ''}
          </div>
        </div>
      </body>
      </html>
    `;
    
    // Generate plain text version
    const text = `${heading}\n\n${body.replace(/<[^>]*>/g, '')}\n\n${footer}${
      template.includeUnsubscribe ? '\n\nTo unsubscribe or update preferences, visit your account settings.' : ''
    }`;
    
    return {
      to: customer.email,
      subject,
      html,
      text
    };
  }
  
  /**
   * Get customer name from email or other sources
   */
  private static getCustomerName(email: string): string {
    // Extract name from email if no proper name is stored
    const emailPrefix = email.split("@")[0];
    // Convert email prefix to proper case (john.doe -> John Doe)
    return emailPrefix
      .split(/[._-]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }
  
  /**
   * Format currency with proper symbol and formatting
   */
  static formatCurrency(amount: number, currency?: string): string {
    const curr = currency || "USD";
    const symbol = this.getCurrencySymbol(curr);
    
    // Format based on currency
    switch (curr) {
      case "EUR":
        return `${amount.toFixed(2)}${symbol}`;
      case "GBP":
      case "USD":
      case "CAD":
      case "AUD":
      default:
        return `${symbol}${amount.toFixed(2)}`;
    }
  }
  
  /**
   * Get currency symbol
   */
  private static getCurrencySymbol(currency: string): string {
    const symbols: Record<string, string> = {
      USD: "$",
      EUR: "€",
      GBP: "£",
      CAD: "$",
      AUD: "$",
      JPY: "¥",
      CNY: "¥",
      INR: "₹",
      // Add more as needed
    };
    
    return symbols[currency] || currency;
  }
  
  /**
   * Generate unsubscribe token (implement your own logic)
   */
  private static generateUnsubscribeToken(customerId: string): string {
    // In production, use a proper token generation method
    // This could be a JWT or a hashed value stored in the database
    return Buffer.from(`${customerId}:${Date.now()}`).toString('base64');
  }
  
  /**
   * Send email via your email provider
   */
  private static async sendViaEmailProvider(content: EmailContent, shopDomain: string): Promise<boolean> {
    // Get sender email - could be from environment or shop settings
    const senderEmail = process.env.SENDER_EMAIL || `noreply@${shopDomain}`;
    const senderName = shopDomain.replace('.myshopify.com', '');
    
    // TODO: Implement your email provider integration here
    
    // Example for SendGrid:
    /*
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    try {
      await sgMail.send({
        to: content.to,
        from: {
          email: senderEmail,
          name: senderName
        },
        subject: content.subject,
        html: content.html,
        text: content.text,
        trackingSettings: {
          clickTracking: { enable: true },
          openTracking: { enable: true }
        }
      });
      return true;
    } catch (error) {
      console.error("SendGrid error:", error);
      return false;
    }
    */
    
    // Example for AWS SES:
    /*
    const AWS = require('aws-sdk');
    const ses = new AWS.SES({ region: process.env.AWS_REGION });
    
    try {
      await ses.sendEmail({
        Source: `${senderName} <${senderEmail}>`,
        Destination: { ToAddresses: [content.to] },
        Message: {
          Subject: { Data: content.subject },
          Body: {
            Html: { Data: content.html },
            Text: { Data: content.text }
          }
        }
      }).promise();
      return true;
    } catch (error) {
      console.error("AWS SES error:", error);
      return false;
    }
    */
    
    // For development/testing
    if (process.env.NODE_ENV === 'development') {
      console.log("📧 Email would be sent:");
      console.log("To:", content.to);
      console.log("Subject:", content.subject);
      console.log("From:", `${senderName} <${senderEmail}>`);
      return true;
    }
    
    // Default: log error if no provider configured
    console.error("No email provider configured. Set up SendGrid, AWS SES, or another provider.");
    return false;
  }
  
  /**
   * Send batch emails (e.g., for balance reminders)
   */
  static async sendBatchEmails(
    shopDomain: string,
    templateType: EmailTemplateType,
    customerIds: string[],
    customDataPerCustomer?: Record<string, Record<string, any>>
  ): Promise<{ sent: number; failed: number; errors: string[] }> {
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    
    // Process in batches to avoid overwhelming the system
    const batchSize = 10;
    for (let i = 0; i < customerIds.length; i += batchSize) {
      const batch = customerIds.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (customerId) => {
          const result = await this.sendEmail({
            customerId,
            templateType,
            shopDomain,
            customData: customDataPerCustomer?.[customerId]
          });
          
          if (result.success) {
            sent++;
          } else {
            failed++;
            if (result.error) {
              errors.push(`${customerId}: ${result.error}`);
            }
          }
        })
      );
      
      // Add a small delay between batches
      if (i + batchSize < customerIds.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return { sent, failed, errors };
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
    openRate: number;
    clickRate: number;
  }> {
    const where: Prisma.EmailLogWhereInput = { shopDomain };
    
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }
    
    const [totalSent, totalOpened, totalClicked, byType, byStatus] = await Promise.all([
      db.emailLog.count({ where: { ...where, status: "SENT" } }),
      db.emailLog.count({ where: { ...where, openedAt: { not: null } } }),
      db.emailLog.count({ where: { ...where, clickedAt: { not: null } } }),
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
      byType: byType.map((t) => ({ 
        type: t.templateType, 
        count: t._count 
      })),
      byStatus: byStatus.map((s) => ({ 
        status: s.status, 
        count: s._count 
      })),
      openRate: totalSent > 0 ? (totalOpened / totalSent) * 100 : 0,
      clickRate: totalSent > 0 ? (totalClicked / totalSent) * 100 : 0
    };
  }
  
  /**
   * Send test email
   */
  static async sendTestEmail(
    templateId: string,
    recipientEmail: string,
    shopDomain: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const template = await db.emailTemplate.findUnique({
        where: { id: templateId }
      });
      
      if (!template) {
        return { success: false, error: "Template not found" };
      }
      
      // Create a mock customer for testing
      const mockCustomer: CustomerWithRelations = {
        id: "test-customer",
        shopDomain,
        shopifyCustomerId: "test-123",
        email: recipientEmail,
        storeCredit: 150.00,
        totalEarned: 500.00,
        notes: null,
        tags: [],
        preferences: null,
        lastSyncedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        emailPreferences: {
          id: "test-prefs",
          customerId: "test-customer",
          shopDomain,
          creditEarnedOptIn: true,
          balanceUpdateOptIn: true,
          tierProgressOptIn: true,
          marketingOptIn: true,
          balanceUpdateFrequency: "MONTHLY",
          tierProgressFrequency: "MONTHLY",
          preferredLanguage: "en",
          timezone: "UTC",
          lastUpdated: new Date(),
          updatedBy: null,
          unsubscribedAt: null,
          unsubscribeReason: null
        },
        membershipHistory: [{
          id: "test-membership",
          customerId: "test-customer",
          tierId: "test-tier",
          startDate: new Date(),
          endDate: null,
          isActive: true,
          assignmentType: "AUTOMATIC",
          assignedBy: null,
          reason: null,
          previousTierId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          tier: {
            id: "test-tier",
            shopDomain,
            name: "Gold",
            minSpend: 1000,
            cashbackPercent: 5,
            evaluationPeriod: "ANNUAL",
            isActive: true,
            benefits: { list: ["Free shipping", "Early access"] },
            createdAt: new Date()
          }
        }]
      };
      
      const emailContent = await this.prepareEmailContent(
        template,
        mockCustomer,
        { 
          "{{credit_amount}}": "$25.00",
          "{{order_id}}": "TEST-1234",
          "{{new_tier}}": "Platinum",
          "{{previous_tier}}": "Gold",
          _isTest: true
        },
        shopDomain
      );
      
      const sent = await this.sendViaEmailProvider(emailContent, shopDomain);
      
      return sent
        ? { success: true }
        : { success: false, error: "Failed to send test email" };
        
    } catch (error) {
      console.error("Test email error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
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
      "{{credit_amount}}": EmailService.formatCurrency(creditAmount),
      "{{order_id}}": orderId
    }
  });
}

export async function sendTierUpgradeEmail(
  customerId: string,
  shopDomain: string,
  newTierName: string,
  previousTierName: string,
  newCashbackPercent: number,
  newBenefits: string[]
): Promise<{ success: boolean; error?: string }> {
  return EmailService.sendEmail({
    customerId,
    shopDomain,
    templateType: "TIER_UPGRADE",
    customData: {
      "{{new_tier}}": newTierName,
      "{{previous_tier}}": previousTierName,
      "{{new_cashback_percent}}": `${newCashbackPercent}%`,
      "{{benefits_list}}": newBenefits.map(b => `• ${b}`).join('<br>')
    }
  });
}

export async function sendTierDowngradeEmail(
  customerId: string,
  shopDomain: string,
  newTierName: string,
  previousTierName: string,
  newCashbackPercent: number
): Promise<{ success: boolean; error?: string }> {
  return EmailService.sendEmail({
    customerId,
    shopDomain,
    templateType: "TIER_DOWNGRADE",
    customData: {
      "{{new_tier}}": newTierName,
      "{{previous_tier}}": previousTierName,
      "{{new_cashback_percent}}": `${newCashbackPercent}%`
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

export async function sendCreditExpiryWarning(
  customerId: string,
  shopDomain: string,
  expiringAmount: number,
  expiryDate: Date
): Promise<{ success: boolean; error?: string }> {
  return EmailService.sendEmail({
    customerId,
    shopDomain,
    templateType: "CREDIT_EXPIRY_WARNING",
    customData: {
      "{{expiring_amount}}": EmailService.formatCurrency(expiringAmount),
      "{{expiry_date}}": expiryDate.toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      })
    }
  });
}