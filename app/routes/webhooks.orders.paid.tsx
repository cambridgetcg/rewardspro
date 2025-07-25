// app/routes/webhooks.orders.paid.tsx
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { evaluateCustomerTier, assignInitialTier, getCustomerTierInfo } from "../services/customer-tier.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("=== CASHBACK WEBHOOK RECEIVED ===");
  
  try {
    const { topic, shop, payload, admin } = await authenticate.webhook(request);
    
    console.log(`Processing ${topic} for shop: ${shop}`);
    console.log(`Webhook payload received for order: ${payload.id}`);
    
    // The payload is already parsed
    const order = payload;
    
    // Skip if no customer (guest checkout)
    if (!order.customer?.id) {
      console.log("Skipping guest order - no customer ID");
      return new Response("OK", { status: 200 });
    }
    
    // Skip test orders in production (optional)
    if (order.test && process.env.NODE_ENV === 'production') {
      console.log("Skipping test order in production");
      return new Response("OK", { status: 200 });
    }
    
    // Skip cancelled or voided orders
    if (order.financial_status === 'voided' || order.cancelled_at) {
      console.log(`Skipping ${order.financial_status} order (cancelled: ${order.cancelled_at})`);
      return new Response("OK", { status: 200 });
    }
    
    const customerId = order.customer.id.toString();
    const customerEmail = order.customer.email;
    const orderId = order.id.toString();
    
    // Use total_price for the final order amount (after discounts)
    const orderAmount = parseFloat(order.total_price);
    const currency = order.currency || "GBP";
    
    // Log additional order details for debugging
    console.log(`Order Financial Details:`);
    console.log(`  Subtotal: ${order.subtotal_price} ${currency}`);
    console.log(`  Total Discounts: ${order.total_discounts} ${currency}`);
    console.log(`  Total Price (final): ${order.total_price} ${currency}`);
    console.log(`  Financial Status: ${order.financial_status}`);
    console.log(`  Test Order: ${order.test}`);
    
    console.log(`Order Details:`);
    console.log(`  Order ID: ${orderId}`);
    console.log(`  Customer: ${customerEmail} (${customerId})`);
    console.log(`  Order Amount: ${orderAmount} ${currency}`);
    
    // Validate order amount
    if (orderAmount <= 0) {
      console.log("Skipping order with zero or negative amount");
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
    
    let isNewCustomer = false;
    if (!customer) {
      console.log(`Creating new customer: ${customerEmail}`);
      customer = await db.customer.create({
        data: {
          shopDomain: shop,
          shopifyCustomerId: customerId,
          email: customerEmail,
          storeCredit: 0,
          totalEarned: 0
        }
      });
      isNewCustomer = true;
    } else {
      console.log(`Found existing customer: ${customerEmail} (DB ID: ${customer.id})`);
    }
    
    // Check if we already processed this order
    const existingTransaction = await db.cashbackTransaction.findUnique({
      where: { 
        shopDomain_shopifyOrderId: {
          shopDomain: shop,
          shopifyOrderId: orderId
        }
      }
    });
    
    if (existingTransaction) {
      console.log(`Order ${orderId} already processed - skipping duplicate`);
      return new Response("OK", { status: 200 });
    }
    
    // TIER INTEGRATION: Assign initial tier to new customers
    if (isNewCustomer) {
      console.log("Assigning initial tier to new customer...");
      await assignInitialTier(customer.id, shop);
    }
    
    // TIER INTEGRATION: Get customer's current tier for cashback calculation
    const tierInfo = await getCustomerTierInfo(customer.id, shop);
    const cashbackPercent = tierInfo?.membership.tier.cashbackPercent || 1; // Default 1% if no tier
    const cashbackAmount = orderAmount * (cashbackPercent / 100);
    
    console.log(`Tier Information:`);
    console.log(`  Current Tier: ${tierInfo?.membership.tier.name || 'None'}`);
    console.log(`  Cashback Rate: ${cashbackPercent}%`);
    console.log(`  Cashback Amount: ${cashbackAmount.toFixed(2)} ${currency}`);
    
    console.log("Processing cashback transaction...");
    
    // Create transaction and update customer balance in a database transaction
    const [transaction, updatedCustomer] = await db.$transaction([
      // Create cashback transaction record
      db.cashbackTransaction.create({
        data: {
          shopDomain: shop,
          customerId: customer.id,
          shopifyOrderId: orderId,
          orderAmount,
          cashbackAmount,
          cashbackPercent: cashbackPercent, // Now using tier-based percentage
          status: "COMPLETED"
        }
      }),
      // Update customer balance
      db.customer.update({
        where: { id: customer.id },
        data: {
          storeCredit: { increment: cashbackAmount },
          totalEarned: { increment: cashbackAmount }
        }
      })
    ]);
    
    console.log(`✅ Cashback credited in database!`);
    console.log(`   Transaction ID: ${transaction.id}`);
    console.log(`   Customer: ${customerEmail}`);
    console.log(`   Previous balance: ${(updatedCustomer.storeCredit - cashbackAmount).toFixed(2)} ${currency}`);
    console.log(`   Cashback added: ${cashbackAmount.toFixed(2)} ${currency}`);
    console.log(`   New balance: ${updatedCustomer.storeCredit.toFixed(2)} ${currency}`);
    console.log(`   Total earned to date: ${updatedCustomer.totalEarned.toFixed(2)} ${currency}`);
    
    // TIER INTEGRATION: Evaluate if customer qualifies for tier upgrade
    console.log("Evaluating tier qualification...");
    const previousTierId = tierInfo?.membership.tierId;
    const updatedMembership = await evaluateCustomerTier(customer.id, shop);
    
    if (updatedMembership && previousTierId !== updatedMembership.tierId) {
      console.log(`🎉 Customer tier upgraded!`);
      console.log(`   From: ${tierInfo?.membership.tier.name || 'None'}`);
      console.log(`   To: ${updatedMembership.tier.name}`);
      console.log(`   New cashback rate: ${updatedMembership.tier.cashbackPercent}%`);
      
      // Optional: Update Shopify customer tags
      if (admin) {
        try {
          const tagUpdateResponse = await admin.graphql(
            `#graphql
            mutation customerUpdate($input: CustomerInput!) {
              customerUpdate(input: $input) {
                customer {
                  id
                  tags
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
              variables: {
                input: {
                  id: `gid://shopify/Customer/${customerId}`,
                  tags: [`Tier:${updatedMembership.tier.name}`]
                }
              }
            }
          );
          
          const tagResult = await tagUpdateResponse.json();
          if (tagResult.data?.customerUpdate?.userErrors?.length > 0) {
            console.error("Failed to update customer tags:", tagResult.data.customerUpdate.userErrors);
          } else {
            console.log(`✅ Updated Shopify customer tag to: Tier:${updatedMembership.tier.name}`);
          }
        } catch (tagError) {
          console.error("Failed to update customer tags:", tagError);
        }
      }
    }
    
    // Issue store credit in Shopify
    if (admin) {
      console.log("Attempting to issue store credit in Shopify...");
      
      try {
        const response = await admin.graphql(
          `#graphql
          mutation storeCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
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
                account {
                  id
                  balance {
                    amount
                    currencyCode
                  }
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
                  amount: cashbackAmount.toFixed(2),
                  currencyCode: currency
                }
              }
            }
          }
        );
        
        const result = await response.json();
        
        // Check for errors first
        if (result.data?.storeCreditAccountCredit?.userErrors?.length > 0) {
          const errors = result.data.storeCreditAccountCredit.userErrors;
          console.error("❌ Store credit GraphQL errors:", errors);
          
          // Check for specific error codes
          const permissionError = errors.find((e: any) => e.code === "INVALID_PERMISSIONS");
          const notFoundError = errors.find((e: any) => e.code === "NOT_FOUND");
          
          if (permissionError) {
            console.error("🔒 Missing permission: write_store_credit_account_transactions");
            console.error("Please reinstall the app with the correct scope, or check if store credit is enabled");
          } else if (notFoundError) {
            console.error("👤 Customer not found in Shopify, might need to verify customer ID");
          }
          
          // Log each error for debugging
          errors.forEach((error: any, index: number) => {
            console.error(`   Error ${index + 1}: ${error.message} (Code: ${error.code}, Field: ${error.field})`);
          });
          
        } else if (result.data?.storeCreditAccountCredit?.storeCreditAccountTransaction) {
          const shopifyTransaction = result.data.storeCreditAccountCredit.storeCreditAccountTransaction;
          console.log("✅ Store credit issued successfully in Shopify!");
          console.log(`   Shopify Transaction ID: ${shopifyTransaction.id}`);
          console.log(`   Amount: ${shopifyTransaction.amount.amount} ${shopifyTransaction.amount.currencyCode}`);
          console.log(`   Shopify Balance: ${shopifyTransaction.balanceAfterTransaction.amount} ${shopifyTransaction.balanceAfterTransaction.currencyCode}`);
          
          // Update our database record with the Shopify transaction ID
          await db.cashbackTransaction.update({
            where: { id: transaction.id },
            data: { 
              shopifyTransactionId: shopifyTransaction.id,
              status: "SYNCED_TO_SHOPIFY"
            }
          });
          
        } else {
          console.error("❌ Unexpected response structure from Shopify:", JSON.stringify(result, null, 2));
        }
        
      } catch (graphqlError) {
        console.error("❌ Failed to issue store credit in Shopify:", graphqlError);
        console.error("Database transaction completed, but Shopify sync failed");
        
        // Update transaction status to indicate sync failure
        await db.cashbackTransaction.update({
          where: { id: transaction.id },
          data: { status: "SHOPIFY_SYNC_FAILED" }
        });
      }
    } else {
      console.warn("⚠️ Admin GraphQL client not available");
    }
    
    console.log("=== WEBHOOK PROCESSING COMPLETE ===");
    return new Response("OK", { status: 200 });
    
  } catch (error) {
    console.error("💥 Webhook processing failed:", error);
    console.error("Error details:", error instanceof Error ? error.stack : error);
    
    // Still return 200 to prevent Shopify from retrying
    // The error is logged for debugging
    return new Response("ERROR", { status: 200 });
  }
};