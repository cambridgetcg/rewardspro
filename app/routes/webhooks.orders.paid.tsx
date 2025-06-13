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
    
    console.log(`✅ Cashback credited!`);
    console.log(`   Customer: ${customerEmail}`);
    console.log(`   New balance: $${updatedCustomer.storeCredit}`);
    console.log(`   Total earned: $${updatedCustomer.totalEarned}`);
    
    // Optional: Update customer metafield in Shopify using GraphQL
    if (admin) {
      try {
        const response = await admin.graphql(
          `#graphql
          mutation customerUpdate($input: CustomerInput!) {
            customerUpdate(input: $input) {
              customer {
                id
                metafields(first: 1, namespace: "rewardspro", keys: "store_credit") {
                  edges {
                    node {
                      id
                      value
                    }
                  }
                }
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
                metafields: [
                  {
                    namespace: "rewardspro",
                    key: "store_credit",
                    value: updatedCustomer.storeCredit.toString(),
                    type: "number_decimal"
                  }
                ]
              }
            }
          }
        );
        
        const result = await response.json();
        if (result.data?.customerUpdate?.userErrors?.length > 0) {
          console.error("GraphQL errors:", result.data.customerUpdate.userErrors);
        } else {
          console.log("Updated Shopify metafield");
        }
      } catch (error) {
        console.error("Failed to update metafield:", error);
        // Don't fail the webhook if metafield update fails
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