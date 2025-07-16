// app/components/OnboardingWelcome.tsx
import { useState } from "react";

interface OnboardingWelcomeProps {
  onComplete: () => void;
  onSkip?: () => void;
}

export default function OnboardingWelcome({ onComplete, onSkip }: OnboardingWelcomeProps) {
  const [currentStep, setCurrentStep] = useState(1);
  
  const handleNext = () => {
    if (currentStep === 3) {
      onComplete();
    } else {
      setCurrentStep(currentStep + 1);
    }
  };
  
  const handleBack = () => {
    setCurrentStep(currentStep - 1);
  };
  
  const handleSkip = () => {
    if (onSkip) {
      onSkip();
    } else {
      onComplete();
    }
  };
  
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
            💡 Not ready? <a href="#" onClick={(e) => { e.preventDefault(); handleSkip(); }} style={styles.link}>Skip to setup</a> and launch later.
          </p>
        </>
      )}
    </div>
  );
}