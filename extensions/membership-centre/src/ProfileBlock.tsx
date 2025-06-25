import {
  reactExtension,
  BlockStack,
  Card,
  Text,
  InlineStack,
  Badge,
  useCustomer,
} from '@shopify/ui-extensions-react/customer-account';
import { useEffect, useState } from 'react';

interface TierInfo {
  displayName: string;
  level: number;
  cashbackPercent: number;
}

interface MembershipData {
  tier: TierInfo;
  storeCredit: number;
}

export default reactExtension(
  'customer-account.profile.block.render',
  () => <ProfileMembershipBlock />
);

function ProfileMembershipBlock() {
  const customer = useCustomer();
  const [data, setData] = useState<MembershipData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        if (!customer?.id) return;
        
        const customerId = customer.id.split('/').pop();
        const response = await fetch(`https://rewardspro.vercel.app/api/customer/${customerId}`);
        
        if (response.ok) {
          const result = await response.json();
          setData({
            tier: result.tier || { displayName: 'Bronze', level: 1, cashbackPercent: 1 },
            storeCredit: result.storeCredit || 0
          });
        }
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [customer]);

  if (loading || !data) return null;

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