import { Card, BlockStack, Text, Badge, Box, InlineStack } from "@shopify/polaris";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
}

export function StatCard({ title, value, subtitle, trend, trendValue }: StatCardProps) {
  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm" tone="subdued">
            {title}
          </Text>
          <Text as="p" variant="heading2xl" fontWeight="bold">
            {value}
          </Text>
          {(subtitle || trendValue) && (
            <InlineStack gap="200" blockAlign="center">
              {trend && trend !== "neutral" && (
                <Text as="span" tone={trend === "up" ? "success" : "critical"}>
                  {trend === "up" ? "↑" : "↓"}
                </Text>
              )}
              {trendValue && (
                <Badge
                  tone={
                    trend === "up"
                      ? "success"
                      : trend === "down"
                        ? "critical"
                        : "info"
                  }
                >
                  {trendValue}
                </Badge>
              )}
              {subtitle && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {subtitle}
                </Text>
              )}
            </InlineStack>
          )}
        </BlockStack>
      </Box>
    </Card>
  );
}
