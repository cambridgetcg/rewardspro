// app/services/transaction-migration.server.ts
import prisma from "../db.server";
import { TransactionStatus } from "@prisma/client";

// Type definitions for Shopify GraphQL responses
interface ShopifyOrder {
  id: string;
  createdAt: string;
  totalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  displayFinancialStatus: string;
  customer: {
    id: string;
    email: string;
  } | null;
}

interface OrderEdge {
  node: ShopifyOrder;
  cursor: string;
}

interface OrdersQueryResponse {
  data: {
    orders: {
      edges: OrderEdge[];
      pageInfo: {
        hasNextPage: boolean;
      };
    };
  };
}

interface MigrationOptions {
  shopDomain: string;
  admin: any; // Using 'any' to avoid specific AdminApiContext typing issues
  options: {
    startDate?: string;
    batchSize?: number;
  };
}

export async function migrateTransactions({ shopDomain, admin, options }: MigrationOptions) {
  // Create migration job record
  const migrationJob = await prisma.migrationHistory.create({
    data: {
      shopDomain,
      status: 'PENDING',
      metadata: {
        startDate: options.startDate,
        batchSize: options.batchSize || 250
      }
    }
  });
  
  // Start async processing
  processMigrationAsync(migrationJob.id, shopDomain, admin, options);
  
  return migrationJob;
}

async function processMigrationAsync(
  jobId: string,
  shopDomain: string,
  admin: any,
  options: { startDate?: string; batchSize?: number }
) {
  try {
    // Update job status
    await prisma.migrationHistory.update({
      where: { id: jobId },
      data: { 
        status: 'PROCESSING',
        startedAt: new Date()
      }
    });
    
    const batchSize = options.batchSize || 250;
    let hasNextPage = true;
    let cursor: string | null = null;
    let totalProcessed = 0;
    let totalFailed = 0;
    const errors: string[] = [];
    
    // Build date filter for query
    const dateFilter = options.startDate 
      ? `created_at:>='${options.startDate}T00:00:00Z'` 
      : '';
    
    // Build the complete query filter
    const queryFilter = dateFilter 
      ? `${dateFilter} AND financial_status:paid`
      : 'financial_status:paid';
    
    // Optimized query - only fetch required fields for CashbackTransaction
    const ordersQuery = `
      query GetOrders($cursor: String, $query: String) {
        orders(first: ${batchSize}, after: $cursor, query: $query) {
          edges {
            node {
              id
              createdAt
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              displayFinancialStatus
              customer {
                id
                email
              }
            }
            cursor
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `;
    
    // Process orders in batches
    while (hasNextPage) {
      try {
        const response = await admin.graphql(ordersQuery, {
          variables: {
            cursor,
            query: queryFilter
          }
        });
        
        const data = await response.json() as OrdersQueryResponse;
        
        if (!data.data?.orders) {
          throw new Error('Failed to fetch orders from Shopify');
        }
        
        const orders = data.data.orders.edges;
        hasNextPage = data.data.orders.pageInfo.hasNextPage;
        
        if (orders.length > 0) {
          cursor = orders[orders.length - 1].cursor;
          
          // Batch process orders for better performance
          const orderPromises = orders.map(async (edge: OrderEdge) => {
            const order = edge.node;
            
            try {
              // Skip orders without customers or with invalid financial status
              if (!order.customer || order.displayFinancialStatus !== 'PAID') {
                return { success: false, error: 'No customer or unpaid order' };
              }
              
              // Extract only required data
              const shopifyOrderId = order.id.split('/').pop()!;
              const shopifyCustomerId = order.customer.id.split('/').pop()!;
              const orderAmount = parseFloat(order.totalPriceSet.shopMoney.amount);
              const customerEmail = order.customer.email;
              
              // Create or get customer (minimal data)
              const customer = await prisma.customer.upsert({
                where: {
                  shopDomain_shopifyCustomerId: {
                    shopDomain,
                    shopifyCustomerId
                  }
                },
                update: {}, // No update needed if exists
                create: {
                  shopDomain,
                  shopifyCustomerId,
                  email: customerEmail
                }
              });
              
              // Create transaction if doesn't exist
              await prisma.cashbackTransaction.upsert({
                where: {
                  shopDomain_shopifyOrderId: {
                    shopDomain,
                    shopifyOrderId
                  }
                },
                update: {}, // No update if exists
                create: {
                  shopDomain,
                  customerId: customer.id,
                  shopifyOrderId,
                  orderAmount,
                  cashbackAmount: 0, // Will be calculated during tier assignment
                  cashbackPercent: 0, // Will be set during tier assignment
                  status: TransactionStatus.COMPLETED,
                  createdAt: new Date(order.createdAt)
                }
              });
              
              return { success: true };
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              return { 
                success: false, 
                error: `Order ${order.id}: ${errorMessage}` 
              };
            }
          });
          
          // Wait for batch to complete
          const results = await Promise.all(orderPromises);
          
          // Count successes and failures
          results.forEach(result => {
            if (result.success) {
              totalProcessed++;
            } else {
              totalFailed++;
              if (result.error && result.error !== 'No customer') {
                errors.push(result.error);
              }
            }
          });
          
          // Update progress periodically (every batch)
          await prisma.migrationHistory.update({
            where: { id: jobId },
            data: {
              processedRecords: totalProcessed,
              failedRecords: totalFailed
            }
          });
        }
      } catch (error) {
        console.error('Batch processing error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Batch error: ${errorMessage}`);
        // Continue with next batch despite error
      }
    }
    
    // Mark migration as completed
    await prisma.migrationHistory.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        totalRecords: totalProcessed + totalFailed,
        processedRecords: totalProcessed,
        failedRecords: totalFailed,
        errors: errors.length > 0 ? errors.slice(0, 100) : undefined // Limit error storage
      }
    });
    
    console.log(`Migration completed: ${totalProcessed} processed, ${totalFailed} failed`);
    
  } catch (error) {
    console.error('Migration error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    await prisma.migrationHistory.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errors: [errorMessage]
      }
    });
  }
}

// Helper function to get migration status
export async function getMigrationStatus(shopDomain: string) {
  return await prisma.migrationHistory.findFirst({
    where: { shopDomain },
    orderBy: { createdAt: 'desc' }
  });
}

// Helper function to cancel a running migration
export async function cancelMigration(jobId: string, shopDomain: string) {
  const job = await prisma.migrationHistory.findFirst({
    where: {
      id: jobId,
      shopDomain,
      status: { in: ['PENDING', 'PROCESSING'] }
    }
  });
  
  if (job) {
    return await prisma.migrationHistory.update({
      where: { id: jobId },
      data: {
        status: 'CANCELLED',
        completedAt: new Date()
      }
    });
  }
  
  return null;
}