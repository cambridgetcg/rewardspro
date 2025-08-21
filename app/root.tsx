import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigation,
} from "@remix-run/react";
import { useEffect, useState } from "react";

function NavigationProgress() {
  const navigation = useNavigation();
  const [progress, setProgress] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    if (navigation.state === "loading" || navigation.state === "submitting") {
      // Reset and start with better timing
      setIsVisible(true);
      setProgress(0);
      
      // Quick jump to show immediate feedback
      setTimeout(() => setProgress(30), 10);
      
      // Smooth exponential progress (slows down as it approaches 90%)
      const timer = setInterval(() => {
        setProgress((currentProgress) => {
          if (currentProgress >= 90) return 90;
          // Exponential slowdown for more natural feel
          const increment = (90 - currentProgress) * 0.15;
          return currentProgress + increment;
        });
      }, 200);
      
      return () => clearInterval(timer);
    } else if (navigation.state === "idle" && isVisible) {
      // Complete animation smoothly
      setProgress(100);
      
      // Keep visible briefly then fade out
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => setProgress(0), 300);
      }, 250);
      
      return () => clearTimeout(timer);
    }
  }, [navigation.state, isVisible]);
  
  if (!isVisible && progress === 0) return null;
  
  return (
    <>
      {/* Enhanced progress bar with gradient */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "3px",
          background: "linear-gradient(90deg, transparent, rgba(102, 126, 234, 0.1), transparent)",
          zIndex: 9999,
          opacity: isVisible ? 1 : 0,
          transition: "opacity 300ms ease",
        }}
      >
        <div
          style={{
            height: "100%",
            background: "linear-gradient(90deg, #667eea 0%, #764ba2 100%)",
            width: `${progress}%`,
            transition: progress === 100 
              ? "width 250ms cubic-bezier(0.4, 0, 0.2, 1)" 
              : "width 400ms cubic-bezier(0.4, 0, 0.6, 1)",
            boxShadow: "0 0 12px rgba(102, 126, 234, 0.8), 0 0 24px rgba(118, 75, 162, 0.4)",
            borderRadius: "0 2px 2px 0",
          }}
        />
      </div>
      
      {/* Subtle loading indicator for long loads */}
      {navigation.state === "loading" && progress > 60 && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "radial-gradient(circle at center, transparent 0%, rgba(255, 255, 255, 0.02) 100%)",
            zIndex: 9998,
            pointerEvents: "none",
            opacity: 0.4,
            transition: "opacity 600ms ease",
            animation: "pulse 2s ease-in-out infinite",
          }}
        />
      )}
    </>
  );
}

export default function App() {
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";
  
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        
        {/* Performance optimizations */}
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link rel="dns-prefetch" href="https://cdn.shopify.com/" />
        
        {/* Fonts with display swap for better performance */}
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        
        {/* Animation styles */}
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
          
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          
          /* Smooth page transitions */
          .page-transition {
            animation: fadeIn 300ms ease-out;
          }
          
          /* Reduce motion for accessibility */
          @media (prefers-reduced-motion: reduce) {
            * {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
              transition-duration: 0.01ms !important;
            }
          }
          
          /* Smooth scrolling */
          html {
            scroll-behavior: smooth;
          }
          
          /* Better focus styles */
          :focus-visible {
            outline: 2px solid #667eea;
            outline-offset: 2px;
          }
        `}} />
        
        <Meta />
        <Links />
      </head>
      <body>
        {/* Navigation Progress Indicator */}
        <NavigationProgress />
        
        {/* Page content with smooth transitions */}
        <div
          className={isNavigating ? "" : "page-transition"}
          style={{
            opacity: isNavigating ? 0.85 : 1,
            transform: isNavigating ? "scale(0.995)" : "scale(1)",
            transition: "opacity 250ms ease, transform 250ms ease",
            transformOrigin: "center top",
            minHeight: "100vh",
          }}
        >
          <Outlet />
        </div>
        
        {/* Maintain scroll position between navigations */}
        <ScrollRestoration 
          getKey={(location) => {
            // Restore scroll position per page
            return location.pathname;
          }}
        />
        
        <Scripts />
      </body>
    </html>
  );
}