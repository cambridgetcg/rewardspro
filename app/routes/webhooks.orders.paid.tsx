// app/routes/webhooks.orders.paid.tsx
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { evaluateCustomerTier, assignInitialTier, getCustomerTierInfo } from "../services/customer-tier.server";

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

  if (!payload) {
    return json({ error: "No payload" }, { status: 400 });
  }

  const order = payload as any;

  try {
    // Find or create customer
    let customer = await prisma.customer.findUnique({
      where: { shopifyCustomerId: order.customer.id.toString() }
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          shopifyCustomerId: order.customer.id.toString(),
          email: order.customer.email,
        }
      });
      
      // Assign initial tier to new customer
      await assignInitialTier(customer.id);
    }

    // Get current tier for cashback calculation
    const tierInfo = await getCustomerTierInfo(customer.id);
    const cashbackPercent = tierInfo?.membership.tier.cashbackPercent || 0;

    // Create cashback transaction
    const orderAmount = parseFloat(order.total_price);
    const cashbackAmount = (orderAmount * cashbackPercent) / 100;

    await prisma.cashbackTransaction.create({
      data: {
        customerId: customer.id,
        shopifyOrderId: order.id.toString(),
        orderAmount,
        cashbackAmount,
        cashbackPercent,
        status: "COMPLETED",
      }
    });

    // Update customer totals
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        storeCredit: { increment: cashbackAmount },
        totalEarned: { increment: cashbackAmount },
      }
    });

    // Evaluate if customer qualifies for tier upgrade
    const updatedMembership = await evaluateCustomerTier(customer.id);
    
    if (updatedMembership && tierInfo?.membership.tierId !== updatedMembership.tierId) {
      console.log(`Customer ${customer.email} upgraded to ${updatedMembership.tier.displayName}!`);
      
      // Optional: Send notification or update Shopify tags
      // await updateShopifyCustomerTags(admin, customer.shopifyCustomerId, updatedMembership.tier.displayName);
    }

    return json({ success: true });
  } catch (error) {
    console.error("Error processing order webhook:", error);
    return json({ error: "Failed to process order" }, { status: 500 });
  }
}