import {
  reactExtension,
  BlockStack,
  Card,
  Heading,
  Text,
  SkeletonText,
  InlineStack,
  Badge,
  Divider,
  Button,
  View,
  useApi,
  useCustomer,
} from '@shopify/ui-extensions-react/customer-account';
import { useEffect, useState } from 'react';

interface TierInfo {
  id: string;
  name: string;
  displayName: string;
  level: number;
  cashbackPercent: number;
  color: string | null;
}

interface CustomerData {
  customerId: string;
  email: string;
  tier: TierInfo;
  storeCredit: number;
  totalEarned: number;
}

export default reactExtension(
  'customer-account.page.render',
  () => <MembershipCentre />
);

function MembershipCentre() {
  const api = useApi();
  const customer = useCustomer();
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadCustomerData = async () => {
      try {
        setLoading(true);
        
        if (!customer?.id) {
          throw new Error('Customer ID not found');
        }

        // Extract numeric ID from gid://shopify/Customer/123456
        const customerId = customer.id.split('/').pop();
        
        // Use your app's domain
        const appUrl = 'https://rewardspro.vercel.app';
        const response = await fetch(`${appUrl}/api/customer/${customerId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        // Transform the API response
        const transformedData: CustomerData = {
          customerId: customerId || '',
          email: data.email || customer.email || '',
          tier: data.tier || {
            id: 'default',
            name: 'bronze',
            displayName: 'Bronze',
            level: 1,
            cashbackPercent: 1,
            color: '#CD7F32'
          },
          storeCredit: data.storeCredit || 0,
          totalEarned: data.totalEarned || 0,
        };
        
        setCustomerData(transformedData);
        setError(null);
      } catch (err) {
        console.error('Error loading customer data:', err);
        setError('Failed to load membership data');
      } finally {
        setLoading(false);
      }
    };

    if (customer?.id) {
      loadCustomerData();
    }
  }, [customer]);

  if (loading) {
    return (
      <Card padding>
        <BlockStack spacing="loose">
          <SkeletonText lines={1} />
          <SkeletonText lines={2} />
        </BlockStack>
      </Card>
    );
  }

  if (error || !customerData) {
    return (
      <Card padding>
        <Text appearance="critical">{error || 'Unable to load membership data'}</Text>
      </Card>
    );
  }

  const { tier, storeCredit } = customerData;

  return (
    <Card padding>
      <BlockStack spacing="loose">
        <Heading level={2}>My Membership</Heading>
        
        <Divider />

        {/* Tier Information */}
        <BlockStack spacing="tight">
          <Text appearance="subdued" size="small">
            VIP Status
          </Text>
          <InlineStack spacing="tight" blockAlignment="center">
            <Badge
              tone={tier.level >= 4 ? 'success' : tier.level >= 2 ? 'info' : 'base'}
            >
              {tier.displayName}
            </Badge>
            <Text size="medium">
              {tier.cashbackPercent}% Cashback
            </Text>
          </InlineStack>
        </BlockStack>

        <Divider />

        {/* Store Credit Balance */}
        <BlockStack spacing="tight">
          <Text appearance="subdued" size="small">
            Cash Credit Balance
          </Text>
          <View>
            <Text size="large" emphasis="bold">
              £{storeCredit.toFixed(2)}
            </Text>
            <Text appearance="subdued" size="small">
              Available to use on your next order
            </Text>
          </View>
        </BlockStack>

        {/* Optional: Add navigation to full membership page */}
        <View>
          <Button
            variant="plain"
            onPress={() => {
              // Navigation will be implemented later
              console.log('View full membership details');
            }}
          >
            View Details →
          </Button>
        </View>
      </BlockStack>
    </Card>
  );
}