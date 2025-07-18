// app/routes/app._index.tsx
import { json, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation, useActionData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState } from "react";

// Simple check: if onboarding exists, go to dashboard
export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  
  // Check if onboarding has been completed
  const onboarding = await prisma.onboarding.findUnique({
    where: { shopDomain: session.shop }
  });
  
  // If onboarding exists, redirect to dashboard
  if (onboarding) {
    return redirect("/app/dashboard");
  }
  
  // Get shop details for pre-filling
  const response = await admin.graphql(
    `#graphql
    query shopDetails {
      shop {
        name
        email
        currencyCode
        billingAddress {
          country
          countryCodeV2
        }
      }
    }`
  );
  
  const shopData = await response.json();
  const shopInfo = shopData?.data?.shop;
  
  // Get session email
  const sessionData = await prisma.session.findFirst({
    where: { shop: session.shop },
    select: { email: true }
  });
  
  return json({
    shopName: shopInfo?.name || "",
    shopEmail: sessionData?.email || shopInfo?.email || "",
    currency: shopInfo?.currencyCode || "USD",
    country: shopInfo?.billingAddress?.countryCodeV2 || "US"
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  try {
    // Create onboarding record
    await prisma.onboarding.create({
      data: {
        shopDomain: session.shop,
        businessName: formData.get("businessName") as string,
        employeeCount: formData.get("employeeCount") as string,
        country: formData.get("country") as string,
        currency: formData.get("currency") as string,
        contactEmail: formData.get("contactEmail") as string,
        productTypes: formData.getAll("productTypes") as string[],
        goals: formData.getAll("goals") as string[]
      }
    });
    
    // Create default tiers if they don't exist
    const existingTiers = await prisma.tier.count({
      where: { shopDomain: session.shop }
    });
    
    if (existingTiers === 0) {
      await prisma.tier.createMany({
        data: [
          {
            shopDomain: session.shop,
            name: "Bronze",
            minSpend: null,
            cashbackPercent: 3,
            evaluationPeriod: "ANNUAL",
            isActive: true
          },
          {
            shopDomain: session.shop,
            name: "Silver", 
            minSpend: 1000,
            cashbackPercent: 5,
            evaluationPeriod: "ANNUAL",
            isActive: true
          },
          {
            shopDomain: session.shop,
            name: "Gold",
            minSpend: 5000,
            cashbackPercent: 7,
            evaluationPeriod: "ANNUAL",
            isActive: true
          },
          {
            shopDomain: session.shop,
            name: "Platinum",
            minSpend: 10000,
            cashbackPercent: 10,
            evaluationPeriod: "ANNUAL",
            isActive: true
          }
        ]
      });
    }
    
    return redirect("/app/dashboard");
  } catch (error) {
    console.error("Onboarding error:", error);
    return json({ error: "Failed to complete setup. Please try again." }, { status: 500 });
  }
}

const productTypes = [
  { value: "fashion", label: "Fashion & Apparel", icon: "👔" },
  { value: "electronics", label: "Electronics", icon: "💻" },
  { value: "home", label: "Home & Garden", icon: "🏠" },
  { value: "beauty", label: "Beauty", icon: "💄" },
  { value: "food", label: "Food & Beverage", icon: "🍽️" },
  { value: "sports", label: "Sports", icon: "⚽" },
  { value: "books", label: "Books & Media", icon: "📚" },
  { value: "toys", label: "Toys & Games", icon: "🎮" },
  { value: "health", label: "Health", icon: "💊" },
  { value: "other", label: "Other", icon: "📦" }
];

const goals = [
  { value: "retention", label: "Improve retention", icon: "🎯" },
  { value: "loyalty", label: "Build loyalty", icon: "⭐" },
  { value: "revenue", label: "Increase revenue", icon: "💰" },
  { value: "engagement", label: "Better engagement", icon: "🤝" }
];

export default function OnboardingQuestionnaire() {
  const { shopName, shopEmail, currency, country } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  
  const toggleProduct = (value: string) => {
    setSelectedProducts(prev => 
      prev.includes(value) 
        ? prev.filter(p => p !== value)
        : [...prev, value]
    );
  };
  
  const toggleGoal = (value: string) => {
    setSelectedGoals(prev =>
      prev.includes(value)
        ? prev.filter(g => g !== value)
        : [...prev, value]
    );
  };
  
  const styles = {
    container: {
      maxWidth: "720px",
      margin: "0 auto",
      padding: "48px 24px"
    },
    header: {
      textAlign: "center" as const,
      marginBottom: "48px"
    },
    title: {
      fontSize: "36px",
      fontWeight: "700",
      margin: "0 0 12px 0",
      color: "#1a1a1a"
    },
    subtitle: {
      fontSize: "18px",
      color: "#666",
      margin: 0
    },
    card: {
      backgroundColor: "#f9fafb",
      padding: "32px",
      borderRadius: "12px",
      marginBottom: "24px"
    },
    section: {
      marginBottom: "32px"
    },
    sectionTitle: {
      fontSize: "18px",
      fontWeight: "600",
      marginBottom: "16px",
      color: "#1a1a1a"
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
      gap: "12px"
    },
    input: {
      width: "100%",
      padding: "12px 16px",
      border: "1px solid #e5e7eb",
      borderRadius: "8px",
      fontSize: "16px",
      backgroundColor: "white"
    },
    select: {
      width: "100%",
      padding: "12px 16px",
      border: "1px solid #e5e7eb",
      borderRadius: "8px",
      fontSize: "16px",
      backgroundColor: "white",
      cursor: "pointer"
    },
    optionCard: {
      padding: "12px 16px",
      border: "2px solid #e5e7eb",
      borderRadius: "8px",
      cursor: "pointer",
      transition: "all 0.2s",
      backgroundColor: "white",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "14px"
    },
    optionCardSelected: {
      borderColor: "#10b981",
      backgroundColor: "#f0fdf4"
    },
    button: {
      width: "100%",
      padding: "16px",
      backgroundColor: "#10b981",
      color: "white",
      border: "none",
      borderRadius: "8px",
      fontSize: "16px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "opacity 0.2s"
    },
    error: {
      backgroundColor: "#fee2e2",
      color: "#dc2626",
      padding: "12px",
      borderRadius: "8px",
      marginBottom: "16px"
    },
    row: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "16px"
    }
  };
  
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Welcome to Cashback Rewards! 🎉</h1>
        <p style={styles.subtitle}>Let's set up your rewards program in 60 seconds</p>
      </div>
      
      {actionData?.error && (
        <div style={styles.error}>{actionData.error}</div>
      )}
      
      <Form method="post">
        <div style={styles.card}>
          {/* Basic Info */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Basic Information</h2>
            <div style={{ display: "grid", gap: "16px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: "500" }}>
                  Business Name *
                </label>
                <input
                  type="text"
                  name="businessName"
                  defaultValue={shopName}
                  required
                  style={styles.input}
                  placeholder="Your Store Name"
                />
              </div>
              
              <div>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: "500" }}>
                  Contact Email *
                </label>
                <input
                  type="email"
                  name="contactEmail"
                  defaultValue={shopEmail}
                  required
                  style={styles.input}
                  placeholder="you@example.com"
                />
              </div>
              
              <div style={styles.row}>
                <div>
                  <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: "500" }}>
                    Team Size *
                  </label>
                  <select name="employeeCount" required style={styles.select}>
                    <option value="">Select...</option>
                    <option value="1">Just me</option>
                    <option value="2-5">2-5 employees</option>
                    <option value="6-10">6-10 employees</option>
                    <option value="11-50">11-50 employees</option>
                    <option value="50+">50+ employees</option>
                  </select>
                </div>
                
                <div>
                  <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: "500" }}>
                    Currency
                  </label>
                  <select name="currency" defaultValue={currency} style={styles.select}>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="CAD">CAD ($)</option>
                    <option value="AUD">AUD ($)</option>
                  </select>
                </div>
              </div>
              
              <input type="hidden" name="country" value={country} />
            </div>
          </div>
          
          {/* Product Types */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>What do you sell? (Select all that apply) *</h2>
            <div style={styles.grid}>
              {productTypes.map(product => (
                <div
                  key={product.value}
                  onClick={() => toggleProduct(product.value)}
                  style={{
                    ...styles.optionCard,
                    ...(selectedProducts.includes(product.value) ? styles.optionCardSelected : {})
                  }}
                >
                  <span>{product.icon}</span>
                  <span>{product.label}</span>
                  <input
                    type="checkbox"
                    name="productTypes"
                    value={product.value}
                    checked={selectedProducts.includes(product.value)}
                    onChange={() => {}}
                    style={{ display: "none" }}
                  />
                </div>
              ))}
            </div>
          </div>
          
          {/* Goals */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>What are your goals? (Optional)</h2>
            <div style={styles.grid}>
              {goals.map(goal => (
                <div
                  key={goal.value}
                  onClick={() => toggleGoal(goal.value)}
                  style={{
                    ...styles.optionCard,
                    ...(selectedGoals.includes(goal.value) ? styles.optionCardSelected : {})
                  }}
                >
                  <span>{goal.icon}</span>
                  <span>{goal.label}</span>
                  <input
                    type="checkbox"
                    name="goals"
                    value={goal.value}
                    checked={selectedGoals.includes(goal.value)}
                    onChange={() => {}}
                    style={{ display: "none" }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <button
          type="submit"
          disabled={isSubmitting || selectedProducts.length === 0}
          style={{
            ...styles.button,
            opacity: isSubmitting || selectedProducts.length === 0 ? 0.6 : 1,
            cursor: isSubmitting || selectedProducts.length === 0 ? "not-allowed" : "pointer"
          }}
        >
          {isSubmitting ? "Setting up..." : "Complete Setup →"}
        </button>
        
        <p style={{ textAlign: "center", marginTop: "16px", fontSize: "14px", color: "#666" }}>
          You can customize your rewards program anytime from the dashboard
        </p>
      </Form>
    </div>
  );
}