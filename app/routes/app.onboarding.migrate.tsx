// app/routes/app.onboarding.migrate.tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useNavigation, useActionData, useSubmit } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useEffect } from "react";
import { migrateTransactions } from "../services/transaction-migration.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  
  // Check if migration has been done before
  const migrationStatus = await prisma.migrationHistory.findFirst({
    where: { shopDomain: session.shop },
    orderBy: { createdAt: 'desc' }
  });
  
  // Get existing transaction count
  const transactionCount = await prisma.cashbackTransaction.count({
    where: { shopDomain: session.shop }
  });
  
  // Get customer count
  const customerCount = await prisma.customer.count({
    where: { shopDomain: session.shop }
  });
  
  return json({
    shopDomain: session.shop,
    migrationStatus,
    stats: {
      transactionCount,
      customerCount
    }
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get('_action') as string;
  
  if (action === 'check-status') {
    const jobId = formData.get('jobId') as string;
    const status = await prisma.migrationHistory.findUnique({
      where: { id: jobId }
    });
    return json({ status });
  }
  
  if (action === 'start-migration') {
    try {
      // Check if a migration is already running
      const runningMigration = await prisma.migrationHistory.findFirst({
        where: {
          shopDomain: session.shop,
          status: { in: ['PENDING', 'PROCESSING'] }
        }
      });
      
      if (runningMigration) {
        return json({ 
          success: false, 
          error: 'A migration is already in progress' 
        }, { status: 400 });
      }
      
      // Start the migration
      const migrationJob = await migrateTransactions({
        shopDomain: session.shop,
        admin,
        options: {
          startDate: formData.get('startDate') as string,
          batchSize: 250
        }
      });
      
      return json({ 
        success: true, 
        jobId: migrationJob.id,
        message: 'Migration started successfully' 
      });
      
    } catch (error) {
      console.error('Migration error:', error);
      return json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Migration failed' 
      }, { status: 500 });
    }
  }
  
  return json({ success: false, error: 'Invalid action' }, { status: 400 });
}

