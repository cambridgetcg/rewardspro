// app/routes/app.import-orders.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation, useActionData, useSubmit, useFetcher } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { migrateTransactions, getMigrationStatus } from "../services/transaction-migration.server";
import prisma from "../db.server";
import { useEffect, useState } from "react";

interface LoaderData {
  shopDomain: string;
  hasReadAllOrders: boolean;
  currentImport: {
    id: string;
    status: string;
    totalRecords: number;
    processedRecords: number;
    failedRecords: number;
    startedAt: string | null;
    completedAt: string | null;
    errors: string[] | null;
  } | null;
  stats: {
    existingTransactions: number;
    existingCustomers: number;
    oldestTransaction: string | null;
    newestTransaction: string | null;
  };
}

interface ActionData {
  success?: boolean;
  error?: string;
  migrationJob?: {
    id: string;
    status: string;
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  
  // Check if we have read_all_orders scope
  let hasReadAllOrders = false;
  try {
    const scopeCheckQuery = `
      query CheckScopes {
        app: currentAppInstallation {
          accessScopes {
            handle
          }
        }
      }
    `;
    
    const response = await admin.graphql(scopeCheckQuery);
    const data = await response.json();
    
    hasReadAllOrders = data.data?.app?.accessScopes?.some(
      (scope: any) => scope.handle === 'read_all_orders'
    ) || false;
  } catch (error) {
    console.error('Error checking scopes:', error);
  }
  
  // Get current migration status
  const currentImport = await getMigrationStatus(session.shop);
  
  // Get existing data stats
  const [transactionCount, customerCount, oldestTransaction, newestTransaction] = await Promise.all([
    prisma.cashbackTransaction.count({ where: { shopDomain: session.shop } }),
    prisma.customer.count({ where: { shopDomain: session.shop } }),
    prisma.cashbackTransaction.findFirst({
      where: { shopDomain: session.shop },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true }
    }),
    prisma.cashbackTransaction.findFirst({
      where: { shopDomain: session.shop },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    })
  ]);
  
  return json<LoaderData>({
    shopDomain: session.shop,
    hasReadAllOrders,
    currentImport: currentImport ? {
      id: currentImport.id,
      status: currentImport.status,
      totalRecords: currentImport.totalRecords,
      processedRecords: currentImport.processedRecords,
      failedRecords: currentImport.failedRecords,
      startedAt: currentImport.startedAt?.toISOString() || null,
      completedAt: currentImport.completedAt?.toISOString() || null,
      errors: currentImport.errors as string[] | null
    } : null,
    stats: {
      existingTransactions: transactionCount,
      existingCustomers: customerCount,
      oldestTransaction: oldestTransaction?.createdAt.toISOString() || null,
      newestTransaction: newestTransaction?.createdAt.toISOString() || null
    }
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get('_action') as string;
  
  if (action === 'start-import') {
    try {
      const importType = formData.get('importType') as string;
      const customStartDate = formData.get('customStartDate') as string;
      
      let startDate: string | undefined;
      
      // Calculate start date based on import type
      const now = new Date();
      switch (importType) {
        case '3months':
          startDate = new Date(now.setMonth(now.getMonth() - 3)).toISOString().split('T')[0];
          break;
        case '6months':
          startDate = new Date(now.setMonth(now.getMonth() - 6)).toISOString().split('T')[0];
          break;
        case '12months':
          startDate = new Date(now.setFullYear(now.getFullYear() - 1)).toISOString().split('T')[0];
          break;
        case 'custom':
          startDate = customStartDate;
          break;
        case 'all':
        default:
          startDate = undefined; // No date filter for all orders
          break;
      }
      
      const migrationJob = await migrateTransactions({
        shopDomain: session.shop,
        admin,
        options: {
          startDate,
          batchSize: 250
        }
      });
      
      return json<ActionData>({
        success: true,
        migrationJob: {
          id: migrationJob.id,
          status: migrationJob.status
        }
      });
      
    } catch (error) {
      console.error('Import error:', error);
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start import'
      });
    }
  }
  
