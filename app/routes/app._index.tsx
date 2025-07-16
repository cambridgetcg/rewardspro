// app/routes/app._index.tsx
// This is the main entry point after app installation
import { json, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState } from "react";

// Check if onboarding is complete
export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  
  // Get URL parameters to preserve in redirects
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || session.shop;
  const host = url.searchParams.get("host");
  
  console.log("App index loader - URL:", url.toString());
  console.log("App index loader - Shop:", shop);
  
  // Check if onboarding is complete for this shop
  const sessionData = await prisma.session.findFirst({
    where: { shop: session.shop },
    select: { 
      shop: true,
      email: true,
      accountOwner: true,
      locale: true,
      onboardingCompleted: true
    }
  });
  
  console.log("App index loader - Session data:", sessionData);
  console.log("App index loader - Onboarding completed:", sessionData?.onboardingCompleted);
  
  // Handle null or undefined onboardingCompleted
  const isOnboardingCompleted = sessionData?.onboardingCompleted === true;
  
  // If onboarding is completed, redirect to dashboard with context preserved
  if (isOnboardingCompleted) {
    const redirectUrl = new URL("/app/dashboard", url.origin);
    redirectUrl.searchParams.set("shop", shop);
    if (host) redirectUrl.searchParams.set("host", host);
    
    console.log("App index loader - Redirecting to dashboard:", redirectUrl.toString());
    return redirect(redirectUrl.toString());
  }
  
  // If onboarding is not complete, show onboarding flow
  console.log("App index loader - Showing onboarding flow");
  
  // Check if there's existing onboarding data (in case of incomplete submission)
  const existingOnboarding = await prisma.onboarding.findUnique({
    where: { shopDomain: session.shop }
  });
  
  // Get shop details from Shopify
  const response = await admin.graphql(
    `#graphql
    query shopDetails {
      shop {
        name
        email
        currencyCode
        primaryDomain {
          url
        }
        # Get country from address
        billingAddress {
          country
          countryCodeV2
        }
      }
    }`
  );
  
  const shopData = await response.json();
  
  if (!shopData?.data?.shop) {
    console.error("App index loader - Failed to fetch shop data");
    throw new Response("Failed to load shop information", { status: 500 });
  }
  
  return json({
    shop: {
      ...shopData.data.shop,
      countryCode: shopData.data.shop.billingAddress?.countryCodeV2 || "US"
    },
    sessionEmail: sessionData?.email || shopData.data.shop.email,
    locale: sessionData?.locale,
    existingOnboarding,
    urlParams: { shop, host } // Pass URL params to component
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  // Preserve URL parameters for redirect
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || session.shop;
  const host = url.searchParams.get("host");
  
  console.log("App index action - Processing form submission");
  
  // Collect all onboarding data
  const onboardingData = {
    businessName: formData.get("businessName") as string,
    employeeCount: formData.get("employeeCount") as string,
    country: formData.get("country") as string,
    currency: formData.get("currency") as string,
    contactEmail: formData.get("contactEmail") as string,
    productTypes: formData.getAll("productTypes") as string[],
    goals: formData.getAll("goals") as string[],
  };
  
  // Validate required fields
  if (!onboardingData.businessName || !onboardingData.employeeCount || 
      !onboardingData.contactEmail || onboardingData.productTypes.length === 0) {
    return json({ error: "Please fill in all required fields" }, { status: 400 });
  }
  
  try {
    // Save or update onboarding data
    await prisma.onboarding.upsert({
      where: { shopDomain: session.shop },
      update: onboardingData,
      create: {
        shopDomain: session.shop,
        ...onboardingData
      }
    });
    
    console.log("App index action - Onboarding data saved");
    
    // Mark onboarding as complete in the session
    await prisma.session.updateMany({
      where: { shop: session.shop },
      data: { onboardingCompleted: true }
    });
    
    console.log("App index action - Session updated");
    
    // Create default tiers for the merchant if they don't exist
    const existingTiers = await prisma.tier.count({
      where: { shopDomain: session.shop }
    });
    
    if (existingTiers === 0) {
      // Create default tier structure
      await prisma.tier.createMany({
        data: [
          {
            shopDomain: session.shop,
            name: "Bronze",
            minSpend: null, // Base tier - no minimum
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
      
      console.log("App index action - Default tiers created");
    }
    
    // Build redirect URL with preserved context
    const redirectUrl = new URL("/app/dashboard", url.origin);
    redirectUrl.searchParams.set("shop", shop);
    if (host) redirectUrl.searchParams.set("host", host);
    
    console.log("App index action - Redirecting to:", redirectUrl.toString());
    return redirect(redirectUrl.toString());
    
  } catch (error) {
    console.error("Onboarding error:", error);
    return json({ error: "Failed to save onboarding data. Please try again." }, { status: 500 });
  }
}

export default function OnboardingFlow() {
  const data = useLoaderData<typeof loader>();
  
  // Safely destructure with defaults
  const { shop, sessionEmail, locale, existingOnboarding, urlParams } = data || {};
  
  const navigation = useNavigation();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    businessName: existingOnboarding?.businessName || shop?.name || "",
    employeeCount: existingOnboarding?.employeeCount || "",
    country: existingOnboarding?.country || shop?.countryCode || "",
    currency: existingOnboarding?.currency || shop?.currencyCode || "USD",
    contactEmail: existingOnboarding?.contactEmail || sessionEmail || "",
    productTypes: existingOnboarding?.productTypes || [] as string[],
    goals: existingOnboarding?.goals || [] as string[]
  });
  
  const isSubmitting = navigation.state === "submitting";
  
  const productTypeOptions = [
    "Fashion & Apparel",
    "Electronics & Tech",
    "Home & Garden",
    "Beauty & Personal Care",
    "Food & Beverage",
    "Sports & Outdoors",
    "Books & Media",
    "Toys & Games",
    "Health & Wellness",
    "Automotive",
    "Other"
  ];
  
  const goalOptions = [
    { value: "retention", label: "Improve customer retention", icon: "🎯" },
    { value: "loyalty", label: "Build loyalty program", icon: "⭐" },
    { value: "email", label: "Email marketing automation", icon: "📧" },
    { value: "analytics", label: "Better customer analytics", icon: "📊" },
    { value: "rewards", label: "Manage rewards & cashback", icon: "💰" },
    { value: "segmentation", label: "Customer segmentation", icon: "👥" }
  ];
  
  const handleNext = () => {
    if (currentStep === 4) {
      // Validate step 4 (business info)
      if (!formData.businessName || !formData.employeeCount || !formData.contactEmail) {
        alert("Please fill in all required fields");
        return;
      }
    }
    setCurrentStep(currentStep + 1);
  };
  
  const handleBack = () => {
    setCurrentStep(currentStep - 1);
  };
  
  // Ensure we have data before rendering
  if (!shop) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h2>Loading...</h2>
        <p>Please wait while we load your shop information.</p>
      </div>
    );
  }
  
  const styles = {
    container: {
      maxWidth: "800px",
      margin: "0 auto",
      padding: "60px 24px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: "#1a1a1a",
      backgroundColor: "#ffffff",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column" as const,
      justifyContent: "center"
    },
    header: {
      textAlign: "center" as const,
      marginBottom: "48px"
    },
    title: {
      fontSize: "40px",
      fontWeight: "700",
      margin: "0 0 16px 0",
      color: "#1a1a1a",
      lineHeight: "1.2"
    },
    subtitle: {
      fontSize: "18px",
      color: "#666",
      margin: 0,
      fontWeight: "400",
      lineHeight: "1.5"
    },
    contentSection: {
      textAlign: "center" as const,
      marginBottom: "60px"
    },
    featureList: {
      maxWidth: "600px",
      margin: "0 auto",
      textAlign: "left" as const
    },
    featureItem: {
      display: "flex",
      alignItems: "flex-start",
      marginBottom: "32px",
      gap: "20px"
    },
    featureIcon: {
      fontSize: "40px",
      flexShrink: 0
    },
    featureText: {
      flex: 1
    },
    featureTitle: {
      fontSize: "20px",
      fontWeight: "600",
      marginBottom: "8px",
      color: "#1a1a1a"
    },
    featureDescription: {
      fontSize: "16px",
      color: "#666",
      lineHeight: "1.5"
    },
    launcherDemo: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "32px",
      margin: "48px 0"
    },
    launcherText: {
      fontSize: "24px",
      fontWeight: "600",
      color: "#1a1a1a"
    },
    launcherButton: {
      width: "80px",
      height: "80px",
      backgroundColor: "#5B5FCF",
      borderRadius: "20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "40px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      cursor: "pointer",
      transition: "transform 0.2s"
    },
    form: {
      backgroundColor: "#f8f9fa",
      padding: "32px",
      borderRadius: "12px",
      border: "1px solid #e0e0e0",
      marginBottom: "32px",
      maxWidth: "600px",
      margin: "0 auto 32px"
    },
    stepTitle: {
      fontSize: "18px",
      fontWeight: "600",
      marginBottom: "24px",
      color: "#1a1a1a"
    },
    formGroup: {
      marginBottom: "24px"
    },
    label: {
      display: "block",
      fontSize: "14px",
      fontWeight: "500",
      marginBottom: "8px",
      color: "#333"
    },
    required: {
      color: "#EF4444"
    },
    input: {
      width: "100%",
      padding: "10px 14px",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "15px",
      backgroundColor: "white",
      transition: "border-color 0.2s",
      outline: "none"
    },
    select: {
      width: "100%",
      padding: "10px 14px",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "15px",
      backgroundColor: "white",
      cursor: "pointer",
      outline: "none"
    },
    helpText: {
      fontSize: "12px",
      color: "#666",
      marginTop: "4px"
    },
    checkboxGroup: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      gap: "12px"
    },
    checkboxLabel: {
      display: "flex",
      alignItems: "center",
      padding: "12px 16px",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      cursor: "pointer",
      transition: "all 0.2s",
      fontSize: "14px"
    },
    checkboxLabelSelected: {
      backgroundColor: "#e8f5e9",
      borderColor: "#10B981"
    },
    checkbox: {
      marginRight: "8px"
    },
    goalCard: {
      display: "flex",
      alignItems: "center",
      padding: "16px",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      cursor: "pointer",
      transition: "all 0.2s",
      marginBottom: "12px"
    },
    goalCardSelected: {
      backgroundColor: "#e8f5e9",
      borderColor: "#10B981"
    },
    goalIcon: {
      fontSize: "24px",
      marginRight: "12px"
    },
    goalText: {
      flex: 1
    },
    goalTitle: {
      fontSize: "14px",
      fontWeight: "500",
      color: "#1a1a1a"
    },
    actions: {
      display: "flex",
      justifyContent: currentStep === 1 ? "center" : "space-between",
      alignItems: "center",
      marginTop: "48px"
    },
    button: {
      padding: "14px 32px",
      borderRadius: "8px",
      fontSize: "16px",
      fontWeight: "500",
      cursor: "pointer",
      transition: "all 0.2s",
      border: "none"
    },
    primaryButton: {
      backgroundColor: "#1a1a1a",
      color: "white"
    },
    secondaryButton: {
      backgroundColor: "transparent",
      color: "#666",
      border: "1px solid #e0e0e0"
    },
    error: {
      backgroundColor: "#ffebee",
      color: "#c62828",
      padding: "12px",
      borderRadius: "8px",
      marginBottom: "16px",
      fontSize: "14px"
    },
    readySection: {
      textAlign: "center" as const,
      maxWidth: "800px",
      margin: "0 auto"
    },
    readyGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
      gap: "40px",
      marginTop: "48px",
      marginBottom: "60px"
    },
    readyCard: {
      textAlign: "center" as const
    },
    readyIcon: {
      fontSize: "60px",
      marginBottom: "20px"
    },
    readyTitle: {
      fontSize: "20px",
      fontWeight: "600",
      marginBottom: "12px",
      color: "#1a1a1a"
    },
    readyDescription: {
      fontSize: "16px",
      color: "#666",
      lineHeight: "1.5"
    },
    termsText: {
      fontSize: "14px",
      color: "#666",
      textAlign: "center" as const,
      marginTop: "24px"
    },
    link: {
      color: "#5B5FCF",
      textDecoration: "none"
    },
    notReadyText: {
      fontSize: "16px",
      color: "#666",
      textAlign: "center" as const,
      marginTop: "24px"
    }
  };
  
  // Build form action URL with preserved parameters
  const formActionUrl = urlParams?.shop 
    ? `/app?shop=${urlParams.shop}${urlParams.host ? `&host=${urlParams.host}` : ''}`
    : '/app';
  
  return (
    <div style={styles.container}>
      {/* Step 1: Welcome */}
      {currentStep === 1 && (
        <>
          <div style={styles.header}>
            <h1 style={styles.title}>Welcome to Cashback Rewards</h1>
            <p style={styles.subtitle}>Let's get your loyalty program set up</p>
          </div>
          
          <div style={styles.contentSection}>
            <h2 style={{ fontSize: "32px", fontWeight: "600", marginBottom: "48px" }}>
              Get more repeat customers
            </h2>
            
            <div style={styles.featureList}>
              <div style={styles.featureItem}>
                <span style={styles.featureIcon}>🎁</span>
                <div style={styles.featureText}>
                  <p style={styles.featureDescription}>
                    Cashback Rewards gives your customers cashback on every order.
                  </p>
                </div>
              </div>
              
              <div style={styles.featureItem}>
                <span style={styles.featureIcon}>❤️</span>
                <div style={styles.featureText}>
                  <p style={styles.featureDescription}>
                    Customers love being rewarded and are 1.5x more likely to make another purchase.
                  </p>
                </div>
              </div>
              
              <div style={styles.featureItem}>
                <span style={styles.featureIcon}>🚀</span>
                <div style={styles.featureText}>
                  <p style={styles.featureDescription}>
                    More returning customers = higher average customer value and a more profitable business.
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          <div style={styles.actions}>
            <button
              onClick={handleNext}
              style={{
                ...styles.button,
                ...styles.primaryButton
              }}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.8'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              Get started
            </button>
          </div>
          
          <p style={styles.termsText}>
            By proceeding, you agree to the{" "}
            <a href="#" style={styles.link}>Terms of Service</a> and{" "}
            <a href="#" style={styles.link}>Privacy Policy</a>
          </p>
        </>
      )}
      
      {/* Step 2: Launcher Info */}
      {currentStep === 2 && (
        <>
          <div style={styles.header}>
            <h1 style={styles.title}>Easy access to your loyalty program</h1>
            <p style={styles.subtitle}>
              Cashback Rewards adds a floating button to your website, we call it "the Launcher". 
              Customers can click it to access your loyalty program.
            </p>
          </div>
          
          <div style={styles.launcherDemo}>
            <span style={styles.launcherText}>The launcher</span>
            <span style={{ fontSize: "32px" }}>→</span>
            <div 
              style={styles.launcherButton}
              onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              🎁
            </div>
          </div>
          
          <div style={styles.actions}>
            <button
              onClick={handleBack}
              style={{
                ...styles.button,
                ...styles.secondaryButton
              }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = '#999'}
              onMouseOut={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
            >
              Back
            </button>
            <button
              onClick={handleNext}
              style={{
                ...styles.button,
                ...styles.primaryButton
              }}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.8'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              Next
            </button>
          </div>
        </>
      )}
      
      {/* Step 3: Ready to Start */}
      {currentStep === 3 && (
        <>
          <div style={styles.readySection}>
            <h1 style={styles.title}>You're ready to start rewarding!</h1>
            
            <div style={styles.readyGrid}>
              <div style={styles.readyCard}>
                <div style={styles.readyIcon}>🎁</div>
                <h3 style={styles.readyTitle}>Customers will earn cashback on every order</h3>
                <p style={styles.readyDescription}>
                  They'll earn 5% back in cashback, which is $5 cashback for every $100 they spend.
                </p>
              </div>
              
              <div style={styles.readyCard}>
                <div style={styles.readyIcon}>📱</div>
                <h3 style={styles.readyTitle}>Cashback Rewards will be added to your store</h3>
                <p style={styles.readyDescription}>
                  A floating button will appear on your website so customers can access your loyalty program.
                </p>
              </div>
              
              <div style={styles.readyCard}>
                <div style={styles.readyIcon}>✉️</div>
                <h3 style={styles.readyTitle}>Customers will be notified by email</h3>
                <p style={styles.readyDescription}>
                  Customers will be sent an email every time they earn or redeem cashback. 
                  <a href="#" style={styles.link}> Preview</a>
                </p>
              </div>
            </div>
          </div>
          
          <div style={styles.actions}>
            <button
              onClick={handleBack}
              style={{
                ...styles.button,
                ...styles.secondaryButton
              }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = '#999'}
              onMouseOut={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
            >
              Back
            </button>
            <button
              onClick={handleNext}
              style={{
                ...styles.button,
                ...styles.primaryButton
              }}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.8'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              Launch your program
            </button>
          </div>
          
          <p style={styles.notReadyText}>
            💡 Not ready? <a href="#" style={styles.link}>Explore Cashback Rewards</a> and launch later.
          </p>
        </>
      )}
      
      {/* Step 4: Business Setup */}
      {currentStep === 4 && (
        <>
          <div style={styles.header}>
            <h1 style={styles.title}>Tell us about your business</h1>
            <p style={styles.subtitle}>This helps us customize your rewards program</p>
          </div>
          
          <Form method="post" action={formActionUrl}>
            <div style={styles.form}>
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Business Name <span style={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  name="businessName"
                  value={formData.businessName}
                  onChange={(e) => setFormData({...formData, businessName: e.target.value})}
                  style={styles.input}
                  placeholder="Your Store Name"
                  required
                />
              </div>
              
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Number of Employees <span style={styles.required}>*</span>
                </label>
                <select
                  name="employeeCount"
                  value={formData.employeeCount}
                  onChange={(e) => setFormData({...formData, employeeCount: e.target.value})}
                  style={styles.select}
                  required
                >
                  <option value="">Select team size</option>
                  <option value="1">Just me</option>
                  <option value="2-5">2-5 employees</option>
                  <option value="6-10">6-10 employees</option>
                  <option value="11-50">11-50 employees</option>
                  <option value="50+">50+ employees</option>
                </select>
              </div>
              
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Country</label>
                  <input
                    type="text"
                    name="country"
                    value={formData.country}
                    onChange={(e) => setFormData({...formData, country: e.target.value})}
                    style={styles.input}
                    placeholder="United States"
                  />
                </div>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>Currency</label>
                  <select
                    name="currency"
                    value={formData.currency}
                    onChange={(e) => setFormData({...formData, currency: e.target.value})}
                    style={styles.select}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="CAD">CAD ($)</option>
                    <option value="AUD">AUD ($)</option>
                  </select>
                </div>
              </div>
              
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Main Contact Email <span style={styles.required}>*</span>
                </label>
                <input
                  type="email"
                  name="contactEmail"
                  value={formData.contactEmail}
                  onChange={(e) => setFormData({...formData, contactEmail: e.target.value})}
                  style={styles.input}
                  placeholder="you@example.com"
                  required
                />
                <p style={styles.helpText}>We'll use this for important updates about your rewards program</p>
              </div>
            </div>
          </Form>
          
          <div style={styles.actions}>
            <button
              onClick={handleBack}
              style={{
                ...styles.button,
                ...styles.secondaryButton
              }}
              onMouseOver={(e) => e.currentTarget.style.borderColor = '#999'}
              onMouseOut={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
            >
              Back
            </button>
            <button
              onClick={handleNext}
              style={{
                ...styles.button,
                ...styles.primaryButton
              }}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.8'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              Next Step →
            </button>
          </div>
        </>
      )}
      
      {/* Step 5: Industry & Goals */}
      {currentStep === 5 && (
        <>
          <div style={styles.header}>
            <h1 style={styles.title}>What are your goals?</h1>
            <p style={styles.subtitle}>This helps us optimize your rewards program</p>
          </div>
          
          <Form method="post" action={formActionUrl}>
            <div style={styles.form}>
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  What type of products do you sell? <span style={styles.required}>*</span>
                </label>
                <p style={styles.helpText}>Select all that apply</p>
                <div style={styles.checkboxGroup}>
                  {productTypeOptions.map((type) => (
                    <label
                      key={type}
                      style={{
                        ...styles.checkboxLabel,
                        ...(formData.productTypes.includes(type) ? styles.checkboxLabelSelected : {})
                      }}
                    >
                      <input
                        type="checkbox"
                        name="productTypes"
                        value={type}
                        checked={formData.productTypes.includes(type)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({
                              ...formData,
                              productTypes: [...formData.productTypes, type]
                            });
                          } else {
                            setFormData({
                              ...formData,
                              productTypes: formData.productTypes.filter(t => t !== type)
                            });
                          }
                        }}
                        style={styles.checkbox}
                      />
                      {type}
                    </label>
                  ))}
                </div>
              </div>
              
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  What do you want to achieve with this rewards program?
                </label>
                <p style={styles.helpText}>Select your main goals (optional)</p>
                <div>
                  {goalOptions.map((goal) => (
                    <div
                      key={goal.value}
                      style={{
                        ...styles.goalCard,
                        ...(formData.goals.includes(goal.value) ? styles.goalCardSelected : {})
                      }}
                      onClick={() => {
                        if (formData.goals.includes(goal.value)) {
                          setFormData({
                            ...formData,
                            goals: formData.goals.filter(g => g !== goal.value)
                          });
                        } else {
                          setFormData({
                            ...formData,
                            goals: [...formData.goals, goal.value]
                          });
                        }
                      }}
                    >
                      <span style={styles.goalIcon}>{goal.icon}</span>
                      <div style={styles.goalText}>
                        <div style={styles.goalTitle}>{goal.label}</div>
                      </div>
                      <input
                        type="checkbox"
                        name="goals"
                        value={goal.value}
                        checked={formData.goals.includes(goal.value)}
                        onChange={() => {}}
                        style={{ marginLeft: "auto" }}
                      />
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Error message if no product types selected */}
              {formData.productTypes.length === 0 && (
                <div style={styles.error}>
                  Please select at least one product type to continue
                </div>
              )}
              
              {/* Hidden inputs to preserve step 4 data */}
              <input type="hidden" name="businessName" value={formData.businessName} />
              <input type="hidden" name="employeeCount" value={formData.employeeCount} />
              <input type="hidden" name="country" value={formData.country} />
              <input type="hidden" name="currency" value={formData.currency} />
              <input type="hidden" name="contactEmail" value={formData.contactEmail} />
            </div>
            
            <div style={styles.actions}>
              <button
                type="button"
                onClick={handleBack}
                style={{
                  ...styles.button,
                  ...styles.secondaryButton
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = '#999'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = '#e0e0e0'}
              >
                ← Back
              </button>
              <button
                type="submit"
                disabled={isSubmitting || formData.productTypes.length === 0}
                style={{
                  ...styles.button,
                  ...styles.primaryButton,
                  opacity: (isSubmitting || formData.productTypes.length === 0) ? 0.6 : 1,
                  cursor: (isSubmitting || formData.productTypes.length === 0) ? "not-allowed" : "pointer"
                }}
                onMouseOver={(e) => {
                  if (!isSubmitting && formData.productTypes.length > 0) {
                    e.currentTarget.style.opacity = '0.8';
                  }
                }}
                onMouseOut={(e) => {
                  if (!isSubmitting && formData.productTypes.length > 0) {
                    e.currentTarget.style.opacity = '1';
                  }
                }}
              >
                {isSubmitting ? "Setting up..." : "Complete Setup"}
              </button>
            </div>
          </Form>
        </>
      )}
    </div>
  );
}