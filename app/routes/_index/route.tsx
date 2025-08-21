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
        {/* Hero Section */}
        <div className={styles.hero}>
          <h1 className={styles.heading}>
            Turn Every Purchase Into Loyalty with RewardsPro
          </h1>
          <p className={styles.tagline}>
            The intelligent cashback system that drives repeat purchases and increases customer lifetime value. 
            Reward your best customers automatically.
          </p>
        </div>

        {/* Login Form */}
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
            <button className={styles.button} type="submit">
              Start Free Trial
            </button>
          </Form>
        )}

        {/* Key Benefits */}
        <div className={styles.benefits}>
          <h2 className={styles.sectionTitle}>Why Merchants Choose RewardsPro</h2>
          <ul className={styles.list}>
            <li>
              <strong>🎯 Smart Tier System</strong>
              <p>Automatically segment customers into tiers based on spending. Reward your VIPs with higher cashback rates.</p>
            </li>
            <li>
              <strong>💰 Boost Repeat Purchases</strong>
              <p>Customers with store credit return 2.7x more often. Watch your retention rates soar.</p>
            </li>
            <li>
              <strong>⚡ Seamless Integration</strong>
              <p>Works instantly with Shopify's native store credit system. No complex setup or customer accounts needed.</p>
            </li>
            <li>
              <strong>📊 Real-Time Analytics</strong>
              <p>Track cashback earned, tier progression, and customer engagement from one intuitive dashboard.</p>
            </li>
          </ul>
        </div>

        {/* How It Works */}
        <div className={styles.howItWorks}>
          <h2 className={styles.sectionTitle}>How It Works</h2>
          <ol className={styles.steps}>
            <li>
              <strong>Set Your Tiers</strong>
              <p>Create cashback tiers (e.g., Bronze 2%, Silver 5%, Gold 10%)</p>
            </li>
            <li>
              <strong>Customers Shop</strong>
              <p>Cashback automatically calculates and applies as store credit</p>
            </li>
            <li>
              <strong>Watch Loyalty Grow</strong>
              <p>Customers return to spend their rewards and earn more</p>
            </li>
          </ol>
        </div>

        {/* Trust Indicators */}
        <div className={styles.trust}>
          <div className={styles.trustItems}>
            <span>✓ GDPR Compliant</span>
            <span>✓ 24/7 Support</span>
            <span>✓ No Transaction Fees</span>
            <span>✓ Free 14-Day Trial</span>
          </div>
        </div>

        {/* FAQ Section */}
        <div className={styles.faq}>
          <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
          <details className={styles.faqItem}>
            <summary>How does the cashback appear to customers?</summary>
            <p>Cashback is automatically added as Shopify store credit after each purchase. Customers see it in their account and can apply it at checkout.</p>
          </details>
          <details className={styles.faqItem}>
            <summary>Can I customize cashback percentages?</summary>
            <p>Yes! Set different cashback rates for each tier. You have complete control over percentages and tier thresholds.</p>
          </details>
          <details className={styles.faqItem}>
            <summary>Does it work with existing loyalty programs?</summary>
            <p>RewardsPro complements points-based programs perfectly. Use points for engagement, cashback for retention.</p>
          </details>
          <details className={styles.faqItem}>
            <summary>What about refunds and returns?</summary>
            <p>Cashback is automatically adjusted when orders are refunded, keeping your accounting accurate.</p>
          </details>
        </div>

        {/* Bottom CTA */}
        <div className={styles.bottomCta}>
          <h3>Ready to increase customer retention?</h3>
          <p className={styles.ctaText}>
            Join hundreds of merchants using RewardsPro to build lasting customer relationships.
          </p>
        </div>
      </div>
    </div>
  );
}