export default function TransactionMigration() {
  const { shopDomain, migrationStatus, stats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  
  const [dateRange, setDateRange] = useState('12');
  const [isPolling, setIsPolling] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(migrationStatus);
  
  const isSubmitting = navigation.state === 'submitting';
  
  // Poll for status updates when migration is running
  useEffect(() => {
    if (currentStatus?.status === 'PROCESSING' || 
        (actionData?.success && actionData?.jobId)) {
      setIsPolling(true);
      const interval = setInterval(() => {
        const formData = new FormData();
        formData.append('_action', 'check-status');
        formData.append('jobId', actionData?.jobId || currentStatus?.id);
        submit(formData, { method: 'post', replace: true });
      }, 3000); // Poll every 3 seconds
      
      return () => clearInterval(interval);
    } else {
      setIsPolling(false);
    }
  }, [currentStatus, actionData, submit]);
  
  // Update status from action data
  useEffect(() => {
    if (actionData?.status) {
      setCurrentStatus(actionData.status);
    }
  }, [actionData]);
  
  const getStartDate = () => {
    const months = parseInt(dateRange);
    if (months === 0) return '2015-01-01'; // Shopify's earliest date
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date.toISOString().split('T')[0];
  };
  
  const styles = {
    container: {
      maxWidth: '800px',
      margin: '0 auto',
      padding: '40px 24px'
    },
    header: {
      textAlign: 'center' as const,
      marginBottom: '48px'
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
      lineHeight: '1.5'
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '20px',
      marginBottom: '40px'
    },
    statCard: {
      backgroundColor: '#f8f9fa',
      padding: '24px',
      borderRadius: '12px',
      textAlign: 'center' as const
    },
    statValue: {
      fontSize: '36px',
      fontWeight: '700',
      color: '#10b981',
      marginBottom: '4px'
    },
    statLabel: {
      fontSize: '14px',
      color: '#666'
    },
    migrationCard: {
      backgroundColor: 'white',
      padding: '32px',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      marginBottom: '24px'
    },
    sectionTitle: {
      fontSize: '20px',
      fontWeight: '600',
      marginBottom: '24px',
      color: '#1a1a1a'
    },
    formGroup: {
      marginBottom: '24px'
    },
    label: {
      display: 'block',
      marginBottom: '8px',
      fontSize: '14px',
      fontWeight: '500',
      color: '#374151'
    },
    select: {
      width: '100%',
      padding: '10px 14px',
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      fontSize: '15px',
      backgroundColor: 'white'
    },
    helpText: {
      marginTop: '6px',
      fontSize: '13px',
      color: '#6b7280'
    },
    button: {
      padding: '14px 28px',
      backgroundColor: '#10b981',
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
      backgroundColor: '#6b7280',
      cursor: 'not-allowed'
    },
    statusCard: {
      padding: '20px',
      borderRadius: '8px',
      marginBottom: '24px'
    },
    statusProcessing: {
      backgroundColor: '#dbeafe',
      border: '1px solid #93c5fd',
      color: '#1e40af'
    },
    statusCompleted: {
      backgroundColor: '#d1fae5',
      border: '1px solid #6ee7b7',
      color: '#065f46'
    },
    statusFailed: {
      backgroundColor: '#fee2e2',
      border: '1px solid #fca5a5',
      color: '#991b1b'
    },
    progressBar: {
      width: '100%',
      height: '8px',
      backgroundColor: '#e5e7eb',
      borderRadius: '4px',
      overflow: 'hidden',
      marginTop: '12px'
    },
    progressFill: {
      height: '100%',
      backgroundColor: '#10b981',
      transition: 'width 0.3s ease'
    },
    infoBox: {
      backgroundColor: '#f0fdf4',
      border: '1px solid '#bbf7d0',
      padding: '16px',
      borderRadius: '8px',
      marginBottom: '24px'
    },
    warningBox: {
      backgroundColor: '#fef3c7',
      border: '1px solid #fde68a',
      padding: '16px',
      borderRadius: '8px',
      marginBottom: '24px'
    },
    list: {
      marginTop: '12px',
      marginLeft: '20px',
      lineHeight: '1.8'
    },
    icon: {
      marginRight: '8px',
      fontSize: '20px'
    }
  };
  
  const getStatusStyle = () => {
    if (!currentStatus) return {};
    switch (currentStatus.status) {
      case 'PROCESSING':
        return styles.statusProcessing;
      case 'COMPLETED':
        return styles.statusCompleted;
      case 'FAILED':
        return styles.statusFailed;
      default:
        return {};
    }
  };
  
  const getProgress = () => {
    if (!currentStatus || currentStatus.totalRecords === 0) return 0;
    return Math.round((currentStatus.processedRecords / currentStatus.totalRecords) * 100);
  };
  
  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Import Transaction History</h1>
        <p style={styles.subtitle}>
          Import your historical orders from Shopify to enable cashback calculations
          and customer tier assignments
        </p>
      </div>
      
      {/* Current Stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.transactionCount}</div>
          <div style={styles.statLabel}>Transactions Imported</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.customerCount}</div>
          <div style={styles.statLabel}>Customers in Database</div>
        </div>
      </div>
      
      {/* Migration Status */}
      {currentStatus && (
        <div style={{ ...styles.statusCard, ...getStatusStyle() }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <strong>
                {currentStatus.status === 'PROCESSING' && '⏳ Migration in Progress'}
                {currentStatus.status === 'COMPLETED' && '✅ Migration Completed'}
                {currentStatus.status === 'FAILED' && '❌ Migration Failed'}
              </strong>
              {currentStatus.status === 'PROCESSING' && (
                <div style={{ marginTop: '8px' }}>
                  Processing {currentStatus.processedRecords} of {currentStatus.totalRecords} orders...
                </div>
              )}
              {currentStatus.status === 'COMPLETED' && (
                <div style={{ marginTop: '8px' }}>
                  Successfully imported {currentStatus.processedRecords} orders
                  {currentStatus.failedRecords > 0 && ` (${currentStatus.failedRecords} failed)`}
                </div>
              )}
            </div>
            {currentStatus.completedAt && (
              <div style={{ fontSize: '13px', color: '#6b7280' }}>
                {new Date(currentStatus.completedAt).toLocaleString()}
              </div>
            )}
          </div>
          
          {currentStatus.status === 'PROCESSING' && (
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${getProgress()}%` }} />
            </div>
          )}
          
          {currentStatus.status === 'FAILED' && currentStatus.errors && (
            <div style={{ marginTop: '12px', fontSize: '14px' }}>
              Error: {currentStatus.errors[0]}
            </div>
          )}
        </div>
      )}
      
      {/* Migration Form */}
      <div style={styles.migrationCard}>
        <h2 style={styles.sectionTitle}>
          <span style={styles.icon}>📥</span>
          Import Settings
        </h2>
        
        <div style={styles.infoBox}>
          <strong>What will be imported:</strong>
          <ul style={styles.list}>
            <li>Customer information (email, Shopify ID)</li>
            <li>Order history with amounts and dates</li>
            <li>Order financial status for accurate calculations</li>
          </ul>
        </div>
        
        <Form method="post">
          <input type="hidden" name="_action" value="start-migration" />
          <input type="hidden" name="startDate" value={getStartDate()} />
          
          <div style={styles.formGroup}>
            <label style={styles.label}>Import Orders From</label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              style={styles.select}
              disabled={isSubmitting || currentStatus?.status === 'PROCESSING'}
            >
              <option value="3">Last 3 months</option>
              <option value="6">Last 6 months</option>
              <option value="12">Last 12 months</option>
              <option value="24">Last 2 years</option>
              <option value="60">Last 5 years</option>
              <option value="0">All time</option>
            </select>
            <p style={styles.helpText}>
              Older orders will help establish customer tiers and lifetime value
            </p>
          </div>
          
          <div style={styles.warningBox}>
            <strong>⚠️ Important:</strong>
            <ul style={{ ...styles.list, margin: '8px 0 0 20px' }}>
              <li>This process may take several minutes depending on order volume</li>
              <li>Only completed/paid orders will be imported</li>
              <li>You can safely close this page - the import will continue in the background</li>
            </ul>
          </div>
          
          <button
            type="submit"
            disabled={isSubmitting || currentStatus?.status === 'PROCESSING'}
            style={{
              ...styles.button,
              ...(isSubmitting || currentStatus?.status === 'PROCESSING' ? styles.buttonDisabled : {})
            }}
          >
            {isSubmitting && 'Starting Import...'}
            {currentStatus?.status === 'PROCESSING' && 'Import in Progress...'}
            {!isSubmitting && currentStatus?.status !== 'PROCESSING' && 'Start Import'}
          </button>
        </Form>
      </div>
      
      {/* Next Steps */}
      {currentStatus?.status === 'COMPLETED' && (
        <div style={styles.migrationCard}>
          <h2 style={styles.sectionTitle}>
            <span style={styles.icon}>🎯</span>
            Next Steps
          </h2>
          <p style={{ marginBottom: '16px', lineHeight: '1.6' }}>
            Great! Your transaction history has been imported. You can now:
          </p>
          <ul style={styles.list}>
            <li>
              <a href="/app/customers/tiers" style={{ color: '#10b981', textDecoration: 'none' }}>
                Assign customer tiers based on their purchase history
              </a>
            </li>
            <li>
              <a href="/app/customers/credit" style={{ color: '#10b981', textDecoration: 'none' }}>
                Award retroactive cashback credits to loyal customers
              </a>
            </li>
            <li>
              <a href="/app/tiers" style={{ color: '#10b981', textDecoration: 'none' }}>
                Configure your tier settings and cashback percentages
              </a>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}