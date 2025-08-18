// extensions/rewardspro-widget/assets/rewards-widget.js

class RewardsWidget {
  constructor(container) {
    this.container = container;
    this.id = container?.id || 'rewards-widget';
    this.contentEl = container?.querySelector('.rp-content') || container;
    this.config = {
      debug: true,
      retryAttempts: 3,
      retryDelay: 1000
    };
    
    console.log(`[RewardsWidget ${this.id}] Initializing...`);
    this.init();
  }

  async init() {
    // Show loading state
    this.showLoading();
    
    // Test proxy connection first
    const testResult = await this.testProxyConnection();
    if (!testResult) {
      console.error('[RewardsWidget] Proxy test failed');
      this.showError('Unable to connect to rewards service');
      return;
    }
    
    // Fetch customer data
    await this.fetchCustomerData();
  }

  async testProxyConnection() {
    try {
      console.log('[RewardsWidget] Testing proxy connection...');
      
      // Use relative URL - Shopify will handle the domain
      const testUrl = '/apps/rewardspro/test';
      console.log('[RewardsWidget] Test URL:', testUrl);
      
      const response = await fetch(testUrl, {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('[RewardsWidget] Proxy test successful:', data);
        return true;
      }
      
      console.error('[RewardsWidget] Proxy test failed with status:', response.status);
      return false;
      
    } catch (error) {
      console.error('[RewardsWidget] Proxy test error:', error);
      return false;
    }
  }

  async fetchCustomerData(attempt = 1) {
    try {
      // Use the proxy endpoint
      const url = '/apps/rewardspro/membership';
      
      console.log(`[RewardsWidget] Fetching customer data (attempt ${attempt})...`);
      console.log('[RewardsWidget] URL:', url);
      console.log('[RewardsWidget] Full URL:', window.location.origin + url);
      
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'same-origin', // Important for cookies
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });

      console.log('[RewardsWidget] Response status:', response.status);
      console.log('[RewardsWidget] Response headers:', response.headers);

      // Handle different response scenarios
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ 
          error: 'Failed to parse error response' 
        }));
        
        console.log('[RewardsWidget] Error response:', errorData);
        
        if (response.status === 401) {
          if (errorData.requiresLogin) {
            console.log('[RewardsWidget] Customer not logged in');
            this.showLoginPrompt();
            return;
          }
          throw new Error('Authentication failed');
        }
        
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log('[RewardsWidget] Received data:', data);
      
      if (data.success) {
        this.updateWidgetData(data);
      } else {
        throw new Error(data.error || 'Invalid response format');
      }
      
    } catch (error) {
      console.error(`[RewardsWidget] Error on attempt ${attempt}:`, error);
      
      // Retry logic
      if (attempt < this.config.retryAttempts) {
        console.log(`[RewardsWidget] Retrying in ${this.config.retryDelay}ms...`);
        setTimeout(() => {
          this.fetchCustomerData(attempt + 1);
        }, this.config.retryDelay);
      } else {
        this.showError(`Error: ${error.message}`);
      }
    }
  }

  updateWidgetData(data) {
    console.log('[RewardsWidget] Updating widget with data:', data);
    
    if (!data || !data.success) {
      this.showError('Invalid data received');
      return;
    }

    const html = `
      <div class="rp-customer-info">
        <h3>Your Rewards</h3>
        
        <div class="rp-stats-grid">
          <div class="rp-stat-card">
            <div class="rp-stat-value">$${(data.balance?.storeCredit || 0).toFixed(2)}</div>
            <div class="rp-stat-label">Store Credit</div>
          </div>
          
          <div class="rp-stat-card">
            <div class="rp-stat-value">${data.membership?.tier?.name || 'Bronze'}</div>
            <div class="rp-stat-label">Current Tier</div>
          </div>
          
          <div class="rp-stat-card">
            <div class="rp-stat-value">${data.membership?.tier?.cashbackPercent || 1}%</div>
            <div class="rp-stat-label">Cashback Rate</div>
          </div>
          
          <div class="rp-stat-card">
            <div class="rp-stat-value">$${(data.balance?.totalEarned || 0).toFixed(2)}</div>
            <div class="rp-stat-label">Total Earned</div>
          </div>
        </div>
        
        <div class="rp-customer-id">
          Customer ID: ${data.customer?.shopifyId || 'Unknown'}
        </div>
        
        ${this.config.debug ? `
        <div class="rp-debug-info">
          <strong>Debug Info:</strong><br>
          Last Synced: ${data.balance?.lastSynced ? new Date(data.balance.lastSynced).toLocaleString() : 'Never'}<br>
          Member Since: ${data.customer?.memberSince ? new Date(data.customer.memberSince).toLocaleDateString() : 'Unknown'}
        </div>
        ` : ''}
      </div>
    `;
    
    this.contentEl.innerHTML = html;
    
    // Update any other elements on the page
    this.updatePageElements(data);
  }

  updatePageElements(data) {
    // Update any elements with data attributes
    const creditElements = document.querySelectorAll('[data-rewards-credit]');
    creditElements.forEach(el => {
      el.textContent = `$${(data.balance?.storeCredit || 0).toFixed(2)}`;
    });
    
    const tierElements = document.querySelectorAll('[data-rewards-tier]');
    tierElements.forEach(el => {
      el.textContent = data.membership?.tier?.name || 'Bronze';
    });
    
    const rateElements = document.querySelectorAll('[data-rewards-rate]');
    rateElements.forEach(el => {
      el.textContent = `${data.membership?.tier?.cashbackPercent || 1}%`;
    });
  }

  showLoading() {
    const loadingHtml = `
      <div class="rp-loading">
        <div class="rp-spinner"></div>
        <p>Loading your rewards...</p>
      </div>
    `;
    this.contentEl.innerHTML = loadingHtml;
  }

  showLoginPrompt() {
    const loginHtml = `
      <div class="rp-login-prompt">
        <h3>Rewards Program</h3>
        <p>Please log in to view your rewards and cashback balance</p>
        <a href="/account/login" class="rp-login-btn">Log In</a>
        <a href="/account/register" class="rp-register-btn">Sign Up</a>
      </div>
    `;
    this.contentEl.innerHTML = loginHtml;
  }

  showError(message) {
    const errorHtml = `
      <div class="rp-error">
        <h3>Unable to Load Rewards</h3>
        <p>${message}</p>
        <button onclick="location.reload()" class="rp-retry-btn">Retry</button>
        
        ${this.config.debug ? `
        <div class="rp-debug-info">
          <strong>Debug Info:</strong><br>
          Error occurred at: ${new Date().toLocaleTimeString()}<br>
          Widget ID: ${this.id}<br>
          Page URL: ${window.location.href}
        </div>
        ` : ''}
      </div>
    `;
    this.contentEl.innerHTML = errorHtml;
  }

  // Utility method to manually test different endpoints
  async debugTest() {
    const endpoints = [
      '/apps/rewardspro/test',
      '/apps/rewardspro/membership',
      '/apps/rewardspro/balance'
    ];

    console.log('[RewardsWidget] Starting debug test...');
    
    for (const endpoint of endpoints) {
      try {
        console.log(`[Debug] Testing ${endpoint}...`);
        const response = await fetch(endpoint, {
          credentials: 'same-origin'
        });
        const data = await response.json().catch(() => null);
        console.log(`[Debug] ${endpoint}:`, {
          status: response.status,
          ok: response.ok,
          data: data
        });
      } catch (error) {
        console.error(`[Debug] ${endpoint} failed:`, error);
      }
    }
    
    console.log('[RewardsWidget] Debug test complete');
  }
}

