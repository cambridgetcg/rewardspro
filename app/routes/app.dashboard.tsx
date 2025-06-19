// app/routes/app.dashboard.tsx
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { 
  getDashboardMetrics, 
  getTierDistribution
} from "../services/dashboard.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  
  const [metrics, tierDistribution] = await Promise.all([
    getDashboardMetrics(),
    getTierDistribution()
  ]);

  return json({ metrics, tierDistribution });
}

export default function Dashboard() {
  const { metrics, tierDistribution } = useLoaderData<typeof loader>();

  return (
    <div style={{ padding: "20px", maxWidth: "1400px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "28px", marginBottom: "24px" }}>Cashback Dashboard</h1>
      
      {/* Metrics Cards */}
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
        gap: "20px",
        marginBottom: "32px"
      }}>
        <MetricCard
          title="Total Customers"
          value={metrics.totalCustomers.toLocaleString()}
          change={metrics.customerGrowth}
          changeLabel="30 days"
        />
        <MetricCard
          title="Total Cashback"
          value={`£${metrics.totalCashbackThisMonth.toFixed(2)}`}
          subtitle="This Month"
        />
        <MetricCard
          title="Active Credit"
          value={`£${metrics.activeStoreCredit.toFixed(2)}`}
          subtitle="(Liability)"
        />
        <MetricCard
          title="Avg Order Value"
          value={`£${metrics.averageOrderValue.toFixed(2)}`}
          change={metrics.aovChange}
        />
      </div>

      {/* Tier Distribution */}
      <div style={{ 
        backgroundColor: "white",
        border: "1px solid #e5e5e5",
        borderRadius: "8px",
        padding: "24px"
      }}>
        <h2 style={{ fontSize: "20px", marginBottom: "20px" }}>Customer Distribution</h2>
        
        <div style={{ marginBottom: "16px" }}>
          <div style={{ 
            display: "flex", 
            height: "40px",
            borderRadius: "8px",
            overflow: "hidden",
            backgroundColor: "#f5f5f5"
          }}>
            {tierDistribution.map((tier, index) => (
              <Link
                key={tier.tierId}
                to={`/app/dashboard/tier/${tier.tierId}`}
                style={{
                  flex: `0 0 ${tier.percentage}%`,
                  backgroundColor: tier.color || getDefaultColor(index),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  textDecoration: "none",
                  fontSize: tier.percentage > 5 ? "14px" : "0",
                  fontWeight: "500",
                  transition: "opacity 0.2s",
                  cursor: "pointer"
                }}
                title={`${tier.displayName}: ${tier.memberCount} members (${tier.percentage}%)`}
                onMouseEnter={(e) => e.currentTarget.style.opacity = "0.8"}
                onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
              >
                {tier.percentage > 10 && tier.displayName}
              </Link>
            ))}
          </div>
        </div>
        
        <div style={{ display: "flex", flexWrap: "wrap", gap: "20px" }}>
          {tierDistribution.map((tier, index) => (
            <div key={tier.tierId} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ 
                width: "16px", 
                height: "16px", 
                backgroundColor: tier.color || getDefaultColor(index),
                borderRadius: "4px"
              }} />
              <span style={{ fontSize: "14px" }}>
                {tier.displayName}: {tier.memberCount} ({tier.percentage}%)
              </span>
            </div>
          ))}
        </div>
        
        <p style={{ marginTop: "16px", fontSize: "14px", color: "#666" }}>
          💡 Click any tier segment to see details
        </p>
      </div>
    </div>
  );
}

// Metric Card Component
function MetricCard({ 
  title, 
  value, 
  subtitle, 
  change, 
  changeLabel = "vs last period" 
}: {
  title: string;
  value: string;
  subtitle?: string;
  change?: number;
  changeLabel?: string;
}) {
  return (
    <div style={{
      backgroundColor: "white",
      border: "1px solid #e5e5e5",
      borderRadius: "8px",
      padding: "20px"
    }}>
      <h3 style={{ 
        fontSize: "14px", 
        fontWeight: "normal", 
        color: "#666",
        marginBottom: "8px"
      }}>
        {title}
      </h3>
      <p style={{ 
        fontSize: "28px", 
        fontWeight: "bold",
        margin: "0"
      }}>
        {value}
      </p>
      {subtitle && (
        <p style={{ 
          fontSize: "14px", 
          color: "#666",
          marginTop: "4px"
        }}>
          {subtitle}
        </p>
      )}
      {change !== undefined && (
        <p style={{ 
          fontSize: "14px",
          marginTop: "8px",
          color: change >= 0 ? "#10B981" : "#EF4444"
        }}>
          {change >= 0 ? "↑" : "↓"} {Math.abs(change)}% {changeLabel}
        </p>
      )}
    </div>
  );
}

// Default colors for tiers
function getDefaultColor(index: number): string {
  const colors = ["#CD7F32", "#C0C0C0", "#FFD700", "#E5E4E2", "#FF69B4"];
  return colors[index % colors.length];
}