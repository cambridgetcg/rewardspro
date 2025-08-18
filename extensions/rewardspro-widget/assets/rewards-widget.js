// extensions/rewardspro-widget/assets/rewards-widget.js
// Fixed version with better error handling and login detection

class RewardsWidget {
  constructor(container) {
    this.container = container;
    this.id = container?.id || 'rewards-widget';
    this.contentEl = container?.querySelector('.rp-content') || container;
    this.config = {
      debug: false,  // Set to false for production
      retryAttempts: 3,
      retryDelay: 1000
    };
    
    // Check if we have customer context from Liquid
    this.context = this.getContextFromLiquid();
    
    console.log(`[RewardsWidget ${this.id}] Initializing...`);
    this.init();
  }

  getContextFromLiquid() {
    // Try to get context from the Liquid template
    const blockId = this.container?.dataset?.blockId;
    if (window.RewardsProContext && blockId) {
      return window.RewardsProContext[blockId];
    }
    // Fallback: try to detect if Shopify customer is logged in
    return {
      isLoggedIn: typeof window.ShopifyAnalytics?.meta?.page?.customerId === 'number',
      customerId: window.ShopifyAnalytics?.meta?.page?.customerId || null
    };
  }

  async init() {
    // If we know the customer is not logged in from Liquid context, show login prompt immediately
    if (this.context && this.context.isLoggedIn === false) {
      console.log('[RewardsWidget] Customer not logged in (detected from context) - showing login prompt');
      this.showLoginPrompt();
      return;
    }
    
    // Show loading state
    this.showLoading();
    
    // Fetch customer data
    await this.fetchCustomerData();
  }

  async fetchCustomerData(attempt = 1) {
    try {
      const url = '/apps/rewardspro/membership';
      
      console.log(`[RewardsWidget] Fetching customer data (attempt ${attempt})...`);
      
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });

      console.log('[RewardsWidget] Response status:', response.status);
      
      // Check if response is JSON before trying to parse
      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');
      
      if (!isJson) {
        console.warn('[RewardsWidget] Response is not JSON, likely HTML error page or app proxy not configured');
        console.log('[RewardsWidget] Content-Type:', contentType);
        
        // If we get HTML back, it's likely the app proxy isn't configured
        // or the user is not logged in - show login prompt as fallback
        if (response.status === 404 || response.status === 401 || !this.context?.isLoggedIn) {
          console.log('[RewardsWidget] Showing login prompt due to non-JSON response');
          this.showLoginPrompt();
          return;
        }
        
        throw new Error('Invalid response format - expected JSON but got ' + (contentType || 'unknown'));
      }

