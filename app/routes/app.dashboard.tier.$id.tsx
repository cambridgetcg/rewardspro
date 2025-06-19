// app/routes/app.dashboard.tier.$id.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, Form, useNavigation, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getTierDetails, getUpgradeOpportunities } from "../services/dashboard.server";
import { format } from "date-fns";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  
  const tierId = params.id;
  if (!tierId) {
    throw new Response("Tier ID required", { status: 400 });
  }

  const tierDetails = await getTierDetails(tierId);
  if (!tierDetails) {
    throw new Response("Tier not found", { status: 404 });
  }

  // Get customers close to upgrading TO this tier
  const allOpportunities = await getUpgradeOpportunities();
  const upgradeOpportunities = allOpportunities.filter(
    opp => opp.nextTier === tierDetails.tier.displayName
  );

  return json({ tierDetails, upgradeOpportunities });
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  
  const formData = await request.formData();
  const action = formData.get("_action");
  
  if (action === "exportMembers") {
    // In a real app, this would generate and download a CSV
    // For now, we'll just return success
    return json({ success: true, message: "Export started" });
  }
  
  return json({ success: false });
}

export default function TierDetail() {
  const { tierDetails, upgradeOpportunities } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const { tier, statistics, members, recentActivity } = tierDetails;

  const handleExport = () => {
    submit({ _action: "exportMembers" }, { method: "post" });
  };

  return (
    <div style={{ padding: "20px", maxWidth: "1400px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <Link 
          to="/app/dashboard" 
          style={{ 
            color: "#4F46E5", 
            textDecoration: "none",
            fontSize: "14px",
            marginBottom: "12px",
            display: "inline-block"
          }}
        >
          ← Back to Dashboard
        </Link>
        <h1 style={{ 
          fontSize: "28px", 
          margin: "12px 0",
          color: tier.color || "#000"
        }}>
          {tier.displayName} Tier Overview
        </h1>
      </div>

      {/* Summary Stats */}
      <div style={{
        backgroundColor: "white",
        border: "1px solid #e5e5e5",
        borderRadius: "8px",
        padding: "24px",
        marginBottom: "24px"
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "24px"
        }}>
          <StatItem 
            label="Members" 
            value={statistics.memberCount.toLocaleString()} 
          />
          <StatItem 
            label="Total Spending" 
            value={`£${statistics.totalSpending.toFixed(2)}`} 
          />
          <StatItem 
            label="Avg Spending" 
            value={`£${statistics.avgSpending.toFixed(2)}`} 
          />
          <StatItem 
            label="Cashback Rate" 
            value={`${tier.cashbackPercent}%`} 
          />
          <StatItem 
            label="Total Cashback Issued" 
            value={`£${statistics.totalCashbackIssued.toFixed(2)}`} 
          />
        </div>
      </div>

      {/* Two Column Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 350px", gap: "24px" }}>
        {/* Left Column - Members Table */}
        <div style={{
          backgroundColor: "white",
          border: "1px solid #e5e5e5",
          borderRadius: "8px",
          padding: "24px"
        }}>
          <div style={{ 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center",
            marginBottom: "20px"
          }}>
            <h2 style={{ fontSize: "20px", margin: 0 }}>
              {tier.displayName} Members
            </h2>
            <button
              onClick={handleExport}
              style={{
                padding: "8px 16px",
                backgroundColor: "#4F46E5",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px"
              }}
            >
              Export CSV
            </button>
          </div>

          {members.length === 0 ? (
            <p style={{ textAlign: "center", color: "#666" }}>
              No members in this tier yet
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e5e5e5" }}>
                    <th style={{ padding: "12px", textAlign: "left" }}>Customer</th>
                    <th style={{ padding: "12px", textAlign: "left" }}>Joined Tier</th>
                    <th style={{ padding: "12px", textAlign: "right" }}>Spent (Year)</th>
                    <th style={{ padding: "12px", textAlign: "right" }}>Credit</th>
                    <th style={{ padding: "12px", textAlign: "center" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "12px" }}>{member.email}</td>
                      <td style={{ padding: "12px" }}>
                        {format(new Date(member.joinedTier), "MMM d, yyyy")}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        £{member.yearlySpending.toFixed(2)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "right" }}>
                        £{member.storeCredit.toFixed(2)}
                      </td>
                      <td style={{ padding: "12px", textAlign: "center" }}>
                        <Link
                          to={`/app/customers/${member.id}`}
                          style={{
                            color: "#4F46E5",
                            textDecoration: "none",
                            fontSize: "14px"
                          }}
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column - Stats and Activity */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Tier Statistics */}
          <div style={{
            backgroundColor: "white",
            border: "1px solid #e5e5e5",
            borderRadius: "8px",
            padding: "24px"
          }}>
            <h3 style={{ fontSize: "18px", marginBottom: "16px" }}>Tier Statistics</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <StatRow 
                icon="📈" 
                label="Growth" 
                value={`+${statistics.growthRate}%`} 
                subtitle="(30 days)" 
              />
              <StatRow 
                icon="🔄" 
                label="Retention" 
                value="92%" 
                subtitle="Coming soon" 
              />
              <StatRow 
                icon="⬆️" 
                label="Upgrade Rate" 
                value={`${statistics.upgradeRate}%`} 
                subtitle="To next tier" 
              />
              <StatRow 
                icon="💰" 
                label="Avg Order" 
                value="£156" 
                subtitle="Coming soon" 
              />
            </div>
          </div>

          {/* Upgrade Opportunities */}
          {upgradeOpportunities.length > 0 && (
            <div style={{
              backgroundColor: "white",
              border: "1px solid #e5e5e5",
              borderRadius: "8px",
              padding: "24px"
            }}>
              <h3 style={{ fontSize: "18px", marginBottom: "16px" }}>
                Close to {tier.displayName}
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {upgradeOpportunities.slice(0, 5).map((opp) => (
                  <div key={opp.customerId} style={{
                    padding: "12px",
                    backgroundColor: "#f9f9f9",
                    borderRadius: "6px"
                  }}>
                    <p style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: "500" }}>
                      {opp.customerEmail}
                    </p>
                    <p style={{ margin: 0, fontSize: "12px", color: "#666" }}>
                      {opp.percentageToNext}% complete • £{opp.remainingAmount.toFixed(2)} to go
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Activity */}
          <div style={{
            backgroundColor: "white",
            border: "1px solid #e5e5e5",
            borderRadius: "8px",
            padding: "24px"
          }}>
            <h3 style={{ fontSize: "18px", marginBottom: "16px" }}>
              Activity in {tier.displayName} Tier
            </h3>
            {recentActivity.length === 0 ? (
              <p style={{ fontSize: "14px", color: "#666" }}>No recent activity</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {recentActivity.slice(0, 5).map((activity, index) => (
                  <div key={index} style={{ fontSize: "14px" }}>
                    <p style={{ margin: "0 0 4px 0" }}>
                      {activity.customerEmail} joined
                    </p>
                    <p style={{ margin: 0, fontSize: "12px", color: "#666" }}>
                      {format(new Date(activity.timestamp), "MMM d, h:mm a")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Stat Item Component
function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ 
        fontSize: "14px", 
        color: "#666",
        marginBottom: "4px"
      }}>
        {label}
      </p>
      <p style={{ 
        fontSize: "24px", 
        fontWeight: "bold",
        margin: 0
      }}>
        {value}
      </p>
    </div>
  );
}

// Stat Row Component
function StatRow({ 
  icon, 
  label, 
  value, 
  subtitle 
}: { 
  icon: string; 
  label: string; 
  value: string; 
  subtitle?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <span style={{ fontSize: "20px" }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontSize: "14px", color: "#666" }}>{label}</p>
        <p style={{ margin: 0, fontSize: "16px", fontWeight: "500" }}>
          {value} {subtitle && <span style={{ fontSize: "12px", color: "#999" }}>{subtitle}</span>}
        </p>
      </div>
    </div>
  );
}