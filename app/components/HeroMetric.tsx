import { BlockStack, InlineStack, Text, Badge, Box } from "@shopify/polaris";

interface HeroMetricProps {
  label: string;
  value: string;
  change?: { value: string; trend: "up" | "down" };
  aside?: { label: string; value: string }[];
}

/**
 * Hero metric — one big number with optional supporting stats.
 * Use once per page for the most important metric.
 */
export function HeroMetric({ label, value, change, aside }: HeroMetricProps) {
  return (
    <Box
      paddingBlock="500"
      paddingInline="600"
      background="bg-surface"
      borderRadius="300"
      borderWidth="025"
      borderColor="border"
    >
      <InlineStack align="space-between" blockAlign="end" wrap={false}>
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" tone="subdued">
            {label}
          </Text>
          <InlineStack gap="300" blockAlign="end">
            <Text as="p" variant="heading3xl" fontWeight="bold">
              {value}
            </Text>
            {change && (
              <Badge tone={change.trend === "up" ? "success" : "critical"}>
                {`${change.trend === "up" ? "↑" : "↓"} ${change.value}`}
              </Badge>
            )}
          </InlineStack>
        </BlockStack>

        {aside && aside.length > 0 && (
          <InlineStack gap="600">
            {aside.map((item) => (
              <BlockStack gap="050" key={item.label}>
                <Text as="p" variant="bodySm" tone="subdued">
                  {item.label}
                </Text>
                <Text as="p" variant="headingMd" fontWeight="semibold">
                  {item.value}
                </Text>
              </BlockStack>
            ))}
          </InlineStack>
        )}
      </InlineStack>
    </Box>
  );
}
