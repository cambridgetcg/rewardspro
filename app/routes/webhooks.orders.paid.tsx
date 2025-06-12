// app/routes/webhooks.orders.paid.tsx
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("=== WEBHOOK RECEIVED ===");
  
  try {
    // Try to authenticate
    const { topic, shop, session, admin, payload } = await authenticate.webhook(
      request
    );
    
    console.log("Webhook authenticated successfully!");
    console.log(`Topic: ${topic}`);
    console.log(`Shop: ${shop}`);
    console.log(`Payload length: ${payload.length}`);
    
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook authentication failed:", error);
    
    // Log more details about the error
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    
    // Still return 200 to acknowledge receipt
    return new Response("OK", { status: 200 });
  }
};