// app/services/order-import.server.ts
import prisma from "../db.server";
import { 
  TransactionStatus, 
  MigrationStatus, 
  AssignmentType,
  TierChangeType,
  LedgerEntryType,
  LedgerSource
} from "@prisma/client";
import { assignInitialTier, evaluateCustomerTier } from "./customer-tier.server";
// Type for the admin API client from authenticate.admin
type AdminGraphQLClient = {
  graphql: (query: string, options?: { variables?: any }) => Promise<Response>;
};
import { subMonths } from "date-fns";

interface OrderNode {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  totalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  subtotalPriceSet: {
    shopMoney: {
      amount: string;
    };
  };
  totalTaxSet: {
    shopMoney: {
      amount: string;
    };
  };
  displayFinancialStatus: string;
  financialStatus: string;
  lineItems: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        quantity: number;
        originalUnitPriceSet: {
          shopMoney: {
            amount: string;
          };
        };
      };
    }>;
  };
  customer: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    ordersCount: string;
    totalSpent: {
      amount: string;
      currencyCode: string;
    };
    createdAt: string;
  } | null;
}

interface ImportOptions {
  shopDomain: string;
  admin: AdminGraphQLClient;
  startDate: Date;
  endDate: Date;
  importType: 'new' | 'all';
  updateTiers: boolean;
  onProgress?: (current: number, total: number, message: string) => void;
}

interface ImportResult {
  totalOrders: number;
  processedOrders: number;
  newCustomers: number;
  newTransactions: number;
  skippedTransactions: number;
  updatedCustomers: number;
  errors: string[];
  tiersUpdated: number;
}

