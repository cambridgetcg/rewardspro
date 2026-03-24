import { redirect, type LoaderFunctionArgs } from "@remix-run/node";

/**
 * Redirect to the unified customers page.
 * Previously this was a separate "Store Credit" page; now merged into /app/customers/tiers.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return redirect("/app/customers/tiers");
};

export default function CreditRedirect() {
  return null;
}
