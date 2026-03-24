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
      setIsVisible(true);
      setProgress(0);

      // Quick jump for immediate feedback
      const t1 = setTimeout(() => setProgress(30), 50);

      // Smooth slowdown as it approaches 90%
      const timer = setInterval(() => {
        setProgress((p) => {
          if (p >= 90) return 90;
          return p + (90 - p) * 0.1;
        });
      }, 300);

      return () => {
        clearTimeout(t1);
        clearInterval(timer);
      };
    } else if (navigation.state === "idle" && isVisible) {
      setProgress(100);
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => setProgress(0), 200);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [navigation.state, isVisible]);

  if (!isVisible && progress === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "2px",
        zIndex: 9999,
        opacity: isVisible ? 1 : 0,
        transition: "opacity 200ms ease",
      }}
    >
      <div
        style={{
          height: "100%",
          background: "#667eea",
          width: `${progress}%`,
          transition:
            progress === 100
              ? "width 200ms ease-out"
              : "width 300ms linear",
          borderRadius: "0 1px 1px 0",
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link rel="dns-prefetch" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
          @media (prefers-reduced-motion: reduce) {
            * {
              animation-duration: 0.01ms !important;
              transition-duration: 0.01ms !important;
            }
          }
          html { scroll-behavior: smooth; }
          :focus-visible {
            outline: 2px solid #667eea;
            outline-offset: 2px;
          }
        `,
          }}
        />
        <Meta />
        <Links />
      </head>
      <body>
        <NavigationProgress />
        <Outlet />
        <ScrollRestoration
          getKey={(location) => location.pathname}
        />
        <Scripts />
      </body>
    </html>
  );
}
