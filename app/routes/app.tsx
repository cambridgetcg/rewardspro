// app/routes/app.tsx
import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, useLocation } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Check if merchant has completed initial migration
  const hasMigrated = await prisma.migrationHistory.findFirst({
    where: { 
      shopDomain: session.shop,
      status: 'COMPLETED'
    }
  });
  
  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    hasMigrated: !!hasMigrated
  });
};

export default function App() {
  const { apiKey, hasMigrated } = useLoaderData<typeof loader>();
  const location = useLocation();
  
  // Show migration prompt if not completed and not on migration page
  const showMigrationPrompt = !hasMigrated && !location.pathname.includes('migrate');

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        {!hasMigrated && (
          <Link to="/app/import/orders" style={{ color: '#10b981' }}>
            📥 Import Data
          </Link>
        )}
        <Link to="/app/dashboard">
          Dashboard
        </Link>
        <Link to="/app/import-orders">
          Import
        </Link>

        <Link to="/app/test-transactions">
          Test Transaction Bebaviour
        </Link>
        <Link to="/app/email/generator">
          Email Generator
        </Link>
        <Link to="/app/tiers">
          Tiers
        </Link>
        <Link to="/app/customers/tiers">
          Customers
        </Link>
      </NavMenu>
      
      {showMigrationPrompt && (
        <div style={{
          backgroundColor: '#fef3c7',
          border: '1px solid #fde68a',
          padding: '16px',
          margin: '16px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <strong>👋 Welcome!</strong> Import your transaction history to start using cashback features.
          </div>
          <Link 
            to="/app/onboarding/migrate"
            style={{
              backgroundColor: '#10b981',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '6px',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            Import Now
          </Link>
        </div>
      )}
      
      <Outlet />
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