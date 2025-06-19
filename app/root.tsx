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
  
  useEffect(() => {
    if (navigation.state === "loading" || navigation.state === "submitting") {
      // Start progress
      setProgress(10);
      
      // Gradually increase progress
      const timer = setInterval(() => {
        setProgress((currentProgress) => {
          const increment = Math.random() * 10;
          const newProgress = currentProgress + increment;
          return newProgress > 90 ? 90 : newProgress;
        });
      }, 300);
      
      return () => clearInterval(timer);
    } else if (navigation.state === "idle" && progress > 0) {
      // Complete the progress
      setProgress(100);
      
      // Hide after completion
      const timer = setTimeout(() => setProgress(0), 200);
      return () => clearTimeout(timer);
    }
  }, [navigation.state, progress]);
  
  if (progress === 0) return null;
  
  return (
    <>
      {/* Progress bar */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "3px",
          background: "rgba(79, 70, 229, 0.1)",
          zIndex: 9999,
          transition: "opacity 200ms ease",
          opacity: progress > 0 && progress < 100 ? 1 : 0,
        }}
      >
        <div
          style={{
            height: "100%",
            background: "#4F46E5",
            width: `${progress}%`,
            transition: "width 200ms ease",
            boxShadow: "0 0 10px rgba(79, 70, 229, 0.7)",
          }}
        />
      </div>
      
      {/* Optional: Loading overlay for longer loads */}
      {navigation.state === "loading" && progress > 50 && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(255, 255, 255, 0.3)",
            backdropFilter: "blur(1px)",
            zIndex: 9998,
            pointerEvents: "none",
            opacity: 0.5,
            transition: "opacity 300ms ease",
          }}
        />
      )}
    </>
  );
}

export default function App() {
  const navigation = useNavigation();
  
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {/* Navigation Progress Indicator */}
        <NavigationProgress />
        
        {/* Optional: Add fade effect during navigation */}
        <div
          style={{
            opacity: navigation.state === "loading" ? 0.7 : 1,
            transition: "opacity 200ms ease",
          }}
        >
          <Outlet />
        </div>
        
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}