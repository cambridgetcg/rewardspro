// extensions/rewardspro-widget/assets/rewards-widget.js
class RewardsWidget {
  constructor(container) {
    this.container = container;
    this.id = container?.id || 'rewards-widget';
    this.contentEl = container?.querySelector('.rp-content') || container;
    this.closeBtn = container?.querySelector('.rp-close-btn');
    this.minimizedBtn = container?.parentElement?.querySelector('.rp-minimized') || 
                        document.querySelector('.rp-minimized');
    this.retryAttempts = 3;
    this.retryDelay = 1000;
    this.context = this.getContextFromLiquid();
    this.isMinimized = false;
    this.dataLoaded = false;
    this.loadingData = false;
    
    // Check if widget should start minimized (from session storage)
    const savedState = sessionStorage.getItem('rewardspro-widget-state');
    if (savedState === 'minimized') {
      this.isMinimized = true;
      this.minimize(false); // Don't animate on initial load
    }
    
    this.setupEventListeners();
    this.init();
  }

  setupEventListeners() {
    // Close button click
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => {
        this.minimize();
      });
    }
    
    // Minimized button click
    if (this.minimizedBtn) {
      this.minimizedBtn.addEventListener('click', () => {
        this.maximize();
      });
    }
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.isMinimized) {
        this.minimize();
      }
    });
  }

  minimize(animate = true) {
    this.isMinimized = true;
    
    // Hide main widget
    if (animate) {
      this.container.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => {
        this.container.style.display = 'none';
        this.container.style.animation = '';
      }, 300);
    } else {
      this.container.style.display = 'none';
    }
    
    // Show minimized button
    if (this.minimizedBtn) {
      this.minimizedBtn.style.display = 'flex';
      if (animate) {
        this.minimizedBtn.style.animation = 'slideIn 0.3s ease-out';
      }
    }
    
    // Save state
    sessionStorage.setItem('rewardspro-widget-state', 'minimized');
  }

  maximize() {
    this.isMinimized = false;
    
    // Show main widget
    this.container.style.display = 'block';
    this.container.style.animation = 'slideIn 0.3s ease-out';
    
    // Hide minimized button
    if (this.minimizedBtn) {
      this.minimizedBtn.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => {
        this.minimizedBtn.style.display = 'none';
        this.minimizedBtn.style.animation = '';
      }, 300);
    }
    
    // Save state
    sessionStorage.setItem('rewardspro-widget-state', 'maximized');
    
    // Initialize data if not already loaded
    if (!this.dataLoaded && !this.loadingData) {
      this.init();
    }
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
    // Don't fetch data if minimized
    if (this.isMinimized) {
      return;
    }
    
    // If customer is not logged in, show login prompt immediately
    if (this.context && this.context.isLoggedIn === false) {
      this.showLoginPrompt();
      this.dataLoaded = true;
      return;
    }
    
    // Show loading state while fetching data
    this.showLoading();
    this.loadingData = true;
    
    // Fetch customer data
    await this.fetchCustomerData();
    this.loadingData = false;
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
        this.dataLoaded = true;
        return;
      }

      // Parse JSON response
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        this.showLoginPrompt();
        this.dataLoaded = true;
        return;
      }
      
      // Check if login is required
      if (data.requiresLogin === true) {
        this.showLoginPrompt();
        this.dataLoaded = true;
        return;
      }
      
      // Check for errors that indicate login is needed
      if (data.error && (
        data.error.toLowerCase().includes('not logged in') ||
        data.error.toLowerCase().includes('missing customer') ||
        data.error.toLowerCase().includes('auth')
      )) {
        this.showLoginPrompt();
        this.dataLoaded = true;
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
        this.dataLoaded = true;
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
        this.dataLoaded = true;
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
            <div class="rp-stat-value">${(data.balance?.storeCredit || 0).toFixed(2)}</div>
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
            <div class="rp-stat-value">${(data.balance?.totalEarned || 0).toFixed(2)}</div>
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
    this.dataLoaded = true;
  }

  updatePageElements(data) {
    // Update any elements on the page with rewards data
    const creditElements = document.querySelectorAll('[data-rewards-credit]');
    creditElements.forEach(el => {
      const formattedCredit = `${(data.balance?.storeCredit || 0).toFixed(2)}`;
      el.textContent = formattedCredit;
      
      // Show value in minimized button if it has credit
      if (el.classList.contains('rp-mini-value') && data.balance?.storeCredit > 0) {
        el.style.display = 'inline-block';
      }
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
    this.dataLoaded = true;
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
    this.dataLoaded = true;
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