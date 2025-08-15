// app/routes/webhooks.orders.paid.tsx
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface Transaction {
  id: string;
  gateway: string;
  status: string;
  kind: string;
  amountSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  parentTransaction?: {
    id: string;
  };
}

interface OrderDetails {
  id: string;
  totalReceivedSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  transactions: Transaction[];
}

interface PaymentBreakdown {
  giftCardAmount: number;
  storeCreditAmount: number;
  externalPaymentAmount: number;
  cashbackEligibleAmount: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Round down to 2 decimal places for accurate currency calculations
 */
function roundDownToHundredths(value: number): number {
  return Math.floor(value * 100) / 100;
}

/**
 * Format number for Shopify API (exactly 2 decimal places)
 */
function formatForShopify(value: number): string {
  return roundDownToHundredths(value).toFixed(2);
}

// ============================================================================
// STEP 3: FETCH TRANSACTION DETAILS
// ============================================================================

async function fetchOrderTransactions(
  admin: any, 
  orderId: string
): Promise<OrderDetails | null> {
  const query = `#graphql
    query GetOrderPaymentDetails($id: ID!) {
      order(id: $id) {
        id
        totalReceivedSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        transactions(first: 250) {
          id
          gateway
          status
          kind
          amountSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          parentTransaction {
            id
          }
        }
      }
    }
  `;

  const gid = orderId.startsWith('gid://') 
    ? orderId 
    : `gid://shopify/Order/${orderId}`;
  
  try {
    const response = await admin.graphql(query, { 
      variables: { id: gid } 
    });
    const result = await response.json();
    
    if (result.errors || !result.data?.order) {
      console.error("Failed to fetch order details:", result.errors);
      return null;
    }
    
    return result.data.order;
  } catch (error) {
    console.error("GraphQL query failed:", error);
    return null;
  }
}

// ============================================================================
// STEP 4: ANALYZE TRANSACTIONS
// ============================================================================

function analyzeTransactions(transactions: Transaction[]): PaymentBreakdown {
  let giftCardAmount = 0;
  let storeCreditAmount = 0;
  let externalPaymentAmount = 0;
  
  // Only process successful SALE or CAPTURE transactions
  const validTransactions = transactions.filter(tx => {
    const isSuccessful = tx.status === 'SUCCESS';
    const isPayment = ['SALE', 'CAPTURE'].includes(tx.kind);
    return isSuccessful && isPayment;
  });
  
  // Deduplicate CAPTURE/AUTHORIZATION pairs
  const processedIds = new Set<string>();
  
  validTransactions.forEach(tx => {
    // Skip if we've already processed this transaction
    if (processedIds.has(tx.id)) return;
    
    // Skip CAPTURE if we already processed its AUTHORIZATION
    if (tx.kind === 'CAPTURE' && tx.parentTransaction) {
      const parentAuth = transactions.find(
        t => t.id === tx.parentTransaction!.id && t.kind === 'AUTHORIZATION'
      );
      if (parentAuth && processedIds.has(parentAuth.id)) {
        return;
      }
    }
    
    processedIds.add(tx.id);
    const amount = parseFloat(tx.amountSet.shopMoney.amount);
    const gateway = tx.gateway.toLowerCase();
    
    // Categorize payment by gateway
    if (gateway.includes('gift_card')) {
      giftCardAmount += amount;
      console.log(`  Gift card: ${amount} (excluded)`);
    } else if (gateway.includes('store_credit')) {
      storeCreditAmount += amount;
      console.log(`  Store credit: ${amount} (excluded)`);
    } else {
      externalPaymentAmount += amount;
      console.log(`  External payment (${tx.gateway}): ${amount} (eligible)`);
    }
  });
  
  return {
    giftCardAmount,
    storeCreditAmount,
    externalPaymentAmount,
    cashbackEligibleAmount: externalPaymentAmount
  };
}

// ============================================================================
// STEP 5: CALCULATE CASHBACK
// ============================================================================

async function calculateCashback(
  customerId: string,
  shopDomain: string,
  eligibleAmount: number
): Promise<{ amount: number; percentage: number; tierName: string | null }> {
  // Get customer's tier information
  const membership = await db.customerMembership.findFirst({
    where: {
      customerId,
      isActive: true
    },
    include: {
      tier: true
    }
  });
  
  const cashbackPercent = membership?.tier.cashbackPercent || 1; // Default 1%
  const rawAmount = eligibleAmount * (cashbackPercent / 100);
  const cashbackAmount = roundDownToHundredths(rawAmount);
  
  return {
    amount: cashbackAmount,
    percentage: cashbackPercent,
    tierName: membership?.tier.name || null
  };
}

// ============================================================================
// STEP 6: ISSUE STORE CREDIT
// ============================================================================

async function issueStoreCredit(
  admin: any,
  customerId: string,
  amount: number,
  currency: string
): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  const formattedAmount = formatForShopify(amount);
  
