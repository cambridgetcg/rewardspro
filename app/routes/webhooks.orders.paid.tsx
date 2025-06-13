// app/routes/webhooks.orders.paid.tsx
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const CASHBACK_PERCENTAGE = 0.10; // 10%

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("=== CASHBACK WEBHOOK RECEIVED ===");
  
  try {
    const { topic, shop, payload, admin } = await authenticate.webhook(request);
    
    console.log(`Processing ${topic} for shop: ${shop}`);
    
    // The payload is already parsed
    const order = payload;
    
    // Skip if no customer (guest checkout)
    if (!order.customer?.id) {
      console.log("Skipping guest order");
      return new Response("OK", { status: 200 });
    }
    
    const customerId = order.customer.id.toString();
    const customerEmail = order.customer.email;
    const orderId = order.id.toString();
    const orderAmount = parseFloat(order.total_price);
    const cashbackAmount = orderAmount * CASHBACK_PERCENTAGE;
    
    console.log(`Order ${orderId}: $${orderAmount} → $${cashbackAmount} cashback`);
    
    // Find or create customer
    let customer = await prisma.customer.findUnique({
      where: { shopifyCustomerId: customerId }
    });
    
    if (!customer) {
      console.log(`Creating new customer: ${customerEmail}`);
      customer = await prisma.customer.create({
        data: {
          shopifyCustomerId: customerId,
          email: customerEmail,
          storeCredit: 0,
          totalEarned: 0
        }
      });
    }
    
    // Check if we already processed this order
    const existingTransaction = await prisma.cashbackTransaction.findUnique({
      where: { shopifyOrderId: orderId }
    });
    
    if (existingTransaction) {
      console.log(`Order ${orderId} already processed`);
      return new Response("OK", { status: 200 });
    }
    
    // Create transaction and update customer balance
    const [transaction, updatedCustomer] = await prisma.$transaction([
      // Create cashback transaction record
      prisma.cashbackTransaction.create({
        data: {
          customerId: customer.id,
          shopifyOrderId: orderId,
          orderAmount,
          cashbackAmount,
          cashbackPercent: CASHBACK_PERCENTAGE,
          status: "COMPLETED"
        }
      }),
      // Update customer balance
      prisma.customer.update({
        where: { id: customer.id },
        data: {
          storeCredit: { increment: cashbackAmount },
          totalEarned: { increment: cashbackAmount }
        }
      })
    ]);
    
    console.log(`✅ Cashback credited in database!`);
    console.log(`   Customer: ${customerEmail}`);
    console.log(`   New balance: $${updatedCustomer.storeCredit}`);
    console.log(`   Total earned: $${updatedCustomer.totalEarned}`);
    
    // Issue store credit in Shopify
    if (admin && updatedCustomer) {
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
                  currencyCode: order.currency || "USD"
                }
              }
            }
          }
        );
        
        const result = await response.json();
        
        if (result.data?.storeCreditAccountCredit?.userErrors?.length > 0) {
          const errors = result.data.storeCreditAccountCredit.userErrors;
          console.error("Store credit errors:", errors);
          
          // Check for specific error codes
          if (errors.some((e: any) => e.code === "INVALID_PERMISSIONS")) {
            console.error("Missing permission: write_store_credit_account_transactions");
            console.error("Please reinstall the app with the correct scope");
          }
        } else if (result.data?.storeCreditAccountCredit?.storeCreditAccountTransaction) {
          const transaction = result.data.storeCreditAccountCredit.storeCreditAccountTransaction;
          console.log("✅ Store credit issued successfully!");
          console.log(`   Transaction ID: ${transaction.id}`);
          console.log(`   Amount: ${transaction.amount.amount} ${transaction.amount.currencyCode}`);
          console.log(`   New balance: ${transaction.balanceAfterTransaction.amount} ${transaction.balanceAfterTransaction.currencyCode}`);
        }
      } catch (error) {
        console.error("Failed to issue store credit:", error);
        // Don't fail the webhook - cashback is still recorded in database
      }
    }
    
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook processing failed:", error);
    
    // Still return 200 to prevent Shopify from retrying
    // Log the error for debugging
    return new Response("OK", { status: 200 });
  }
};