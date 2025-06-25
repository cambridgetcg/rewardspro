import {
  reactExtension,
  BlockStack,
  Card,
  Text,
  InlineStack,
  useCustomer,
} from '@shopify/ui-extensions-react/customer-account';
import { useEffect, useState } from 'react';

export default reactExtension(
  'customer-account.order-index.block.render',
  () => <OrderMembershipBlock />
);

function OrderMembershipBlock() {
  const customer = useCustomer();
  const [storeCredit, setStoreCredit] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCredit = async () => {
      try {
        if (!customer?.id) return;
        
        const customerId = customer.id.split('/').pop();
        const response = await fetch(`https://rewardspro.vercel.app/api/customer/${customerId}`);
        
        if (response.ok) {
          const data = await response.json();
          setStoreCredit(data.storeCredit || 0);
        }
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadCredit();
  }, [customer]);

  if (loading || storeCredit === 0) return null;

  return (
    <Card padding>
      <InlineStack spacing="base" blockAlignment="center">
        <Text size="small" emphasis="bold">
          💰 You have £{storeCredit.toFixed(2)} in store credit
        </Text>
        <Text size="small" appearance="subdued">
          Use on your next order
        </Text>
      </InlineStack>
    </Card>
  );
}