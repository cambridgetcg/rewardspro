import {
  reactExtension,
  BlockStack,
  Card,
  Heading,
  Text,
  InlineStack,
  Badge,
  Divider,
  View,
  useCustomer,
  useAsync,
} from '@shopify/ui-extensions-react/customer-account';

// Main membership page extension
export const MembershipPage = reactExtension(
  'customer-account.page.render',
  () => <MembershipCentre />
);

// Profile block extension
export const ProfileBlock = reactExtension(
  'customer-account.profile.block.render',
  () => <MembershipSummary />
);

// Order page block extension
export const OrderBlock = reactExtension(
  'customer-account.order-index.block.render',
  () => <CreditBalance />
);

// Fetch customer data function
async function fetchCustomerData(customerId) {
  if (!customerId) return null;
  
  const cleanId = customerId.split('/').pop();
  
  try {
    const response = await fetch(`https://rewardspro.vercel.app/api/customer/${cleanId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    return {
      customerId: cleanId,
      email: result.email || '',
      tier: result.tier || {
        id: 'default',
        name: 'bronze',
        displayName: 'Bronze',
        level: 1,
        cashbackPercent: 1,
        color: '#CD7F32'
      },
      storeCredit: result.storeCredit || 0,
      totalEarned: result.totalEarned || 0,
    };
  } catch (error) {
    console.error('Error fetching customer data:', error);
    return null;
  }
}

// Main membership centre component
function MembershipCentre() {
  const customer = useCustomer();
  const { value: data, loading, error } = useAsync(
    () => fetchCustomerData(customer?.id),
    [customer?.id]
  );

  if (loading) {
    return (
      <Card padding>
        <BlockStack spacing="loose">
          <Text>Loading membership data...</Text>
        </BlockStack>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card padding>
        <Text appearance="critical">Unable to load membership data</Text>
      </Card>
    );
  }

  const { tier, storeCredit } = data;

  return (
    <Card padding>
      <BlockStack spacing="loose">
        <Heading level={2}>My Membership</Heading>
        
        <Divider />

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
      </BlockStack>
    </Card>
  );
}

// Profile summary component
function MembershipSummary() {
  const customer = useCustomer();
  const { value: data } = useAsync(
    () => fetchCustomerData(customer?.id),
    [customer?.id]
  );

  if (!data) return null;

  return (
    <Card padding>
      <BlockStack spacing="tight">
        <InlineStack spacing="base" blockAlignment="center">
          <Badge tone={data.tier.level >= 3 ? 'success' : 'info'}>
            {data.tier.displayName} VIP
          </Badge>
          <Text size="small">
            {data.tier.cashbackPercent}% Cashback
          </Text>
        </InlineStack>
        
        <Text size="small" appearance="subdued">
          Credit Balance: £{data.storeCredit.toFixed(2)}
        </Text>
      </BlockStack>
    </Card>
  );
}

// Credit balance component for order page
function CreditBalance() {
  const customer = useCustomer();
  const { value: data } = useAsync(
    () => fetchCustomerData(customer?.id),
    [customer?.id]
  );

  if (!data || data.storeCredit === 0) return null;

  return (
    <Card padding>
      <InlineStack spacing="base" blockAlignment="center">
        <Text size="small" emphasis="bold">
          💰 You have £{data.storeCredit.toFixed(2)} in store credit
        </Text>
        <Text size="small" appearance="subdued">
          Use on your next order
        </Text>
      </InlineStack>
    </Card>
  );
}