// Initialize widgets when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('[RewardsWidget] DOM Content Loaded');
  
  // Initialize all widgets with data attribute
  const containers = document.querySelectorAll('[data-rewards-widget]');
  console.log(`[RewardsWidget] Found ${containers.length} widget container(s)`);
  
  containers.forEach((container, index) => {
    console.log(`[RewardsWidget] Initializing widget ${index + 1}`);
    const widget = new RewardsWidget(container);
    
    // Store widget instance for debugging
    if (!window.RewardsWidgets) {
      window.RewardsWidgets = [];
    }
    window.RewardsWidgets.push(widget);
  });
  
  // Also check for legacy selectors
  const legacyContainers = document.querySelectorAll('.rewardspro-widget');
  legacyContainers.forEach((container) => {
    if (!container.hasAttribute('data-rewards-widget')) {
      console.log('[RewardsWidget] Found legacy container, initializing...');
      const widget = new RewardsWidget(container);
      if (!window.RewardsWidgets) {
        window.RewardsWidgets = [];
      }
      window.RewardsWidgets.push(widget);
    }
  });
});

// Global access for debugging
if (typeof window.RewardsWidget === 'undefined') {
  window.RewardsWidget = RewardsWidget;
  
  // Add debug helper
  window.debugRewards = () => {
    console.log('[Debug] Available widgets:', window.RewardsWidgets);
    if (window.RewardsWidgets && window.RewardsWidgets[0]) {
      window.RewardsWidgets[0].debugTest();
    }
  };
  
  console.log('[RewardsWidget] Widget class loaded. Use window.debugRewards() to test endpoints.');
}