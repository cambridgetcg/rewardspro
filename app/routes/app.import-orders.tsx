// app/routes/app.import-orders.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation, useActionData, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { TransactionStatus, MigrationStatus } from "@prisma/client";
import { useState, useEffect } from "react";
import { assignInitialTier, evaluateCustomerTier } from "../services/customer-tier.server";
import { processOrdersImport, syncStoreCreditToShopify } from "../services/order-import.server";

interface LoaderData {
  shopDomain: string;
  stats: {
    totalOrders: number;
    totalCustomers: number;
    lastImportDate?: string;
    oldestOrderDate?: string;
  };
  presetDates: {
    oneMonth: string;
    threeMonths: string;
    sixMonths: string;
    oneYear: string;
  };
  hasActiveTiers: boolean;
}

interface ActionData {
  success: boolean;
  error?: string;
  importResult?: {
    totalOrders: number;
    processedOrders: number;
    newCustomers: number;
    newTransactions: number;
    skippedTransactions: number;
    updatedCustomers: number;
    errors: string[];
    tiersUpdated: number;
    duration: number;
  };
  progress?: {
    current: number;
    total: number;
    message: string;
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  // Get statistics
  const [totalOrders, totalCustomers, lastMigration, oldestOrder, activeTiers] = await Promise.all([
    prisma.cashbackTransaction.count({ where: { shopDomain: session.shop } }),
    prisma.customer.count({ where: { shopDomain: session.shop } }),
    prisma.migrationHistory.findFirst({
      where: { 
        shopDomain: session.shop,
        status: 'COMPLETED'
      },
      orderBy: { completedAt: 'desc' }
    }),
    prisma.cashbackTransaction.findFirst({
      where: { shopDomain: session.shop },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.tier.count({
      where: { shopDomain: session.shop, isActive: true }
    })
  ]);
  
  // Calculate preset dates
  const now = new Date();
  const oneMonth = new Date(now);
  oneMonth.setMonth(oneMonth.getMonth() - 1);
  
  const threeMonths = new Date(now);
  threeMonths.setMonth(threeMonths.getMonth() - 3);
  
  const sixMonths = new Date(now);
  sixMonths.setMonth(sixMonths.getMonth() - 6);
  
  const oneYear = new Date(now);
  oneYear.setFullYear(oneYear.getFullYear() - 1);
  
  return json<LoaderData>({
    shopDomain: session.shop,
    stats: {
      totalOrders,
      totalCustomers,
      lastImportDate: lastMigration?.completedAt?.toISOString(),
      oldestOrderDate: oldestOrder?.createdAt.toISOString()
    },
    presetDates: {
      oneMonth: oneMonth.toISOString().split('T')[0],
      threeMonths: threeMonths.toISOString().split('T')[0],
      sixMonths: sixMonths.toISOString().split('T')[0],
      oneYear: oneYear.toISOString().split('T')[0]
    },
    hasActiveTiers: activeTiers > 0
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);  // admin is the GraphQL client
  const formData = await request.formData();
  const action = formData.get('_action') as string;
  
  if (action === 'import') {
    const startTime = Date.now();
    
    try {
      const dateRange = formData.get('dateRange') as string;
      const customStartDate = formData.get('customStartDate') as string;
      const customEndDate = formData.get('customEndDate') as string;
      const importType = formData.get('importType') as string;
      const updateTiers = formData.get('updateTiers') === 'true';
      
      let startDate: Date;
      let endDate = new Date();
      
      // Determine date range
      switch (dateRange) {
        case '1month':
          startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case '3months':
          startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 3);
          break;
        case '6months':
          startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 6);
          break;
        case '1year':
          startDate = new Date();
          startDate.setFullYear(startDate.getFullYear() - 1);
          break;
        case 'custom':
          startDate = new Date(customStartDate);
          if (customEndDate) {
            endDate = new Date(customEndDate);
          }
          break;
        case 'all':
          startDate = new Date('2000-01-01'); // Far past date to get all orders
          break;
        default:
          throw new Error('Invalid date range');
      }
      
      // Process the import using the admin client from authenticate
      const result = await processOrdersImport({
        shopDomain: session.shop,
        admin,  // This is the GraphQL client from authenticate.admin
        startDate,
        endDate,
        importType: importType as 'new' | 'all',
        updateTiers
      });
      
      const duration = Date.now() - startTime;
      
      // Log the import
      await prisma.migrationHistory.create({
        data: {
          shopDomain: session.shop,
          status: result.errors.length > 0 ? 'COMPLETED' : 'COMPLETED',
          totalRecords: result.totalOrders,
          processedRecords: result.processedOrders,
          failedRecords: result.totalOrders - result.processedOrders,
          errors: result.errors.length > 0 ? result.errors : undefined,
          metadata: {
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            importType,
            updateTiers,
            newCustomers: result.newCustomers,
            newTransactions: result.newTransactions,
            skippedTransactions: result.skippedTransactions,
            tiersUpdated: result.tiersUpdated
          },
          startedAt: new Date(Date.now() - duration),
          completedAt: new Date()
        }
      });
      
      return json<ActionData>({
        success: true,
        importResult: {
          ...result,
          duration
        }
      });
      
    } catch (error) {
      console.error('Import error:', error);
      
      // Log failed import
      await prisma.migrationHistory.create({
        data: {
          shopDomain: session.shop,
          status: 'FAILED',
          totalRecords: 0,
          processedRecords: 0,
          failedRecords: 0,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error',
            startDate: new Date().toISOString(),
            endDate: new Date().toISOString()
          },
          startedAt: new Date(Date.now() - (Date.now() - startTime)),
          completedAt: new Date()
        }
      });
      
      return json<ActionData>({
        success: false,
        error: error instanceof Error ? error.message : 'Import failed'
      });
    }
  }
  
  if (action === 'check-progress') {
    // This would be used for polling progress in a real implementation
    // For now, we'll just return a placeholder
    return json<ActionData>({
      success: true,
      progress: {
        current: 0,
        total: 0,
        message: 'Checking progress...'
      }
    });
  }
  
  return json<ActionData>({ success: false, error: 'Invalid action' });
}

export default function ImportOrders() {
  const { shopDomain, stats, presetDates, hasActiveTiers } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [dateRange, setDateRange] = useState('3months');
  const [importType, setImportType] = useState('new');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isSubmitting = navigation.state === 'submitting';
  
  const styles = {
    container: {
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '32px 24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#1a1a1a',
      backgroundColor: '#ffffff',
      minHeight: '100vh'
    },
    header: {
      marginBottom: '32px'
    },
    title: {
      fontSize: '28px',
      fontWeight: '600',
      margin: '0 0 8px 0',
      color: '#1a1a1a'
    },
    subtitle: {
      fontSize: '16px',
      color: '#666',
      margin: 0,
      fontWeight: '400'
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '20px',
      marginBottom: '32px'
    },
    statCard: {
      backgroundColor: '#f8f9fa',
      padding: '20px',
      borderRadius: '8px',
      textAlign: 'center' as const
    },
    statValue: {
      fontSize: '28px',
      fontWeight: '600',
      margin: '0 0 4px 0',
      color: '#1a1a1a'
    },
    statLabel: {
      fontSize: '14px',
      color: '#666',
      margin: 0
    },
    warningBanner: {
      backgroundColor: '#fef3c7',
      border: '1px solid #f59e0b',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '24px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px'
    },
    warningIcon: {
      fontSize: '20px',
      color: '#d97706',
      marginTop: '2px'
    },
    warningContent: {
      flex: 1
    },
    warningTitle: {
      fontWeight: '600',
      marginBottom: '4px',
      color: '#92400e'
    },
    warningText: {
      fontSize: '14px',
      color: '#92400e',
      margin: 0
    },
    formSection: {
      backgroundColor: 'white',
      padding: '24px',
      borderRadius: '8px',
      border: '1px solid #e0e0e0',
      marginBottom: '24px'
    },
    sectionTitle: {
      fontSize: '20px',
      fontWeight: '600',
      marginBottom: '20px',
      color: '#1a1a1a'
    },
    formGroup: {
      marginBottom: '20px'
    },
    label: {
      display: 'block',
      fontSize: '14px',
      fontWeight: '500',
      marginBottom: '8px',
      color: '#333'
    },
    radioGroup: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '12px'
    },
    radioOption: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '8px',
      padding: '12px',
      border: '1px solid #e0e0e0',
      borderRadius: '6px',
      cursor: 'pointer',
      transition: 'all 0.2s'
    },
    radioOptionSelected: {
      borderColor: '#0066cc',
      backgroundColor: '#f0f7ff'
    },
    radioInput: {
      marginTop: '2px'
    },
    radioContent: {
      flex: 1
    },
    radioLabel: {
      fontWeight: '500',
      marginBottom: '2px',
      display: 'block'
    },
    radioDescription: {
      fontSize: '13px',
      color: '#666',
      margin: 0
    },
    dateInputGroup: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '16px',
      marginTop: '12px'
    },
    input: {
      width: '100%',
      padding: '8px 12px',
      border: '1px solid #e0e0e0',
      borderRadius: '6px',
      fontSize: '14px',
      backgroundColor: 'white',
      transition: 'border-color 0.2s',
      outline: 'none'
    },
    checkbox: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '16px'
    },
    advancedToggle: {
      background: 'none',
      border: 'none',
      color: '#0066cc',
      cursor: 'pointer',
      fontSize: '14px',
      textDecoration: 'underline',
      padding: 0,
      marginBottom: '16px'
    },
    button: {
      padding: '12px 24px',
      backgroundColor: '#1a1a1a',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '16px',
      fontWeight: '500',
      transition: 'opacity 0.2s'
    },
    buttonDisabled: {
      opacity: 0.6,
      cursor: 'not-allowed'
    },
    resultSection: {
      backgroundColor: 'white',
      padding: '24px',
      borderRadius: '8px',
      border: '1px solid #e0e0e0'
    },
    successMessage: {
      backgroundColor: '#e8f5e9',
      color: '#2e7d32',
      padding: '16px',
      borderRadius: '6px',
      marginBottom: '20px',
      border: '1px solid #c8e6c9'
    },
    errorMessage: {
      backgroundColor: '#ffebee',
      color: '#c62828',
      padding: '16px',
      borderRadius: '6px',
      marginBottom: '20px',
      border: '1px solid #ffcdd2'
    },
    resultGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: '16px',
      marginBottom: '20px'
    },
    resultCard: {
      textAlign: 'center' as const
    },
    resultValue: {
      fontSize: '24px',
      fontWeight: '600',
      color: '#10b981',
      marginBottom: '4px'
    },
    resultLabel: {
      fontSize: '13px',
      color: '#666'
    },
    errorsList: {
      backgroundColor: '#f8f9fa',
      padding: '16px',
      borderRadius: '6px',
      marginTop: '16px',
      maxHeight: '200px',
      overflowY: 'auto' as const
    },
    progressBar: {
      width: '100%',
      height: '8px',
      backgroundColor: '#e0e0e0',
      borderRadius: '4px',
      overflow: 'hidden',
      marginBottom: '8px'
    },
    progressFill: {
      height: '100%',
      backgroundColor: '#10b981',
      transition: 'width 0.3s ease'
    },
    helpText: {
      fontSize: '13px',
      color: '#666',
      marginTop: '8px'
    }
  };
  
  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Import Orders</h1>
        <p style={styles.subtitle}>Import historical orders and calculate cashback</p>
      </div>
      
      {/* Stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <h3 style={styles.statValue}>{stats.totalOrders}</h3>
          <p style={styles.statLabel}>Total Orders</p>
        </div>
        <div style={styles.statCard}>
          <h3 style={styles.statValue}>{stats.totalCustomers}</h3>
          <p style={styles.statLabel}>Total Customers</p>
        </div>
        <div style={styles.statCard}>
          <h3 style={styles.statValue}>
            {stats.lastImportDate ? new Date(stats.lastImportDate).toLocaleDateString() : 'Never'}
          </h3>
          <p style={styles.statLabel}>Last Import</p>
        </div>
        <div style={styles.statCard}>
          <h3 style={styles.statValue}>
            {stats.oldestOrderDate ? new Date(stats.oldestOrderDate).toLocaleDateString() : 'N/A'}
          </h3>
          <p style={styles.statLabel}>Oldest Order</p>
        </div>
      </div>
      
      {/* Warning Banner */}
      {!hasActiveTiers && (
        <div style={styles.warningBanner}>
          <span style={styles.warningIcon}>⚠️</span>
          <div style={styles.warningContent}>
            <div style={styles.warningTitle}>No Active Tiers</div>
            <p style={styles.warningText}>
              Please set up at least one active tier before importing orders. 
              Customers will be assigned to the default tier during import.
            </p>
          </div>
        </div>
      )}
      
      {/* Import Form */}
      <Form method="post">
        <input type="hidden" name="_action" value="import" />
        
        <div style={styles.formSection}>
          <h2 style={styles.sectionTitle}>Import Settings</h2>
          
          {/* Date Range Selection */}
          <div style={styles.formGroup}>
            <label style={styles.label}>Select Date Range</label>
            <div style={styles.radioGroup}>
              <label style={{
                ...styles.radioOption,
                ...(dateRange === '1month' ? styles.radioOptionSelected : {})
              }}>
                <input
                  type="radio"
                  name="dateRange"
                  value="1month"
                  checked={dateRange === '1month'}
                  onChange={(e) => setDateRange(e.target.value)}
                  style={styles.radioInput}
                />
                <div style={styles.radioContent}>
                  <span style={styles.radioLabel}>Last Month</span>
                  <p style={styles.radioDescription}>Import orders from the last 30 days</p>
                </div>
              </label>
              
              <label style={{
                ...styles.radioOption,
                ...(dateRange === '3months' ? styles.radioOptionSelected : {})
              }}>
                <input
                  type="radio"
                  name="dateRange"
                  value="3months"
                  checked={dateRange === '3months'}
                  onChange={(e) => setDateRange(e.target.value)}
                  style={styles.radioInput}
                />
                <div style={styles.radioContent}>
                  <span style={styles.radioLabel}>Last 3 Months</span>
                  <p style={styles.radioDescription}>Import orders from the last 90 days</p>
                </div>
              </label>
              
              <label style={{
                ...styles.radioOption,
                ...(dateRange === '6months' ? styles.radioOptionSelected : {})
              }}>
                <input
                  type="radio"
                  name="dateRange"
                  value="6months"
                  checked={dateRange === '6months'}
                  onChange={(e) => setDateRange(e.target.value)}
                  style={styles.radioInput}
                />
                <div style={styles.radioContent}>
                  <span style={styles.radioLabel}>Last 6 Months</span>
                  <p style={styles.radioDescription}>Import orders from the last 180 days</p>
                </div>
              </label>
              
              <label style={{
                ...styles.radioOption,
                ...(dateRange === '1year' ? styles.radioOptionSelected : {})
              }}>
                <input
                  type="radio"
                  name="dateRange"
                  value="1year"
                  checked={dateRange === '1year'}
                  onChange={(e) => setDateRange(e.target.value)}
                  style={styles.radioInput}
                />
                <div style={styles.radioContent}>
                  <span style={styles.radioLabel}>Last Year</span>
                  <p style={styles.radioDescription}>Import orders from the last 365 days</p>
                </div>
              </label>
              
              <label style={{
                ...styles.radioOption,
                ...(dateRange === 'all' ? styles.radioOptionSelected : {})
              }}>
                <input
                  type="radio"
                  name="dateRange"
                  value="all"
                  checked={dateRange === 'all'}
                  onChange={(e) => setDateRange(e.target.value)}
                  style={styles.radioInput}
                />
                <div style={styles.radioContent}>
                  <span style={styles.radioLabel}>All Time</span>
                  <p style={styles.radioDescription}>Import all historical orders (may take longer)</p>
                </div>
              </label>
              
              <label style={{
                ...styles.radioOption,
                ...(dateRange === 'custom' ? styles.radioOptionSelected : {})
              }}>
                <input
                  type="radio"
                  name="dateRange"
                  value="custom"
                  checked={dateRange === 'custom'}
                  onChange={(e) => setDateRange(e.target.value)}
                  style={styles.radioInput}
                />
                <div style={styles.radioContent}>
                  <span style={styles.radioLabel}>Custom Range</span>
                  <p style={styles.radioDescription}>Specify exact start and end dates</p>
                </div>
              </label>
            </div>
            
            {dateRange === 'custom' && (
              <div style={styles.dateInputGroup}>
                <div>
                  <label style={{ ...styles.label, fontSize: '13px', marginBottom: '4px' }}>
                    Start Date
                  </label>
                  <input
                    type="date"
                    name="customStartDate"
                    required
                    style={styles.input}
                    defaultValue={presetDates.threeMonths}
                  />
                </div>
                <div>
                  <label style={{ ...styles.label, fontSize: '13px', marginBottom: '4px' }}>
                    End Date (Optional)
                  </label>
                  <input
                    type="date"
                    name="customEndDate"
                    style={styles.input}
                  />
                  <p style={styles.helpText}>Leave empty to import until today</p>
                </div>
              </div>
            )}
          </div>
          
          {/* Advanced Options */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={styles.advancedToggle}
          >
            {showAdvanced ? 'Hide' : 'Show'} Advanced Options
          </button>
          
          {showAdvanced && (
            <>
              {/* Import Type */}
              <div style={styles.formGroup}>
                <label style={styles.label}>Import Type</label>
                <div style={styles.radioGroup}>
                  <label style={{
                    ...styles.radioOption,
                    ...(importType === 'new' ? styles.radioOptionSelected : {})
                  }}>
                    <input
                      type="radio"
                      name="importType"
                      value="new"
                      checked={importType === 'new'}
                      onChange={(e) => setImportType(e.target.value)}
                      style={styles.radioInput}
                    />
                    <div style={styles.radioContent}>
                      <span style={styles.radioLabel}>New Orders Only</span>
                      <p style={styles.radioDescription}>
                        Skip orders that have already been imported (recommended)
                      </p>
                    </div>
                  </label>
                  
                  <label style={{
                    ...styles.radioOption,
                    ...(importType === 'all' ? styles.radioOptionSelected : {})
                  }}>
                    <input
                      type="radio"
                      name="importType"
                      value="all"
                      checked={importType === 'all'}
                      onChange={(e) => setImportType(e.target.value)}
                      style={styles.radioInput}
                    />
                    <div style={styles.radioContent}>
                      <span style={styles.radioLabel}>All Orders</span>
                      <p style={styles.radioDescription}>
                        Re-import all orders in range (updates existing records)
                      </p>
                    </div>
                  </label>
                </div>
              </div>
              
              {/* Update Tiers Option */}
              <label style={styles.checkbox}>
                <input
                  type="checkbox"
                  name="updateTiers"
                  value="true"
                  defaultChecked
                />
                <span>Automatically update customer tiers after import</span>
              </label>
            </>
          )}
          
          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !hasActiveTiers}
            style={{
              ...styles.button,
              marginTop: '24px',
              ...(isSubmitting || !hasActiveTiers ? styles.buttonDisabled : {})
            }}
          >
            {isSubmitting ? 'Importing Orders...' : 'Start Import'}
          </button>
        </div>
      </Form>
      
      {/* Progress Indicator */}
      {isSubmitting && (
        <div style={styles.formSection}>
          <h2 style={styles.sectionTitle}>Import Progress</h2>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: '30%' }} />
          </div>
          <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>
            Processing orders... This may take a few minutes for large imports.
          </p>
        </div>
      )}
      
      {/* Results */}
      {actionData && (
        <div style={styles.resultSection}>
          <h2 style={styles.sectionTitle}>Import Results</h2>
          
          {actionData.success && actionData.importResult ? (
            <>
              <div style={styles.successMessage}>
                ✅ Import completed successfully in {(actionData.importResult.duration / 1000).toFixed(1)} seconds
              </div>
              
              <div style={styles.resultGrid}>
                <div style={styles.resultCard}>
                  <div style={styles.resultValue}>{actionData.importResult.totalOrders}</div>
                  <div style={styles.resultLabel}>Orders Found</div>
                </div>
                <div style={styles.resultCard}>
                  <div style={styles.resultValue}>{actionData.importResult.processedOrders}</div>
                  <div style={styles.resultLabel}>Orders Processed</div>
                </div>
                <div style={styles.resultCard}>
                  <div style={styles.resultValue}>{actionData.importResult.newCustomers}</div>
                  <div style={styles.resultLabel}>New Customers</div>
                </div>
                <div style={styles.resultCard}>
                  <div style={styles.resultValue}>{actionData.importResult.newTransactions}</div>
                  <div style={styles.resultLabel}>New Transactions</div>
                </div>
                <div style={styles.resultCard}>
                  <div style={styles.resultValue}>{actionData.importResult.skippedTransactions}</div>
                  <div style={styles.resultLabel}>Skipped (Duplicates)</div>
                </div>
                <div style={styles.resultCard}>
                  <div style={styles.resultValue}>{actionData.importResult.updatedCustomers}</div>
                  <div style={styles.resultLabel}>Updated Customers</div>
                </div>
                <div style={styles.resultCard}>
                  <div style={styles.resultValue}>{actionData.importResult.tiersUpdated}</div>
                  <div style={styles.resultLabel}>Tiers Updated</div>
                </div>
              </div>
              
              {actionData.importResult.errors.length > 0 && (
                <>
                  <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>
                    Errors ({actionData.importResult.errors.length})
                  </h3>
                  <div style={styles.errorsList}>
                    {actionData.importResult.errors.map((error, index) => (
                      <div key={index} style={{ marginBottom: '8px', fontSize: '13px' }}>
                        • {error}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : actionData.error ? (
            <div style={styles.errorMessage}>
              ❌ Import failed: {actionData.error}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}