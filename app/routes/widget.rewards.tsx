// app/routes/widget.rewards.tsx
// This creates an embeddable widget for Shopify themes
import type { LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  
  // Get parameters from the script tag
  const position = url.searchParams.get('position') || 'bottom-right';
  const theme = url.searchParams.get('theme') || 'light';
  const buttonText = url.searchParams.get('text') || 'Rewards';

  const widgetScript = `
(function() {
  // Prevent multiple loads
  if (window.RewardsWidgetLoaded) return;
  window.RewardsWidgetLoaded = true;

  // Widget Configuration
  const config = {
    position: '${position}',
    theme: '${theme}',
    buttonText: '${buttonText}',
    apiUrl: '${url.origin}'
  };

  // Widget Styles
  const styles = \`
    /* Reset and Base Styles */
    #rewards-widget * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* Floating Button */
    #rewards-widget-button {
      position: fixed;
      \${config.position.includes('bottom') ? 'bottom: 20px;' : 'top: 20px;'}
      \${config.position.includes('right') ? 'right: 20px;' : 'left: 20px;'}
      width: 60px;
      height: 60px;
      border-radius: 30px;
      background: #8b5cf6;
      color: white;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 99998;
      transition: all 0.3s ease;
    }

    #rewards-widget-button:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 20px rgba(139, 92, 246, 0.4);
    }

    #rewards-widget-button.expanded {
      width: auto;
      padding: 0 20px;
    }

    #rewards-widget-button-text {
      display: none;
      margin-left: 8px;
      font-weight: 500;
      font-size: 14px;
    }

    #rewards-widget-button.expanded #rewards-widget-button-text {
      display: block;
    }

    /* Widget Panel */
    #rewards-widget-panel {
      position: fixed;
      \${config.position.includes('bottom') ? 'bottom: 90px;' : 'top: 90px;'}
      \${config.position.includes('right') ? 'right: 20px;' : 'left: 20px;'}
      width: 380px;
      max-width: calc(100vw - 40px);
      background: \${config.theme === 'dark' ? '#1a1a1a' : 'white'};
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
      z-index: 99999;
      opacity: 0;
      transform: translateY(20px);
      pointer-events: none;
      transition: all 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    #rewards-widget-panel.active {
      opacity: 1;
      transform: translateY(0);
      pointer-events: all;
    }

    /* Panel Header */
    .rewards-widget-header {
      padding: 20px;
      border-bottom: 1px solid \${config.theme === 'dark' ? '#333' : '#e5e7eb'};
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .rewards-widget-title {
      font-size: 18px;
      font-weight: 600;
      color: \${config.theme === 'dark' ? 'white' : '#1a1a1a'};
    }

    .rewards-widget-close {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: \${config.theme === 'dark' ? '#999' : '#666'};
      line-height: 1;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: all 0.2s;
    }

    .rewards-widget-close:hover {
      background: \${config.theme === 'dark' ? '#333' : '#f3f4f6'};
    }

    /* Panel Content */
    .rewards-widget-content {
      padding: 20px;
      max-height: 400px;
      overflow-y: auto;
    }

    /* Loading State */
    .rewards-widget-loading {
      text-align: center;
      padding: 40px;
      color: \${config.theme === 'dark' ? '#999' : '#666'};
    }

    /* Balance Display */
    .rewards-widget-balance {
      background: \${config.theme === 'dark' ? '#2a2a2a' : '#f8f9fa'};
      border-radius: 8px;
      padding: 24px;
      text-align: center;
      margin-bottom: 20px;
    }

    .rewards-widget-balance-label {
      font-size: 13px;
      color: \${config.theme === 'dark' ? '#999' : '#666'};
      margin-bottom: 8px;
    }

    .rewards-widget-balance-amount {
      font-size: 32px;
      font-weight: 700;
      color: #8b5cf6;
      margin-bottom: 4px;
    }

    .rewards-widget-balance-earned {
      font-size: 12px;
      color: \${config.theme === 'dark' ? '#999' : '#999'};
    }

    /* Tier Badge */
    .rewards-widget-tier {
      display: inline-block;
      padding: 4px 12px;
      background: #8b5cf6;
      color: white;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }

    /* Stats Grid */
    .rewards-widget-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 20px;
    }

    .rewards-widget-stat {
      background: \${config.theme === 'dark' ? '#2a2a2a' : '#f8f9fa'};
      padding: 16px;
      border-radius: 8px;
      text-align: center;
    }

    .rewards-widget-stat-value {
      font-size: 20px;
      font-weight: 600;
      color: \${config.theme === 'dark' ? 'white' : '#1a1a1a'};
      display: block;
      margin-bottom: 4px;
    }

    .rewards-widget-stat-label {
      font-size: 12px;
      color: \${config.theme === 'dark' ? '#999' : '#666'};
    }

    /* Login Prompt */
    .rewards-widget-login {
      text-align: center;
      padding: 40px 20px;
    }

    .rewards-widget-login h3 {
      color: \${config.theme === 'dark' ? 'white' : '#1a1a1a'};
      margin-bottom: 12px;
      font-size: 18px;
    }

    .rewards-widget-login p {
      color: \${config.theme === 'dark' ? '#999' : '#666'};
      margin-bottom: 20px;
      font-size: 14px;
    }

    .rewards-widget-login-button {
      display: inline-block;
      padding: 12px 24px;
      background: #8b5cf6;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      transition: background 0.2s;
    }

    .rewards-widget-login-button:hover {
      background: #7c3aed;
    }

    /* Progress Bar */
    .rewards-widget-progress {
      margin-top: 20px;
    }

    .rewards-widget-progress-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;
    }

    .rewards-widget-progress-label {
      color: \${config.theme === 'dark' ? '#999' : '#666'};
    }

    .rewards-widget-progress-value {
      color: #8b5cf6;
      font-weight: 500;
    }

    .rewards-widget-progress-bar {
      height: 8px;
      background: \${config.theme === 'dark' ? '#333' : '#e5e7eb'};
      border-radius: 4px;
      overflow: hidden;
    }

    .rewards-widget-progress-fill {
      height: 100%;
      background: #8b5cf6;
      transition: width 0.3s ease;
    }

    /* Mobile Responsive */
    @media (max-width: 480px) {
      #rewards-widget-panel {
        width: calc(100vw - 20px);
        \${config.position.includes('bottom') ? 'bottom: 10px;' : 'top: 10px;'}
        \${config.position.includes('right') ? 'right: 10px;' : 'left: 10px;'}
      }

      #rewards-widget-button {
        \${config.position.includes('bottom') ? 'bottom: 10px;' : 'top: 10px;'}
        \${config.position.includes('right') ? 'right: 10px;' : 'left: 10px;'}
      }
    }
  \`;

  // Add styles to page
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);

  // Create widget HTML
  const widgetHTML = \`
    <button id="rewards-widget-button" aria-label="Open rewards panel">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
      </svg>
      <span id="rewards-widget-button-text">\${config.buttonText}</span>
    </button>

    <div id="rewards-widget-panel">
      <div class="rewards-widget-header">
        <h2 class="rewards-widget-title">My Rewards</h2>
        <button class="rewards-widget-close" aria-label="Close panel">&times;</button>
      </div>
      <div class="rewards-widget-content" id="rewards-widget-content">
        <div class="rewards-widget-loading">Loading...</div>
      </div>
    </div>
  \`;

  // Add widget to page
  const widgetContainer = document.createElement('div');
  widgetContainer.id = 'rewards-widget';
  widgetContainer.innerHTML = widgetHTML;
  document.body.appendChild(widgetContainer);

  // Widget functionality
  const button = document.getElementById('rewards-widget-button');
  const panel = document.getElementById('rewards-widget-panel');
  const closeBtn = document.querySelector('.rewards-widget-close');
  const content = document.getElementById('rewards-widget-content');

  let isOpen = false;
  let customerData = null;

  // Toggle panel
  function togglePanel() {
    isOpen = !isOpen;
    panel.classList.toggle('active', isOpen);
    
    if (isOpen && !customerData) {
      loadCustomerData();
    }
  }

  // Load customer data
  function loadCustomerData() {
    // Check if customer is logged in (Shopify provides this)
    const customerId = window.ShopifyAnalytics?.meta?.page?.customerId || 
                      document.querySelector('meta[name="customer-id"]')?.content;

    if (!customerId) {
      showLoginPrompt();
      return;
    }

    // In a real implementation, you'd call your API here
    // For now, we'll show mock data
    setTimeout(() => {
      customerData = {
        balance: 25.50,
        earned: 125.75,
        tier: 'Gold',
        orders: 12,
        cashbackRate: 5,
        nextTier: {
          name: 'Platinum',
          progress: 75,
          remaining: 250
        }
      };
      showCustomerData(customerData);
    }, 1000);
  }

  // Show login prompt
  function showLoginPrompt() {
    content.innerHTML = \`
      <div class="rewards-widget-login">
        <h3>Join Our Rewards Program</h3>
        <p>Sign in to view your rewards balance and start earning cashback on every purchase!</p>
        <a href="/account/login" class="rewards-widget-login-button">Sign In</a>
      </div>
    \`;
  }

  // Show customer data
  function showCustomerData(data) {
    content.innerHTML = \`
      <div class="rewards-widget-balance">
        <div class="rewards-widget-balance-label">Available Balance</div>
        <div class="rewards-widget-balance-amount">$\${data.balance.toFixed(2)}</div>
        <div class="rewards-widget-balance-earned">Total earned: $\${data.earned.toFixed(2)}</div>
      </div>

      <div class="rewards-widget-stats">
        <div class="rewards-widget-stat">
          <span class="rewards-widget-stat-value">\${data.orders}</span>
          <div class="rewards-widget-stat-label">Orders</div>
        </div>
        <div class="rewards-widget-stat">
          <span class="rewards-widget-stat-value">\${data.cashbackRate}%</span>
          <div class="rewards-widget-stat-label">Cashback</div>
        </div>
      </div>

      \${data.nextTier ? \`
        <div class="rewards-widget-progress">
          <div class="rewards-widget-progress-header">
            <span class="rewards-widget-progress-label">Progress to \${data.nextTier.name}</span>
            <span class="rewards-widget-progress-value">\${data.nextTier.progress}%</span>
          </div>
          <div class="rewards-widget-progress-bar">
            <div class="rewards-widget-progress-fill" style="width: \${data.nextTier.progress}%"></div>
          </div>
          <div style="margin-top: 8px; font-size: 12px; color: \${config.theme === 'dark' ? '#999' : '#666'};">
            Spend $\${data.nextTier.remaining} more to unlock next tier
          </div>
        </div>
      \` : ''}
    \`;
  }

  // Event listeners
  button.addEventListener('click', togglePanel);
  closeBtn.addEventListener('click', togglePanel);

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (isOpen && !widgetContainer.contains(e.target)) {
      togglePanel();
    }
  });

  // Expand button on hover
  let hoverTimeout;
  button.addEventListener('mouseenter', () => {
    hoverTimeout = setTimeout(() => {
      button.classList.add('expanded');
    }, 300);
  });

  button.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimeout);
    button.classList.remove('expanded');
  });

  // Initialize
  console.log('Rewards widget loaded successfully');
})();
`;

  return new Response(widgetScript, {
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "public, max-age=3600",
    },
  });
}