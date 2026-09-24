import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <div className={styles.hero}>
          <h1 className={styles.heading}>Reward rules and records</h1>
          <p className={styles.tagline}>
            View Shopify cashback rules, customer balances and the orders behind them.
          </p>
        </div>

        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="my-shop.myshopify.com"
                required
              />
              <span className={styles.hint}>Enter your Shopify store domain</span>
            </label>
            <button className={styles.button} type="submit">Open the app</button>
          </Form>
        )}

        <div className={styles.benefits}>
          <h2 className={styles.sectionTitle}>Programme records</h2>
          <ul className={styles.list}>
            <li>
              <strong>Tier rules</strong>
              <p>Inspect spending thresholds and the cashback rate assigned to each tier.</p>
            </li>
            <li>
              <strong>Store credit</strong>
              <p>Follow purchases, earned credit, redemptions and refund adjustments.</p>
            </li>
            <li>
              <strong>Activity</strong>
              <p>Read recorded order amounts, rewards and tier changes in the dashboard.</p>
            </li>
          </ul>
        </div>

        <div className={styles.widgetCTA}>
          <h2 className={styles.sectionTitle}>Display reward information</h2>
          <p className={styles.widgetText}>
            In Shopify, open Online Store → Themes → Customize. Add the RewardsPro
            app block to a product page to display its configured cashback rates.
            Availability depends on your theme and existing app setup.
          </p>
        </div>

        <div className={styles.faq}>
          <h2 className={styles.sectionTitle}>Balances and support</h2>
          <details className={styles.faqItem}>
            <summary>Where can customers see their cashback?</summary>
            <p>Recorded credit appears in the customer account and can be applied to eligible purchases under the programme rules.</p>
          </details>
          <details className={styles.faqItem}>
            <summary>What happens after a refund?</summary>
            <p>Refund processing adjusts the corresponding reward. Inspect the order and credit history if the records disagree.</p>
          </details>
        </div>
      </div>
    </div>
  );
}
