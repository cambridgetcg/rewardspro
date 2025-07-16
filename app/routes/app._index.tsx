// app/routes/app._index.tsx
// This is the main entry point after app installation
import { json, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState } from "react";

// Check if onboarding is complete
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
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
  
  // If onboarding is completed, redirect to dashboard
  if (sessionData?.onboardingCompleted) {
    return redirect("/app/dashboard");
  }
  
  // Check if there's existing onboarding data (in case of incomplete submission)
  const existingOnboarding = await prisma.onboarding.findUnique({
    where: { shopDomain: session.shop }
  });
  
  // Get shop details from Shopify
  const { admin } = await authenticate.admin(request);
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
  
  return json({
    shop: {
      ...shopData.data.shop,
      countryCode: shopData.data.shop.billingAddress?.countryCodeV2 || "US"
    },
    sessionEmail: sessionData?.email || shopData.data.shop.email,
    locale: sessionData?.locale,
    existingOnboarding
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
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
    
    // Mark onboarding as complete in the session
    await prisma.session.updateMany({
      where: { shop: session.shop },
      data: { onboardingCompleted: true }
    });
    
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
    }
    
    return redirect("/app/dashboard");
  } catch (error) {
    console.error("Onboarding error:", error);
    return json({ error: "Failed to save onboarding data. Please try again." }, { status: 500 });
  }
}

export default function OnboardingFlow() {
  const { shop, sessionEmail, locale, existingOnboarding } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    businessName: existingOnboarding?.businessName || shop.name || "",
    employeeCount: existingOnboarding?.employeeCount || "",
    country: existingOnboarding?.country || shop.countryCode || "",
    currency: existingOnboarding?.currency || shop.currencyCode || "USD",
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
    if (currentStep === 1) {
      // Validate step 1
      if (!formData.businessName || !formData.employeeCount || !formData.contactEmail) {
        alert("Please fill in all required fields");
        return;
      }
      setCurrentStep(2);
    }
  };
  
  const handleBack = () => {
    setCurrentStep(1);
  };
  
  const styles = {
    container: {
      maxWidth: "1200px",
      margin: "0 auto",
      padding: "32px 24px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: "#1a1a1a",
      backgroundColor: "#ffffff",
      minHeight: "100vh"
    },
    header: {
      marginBottom: "40px"
    },
    title: {
      fontSize: "32px",
      fontWeight: "600",
      margin: "0 0 8px 0",
      color: "#1a1a1a"
    },
    subtitle: {
      fontSize: "16px",
      color: "#666",
      margin: 0,
      fontWeight: "400"
    },
    progressBar: {
      display: "flex",
      justifyContent: "center",
      marginBottom: "40px",
      position: "relative" as const,
      maxWidth: "400px",
      margin: "0 auto 40px"
    },
    progressLine: {
      position: "absolute" as const,
      top: "20px",
      left: "50px",
      right: "50px",
      height: "2px",
      backgroundColor: "#e0e0e0",
      zIndex: 0
    },
    progressLineFilled: {
      position: "absolute" as const,
      top: "20px",
      left: "50px",
      width: currentStep === 2 ? "calc(100% - 100px)" : "0",
      height: "2px",
      backgroundColor: "#10B981",
      zIndex: 0,
      transition: "width 0.3s ease"
    },
    progressStep: {
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center",
      position: "relative" as const,
      zIndex: 1
    },
    progressCircle: {
      width: "40px",
      height: "40px",
      borderRadius: "50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "16px",
      fontWeight: "600",
      transition: "all 0.3s ease"
    },
    progressLabel: {
      marginTop: "8px",
      fontSize: "14px",
      fontWeight: "500"
    },
    form: {
      backgroundColor: "#f8f9fa",
      padding: "32px",
      borderRadius: "12px",
      border: "1px solid #e0e0e0",
      marginBottom: "32px",
      maxWidth: "800px",
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
      justifyContent: "space-between",
      alignItems: "center"
    },
    button: {
      padding: "10px 20px",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: "500",
      cursor: "pointer",
      transition: "opacity 0.2s",
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
    infoBox: {
      backgroundColor: "#e3f2fd",
      border: "1px solid #90caf9",
      borderRadius: "8px",
      padding: "16px",
      marginBottom: "24px",
      fontSize: "14px",
      color: "#1565c0",
      display: "flex",
      alignItems: "center",
      gap: "12px"
    },
    error: {
      backgroundColor: "#ffebee",
      color: "#c62828",
      padding: "12px",
      borderRadius: "8px",
      marginBottom: "16px",
      fontSize: "14px"
    }
  };
  
  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Welcome to Cashback Rewards</h1>
        <p style={styles.subtitle}>Let's get your loyalty program set up in just 2 minutes</p>
      </div>
      
      {/* Info Box */}
      <div style={styles.infoBox}>
        <span style={{ fontSize: "20px" }}>ℹ️</span>
        <div>
          <strong>Complete setup to get started</strong>
          <br />
          We'll create default reward tiers for you, which you can customize later.
        </div>
      </div>
      
      {/* Progress Bar */}
      <div style={styles.progressBar}>
        <div style={styles.progressLine}></div>
        <div style={styles.progressLineFilled}></div>
        
        <div style={styles.progressStep}>
          <div style={{
            ...styles.progressCircle,
            backgroundColor: "#10B981",
            color: "white"
          }}>
            1
          </div>
          <span style={{
            ...styles.progressLabel,
            color: "#10B981"
          }}>
            Business Info
          </span>
        </div>
        
        <div style={styles.progressStep}>
          <div style={{
            ...styles.progressCircle,
            backgroundColor: currentStep === 2 ? "#10B981" : "#f5f5f5",
            color: currentStep === 2 ? "white" : "#999"
          }}>
            2
          </div>
          <span style={{
            ...styles.progressLabel,
            color: currentStep === 2 ? "#10B981" : "#999"
          }}>
            Your Goals
          </span>
        </div>
      </div>
      
      <Form method="post">
        {/* Step 1: Business Setup */}
        {currentStep === 1 && (
          <div style={styles.form}>
            <h2 style={styles.stepTitle}>Tell us about your business</h2>
            
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
            
            <div style={styles.actions}>
              <div></div>
              <button
                type="button"
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
          </div>
        )}
        
        {/* Step 2: Industry & Goals */}
        {currentStep === 2 && (
          <div style={styles.form}>
            <h2 style={styles.stepTitle}>What are your goals?</h2>
            
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
            
            {/* Hidden inputs to preserve step 1 data */}
            <input type="hidden" name="businessName" value={formData.businessName} />
            <input type="hidden" name="employeeCount" value={formData.employeeCount} />
            <input type="hidden" name="country" value={formData.country} />
            <input type="hidden" name="currency" value={formData.currency} />
            <input type="hidden" name="contactEmail" value={formData.contactEmail} />
            
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
          </div>
        )}
      </Form>
    </div>
  );
}