export async function processOrdersImport(options: ImportOptions): Promise<ImportResult> {
  const {
    shopDomain,
    admin,
    startDate,
    endDate,
    importType,
    updateTiers,
    onProgress
  } = options;
  
  const result: ImportResult = {
    totalOrders: 0,
    processedOrders: 0,
    newCustomers: 0,
    newTransactions: 0,
    skippedTransactions: 0,
    updatedCustomers: 0,
    errors: [],
    tiersUpdated: 0
  };
  
  // Create migration history record
  const migration = await prisma.migrationHistory.create({
    data: {
      shopDomain,
      status: MigrationStatus.PROCESSING,
      totalRecords: 0,
      processedRecords: 0,
      failedRecords: 0,
      startedAt: new Date(),
      metadata: {
        type: 'order_import',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        importType,
        updateTiers
      }
    }
  });
  
  try {
    // Check for active tiers
    const activeTiers = await prisma.tier.findMany({
      where: {
        shopDomain,
        isActive: true
      },
      orderBy: { cashbackPercent: 'asc' }
    });
    
    if (activeTiers.length === 0) {
      throw new Error("No active tiers found. Please create at least one tier before importing.");
    }
    
    // Fetch orders from Shopify with pagination
    let hasNextPage = true;
    let cursor: string | null = null;
    let pageCount = 0;
    const ordersPerPage = 50;
    const processedCustomerIds = new Set<string>();
    
    while (hasNextPage) {
      pageCount++;
      onProgress?.(pageCount * ordersPerPage, 0, `Fetching orders page ${pageCount}...`);
      
      // Build GraphQL query for orders
      const ordersQuery = `
        query GetOrdersForImport($first: Int!, $after: String) {
          orders(
            first: $first, 
            after: $after,
            query: "financial_status:paid",
            sortKey: CREATED_AT,
            reverse: false
          ) {
            edges {
              node {
                id
                name
                createdAt
                updatedAt
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                subtotalPriceSet {
                  shopMoney {
                    amount
                  }
                }
                totalTaxSet {
                  shopMoney {
                    amount
                  }
                }
                displayFinancialStatus
                financialStatus
                lineItems(first: 250) {
                  edges {
                    node {
                      id
                      title
                      quantity
                      originalUnitPriceSet {
                        shopMoney {
                          amount
                        }
                      }
                    }
                  }
                }
                customer {
                  id
                  email
                  firstName
                  lastName
                  phone
                  ordersCount
                  totalSpent {
                    amount
                    currencyCode
                  }
                  createdAt
                }
              }
              cursor
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;
      
      const response = await admin.graphql(ordersQuery, {
        variables: {
          first: ordersPerPage,
          after: cursor
        }
      });
      
      const data = await response.json();
      
      if (data.errors) {
        console.error('GraphQL errors:', data.errors);
        result.errors.push(`GraphQL error: ${data.errors[0]?.message || 'Unknown error'}`);
        break;
      }
      
      const orders = data.data?.orders?.edges || [];
      hasNextPage = data.data?.orders?.pageInfo?.hasNextPage || false;
      cursor = data.data?.orders?.pageInfo?.endCursor || null;
      
      // Process each order in a transaction
      for (const edge of orders) {
        const order = edge.node as OrderNode;
        
        try {
          // Check if order is within date range
          const orderDate = new Date(order.createdAt);
          if (orderDate < startDate || orderDate > endDate) {
            continue;
          }
          
          result.totalOrders++;
          
          // Skip orders without customers
          if (!order.customer) {
            result.errors.push(`Order ${order.name} has no customer`);
            continue;
          }
          
          // Extract IDs
          const shopifyOrderId = order.id.split('/').pop()!;
          const shopifyCustomerId = order.customer.id.split('/').pop()!;
          const orderAmount = parseFloat(order.totalPriceSet.shopMoney.amount);
          
          // Store customer data to avoid TS null checks
          const customerData = order.customer;
          
          // Process in a transaction
          await prisma.$transaction(async (tx) => {
            // Create or update customer
            const existingCustomer = await tx.customer.findUnique({
              where: {
                shopDomain_shopifyCustomerId: {
                  shopDomain,
                  shopifyCustomerId
                }
              }
            });
            
            let customer;
            let isNewCustomer = false;
            
            if (!existingCustomer) {
              // Create new customer
              customer = await tx.customer.create({
                data: {
                  shopDomain,
                  shopifyCustomerId,
                  email: customerData.email,
                  storeCredit: 0,
                  totalEarned: 0,
                  createdAt: new Date(customerData.createdAt)
                }
              });
              result.newCustomers++;
              isNewCustomer = true;
              
              // Assign initial tier
              await assignInitialTierInTransaction(tx, customer.id, shopDomain);
            } else {
              customer = existingCustomer;
              processedCustomerIds.add(customer.id);
            }
            
            // Check if transaction already exists
            const existingTransaction = await tx.cashbackTransaction.findUnique({
              where: {
                shopDomain_shopifyOrderId: {
                  shopDomain,
                  shopifyOrderId
                }
              }
            });
            
            if (existingTransaction && importType === 'new') {
              result.skippedTransactions++;
              return;
            }
            
            // Get customer's current tier for cashback calculation
            const membership = await tx.customerMembership.findFirst({
              where: {
                customerId: customer.id,
                isActive: true
              },
              include: { tier: true }
            });
            
            const cashbackPercent = membership?.tier.cashbackPercent || 0;
            const cashbackAmount = orderAmount * (cashbackPercent / 100);
            
            if (existingTransaction) {
              // Update existing transaction
              await tx.cashbackTransaction.update({
                where: { id: existingTransaction.id },
                data: {
                  orderAmount,
                  cashbackAmount,
                  cashbackPercent,
                  status: TransactionStatus.COMPLETED
                }
              });
            } else {
              // Create new transaction
              await tx.cashbackTransaction.create({
                data: {
                  shopDomain,
                  customerId: customer.id,
                  shopifyOrderId,
                  orderAmount,
                  cashbackAmount,
                  cashbackPercent,
                  status: TransactionStatus.COMPLETED,
                  createdAt: orderDate
                }
              });
              
              // Update customer's total earned
              await tx.customer.update({
                where: { id: customer.id },
                data: {
                  totalEarned: {
                    increment: cashbackAmount
                  },
                  storeCredit: {
                    increment: cashbackAmount
                  }
                }
              });
              
              // Create ledger entry for cashback earned
              const updatedCustomer = await tx.customer.findUnique({
                where: { id: customer.id }
              });
              
              await tx.storeCreditLedger.create({
                data: {
                  customerId: customer.id,
                  shopDomain,
                  amount: cashbackAmount,
                  balance: updatedCustomer!.storeCredit,
                  type: LedgerEntryType.CASHBACK_EARNED,
                  source: LedgerSource.APP_CASHBACK,
                  shopifyReference: shopifyOrderId,
                  description: `Cashback earned from order ${order.name}`
                }
              });
              
              result.newTransactions++;
            }
            
            result.processedOrders++;
          });
          
        } catch (error) {
          console.error(`Error processing order ${order.name}:`, error);
          result.errors.push(
            `Order ${order.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
      
      // Update migration progress
      await prisma.migrationHistory.update({
        where: { id: migration.id },
        data: {
          totalRecords: result.totalOrders,
          processedRecords: result.processedOrders,
          failedRecords: result.totalOrders - result.processedOrders
        }
      });
      
      // Stop if we've processed all orders in the date range
      if (orders.length === 0 || !hasNextPage) {
        break;
      }
      
      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Update customer information from Shopify
    if (processedCustomerIds.size > 0) {
      onProgress?.(0, 0, 'Updating customer information from Shopify...');
      const customerUpdateResults = await updateCustomersFromShopify(
        Array.from(processedCustomerIds),
        shopDomain,
        admin
      );
      result.updatedCustomers = customerUpdateResults.updated;
      result.errors.push(...customerUpdateResults.errors);
    }
    
    // Update customer analytics and tiers if requested
    if (updateTiers && (result.newTransactions > 0 || result.newCustomers > 0)) {
      onProgress?.(0, 0, 'Updating customer analytics and tiers...');
      
      // Get all customers that need updates
      const customersToUpdate = await prisma.customer.findMany({
        where: {
          shopDomain,
          OR: [
            // New customers
            {
              createdAt: {
                gte: new Date(Date.now() - 10 * 60 * 1000) // Last 10 minutes
              }
            },
            // Customers with recent transactions
            {
              transactions: {
                some: {
                  createdAt: {
                    gte: new Date(Date.now() - 10 * 60 * 1000)
                  }
                }
              }
            }
          ]
        }
      });
      
      for (const customer of customersToUpdate) {
        try {
          // Update analytics
          await updateCustomerAnalyticsInDb(customer.id, shopDomain);
          
          // Evaluate tier
          const tierResult = await evaluateCustomerTier(customer.id, shopDomain);
          if (tierResult) {
            result.tiersUpdated++;
          }
        } catch (error) {
          console.error(`Error updating customer ${customer.email}:`, error);
          result.errors.push(
            `Customer update for ${customer.email}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    }
    
    // Mark migration as completed
    await prisma.migrationHistory.update({
      where: { id: migration.id },
      data: {
        status: MigrationStatus.COMPLETED,
        completedAt: new Date(),
        totalRecords: result.totalOrders,
        processedRecords: result.processedOrders,
        failedRecords: result.totalOrders - result.processedOrders,
        errors: result.errors.length > 0 ? result.errors : undefined,
        metadata: {
          type: 'order_import',
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          importType,
          updateTiers,
          results: {
            newCustomers: result.newCustomers,
            newTransactions: result.newTransactions,
            skippedTransactions: result.skippedTransactions,
            updatedCustomers: result.updatedCustomers,
            tiersUpdated: result.tiersUpdated
          }
        }
      }
    });
    
    return result;
    
  } catch (error) {
    // Mark migration as failed
    await prisma.migrationHistory.update({
      where: { id: migration.id },
      data: {
        status: MigrationStatus.FAILED,
        completedAt: new Date(),
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    });
    
    console.error('Import process error:', error);
    throw error;
  }
}

// Helper function to assign initial tier within a transaction
async function assignInitialTierInTransaction(tx: any, customerId: string, shopDomain: string) {
  // Get the tier with no minimum spend (base tier)
  const defaultTier = await tx.tier.findFirst({
    where: { 
      shopDomain,
      isActive: true,
      minSpend: null
    },
    orderBy: { cashbackPercent: 'asc' }
  });

  const tierToAssign = defaultTier || await tx.tier.findFirst({
    where: { 
      shopDomain,
      isActive: true
    },
    orderBy: { minSpend: 'asc' }
  });
  
  if (!tierToAssign) {
    throw new Error("No active tiers found for shop");
  }
  
  // Create membership record
  await tx.customerMembership.create({
    data: {
      customerId,
      tierId: tierToAssign.id,
      isActive: true,
      assignmentType: AssignmentType.AUTOMATIC,
    }
  });

  // Log the change
  await tx.tierChangeLog.create({
    data: {
      customerId,
      toTierId: tierToAssign.id,
      changeType: TierChangeType.INITIAL_ASSIGNMENT,
      changeReason: "New customer initial tier assignment",
      triggeredBy: "System",
      metadata: {
        tierName: tierToAssign.name,
        cashbackPercent: tierToAssign.cashbackPercent
      }
    }
  });
}

// Update customer analytics (following pattern from tier service)
async function updateCustomerAnalyticsInDb(customerId: string, shopDomain: string) {
  const now = new Date();
  const twelveMonthsAgo = subMonths(now, 12);
  const threeMonthsAgo = subMonths(now, 3);
  const oneMonthAgo = subMonths(now, 1);

  // Get all transaction data
  const transactions = await prisma.cashbackTransaction.findMany({
    where: {
      customerId,
      shopDomain,
      status: { in: [TransactionStatus.COMPLETED, TransactionStatus.SYNCED_TO_SHOPIFY] }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Calculate metrics
  const lifetimeSpending = transactions.reduce((sum, t) => sum + t.orderAmount, 0);
  const yearlySpending = transactions
    .filter(t => t.createdAt >= twelveMonthsAgo)
    .reduce((sum, t) => sum + t.orderAmount, 0);
  const quarterlySpending = transactions
    .filter(t => t.createdAt >= threeMonthsAgo)
    .reduce((sum, t) => sum + t.orderAmount, 0);
  const monthlySpending = transactions
    .filter(t => t.createdAt >= oneMonthAgo)
    .reduce((sum, t) => sum + t.orderAmount, 0);
  
  const orderCount = transactions.length;
  const avgOrderValue = orderCount > 0 ? lifetimeSpending / orderCount : 0;
  const lastOrderDate = transactions[0]?.createdAt || null;
  const daysSinceLastOrder = lastOrderDate 
    ? Math.floor((now.getTime() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Get tier info
  const membership = await prisma.customerMembership.findFirst({
    where: { customerId, isActive: true },
    include: { tier: true }
  });

  const tierChanges = await prisma.tierChangeLog.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' }
  });

  const lastTierChange = tierChanges[0]?.createdAt || membership?.startDate || now;
  const currentTierDays = Math.floor((now.getTime() - lastTierChange.getTime()) / (1000 * 60 * 60 * 24));
  const tierUpgradeCount = tierChanges.filter(
    t => t.changeType === TierChangeType.AUTOMATIC_UPGRADE || t.changeType === TierChangeType.MANUAL_OVERRIDE
  ).length;

  // Calculate progress to next tier
  let nextTierProgress = 0;
  if (membership) {
    const nextTier = await prisma.tier.findFirst({
      where: {
        shopDomain,
        cashbackPercent: { gt: membership.tier.cashbackPercent },
        isActive: true,
        minSpend: { not: null }
      },
      orderBy: { cashbackPercent: 'asc' }
    });

    if (nextTier && nextTier.minSpend) {
      const relevantSpending = nextTier.evaluationPeriod === 'LIFETIME'
        ? lifetimeSpending
        : yearlySpending;
      nextTierProgress = Math.min(100, (relevantSpending / nextTier.minSpend) * 100);
    }
  }

  // Update or create analytics record
  await prisma.customerAnalytics.upsert({
    where: { customerId },
    update: {
      lifetimeSpending,
      yearlySpending,
      quarterlySpending,
      monthlySpending,
      avgOrderValue,
      orderCount,
      currentTierDays,
      tierUpgradeCount,
      lastTierChange,
      nextTierProgress,
      lastOrderDate,
      daysSinceLastOrder,
      calculatedAt: now
    },
    create: {
      customerId,
      shopDomain,
      lifetimeSpending,
      yearlySpending,
      quarterlySpending,
      monthlySpending,
      avgOrderValue,
      orderCount,
      currentTierDays,
      tierUpgradeCount,
      lastTierChange,
      nextTierProgress,
      lastOrderDate,
      daysSinceLastOrder
    }
  });
}

// Update customers from Shopify
async function updateCustomersFromShopify(
  customerIds: string[],
  shopDomain: string,
  admin: AdminGraphQLClient
): Promise<{ updated: number; errors: string[] }> {
  const result = { updated: 0, errors: [] as string[] };
  
  // Process in batches to avoid query size limits
  const batchSize = 10;
  for (let i = 0; i < customerIds.length; i += batchSize) {
    const batch = customerIds.slice(i, i + batchSize);
    
    try {
      // Get customers from database
      const customers = await prisma.customer.findMany({
        where: {
          id: { in: batch },
          shopDomain
        }
      });
      
      // Update each customer from Shopify
      for (const customer of customers) {
        try {
          const customerQuery = `
            query GetCustomer($id: ID!) {
              customer(id: $id) {
                id
                firstName
                lastName
                email
                phone
                ordersCount
                totalSpent {
                  amount
                  currencyCode
                }
                metafields(first: 10, namespace: "cashback") {
                  edges {
                    node {
                      key
                      value
                      type
                    }
                  }
                }
              }
            }
          `;
          
          const response = await admin.graphql(customerQuery, {
            variables: {
              id: `gid://shopify/Customer/${customer.shopifyCustomerId}`
            }
          });
          
          const data = await response.json();
          
          if (data.data?.customer) {
            const shopifyCustomer = data.data.customer;
            
            // Prepare update data
            const updateData: any = {};
            
            // Check for store credit metafield
            const storeCreditMetafield = shopifyCustomer.metafields?.edges?.find(
              (edge: any) => edge.node.key === 'store_credit_balance'
            );
            
            if (storeCreditMetafield) {
              const shopifyStoreCredit = parseFloat(storeCreditMetafield.node.value);
              if (Math.abs(shopifyStoreCredit - customer.storeCredit) > 0.01) {
                updateData.storeCredit = shopifyStoreCredit;
                updateData.lastSyncedAt = new Date();
                
                // Create reconciliation ledger entry
                await prisma.storeCreditLedger.create({
                  data: {
                    customerId: customer.id,
                    shopDomain,
                    amount: shopifyStoreCredit - customer.storeCredit,
                    balance: shopifyStoreCredit,
                    type: LedgerEntryType.SHOPIFY_SYNC,
                    source: LedgerSource.RECONCILIATION,
                    description: `Store credit sync from Shopify`,
                    reconciledAt: new Date()
                  }
                });
              }
            }
            
            // Update customer if needed
            if (Object.keys(updateData).length > 0) {
              await prisma.customer.update({
                where: { id: customer.id },
                data: updateData
              });
              result.updated++;
            }
          }
        } catch (error) {
          console.error(`Error updating customer ${customer.email}:`, error);
          result.errors.push(
            `Customer ${customer.email}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    } catch (error) {
      console.error('Batch update error:', error);
      result.errors.push(
        `Batch update error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
  
  return result;
}

// Sync store credit to Shopify
export async function syncStoreCreditToShopify(
  customerId: string,
  shopDomain: string,
  admin: AdminGraphQLClient
): Promise<void> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId }
  });
  
  if (!customer) {
    throw new Error('Customer not found');
  }
  
  try {
    const mutation = `
      mutation UpdateCustomerMetafield($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer {
            id
            metafields(first: 1, namespace: "cashback", key: "store_credit_balance") {
              edges {
                node {
                  id
                  value
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    
    const response = await admin.graphql(mutation, {
      variables: {
        input: {
          id: `gid://shopify/Customer/${customer.shopifyCustomerId}`,
          metafields: [
            {
              namespace: "cashback",
              key: "store_credit_balance",
              value: customer.storeCredit.toString(),
              type: "number_decimal"
            }
          ]
        }
      }
    });
    
    const data = await response.json();
    
    if (data.data?.customerUpdate?.userErrors?.length > 0) {
      throw new Error(data.data.customerUpdate.userErrors[0].message);
    }
    
    // Update last synced timestamp
    await prisma.customer.update({
      where: { id: customerId },
      data: { lastSyncedAt: new Date() }
    });
    
  } catch (error) {
    console.error('Store credit sync error:', error);
    throw error;
  }
}