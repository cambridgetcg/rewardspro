// app/routes/app._index.tsx
import { json, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation, useActionData, useSearchParams } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect } from "react";

// Check if onboarding is complete
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || session.shop;
    const host = url.searchParams.get("host");
    
    // Check if onboarding is complete
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
    
    // If onboarding is complete, redirect to dashboard
    if (sessionData?.onboardingCompleted) {
      const redirectUrl = new URL("/app/dashboard", request.url);
      redirectUrl.searchParams.set("shop", shop);
      if (host) redirectUrl.searchParams.set("host", host);
      return redirect(redirectUrl.toString());
    }
    
    // Get existing onboarding data if any
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
          billingAddress {
            country
            countryCodeV2
          }
        }
      }`
    );
    
    const shopData = await response.json();
    
    if (!shopData?.data?.shop) {
      throw new Error("Failed to load shop information");
    }
    
    return json({
      shop: {
        ...shopData.data.shop,
        domain: session.shop,
        countryCode: shopData.data.shop.billingAddress?.countryCodeV2 || "US"
      },
      sessionEmail: sessionData?.email || shopData.data.shop.email,
      locale: sessionData?.locale,
      existingOnboarding,
      urlParams: { shop, host }
    });
  } catch (error) {
    console.error("Loader error:", error);
    throw error;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || session.shop;
    const host = url.searchParams.get("host");
    
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
    const errors: Record<string, string> = {};
    if (!onboardingData.businessName) errors.businessName = "Business name is required";
    if (!onboardingData.employeeCount) errors.employeeCount = "Please select your team size";
    if (!onboardingData.contactEmail) errors.contactEmail = "Contact email is required";
    if (onboardingData.productTypes.length === 0) errors.productTypes = "Please select at least one product type";
    
    if (Object.keys(errors).length > 0) {
      return json({ success: false, errors }, { status: 400 });
    }
    
    // Save onboarding data
    await prisma.onboarding.upsert({
      where: { shopDomain: session.shop },
      update: onboardingData,
      create: {
        shopDomain: session.shop,
        ...onboardingData
      }
    });
    
    // Mark onboarding as complete
    await prisma.session.updateMany({
      where: { shop: session.shop },
      data: { onboardingCompleted: true }
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
    
    // Redirect to dashboard
    const redirectUrl = new URL("/app/dashboard", request.url);
    redirectUrl.searchParams.set("shop", shop);
    if (host) redirectUrl.searchParams.set("host", host);
    
    return redirect(redirectUrl.toString());
  } catch (error) {
    console.error("Action error:", error);
    return json({
      success: false,
      errors: { general: "Failed to save onboarding data. Please try again." }
    }, { status: 500 });
  }
}

// Product type options
const productTypeOptions = [
  { value: "fashion", label: "Fashion & Apparel", icon: "👔" },
  { value: "electronics", label: "Electronics & Tech", icon: "💻" },
  { value: "home", label: "Home & Garden", icon: "🏠" },
  { value: "beauty", label: "Beauty & Personal Care", icon: "💄" },
  { value: "food", label: "Food & Beverage", icon: "🍽️" },
  { value: "sports", label: "Sports & Outdoors", icon: "⚽" },
  { value: "books", label: "Books & Media", icon: "📚" },
  { value: "toys", label: "Toys & Games", icon: "🎮" },
  { value: "health", label: "Health & Wellness", icon: "💊" },
  { value: "automotive", label: "Automotive", icon: "🚗" },
  { value: "other", label: "Other", icon: "📦" }
];

// Goal options
const goalOptions = [
  { value: "retention", label: "Improve customer retention", icon: "🎯", description: "Keep customers coming back" },
  { value: "loyalty", label: "Build brand loyalty", icon: "⭐", description: "Create lasting relationships" },
  { value: "revenue", label: "Increase revenue", icon: "💰", description: "Boost average order value" },
  { value: "engagement", label: "Better engagement", icon: "🤝", description: "Connect with customers" },
  { value: "acquisition", label: "Attract new customers", icon: "🚀", description: "Grow your customer base" },
  { value: "analytics", label: "Understand customers better", icon: "📊", description: "Data-driven insights" }
];

export default function OnboardingFlow() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state === "submitting";
  
  const { shop, sessionEmail, existingOnboarding, urlParams } = data;
  
  // Form state
  const [formData, setFormData] = useState({
    businessName: existingOnboarding?.businessName || shop?.name || "",
    employeeCount: existingOnboarding?.employeeCount || "",
    country: existingOnboarding?.country || shop?.countryCode || "US",
    currency: existingOnboarding?.currency || shop?.currencyCode || "USD",
    contactEmail: existingOnboarding?.contactEmail || sessionEmail || "",
    productTypes: existingOnboarding?.productTypes || [] as string[],
    goals: existingOnboarding?.goals || [] as string[]
  });
  
  // UI state
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 3;
  
  // Validation errors
  const errors = actionData?.errors || {};
  
  // Step navigation
  const canProceedStep1 = formData.businessName && formData.employeeCount && formData.contactEmail;
  const canProceedStep2 = formData.productTypes.length > 0;
  
  const handleNext = () => {
    if (currentStep === 1 && !canProceedStep1) {
      alert("Please fill in all required fields");
      return;
    }
    if (currentStep === 2 && !canProceedStep2) {
      alert("Please select at least one product type");
      return;
    }
    setCurrentStep(Math.min(currentStep + 1, totalSteps));
  };
  
  const handleBack = () => {
    setCurrentStep(Math.max(currentStep - 1, 1));
  };
  
  // Toggle helpers
  const toggleProductType = (type: string) => {
    setFormData(prev => ({
      ...prev,
      productTypes: prev.productTypes.includes(type)
        ? prev.productTypes.filter(t => t !== type)
        : [...prev.productTypes, type]
    }));
  };
  
  const toggleGoal = (goal: string) => {
    setFormData(prev => ({
      ...prev,
      goals: prev.goals.includes(goal)
        ? prev.goals.filter(g => g !== goal)
        : [...prev.goals, goal]
    }));
  };
  
  const styles = {
    container: {
      maxWidth: "900px",
      margin: "0 auto",
      padding: "40px 24px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: "#1a1a1a",
      backgroundColor: "#ffffff",
      minHeight: "100vh"
    },
    progressBar: {
      marginBottom: "48px"
    },
    progressSteps: {
      display: "flex",
      justifyContent: "space-between",
      position: "relative" as const,
      marginBottom: "8px"
    },
    progressLine: {
      position: "absolute" as const,
      top: "16px",
      left: "0",
      right: "0",
      height: "2px",
      backgroundColor: "#e0e0e0",
      zIndex: 0
    },
    progressLineFill: {
      position: "absolute" as const,
      top: "16px",
      left: "0",
      height: "2px",
      backgroundColor: "#10B981",
      transition: "width 0.3s ease",
      zIndex: 1
    },
    progressStep: {
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center",
      position: "relative" as const,
      zIndex: 2,
      backgroundColor: "white",
      padding: "0 8px"
    },
    progressDot: {
      width: "32px",
      height: "32px",
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "14px",
      fontWeight: "600",
      transition: "all 0.3s ease"
    },
    progressDotActive: {
      backgroundColor: "#10B981",
      color: "white"
    },
    progressDotInactive: {
      backgroundColor: "#e0e0e0",
      color: "#999"
    },
    progressLabel: {
      fontSize: "12px",
      marginTop: "8px",
      color: "#666"
    },
    header: {
      textAlign: "center" as const,
      marginBottom: "48px"
    },
    title: {
      fontSize: "36px",
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
    form: {
      maxWidth: "600px",
      margin: "0 auto"
    },
    formSection: {
      backgroundColor: "#f8f9fa",
      padding: "32px",
      borderRadius: "12px",
      border: "1px solid #e0e0e0",
      marginBottom: "32px"
    },
    formGroup: {
      marginBottom: "24px"
    },
    label: {
      display: "block",
      fontSize: "14px",
      fontWeight: "600",
      marginBottom: "8px",
      color: "#333"
    },
    required: {
      color: "#EF4444"
    },
    input: {
      width: "100%",
      padding: "12px 16px",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "16px",
      backgroundColor: "white",
      transition: "all 0.2s",
      outline: "none"
    },
    inputError: {
      borderColor: "#EF4444"
    },
    select: {
      width: "100%",
      padding: "12px 16px",
      border: "1px solid #e0e0e0",
      borderRadius: "8px",
      fontSize: "16px",
      backgroundColor: "white",
      cursor: "pointer",
      outline: "none"
    },
    helpText: {
      fontSize: "13px",
      color: "#666",
      marginTop: "6px"
    },
    errorText: {
      fontSize: "13px",
      color: "#EF4444",
      marginTop: "6px"
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      gap: "12px"
    },
    checkCard: {
      padding: "16px",
      border: "2px solid #e0e0e0",
      borderRadius: "8px",
      cursor: "pointer",
      transition: "all 0.2s",
      backgroundColor: "white",
      display: "flex",
      alignItems: "center",
      gap: "12px"
    },
    checkCardSelected: {
      borderColor: "#10B981",
      backgroundColor: "#f0fdf4"
    },
    checkIcon: {
      fontSize: "24px"
    },
    checkLabel: {
      fontSize: "14px",
      fontWeight: "500",
      color: "#1a1a1a"
    },
    goalCard: {
      padding: "20px",
      border: "2px solid #e0e0e0",
      borderRadius: "8px",
      cursor: "pointer",
      transition: "all 0.2s",
      backgroundColor: "white"
    },
    goalCardSelected: {
      borderColor: "#10B981",
      backgroundColor: "#f0fdf4"
    },
    goalHeader: {
      display: "flex",
      alignItems: "center",
      gap: "12px",
      marginBottom: "8px"
    },
    goalIcon: {
      fontSize: "28px"
    },
    goalTitle: {
      fontSize: "16px",
      fontWeight: "600",
      color: "#1a1a1a"
    },
    goalDescription: {
      fontSize: "13px",
      color: "#666",
      marginLeft: "40px"
    },
    review: {
      backgroundColor: "#f8f9fa",
      padding: "24px",
      borderRadius: "8px",
      marginBottom: "16px"
    },
    reviewSection: {
      marginBottom: "20px"
    },
    reviewLabel: {
      fontSize: "13px",
      color: "#666",
      marginBottom: "4px"
    },
    reviewValue: {
      fontSize: "16px",
      fontWeight: "500",
      color: "#1a1a1a"
    },
    actions: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: "48px"
    },
    button: {
      padding: "14px 28px",
      borderRadius: "8px",
      fontSize: "16px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "all 0.2s",
      border: "none"
    },
    primaryButton: {
      backgroundColor: "#10B981",
      color: "white"
    },
    secondaryButton: {
      backgroundColor: "white",
      color: "#666",
      border: "1px solid #e0e0e0"
    },
    buttonDisabled: {
      opacity: 0.5,
      cursor: "not-allowed"
    }
  };
  
  // Progress calculation
  const progressPercentage = ((currentStep - 1) / (totalSteps - 1)) * 100;
  
  return (
    <div style={styles.container}>
      {/* Progress Bar */}
      <div style={styles.progressBar}>
        <div style={styles.progressSteps}>
          <div style={styles.progressLine} />
          <div style={{ ...styles.progressLineFill, width: `${progressPercentage}%` }} />
          
          {["Business Info", "Products & Goals", "Review & Launch"].map((label, index) => (
            <div key={index} style={styles.progressStep}>
              <div style={{
                ...styles.progressDot,
                ...(currentStep > index + 1 || (currentStep === totalSteps && index === totalSteps - 1) 
                  ? styles.progressDotActive 
                  : styles.progressDotInactive)
              }}>
                {currentStep > index + 1 ? "✓" : index + 1}
              </div>
              <span style={styles.progressLabel}>{label}</span>
            </div>
          ))}
        </div>
      </div>
      
      <Form method="post">
        {/* Step 1: Business Information */}
        {currentStep === 1 && (
          <>
            <div style={styles.header}>
              <h1 style={styles.title}>Welcome to Cashback Rewards</h1>
              <p style={styles.subtitle}>Let's get your loyalty program set up in just a few minutes</p>
            </div>
            
            <div style={styles.form}>
              <div style={styles.formSection}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    Business Name <span style={styles.required}>*</span>
                  </label>
                  <input
                    type="text"
                    name="businessName"
                    value={formData.businessName}
                    onChange={(e) => setFormData({...formData, businessName: e.target.value})}
                    style={{
                      ...styles.input,
                      ...(errors.businessName ? styles.inputError : {})
                    }}
                    placeholder="Your Store Name"
                    required
                  />
                  {errors.businessName && <p style={styles.errorText}>{errors.businessName}</p>}
                </div>
                
                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    Team Size <span style={styles.required}>*</span>
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
                  {errors.employeeCount && <p style={styles.errorText}>{errors.employeeCount}</p>}
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
                    Contact Email <span style={styles.required}>*</span>
                  </label>
                  <input
                    type="email"
                    name="contactEmail"
                    value={formData.contactEmail}
                    onChange={(e) => setFormData({...formData, contactEmail: e.target.value})}
                    style={{
                      ...styles.input,
                      ...(errors.contactEmail ? styles.inputError : {})
                    }}
                    placeholder="you@example.com"
                    required
                  />
                  <p style={styles.helpText}>We'll use this for important updates about your rewards program</p>
                  {errors.contactEmail && <p style={styles.errorText}>{errors.contactEmail}</p>}
                </div>
              </div>
            </div>
          </>
        )}
        
        {/* Step 2: Products & Goals */}
        {currentStep === 2 && (
          <>
            <div style={styles.header}>
              <h1 style={styles.title}>What do you sell?</h1>
              <p style={styles.subtitle}>This helps us optimize your rewards program</p>
            </div>
            
            <div style={styles.form}>
              <div style={styles.formSection}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    Product Categories <span style={styles.required}>*</span>
                  </label>
                  <p style={styles.helpText}>Select all that apply</p>
                  <div style={styles.grid}>
                    {productTypeOptions.map((type) => (
                      <div
                        key={type.value}
                        style={{
                          ...styles.checkCard,
                          ...(formData.productTypes.includes(type.value) ? styles.checkCardSelected : {})
                        }}
                        onClick={() => toggleProductType(type.value)}
                      >
                        <span style={styles.checkIcon}>{type.icon}</span>
                        <span style={styles.checkLabel}>{type.label}</span>
                        <input
                          type="checkbox"
                          name="productTypes"
                          value={type.value}
                          checked={formData.productTypes.includes(type.value)}
                          onChange={() => {}}
                          style={{ display: "none" }}
                        />
                      </div>
                    ))}
                  </div>
                  {errors.productTypes && <p style={styles.errorText}>{errors.productTypes}</p>}
                </div>
              </div>
              
              <div style={styles.formSection}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>What are your main goals?</label>
                  <p style={styles.helpText}>Select any that apply (optional)</p>
                  <div style={{ display: "grid", gap: "12px" }}>
                    {goalOptions.map((goal) => (
                      <div
                        key={goal.value}
                        style={{
                          ...styles.goalCard,
                          ...(formData.goals.includes(goal.value) ? styles.goalCardSelected : {})
                        }}
                        onClick={() => toggleGoal(goal.value)}
                      >
                        <div style={styles.goalHeader}>
                          <span style={styles.goalIcon}>{goal.icon}</span>
                          <span style={styles.goalTitle}>{goal.label}</span>
                        </div>
                        <p style={styles.goalDescription}>{goal.description}</p>
                        <input
                          type="checkbox"
                          name="goals"
                          value={goal.value}
                          checked={formData.goals.includes(goal.value)}
                          onChange={() => {}}
                          style={{ display: "none" }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
        
        {/* Step 3: Review & Launch */}
        {currentStep === 3 && (
          <>
            <div style={styles.header}>
              <h1 style={styles.title}>Ready to launch! 🎉</h1>
              <p style={styles.subtitle}>Review your settings and launch your rewards program</p>
            </div>
            
            <div style={styles.form}>
              <div style={styles.review}>
                <h3 style={{ margin: "0 0 20px 0", fontSize: "18px", fontWeight: "600" }}>Your Settings</h3>
                
                <div style={styles.reviewSection}>
                  <p style={styles.reviewLabel}>Business Name</p>
                  <p style={styles.reviewValue}>{formData.businessName}</p>
                </div>
                
                <div style={styles.reviewSection}>
                  <p style={styles.reviewLabel}>Contact Email</p>
                  <p style={styles.reviewValue}>{formData.contactEmail}</p>
                </div>
                
                <div style={styles.reviewSection}>
                  <p style={styles.reviewLabel}>Product Categories</p>
                  <p style={styles.reviewValue}>
                    {formData.productTypes
                      .map(type => productTypeOptions.find(opt => opt.value === type)?.label)
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
                
                {formData.goals.length > 0 && (
                  <div style={styles.reviewSection}>
                    <p style={styles.reviewLabel}>Goals</p>
                    <p style={styles.reviewValue}>
                      {formData.goals
                        .map(goal => goalOptions.find(opt => opt.value === goal)?.label)
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                )}
              </div>
              
              <div style={styles.formSection}>
                <h3 style={{ margin: "0 0 16px 0", fontSize: "18px", fontWeight: "600" }}>
                  What happens next?
                </h3>
                <ul style={{ margin: 0, paddingLeft: "20px", lineHeight: "1.8" }}>
                  <li>We'll create 4 default reward tiers (Bronze, Silver, Gold, Platinum)</li>
                  <li>Customers will automatically earn cashback on every purchase</li>
                  <li>You can customize tiers and settings anytime from the dashboard</li>
                  <li>Email notifications will be sent when customers earn rewards</li>
                </ul>
              </div>
              
              {/* Hidden inputs for all form data */}
              <input type="hidden" name="businessName" value={formData.businessName} />
              <input type="hidden" name="employeeCount" value={formData.employeeCount} />
              <input type="hidden" name="country" value={formData.country} />
              <input type="hidden" name="currency" value={formData.currency} />
              <input type="hidden" name="contactEmail" value={formData.contactEmail} />
              {formData.productTypes.map((type, i) => (
                <input key={`product-${i}`} type="hidden" name="productTypes" value={type} />
              ))}
              {formData.goals.map((goal, i) => (
                <input key={`goal-${i}`} type="hidden" name="goals" value={goal} />
              ))}
            </div>
          </>
        )}
        
        {/* Action Buttons */}
        <div style={styles.actions}>
          <button
            type="button"
            onClick={handleBack}
            style={{
              ...styles.button,
              ...styles.secondaryButton,
              visibility: currentStep === 1 ? "hidden" : "visible"
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'white'}
          >
            ← Back
          </button>
          
          {currentStep < 3 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={
                (currentStep === 1 && !canProceedStep1) ||
                (currentStep === 2 && !canProceedStep2)
              }
              style={{
                ...styles.button,
                ...styles.primaryButton,
                ...((currentStep === 1 && !canProceedStep1) || (currentStep === 2 && !canProceedStep2) 
                  ? styles.buttonDisabled 
                  : {})
              }}
              onMouseOver={(e) => {
                if ((currentStep === 1 && canProceedStep1) || (currentStep === 2 && canProceedStep2)) {
                  e.currentTarget.style.backgroundColor = '#059669';
                }
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = '#10B981';
              }}
            >
              Continue →
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                ...styles.button,
                ...styles.primaryButton,
                ...(isSubmitting ? styles.buttonDisabled : {})
              }}
              onMouseOver={(e) => {
                if (!isSubmitting) {
                  e.currentTarget.style.backgroundColor = '#059669';
                }
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = '#10B981';
              }}
            >
              {isSubmitting ? "Launching..." : "Launch Rewards Program 🚀"}
            </button>
          )}
        </div>
        
        {/* General Error */}
        {errors.general && (
          <div style={{
            marginTop: "16px",
            padding: "12px",
            backgroundColor: "#ffebee",
            color: "#c62828",
            borderRadius: "8px",
            textAlign: "center" as const,
            fontSize: "14px"
          }}>
            {errors.general}
          </div>
        )}
      </Form>
    </div>
  );
}