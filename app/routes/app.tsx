import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, useNavigation } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Log the request URL to see if shop parameter is present
    const url = new URL(request.url);
    console.log("App loader - Request URL:", url.toString());
    console.log("App loader - Shop param:", url.searchParams.get("shop"));
    
    // Authenticate once for all child routes
    const { session } = await authenticate.admin(request);
    
    console.log("App loader - Authentication successful for shop:", session.shop);
    
    return json({
      apiKey: process.env.SHOPIFY_API_KEY || "",
      shop: session.shop,
    });
  } catch (error) {
    console.error("App loader - Authentication error:", error);
    
    // Check if it's an authentication error
    if (error instanceof Response) {
      console.error("App loader - Error status:", error.status);
      console.error("App loader - Error headers:", error.headers);
    }
    
    // Re-throw to trigger Shopify's login flow
    throw error;
  }
};

// Loading overlay component
function LoadingOverlay() {
  const navigation = useNavigation();
  
  if (navigation.state !== "loading") return null;
  
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(255, 255, 255, 0.8)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: "40px",
            height: "40px",
            border: "3px solid #f3f3f3",
            borderTop: "3px solid #4F46E5",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "0 auto 16px",
          }}
        />
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}

export default function App() {
  const { apiKey, shop } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  // Log to verify data is loaded
  console.log("App component - API Key present:", !!apiKey);
  console.log("App component - Shop:", shop);

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home" prefetch="intent">
          Home
        </Link>
        <Link to="/app/dashboard" prefetch="intent">
          Dashboard
        </Link>
        <Link to="/app/customers/credit" prefetch="intent">
          Credits
        </Link>
        <Link to="/app/tiers" prefetch="intent">
          Tiers
        </Link>
        <Link to="/app/customers/tiers" prefetch="intent">
          Customers
        </Link>
      </NavMenu>
      
      {/* Loading overlay for better UX */}
      <LoadingOverlay />
      
      {/* Main content with fade effect during navigation */}
      <div
        style={{
          opacity: navigation.state === "loading" ? 0.6 : 1,
          transition: "opacity 150ms ease-in-out",
          minHeight: "100vh",
        }}
      >
        <Outlet />
      </div>
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  console.error("App ErrorBoundary - Error:", error);
  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};