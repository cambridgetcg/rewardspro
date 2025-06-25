import {
  extension,
  Card,
  BlockStack,
  Text,
  Heading,
  Badge,
  InlineStack,
  Divider,
  View,
} from '@shopify/ui-extensions/customer-account';

export default extension(
  'customer-account.page.render',
  (root, { customerId }) => {
    // Create the main card
    const app = root.createComponent(
      Card,
      { padding: true },
      [
        root.createComponent(
          BlockStack,
          { spacing: 'loose' },
          [
            // Title
            root.createComponent(Heading, { level: 2 }, 'My Membership'),
            root.createComponent(Divider),
            
            // VIP Status Section
            root.createComponent(
              BlockStack,
              { spacing: 'tight' },
              [
                root.createComponent(
                  Text,
                  { appearance: 'subdued', size: 'small' },
                  'VIP Status'
                ),
                root.createComponent(
                  InlineStack,
                  { spacing: 'tight', blockAlignment: 'center' },
                  [
                    root.createComponent(
                      Badge,
                      { tone: 'info' },
                      'Bronze'
                    ),
                    root.createComponent(
                      Text,
                      { size: 'medium' },
                      '1% Cashback'
                    ),
                  ]
                ),
              ]
            ),
            
            root.createComponent(Divider),
            
            // Cash Credit Section
            root.createComponent(
              BlockStack,
              { spacing: 'tight' },
              [
                root.createComponent(
                  Text,
                  { appearance: 'subdued', size: 'small' },
                  'Cash Credit Balance'
                ),
                root.createComponent(
                  View,
                  {},
                  [
                    root.createComponent(
                      Text,
                      { size: 'large', emphasis: 'bold' },
                      '£0.00'
                    ),
                    root.createComponent(
                      Text,
                      { appearance: 'subdued', size: 'small' },
                      'Available to use on your next order'
                    ),
                  ]
                ),
              ]
            ),
            
            // Temporary notice
            root.createComponent(Divider),
            root.createComponent(
              Text,
              { appearance: 'subdued', size: 'small' },
              'Live data coming soon. Contact support for your current balance.'
            ),
          ]
        )
      ]
    );

    root.appendChild(app);
  }
);