// app/routes/app.activity.tsx
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, useSearchParams } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getActivityLog, type ActivityFilter } from "../services/activity.server";
import { formatDistanceToNow, format } from "date-fns";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  
  const url = new URL(request.url);
  const filter: ActivityFilter = {
    type: url.searchParams.get('type') as ActivityFilter['type'] || undefined,
    customerId: url.searchParams.get('customerId') || undefined,
    page: parseInt(url.searchParams.get('page') || '1'),
    limit: parseInt(url.searchParams.get('limit') || '50')
  };

  const { activities, totalCount, totalPages } = await getActivityLog(filter);

  return json({ activities, totalCount, totalPages, currentPage: filter.page });
}

export default function ActivityLog() {
  const { activities, totalCount, totalPages, currentPage } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const updateFilter = (key: string, value: string | null) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    newParams.set('page', '1'); // Reset to first page
    setSearchParams(newParams);
  };

  const changePage = (page: number) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('page', page.toString());
    setSearchParams(newParams);
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'tier_upgrade':
        return '🎉';
      case 'tier_downgrade':
        return '📉';
      case 'cashback_earned':
        return '💰';
      case 'cashback_redeemed':
        return '🛍️';
      case 'new_customer':
        return '👋';
      case 'manual_assignment':
        return '✏️';
      default:
        return '📊';
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'tier_upgrade':
        return '#10B981';
      case 'tier_downgrade':
        return '#EF4444';
      case 'cashback_earned':
        return '#3B82F6';
      case 'cashback_redeemed':
        return '#8B5CF6';
      case 'new_customer':
        return '#F59E0B';
      case 'manual_assignment':
        return '#6B7280';
      default:
        return '#374151';
    }
  };

  return (
    <div style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        marginBottom: "24px"
      }}>
        <h1 style={{ fontSize: "28px", margin: 0 }}>Activity Log</h1>
        <Link 
          to="/app/dashboard" 
          style={{ 
            fontSize: "14px", 
            color: "#4F46E5",
            textDecoration: "none"
          }}
        >
          ← Back to Dashboard
        </Link>
      </div>

      {/* Filters */}
      <div style={{
        backgroundColor: "white",
        border: "1px solid #e5e5e5",
        borderRadius: "8px",
        padding: "16px",
        marginBottom: "24px"
      }}>
        <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: "14px", color: "#666", marginRight: "8px" }}>
              Type:
            </label>
            <select
              value={searchParams.get('type') || ''}
              onChange={(e) => updateFilter('type', e.target.value || null)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #e5e5e5",
                fontSize: "14px"
              }}
            >
              <option value="">All Types</option>
              <option value="tier_upgrade">Tier Upgrade</option>
              <option value="tier_downgrade">Tier Downgrade</option>
              <option value="cashback_earned">Cashback Earned</option>
              <option value="cashback_redeemed">Cashback Redeemed</option>
              <option value="new_customer">New Customer</option>
              <option value="manual_assignment">Manual Assignment</option>
            </select>
          </div>
          
          <div style={{ fontSize: "14px", color: "#666" }}>
            Showing {activities.length} of {totalCount} activities
          </div>
        </div>
      </div>

      {/* Activity List */}
      <div style={{
        backgroundColor: "white",
        border: "1px solid #e5e5e5",
        borderRadius: "8px",
        overflow: "hidden"
      }}>
        {activities.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#666" }}>
            No activities found
          </div>
        ) : (
          <div>
            {activities.map((activity, index) => (
              <div
                key={activity.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  padding: "16px 20px",
                  borderBottom: index < activities.length - 1 ? "1px solid #e5e5e5" : "none",
                  transition: "background-color 0.2s",
                  cursor: "pointer"
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f9f9f9"}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                onClick={() => {
                  if (activity.customerId) {
                    window.location.href = `/app/customers/${activity.customerId}`;
                  }
                }}
              >
                <span style={{ fontSize: "24px" }}>{getActivityIcon(activity.type)}</span>
                
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        fontSize: "12px",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        backgroundColor: getActivityColor(activity.type) + "20",
                        color: getActivityColor(activity.type),
                        fontWeight: "500"
                      }}
                    >
                      {activity.type.replace(/_/g, ' ').toUpperCase()}
                    </span>
                    <p style={{ margin: 0, fontSize: "14px" }}>
                      {activity.message}
                    </p>
                  </div>
                  
                  {activity.metadata && (
                    <div style={{ marginTop: "4px", fontSize: "13px", color: "#666" }}>
                      {activity.metadata.previousTier && activity.metadata.newTier && (
                        <span>
                          {activity.metadata.previousTier} → {activity.metadata.newTier}
                        </span>
                      )}
                      {activity.metadata.amount && (
                        <span>Amount: £{activity.metadata.amount.toFixed(2)}</span>
                      )}
                      {activity.metadata.orderId && (
                        <span> • Order: #{activity.metadata.orderId}</span>
                      )}
                    </div>
                  )}
                </div>
                
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "13px", color: "#666" }}>
                    {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                  </div>
                  <div style={{ fontSize: "12px", color: "#999" }}>
                    {format(new Date(activity.timestamp), 'MMM d, yyyy h:mm a')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "8px",
          marginTop: "24px"
        }}>
          <button
            onClick={() => changePage((currentPage || 1) - 1)}
            disabled={(currentPage || 1) === 1}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid #e5e5e5",
              backgroundColor: (currentPage || 1) === 1 ? "#f5f5f5" : "white",
              color: (currentPage || 1) === 1 ? "#999" : "#333",
              cursor: (currentPage || 1) === 1 ? "not-allowed" : "pointer",
              fontSize: "14px"
            }}
          >
            Previous
          </button>
          
          <span style={{ fontSize: "14px", color: "#666" }}>
            Page {currentPage} of {totalPages}
          </span>
          
          <button
            onClick={() => changePage((currentPage || 1) + 1)}
            disabled={currentPage === totalPages}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid #e5e5e5",
              backgroundColor: currentPage === totalPages ? "#f5f5f5" : "white",
              color: currentPage === totalPages ? "#999" : "#333",
              cursor: currentPage === totalPages ? "not-allowed" : "pointer",
              fontSize: "14px"
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}