// app/services/transaction-migration.server.ts
import prisma from "../db.server";
import { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { TransactionStatus } from "@prisma/client";

interface MigrationOptions {
  shopDomain: string;
  admin: AdminApiContext;
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
  admin: AdminApiContext,
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
    let totalOrders = 0;
    const errors: string[] = [];
    
    // Build date filter
    const dateFilter = options.startDate 
      ? `created_at:>='${options.startDate}'` 
      : '';
    
    // First, get total count for progress tracking
    const countQuery = `
      query GetOrderCount {
        ordersCount {
          count
        }
      }
    `;
    
    const countResponse = await admin.graphql(countQuery);
    const countData = await countResponse.json();
    totalOrders = countData.data?.ordersCount?.count || 0;
    
    // Update job with total count
    await prisma.migrationHistory.update({
      where: { id: jobId },
      data: { totalRecords: totalOrders }
    });
    
    // Process orders in batches
    while (hasNextPage) {
      const ordersQuery = `
        query GetOrders($cursor: String, $query: String) {
          orders(first: ${batchSize}, after: $cursor, query: $query) {
            edges {
              node {
                id
                name
                email
                createdAt
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                currentTotalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                financialStatus
                fulfillmentStatus
                customer {
                  id
                  email
                  firstName
                  lastName
                  totalSpent
                }
                lineItems(first: 250) {
                  edges {
                    node {
                      id
                      title
                      quantity
                      variant {
                        price
                      }
                    }
                  }
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
      
      try {
        const response = await admin.graphql(ordersQuery, {
          variables: {
            cursor,
            query: `${dateFilter} financial_status:paid`
          }
        });
        
        const data = await response.json();
        
        if (!data.data?.orders) {
          throw new Error('Failed to fetch orders from Shopify');
        }
        
        const orders = data.data.orders.edges;
        hasNextPage = data.data.orders.pageInfo.hasNextPage;
        
        if (orders.length > 0) {
          cursor = orders[orders.length - 1].cursor;
          
          // Process each order
          for (const edge of orders) {
            const order = edge.node;
            
            try {
              // Skip if no customer
              if (!order.customer) {
                console.log(`Skipping order ${order.name} - no customer associated`);
                continue;
              }
              
              const customerId = order.customer.id.split('/').pop()!;
              const orderAmount = parseFloat(order.totalPriceSet.shopMoney.amount);
              
              // Create or update customer
              const customer = await prisma.customer.upsert({
                where: {
                  shopDomain_shopifyCustomerId: {
                    shopDomain,
                    shopifyCustomerId: customerId
                  }
                },
                update: {
                  email: order.customer.email
                },
                create: {
                  shopDomain,
                  shopifyCustomerId: customerId,
                  email: order.customer.email
                }
              });
              
              // Check if transaction already exists
              const existingTransaction = await prisma.cashbackTransaction.findUnique({
                where: {
                  shopDomain_shopifyOrderId: {
                    shopDomain,
                    shopifyOrderId: order.id.split('/').pop()!
                  }
                }
              });
              
              if (!existingTransaction) {
                // Create transaction record
                // Note: We're not calculating cashback yet - that will be done separately
                await prisma.cashbackTransaction.create({
                  data: {
                    shopDomain,
                    customerId: customer.id,
                    shopifyOrderId: order.id.split('/').pop()!,
                    orderAmount,
                    cashbackAmount: 0, // Will be calculated during tier assignment
                    cashbackPercent: 0, // Will be set during tier assignment
                    status: TransactionStatus.COMPLETED,
                    createdAt: new Date(order.createdAt)
                  }
                });
              }
              
              totalProcessed++;
            } catch (error) {
              totalFailed++;
              errors.push(`Order ${order.name}: ${error.message}`);
              console.error(`Error processing order ${order.name}:`, error);
            }
          }
          
          // Update progress
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
        errors.push(`Batch error: ${error.message}`);
        // Continue with next batch despite error
      }
    }
    
    // Mark migration as completed
    await prisma.migrationHistory.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        processedRecords: totalProcessed,
        failedRecords: totalFailed,
        errors: errors.length > 0 ? errors.slice(0, 100) : null // Limit error storage
      }
    });
    
    console.log(`Migration completed: ${totalProcessed} processed, ${totalFailed} failed`);
    
  } catch (error) {
    console.error('Migration error:', error);
    
    await prisma.migrationHistory.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errors: [error.message]
      }
    });
  }
}