      // Now safe to parse JSON
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('[RewardsWidget] Failed to parse JSON:', jsonError);
        // If JSON parsing fails but we expected JSON, show login prompt as safe fallback
        this.showLoginPrompt();
        return;
      }
      
      console.log('[RewardsWidget] Received data:', data);
      
      // Check if user is not logged in (this is not an error!)
      if (data.requiresLogin || data.error === "Not logged in" || data.error === "Missing customer parameter") {
        console.log('[RewardsWidget] Customer not logged in - showing login prompt');
        this.showLoginPrompt();
        return;
      }
      
      // Check for actual errors
      if (!response.ok && response.status !== 401) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      
      // Success - show the data
      if (data.success) {
        this.updateWidgetData(data);
      } else if (data.error) {
        // If there's an error but it might be login-related, show login prompt
        if (data.error.toLowerCase().includes('login') || 
            data.error.toLowerCase().includes('customer') ||
            data.error.toLowerCase().includes('auth')) {
          this.showLoginPrompt();
          return;
        }
        throw new Error(data.error);
      }
      
    } catch (error) {
      console.error(`[RewardsWidget] Error on attempt ${attempt}:`, error);
      
      // If it's a network error or similar, and we're not logged in, show login prompt
      if (!this.context?.isLoggedIn) {
        console.log('[RewardsWidget] Error occurred and customer not logged in - showing login prompt');
        this.showLoginPrompt();
        return;
      }
      
      // Retry logic for actual errors (not login issues)
      if (attempt < this.config.retryAttempts) {
        console.log(`[RewardsWidget] Retrying in ${this.config.retryDelay}ms...`);
        setTimeout(() => {
          this.fetchCustomerData(attempt + 1);
        }, this.config.retryDelay);
      } else {
        // Final fallback - if all retries failed and we can't determine login status, 
        // show login prompt instead of error
        if (error.message.includes('Invalid response format') || 
            error.message.includes('404') || 
            error.message.includes('Failed to fetch')) {
          console.log('[RewardsWidget] Showing login prompt as final fallback');
          this.showLoginPrompt();
        } else {
          this.showError(`Unable to load rewards. Please try again later.`);
        }
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
        <h3>🎁 Your Rewards</h3>
        
        <div class="rp-stats-grid">
          <div class="rp-stat-card rp-stat-card-primary">
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
        
        <div class="rp-customer-details">
          <p class="rp-customer-id">Customer ID: ${data.customer?.shopifyId || 'Unknown'}</p>
          ${data.customer?.memberSince ? `
            <p class="rp-member-since">Member since: ${new Date(data.customer.memberSince).toLocaleDateString()}</p>
          ` : ''}
        </div>
        
        ${this.config.debug && data.debug ? `
        <div class="rp-debug-info">
          <strong>Debug Info:</strong><br>
          Database Connected: ${data.debug.databaseConnected ? '✅' : '❌'}<br>
          Customer UUID: ${data.debug.customerId || 'N/A'}<br>
          Last Synced: ${data.balance?.lastSynced ? new Date(data.balance.lastSynced).toLocaleString() : 'Never'}<br>
          Created: ${data.debug?.createdAt ? new Date(data.debug.createdAt).toLocaleString() : 'Unknown'}
        </div>
        ` : ''}
      </div>
    `;
    
    this.contentEl.innerHTML = html;
    this.updatePageElements(data);
  }

  updatePageElements(data) {
    // Update any elements on the page with data attributes
    const creditElements = document.querySelectorAll('[data-rewards-credit]');
    creditElements.forEach(el => {
      el.textContent = `$${(data.balance?.storeCredit || 0).toFixed(2)}`;
    });
    
    const tierElements = document.querySelectorAll('[data-rewards-tier]');
    tierElements.forEach(el => {
      el.textContent = data.membership?.tier?.name || 'Bronze';
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
        <div class="rp-login-icon">🎁</div>
        <h3>Join Our Rewards Program!</h3>
        <p class="rp-login-message">
          Earn cashback on every purchase and unlock exclusive benefits as a member.
        </p>
        
        <div class="rp-benefits">
          <div class="rp-benefit">
            <span class="rp-benefit-icon">💰</span>
            <span>Earn cashback on all orders</span>
          </div>
          <div class="rp-benefit">
            <span class="rp-benefit-icon">⭐</span>
            <span>Unlock higher tier benefits</span>
          </div>
          <div class="rp-benefit">
            <span class="rp-benefit-icon">🎯</span>
            <span>Get exclusive member offers</span>
          </div>
        </div>
        
        <div class="rp-login-actions">
          <a href="/account/login" class="rp-login-btn rp-btn-primary">
            Sign In
          </a>
          <a href="/account/register" class="rp-register-btn rp-btn-secondary">
            Create Account
          </a>
        </div>
        
        <p class="rp-login-footer">
          Already have an account? Sign in to view your rewards balance.
        </p>
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

  // Utility method for manual testing
  async debugTest() {
    const endpoints = [
      '/apps/rewardspro/test',
      '/apps/rewardspro/membership'
    ];

    console.log('[RewardsWidget] Starting debug test...');
    
    for (const endpoint of endpoints) {
      try {
        console.log(`[Debug] Testing ${endpoint}...`);
        const response = await fetch(endpoint, {
          credentials: 'same-origin'
        });
        
        const contentType = response.headers.get('content-type');
        console.log(`[Debug] ${endpoint} Content-Type:`, contentType);
        
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          console.log(`[Debug] ${endpoint}:`, {
            status: response.status,
            ok: response.ok,
            data: data
          });
        } else {
          const text = await response.text();
          console.log(`[Debug] ${endpoint} returned non-JSON:`, {
            status: response.status,
            contentType: contentType,
            preview: text.substring(0, 200)
          });
        }
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