  console.log(`Issuing store credit: ${formattedAmount} ${currency}`);
  
  try {
    const response = await admin.graphql(
      `#graphql
      mutation IssueStoreCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
        storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
          storeCreditAccountTransaction {
            id
            amount {
              amount
              currencyCode
            }
            balanceAfterTransaction {
              amount
              currencyCode
            }
          }
          userErrors {
            field
            message
            code
          }
        }
      }`,
      {
        variables: {
          id: `gid://shopify/Customer/${customerId}`,
          creditInput: {
            creditAmount: {
              amount: formattedAmount,
              currencyCode: currency
            }
          }
        }
      }
    );
    
    const result = await response.json();
    
    // Check for errors
    if (result.data?.storeCreditAccountCredit?.userErrors?.length > 0) {
      const errors = result.data.storeCreditAccountCredit.userErrors;
      const errorMessages = errors.map((e: any) => e.message).join(', ');
      console.error("Store credit errors:", errors);
      return { success: false, error: errorMessages };
    }
    
    // Check for successful transaction
    const transaction = result.data?.storeCreditAccountCredit?.storeCreditAccountTransaction;
    if (transaction) {
      console.log(`✅ Store credit issued: ${transaction.id}`);
      console.log(`   New balance: ${transaction.balanceAfterTransaction.amount} ${currency}`);
      return { 
        success: true, 
        transactionId: transaction.id 
      };
    }
    
    return { success: false, error: "No transaction returned" };
    
  } catch (error) {
    console.error("Store credit API error:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function recordCashbackTransaction(
  shopDomain: string,
  customerId: string,
  orderId: string,
  orderAmount: number,
  cashbackAmount: number,
  cashbackPercent: number,
  shopifyTransactionId?: string
) {
  // Use a transaction to ensure atomicity
  const [transaction, updatedCustomer] = await db.$transaction([
    // Create cashback transaction record
    db.cashbackTransaction.create({
      data: {
        shopDomain,
        customerId,
        shopifyOrderId: orderId,
        orderAmount,
        cashbackAmount,
        cashbackPercent,
        status: shopifyTransactionId ? "SYNCED_TO_SHOPIFY" : "COMPLETED",
        shopifyTransactionId
      }
    }),
    // Update customer balance
    db.customer.update({
      where: { id: customerId },
      data: {
        storeCredit: { increment: cashbackAmount },
        totalEarned: { increment: cashbackAmount }
      }
    })
  ]);
  
  return { transaction, updatedCustomer };
}

// ============================================================================
// MAIN WEBHOOK HANDLER
// ============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("\n" + "=".repeat(60));
  console.log("CASHBACK WEBHOOK - ORDER PAID");
  console.log("=".repeat(60));
  
  try {
    // Authenticate webhook
    const { topic, shop, payload, admin } = await authenticate.webhook(request);
    
    // ========================================================================
    // STEP 1 & 2: RECEIVE ORDER & EXTRACT BASIC INFO
    // ========================================================================
    
    const order = payload;
    
    // Extract essential information
    const orderId = order.id?.toString();
    const customerId = order.customer?.id?.toString();
    const customerEmail = order.customer?.email;
    const currency = order.currency || "USD";
    const webhookTotalPrice = parseFloat(order.total_price || "0");
    
    console.log("\n📦 Order Information:");
    console.log(`   Order ID: ${orderId}`);
    console.log(`   Customer: ${customerEmail} (ID: ${customerId})`);
    console.log(`   Total Price: ${webhookTotalPrice} ${currency}`);
    console.log(`   Financial Status: ${order.financial_status}`);
    
    // Validation checks
    if (!customerId) {
      console.log("⏭️  Skipping: Guest checkout (no customer ID)");
      return new Response("OK", { status: 200 });
    }
    
    if (order.financial_status === 'voided' || order.cancelled_at) {
      console.log("⏭️  Skipping: Order cancelled or voided");
      return new Response("OK", { status: 200 });
    }
    
    // Check for duplicate processing
    const existingTransaction = await db.cashbackTransaction.findUnique({
      where: { 
        shopDomain_shopifyOrderId: {
          shopDomain: shop,
          shopifyOrderId: orderId
        }
      }
    });
    
    if (existingTransaction) {
      console.log("⏭️  Skipping: Order already processed");
      return new Response("OK", { status: 200 });
    }
    
    // Find or create customer
    let customer = await db.customer.findUnique({
      where: { 
        shopDomain_shopifyCustomerId: {
          shopDomain: shop,
          shopifyCustomerId: customerId
        }
      }
    });
    
    if (!customer) {
      console.log("👤 Creating new customer record");
      customer = await db.customer.create({
        data: {
          shopDomain: shop,
          shopifyCustomerId: customerId,
          email: customerEmail,
          storeCredit: 0,
          totalEarned: 0
        }
      });
      
      // Assign initial tier
      const defaultTierId = await getDefaultTierId(shop);
      await db.customerMembership.create({
        data: {
          customerId: customer.id,
          tierId: defaultTierId,
          assignmentType: "AUTOMATIC" // System-assigned for new customers
        }
      });
      
      // Log the initial tier assignment
      await db.tierChangeLog.create({
        data: {
          customerId: customer.id,
          fromTierId: null, // No previous tier
          toTierId: defaultTierId,
          changeType: "INITIAL_ASSIGNMENT", // This is valid in TierChangeType enum
          triggeredBy: "SYSTEM",
          changeReason: "New customer - first order"
        }
      });
    }
    
    // ========================================================================
    // STEP 3: FETCH TRANSACTION DETAILS
    // ========================================================================
    
    console.log("\n💳 Fetching payment details...");
    
    let cashbackEligibleAmount = webhookTotalPrice; // Fallback
    
    if (admin) {
      const orderDetails = await fetchOrderTransactions(admin, orderId);
      
      if (orderDetails && orderDetails.transactions.length > 0) {
        // ====================================================================
        // STEP 4: ANALYZE TRANSACTIONS
        // ====================================================================
        
        console.log(`\n📊 Analyzing ${orderDetails.transactions.length} transactions:`);
        const breakdown = analyzeTransactions(orderDetails.transactions);
        
        console.log("\n💰 Payment Breakdown:");
        console.log(`   Gift Cards: ${breakdown.giftCardAmount.toFixed(2)} ${currency}`);
        console.log(`   Store Credit: ${breakdown.storeCreditAmount.toFixed(2)} ${currency}`);
        console.log(`   External Payments: ${breakdown.externalPaymentAmount.toFixed(2)} ${currency}`);
        console.log(`   ✅ Cashback Eligible: ${breakdown.cashbackEligibleAmount.toFixed(2)} ${currency}`);
        
        cashbackEligibleAmount = breakdown.cashbackEligibleAmount;
      } else {
        console.warn("⚠️  Could not fetch transactions, using webhook total");
      }
    } else {
      console.warn("⚠️  Admin API not available");
    }
    
    // Skip if no eligible amount
    if (cashbackEligibleAmount <= 0) {
      console.log("⏭️  Skipping: No cashback eligible amount");
      return new Response("OK", { status: 200 });
    }
    
    // ========================================================================
    // STEP 5: CALCULATE CASHBACK
    // ========================================================================
    
    console.log("\n🎯 Calculating cashback:");
    const cashback = await calculateCashback(
      customer.id, 
      shop, 
      cashbackEligibleAmount
    );
    
    console.log(`   Tier: ${cashback.tierName || 'Default'}`);
    console.log(`   Rate: ${cashback.percentage}%`);
    console.log(`   Amount: ${cashback.amount.toFixed(2)} ${currency}`);
    
    // ========================================================================
    // STEP 6: ISSUE STORE CREDIT
    // ========================================================================
    
    let shopifyTransactionId: string | undefined;
    
    if (admin && cashback.amount > 0) {
      console.log("\n💸 Issuing store credit in Shopify:");
      
      const creditResult = await issueStoreCredit(
        admin,
        customerId,
        cashback.amount,
        currency
      );
      
      if (creditResult.success) {
        shopifyTransactionId = creditResult.transactionId;
        console.log("   ✅ Success! Transaction ID:", shopifyTransactionId);
      } else {
        console.error("   ❌ Failed:", creditResult.error);
      }
    }
    
    // ========================================================================
    // RECORD IN DATABASE
    // ========================================================================
    
    console.log("\n💾 Recording transaction in database:");
    const { transaction, updatedCustomer } = await recordCashbackTransaction(
      shop,
      customer.id,
      orderId,
      cashbackEligibleAmount,
      cashback.amount,
      cashback.percentage,
      shopifyTransactionId
    );
    
    console.log(`   Transaction ID: ${transaction.id}`);
    console.log(`   Previous Balance: ${(updatedCustomer.storeCredit - cashback.amount).toFixed(2)}`);
    console.log(`   New Balance: ${updatedCustomer.storeCredit.toFixed(2)}`);
    console.log(`   Total Earned: ${updatedCustomer.totalEarned.toFixed(2)}`);
    
    // ========================================================================
    // EVALUATE TIER UPGRADE
    // ========================================================================
    
    await evaluateTierUpgrade(customer.id, shop);
    
    console.log("\n✅ Webhook processing complete!");
    console.log("=".repeat(60) + "\n");
    
    return new Response("OK", { status: 200 });
    
  } catch (error) {
    console.error("\n❌ WEBHOOK ERROR:", error);
    console.error(error instanceof Error ? error.stack : error);
    
    // Return 200 to prevent Shopify retries
    return new Response("ERROR", { status: 200 });
  }
};

// ============================================================================
// TIER MANAGEMENT HELPERS
// ============================================================================

async function getDefaultTierId(shopDomain: string): Promise<string> {
  const defaultTier = await db.tier.findFirst({
    where: {
      shopDomain,
      isActive: true,
      minSpend: null // or minSpend: 0
    },
    orderBy: {
      cashbackPercent: 'asc'
    }
  });
  
  if (!defaultTier) {
    throw new Error(`No default tier found for shop ${shopDomain}`);
  }
  
  return defaultTier.id;
}

async function evaluateTierUpgrade(customerId: string, shopDomain: string) {
  // Get customer's spending based on evaluation period
  const analytics = await db.customerAnalytics.findUnique({
    where: { customerId }
  });
  
  if (!analytics) return;
  
  const currentMembership = await db.customerMembership.findFirst({
    where: { customerId, isActive: true },
    include: { tier: true }
  });
  
  if (!currentMembership) return;
  
  // Find eligible tier based on spending
  const spendingAmount = currentMembership.tier.evaluationPeriod === 'LIFETIME' 
    ? analytics.lifetimeSpending 
    : analytics.yearlySpending;
  
  const eligibleTier = await db.tier.findFirst({
    where: {
      shopDomain,
      isActive: true,
      minSpend: { lte: spendingAmount }
    },
    orderBy: {
      minSpend: 'desc'
    }
  });
  
  // Upgrade if eligible for higher tier
  if (eligibleTier && eligibleTier.id !== currentMembership.tierId) {
    // Deactivate current membership
    await db.customerMembership.update({
      where: { id: currentMembership.id },
      data: { isActive: false, endDate: new Date() }
    });
    
    // Create new membership
    await db.customerMembership.create({
      data: {
        customerId,
        tierId: eligibleTier.id,
        assignmentType: "AUTOMATIC",
        previousTierId: currentMembership.tierId
      }
    });
    
    // Log tier change
    await db.tierChangeLog.create({
      data: {
        customerId,
        fromTierId: currentMembership.tierId,
        toTierId: eligibleTier.id,
        changeType: "AUTOMATIC_UPGRADE",
        triggeredBy: "SYSTEM",
        metadata: { spendingAmount, evaluationPeriod: currentMembership.tier.evaluationPeriod }
      }
    });
    
    console.log(`   🎉 Tier upgraded: ${currentMembership.tier.name} → ${eligibleTier.name}`);
  }
}