  if (action === 'cancel-import') {
    try {
      const jobId = formData.get('jobId') as string;
      
      await prisma.migrationHistory.update({
        where: { id: jobId },
        data: {
          status: 'CANCELLED',
          completedAt: new Date()
        }
      });
      
      return json<ActionData>({ success: true });
    } catch (error) {
      return json<ActionData>({
        success: false,
        error: 'Failed to cancel import'
      });
    }
  }
  
  return json<ActionData>({ success: false, error: 'Invalid action' });
}

export default function ImportOrders() {
  const { shopDomain, hasReadAllOrders, currentImport, stats } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const submit = useSubmit();
  const [importType, setImportType] = useState('all');
  const [customDate, setCustomDate] = useState('');
  
  const isSubmitting = navigation.state === 'submitting';
  
  // Auto-refresh status when import is running
  useEffect(() => {
    if (currentImport && ['PENDING', 'PROCESSING'].includes(currentImport.status)) {
      const interval = setInterval(() => {
        fetcher.load('/app/import-orders');
      }, 3000); // Refresh every 3 seconds
      
      return () => clearInterval(interval);
    }
  }, [currentImport?.status]);
  
  // Calculate progress percentage
  const progressPercentage = currentImport && currentImport.totalRecords > 0
    ? Math.round((currentImport.processedRecords / currentImport.totalRecords) * 100)
    : 0;
  
  const styles = {
    container: {
      maxWidth: '900px',
      margin: '0 auto',
      padding: '40px 24px'
    },
    header: {
      marginBottom: '32px',
      textAlign: 'center' as const
    },
    title: {
      fontSize: '32px',
      fontWeight: '700',
      marginBottom: '12px',
      color: '#1a1a1a'
    },
    subtitle: {
      fontSize: '18px',
      color: '#666',
      marginBottom: '24px'
    },
    warningBanner: {
      backgroundColor: '#fef3c7',
      border: '1px solid #f59e0b',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '24px',
      fontSize: '14px',
      color: '#92400e'
    },
    successBanner: {
      backgroundColor: '#d1fae5',
      border: '1px solid #10b981',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '24px',
      fontSize: '14px',
      color: '#065f46'
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '16px',
      marginBottom: '32px'
    },
    statCard: {
      backgroundColor: '#f8f9fa',
      padding: '24px',
      borderRadius: '12px',
      textAlign: 'center' as const,
      border: '1px solid #e5e7eb'
    },
    statValue: {
      fontSize: '28px',
      fontWeight: '700',
      color: '#3b82f6',
      marginBottom: '8px'
    },
    statLabel: {
      fontSize: '14px',
      color: '#666',
      fontWeight: '500'
    },
    importSection: {
      backgroundColor: 'white',
      padding: '32px',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
    },
    sectionTitle: {
      fontSize: '20px',
      fontWeight: '600',
      marginBottom: '24px',
      color: '#1a1a1a'
    },
    radioGroup: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '12px',
      marginBottom: '24px'
    },
    radioOption: {
      display: 'flex',
      alignItems: 'center',
      padding: '16px',
      border: '2px solid #e5e7eb',
      borderRadius: '8px',
      cursor: 'pointer',
      transition: 'all 0.2s',
      backgroundColor: 'white'
    },
    radioOptionSelected: {
      borderColor: '#3b82f6',
      backgroundColor: '#eff6ff'
    },
    radioInput: {
      marginRight: '12px',
      width: '20px',
      height: '20px',
      cursor: 'pointer'
    },
    radioLabel: {
      fontSize: '16px',
      fontWeight: '500',
      color: '#1a1a1a',
      cursor: 'pointer',
      flex: 1
    },
    radioDescription: {
      fontSize: '14px',
      color: '#666',
      marginTop: '4px'
    },
    dateInput: {
      padding: '12px 16px',
      border: '2px solid #e5e7eb',
      borderRadius: '8px',
      fontSize: '16px',
      width: '100%',
      marginTop: '12px',
      backgroundColor: '#f9fafb'
    },
    button: {
      padding: '14px 28px',
      backgroundColor: '#3b82f6',
      color: 'white',
      border: 'none',
      borderRadius: '8px',
      fontSize: '16px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'all 0.2s',
      width: '100%'
    },
    buttonDisabled: {
      backgroundColor: '#9ca3af',
      cursor: 'not-allowed'
    },
    buttonCancel: {
      backgroundColor: '#ef4444'
    },
    progressSection: {
      backgroundColor: '#f3f4f6',
      padding: '24px',
      borderRadius: '8px',
      marginTop: '24px'
    },
    progressBar: {
      width: '100%',
      height: '24px',
      backgroundColor: '#e5e7eb',
      borderRadius: '12px',
      overflow: 'hidden',
      marginBottom: '16px'
    },
    progressFill: {
      height: '100%',
      backgroundColor: '#3b82f6',
      transition: 'width 0.3s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      fontSize: '14px',
      fontWeight: '600'
    },
    progressStats: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '14px',
      color: '#666'
    },
    errorList: {
      backgroundColor: '#fee2e2',
      border: '1px solid #fca5a5',
      borderRadius: '8px',
      padding: '16px',
      marginTop: '16px',
      maxHeight: '200px',
      overflow: 'auto'
    },
    errorItem: {
      fontSize: '13px',
      color: '#991b1b',
      marginBottom: '4px'
    }
  };
  
  const importOptions = [
    {
      value: 'all',
      label: 'All Orders',
      description: hasReadAllOrders 
        ? 'Import all historical orders from your store' 
        : 'Import all orders (limited to last 60 days without full access)'
    },
    {
      value: '12months',
      label: 'Last 12 Months',
      description: 'Import orders from the past year'
    },
    {
      value: '6months',
      label: 'Last 6 Months',
      description: 'Import orders from the past 6 months'
    },
    {
      value: '3months',
      label: 'Last 3 Months',
      description: 'Import orders from the past 3 months'
    },
    {
      value: 'custom',
      label: 'Custom Date Range',
      description: 'Choose a specific start date for import'
    }
  ];
  
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Import Your Orders</h1>
        <p style={styles.subtitle}>
          Import your Shopify orders to start tracking cashback rewards for your customers
        </p>
      </div>
      
      {/* Access scope banner */}
      {hasReadAllOrders ? (
        <div style={styles.successBanner}>
          ✅ <strong>Full Access Enabled:</strong> Your app has access to all historical orders. 
          You can import your complete order history.
        </div>
      ) : (
        <div style={styles.warningBanner}>
          ⚠️ <strong>Limited Access:</strong> Your app can only access orders from the last 60 days. 
          To import older orders, you'll need to request the "read_all_orders" scope from Shopify.
        </div>
      )}
      
      {/* Current stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.existingTransactions.toLocaleString()}</div>
          <div style={styles.statLabel}>Imported Orders</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.existingCustomers.toLocaleString()}</div>
          <div style={styles.statLabel}>Total Customers</div>
        </div>
        {stats.oldestTransaction && (
          <div style={styles.statCard}>
            <div style={styles.statValue}>
              {new Date(stats.oldestTransaction).toLocaleDateString()}
            </div>
            <div style={styles.statLabel}>Oldest Order</div>
          </div>
        )}
        {stats.newestTransaction && (
          <div style={styles.statCard}>
            <div style={styles.statValue}>
              {new Date(stats.newestTransaction).toLocaleDateString()}
            </div>
            <div style={styles.statLabel}>Newest Order</div>
          </div>
        )}
      </div>
      
      {/* Import section */}
      <div style={styles.importSection}>
        {currentImport && ['PENDING', 'PROCESSING'].includes(currentImport.status) ? (
          // Show progress if import is running
          <>
            <h2 style={styles.sectionTitle}>Import in Progress</h2>
            <div style={styles.progressSection}>
              <div style={styles.progressBar}>
                <div 
                  style={{
                    ...styles.progressFill,
                    width: `${progressPercentage}%`
                  }}
                >
                  {progressPercentage > 10 && `${progressPercentage}%`}
                </div>
              </div>
              <div style={styles.progressStats}>
                <span>
                  Status: <strong>{currentImport.status}</strong>
                </span>
                <span>
                  Processed: <strong>{currentImport.processedRecords.toLocaleString()}</strong> / {currentImport.totalRecords.toLocaleString() || '?'}
                </span>
                {currentImport.failedRecords > 0 && (
                  <span>
                    Failed: <strong style={{ color: '#ef4444' }}>{currentImport.failedRecords.toLocaleString()}</strong>
                  </span>
                )}
              </div>
              {currentImport.startedAt && (
                <div style={{ marginTop: '12px', fontSize: '14px', color: '#666' }}>
                  Started: {new Date(currentImport.startedAt).toLocaleString()}
                </div>
              )}
            </div>
            
            {currentImport.errors && currentImport.errors.length > 0 && (
              <div style={styles.errorList}>
                <strong style={{ marginBottom: '8px', display: 'block' }}>Errors:</strong>
                {currentImport.errors.slice(0, 10).map((error, index) => (
                  <div key={index} style={styles.errorItem}>• {error}</div>
                ))}
                {currentImport.errors.length > 10 && (
                  <div style={styles.errorItem}>... and {currentImport.errors.length - 10} more</div>
                )}
              </div>
            )}
            
            <Form method="post" style={{ marginTop: '24px' }}>
              <input type="hidden" name="_action" value="cancel-import" />
              <input type="hidden" name="jobId" value={currentImport.id} />
              <button
                type="submit"
                style={{
                  ...styles.button,
                  ...styles.buttonCancel
                }}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Cancelling...' : 'Cancel Import'}
              </button>
            </Form>
          </>
        ) : (
          // Show import options
          <>
            <h2 style={styles.sectionTitle}>Choose Import Range</h2>
            <Form method="post">
              <input type="hidden" name="_action" value="start-import" />
              
              <div style={styles.radioGroup}>
                {importOptions.map((option) => (
                  <label
                    key={option.value}
                    style={{
                      ...styles.radioOption,
                      ...(importType === option.value ? styles.radioOptionSelected : {})
                    }}
                  >
                    <input
                      type="radio"
                      name="importType"
                      value={option.value}
                      checked={importType === option.value}
                      onChange={(e) => setImportType(e.target.value)}
                      style={styles.radioInput}
                    />
                    <div>
                      <div style={styles.radioLabel}>{option.label}</div>
                      <div style={styles.radioDescription}>{option.description}</div>
                    </div>
                  </label>
                ))}
              </div>
              
              {importType === 'custom' && (
                <input
                  type="date"
                  name="customStartDate"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  required={importType === 'custom'}
                  style={styles.dateInput}
                  placeholder="Select start date"
                />
              )}
              
              {currentImport?.status === 'COMPLETED' && (
                <div style={{
                  ...styles.successBanner,
                  marginTop: '24px',
                  marginBottom: '16px'
                }}>
                  ✅ Last import completed successfully on {new Date(currentImport.completedAt!).toLocaleString()}
                  <br />
                  Processed: {currentImport.processedRecords.toLocaleString()} orders
                </div>
              )}
              
              {currentImport?.status === 'FAILED' && (
                <div style={{
                  ...styles.warningBanner,
                  marginTop: '24px',
                  marginBottom: '16px',
                  backgroundColor: '#fee2e2',
                  borderColor: '#ef4444',
                  color: '#991b1b'
                }}>
                  ❌ Last import failed. Please try again or contact support if the issue persists.
                </div>
              )}
              
              <button
                type="submit"
                disabled={isSubmitting || (importType === 'custom' && !customDate)}
                style={{
                  ...styles.button,
                  ...(isSubmitting || (importType === 'custom' && !customDate) ? styles.buttonDisabled : {})
                }}
              >
                {isSubmitting ? 'Starting Import...' : 'Start Import'}
              </button>
            </Form>
          </>
        )}
      </div>
      
      {/* Help section */}
      <div style={{ marginTop: '32px', padding: '24px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>
          Important Notes:
        </h3>
        <ul style={{ marginLeft: '20px', lineHeight: '1.8', fontSize: '14px', color: '#666' }}>
          <li>Only <strong>paid orders</strong> will be imported</li>
          <li>Orders without customer information (guest checkouts) will be skipped</li>
          <li>The import process runs in the background - you can navigate away and check back later</li>
          <li>Duplicate orders will be automatically skipped</li>
          <li>Large stores may take several minutes to complete the import</li>
        </ul>
      </div>
    </div>
  );
}