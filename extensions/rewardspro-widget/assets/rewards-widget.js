// extensions/rewardspro-widget/assets/rewards-widget.js
class RewardsWidget {
  constructor(container) {
    this.container = container;
    this.id = container?.id || 'rewards-widget';
    this.contentEl = container?.querySelector('.rp-content') || container;
    this.retryAttempts = 3;
    this.retryDelay = 1000;
    this.context = this.getContextFromLiquid();
    
    this.init();
  }

  getContextFromLiquid() {
    const blockId = this.container?.dataset?.blockId;
    if (window.RewardsProContext && blockId) {
      return window.RewardsProContext[blockId];
    }
    
    // Fallback: detect Shopify customer
    return {
      isLoggedIn: typeof window.ShopifyAnalytics?.meta?.page?.customerId === 'number',
      customerId: window.ShopifyAnalytics?.meta?.page?.customerId || null,
      shopDomain: window.Shopify?.shop || null
    };
  }

  async init() {
    // If customer is not logged in, show login prompt immediately
    if (this.context && this.context.isLoggedIn === false) {
      this.showLoginPrompt();
      return;
    }
    
    // Show loading state while fetching data
    this.showLoading();
    
    // Fetch customer data
    await this.fetchCustomerData();
  }

  async fetchCustomerData(attempt = 1) {
    try {
      const url = '/apps/rewardspro/membership';
      
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');
      
      if (!isJson) {
        // Non-JSON response usually means app proxy not configured or user not logged in
        this.showLoginPrompt();
        return;
      }

      // Parse JSON response
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        this.showLoginPrompt();
        return;
      }
      
      // Check if login is required
      if (data.requiresLogin === true) {
        this.showLoginPrompt();
        return;
      }
      
      // Check for errors that indicate login is needed
      if (data.error && (
        data.error.toLowerCase().includes('not logged in') ||
        data.error.toLowerCase().includes('missing customer') ||
        data.error.toLowerCase().includes('auth')
      )) {
        this.showLoginPrompt();
        return;
      }
      
      // Handle successful response
      if (data.success) {
        this.updateWidgetData(data);
        return;
      }
      
      // Handle other errors with retry
      throw new Error(data.error || `HTTP ${response.status}`);
      
    } catch (error) {
      // Check if we should show login prompt
      if (!this.context?.isLoggedIn || 
          error.message.includes('404') || 
          error.message.includes('401')) {
        this.showLoginPrompt();
        return;
      }
      
      // Retry logic for actual errors
      if (attempt < this.retryAttempts) {
        setTimeout(() => {
          this.fetchCustomerData(attempt + 1);
        }, this.retryDelay);
      } else {
        // Final fallback - show login prompt
        this.showLoginPrompt();
      }
    }
  }

  updateWidgetData(data) {
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
        
        <div class="rp-actions">
          <a href="/account" class="rp-action-link">View Account →</a>
        </div>
      </div>
    `;
    
    this.contentEl.innerHTML = html;
    this.updatePageElements(data);
  }

  updatePageElements(data) {
    // Update any elements on the page with rewards data
    const creditElements = document.querySelectorAll('[data-rewards-credit]');
    creditElements.forEach(el => {
      el.textContent = `$${(data.balance?.storeCredit || 0).toFixed(2)}`;
    });
    
    const tierElements = document.querySelectorAll('[data-rewards-tier]');
    tierElements.forEach(el => {
      el.textContent = data.membership?.tier?.name || 'Bronze';
    });
    
    const cashbackElements = document.querySelectorAll('[data-rewards-cashback]');
    cashbackElements.forEach(el => {
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
      </div>
    `;
    this.contentEl.innerHTML = errorHtml;
  }
}

// Initialize widgets when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Find all widget containers
  const containers = document.querySelectorAll('[data-rewards-widget]');
  
  containers.forEach((container) => {
    new RewardsWidget(container);
  });
  
  // Also check for legacy selectors
  const legacyContainers = document.querySelectorAll('.rewardspro-widget');
  legacyContainers.forEach((container) => {
    if (!container.hasAttribute('data-rewards-widget')) {
      new RewardsWidget(container);
    }
  });
});

// Export for global access if needed
window.RewardsWidget = RewardsWidget;