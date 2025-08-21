// extensions/rewardspro-widget/assets/rewards-widget.js
// RewardsPro Widget - Final Production Version

(function() {
  'use strict';

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
      
      // Check saved state
      const savedState = sessionStorage.getItem('rewardspro-widget-state');
      if (savedState === 'minimized') {
        this.isMinimized = true;
        this.minimize(false);
      }
      
      this.setupEventListeners();
      this.init();
    }

    getContextFromLiquid() {
      const blockId = this.container?.dataset?.blockId;
      if (window.RewardsProContext && blockId) {
        return window.RewardsProContext[blockId];
      }
      
      // Fallback detection
      return {
        isLoggedIn: typeof window.ShopifyAnalytics?.meta?.page?.customerId === 'number',
        customerId: window.ShopifyAnalytics?.meta?.page?.customerId || null,
        shopDomain: window.Shopify?.shop || null
      };
    }

    setupEventListeners() {
      // Close button
      if (this.closeBtn) {
        this.closeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.minimize();
        });
      }
      
      // Minimized button
      if (this.minimizedBtn) {
        this.minimizedBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.maximize();
        });
      }
      
      // Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !this.isMinimized) {
          this.minimize();
        }
      });
    }

    minimize(animate = true) {
      this.isMinimized = true;
      
      if (animate) {
        this.container.style.animation = 'rpSlideOut 0.3s ease-out';
        setTimeout(() => {
          this.container.style.display = 'none';
          this.container.style.animation = '';
        }, 300);
      } else {
        this.container.style.display = 'none';
      }
      
      if (this.minimizedBtn) {
        this.minimizedBtn.style.display = 'flex';
        if (animate) {
          this.minimizedBtn.style.animation = 'rpSlideIn 0.3s ease-out';
        }
      }
      
      sessionStorage.setItem('rewardspro-widget-state', 'minimized');
    }

    maximize() {
      this.isMinimized = false;
      
      this.container.style.display = 'block';
      this.container.style.animation = 'rpSlideIn 0.3s ease-out';
      
      if (this.minimizedBtn) {
        this.minimizedBtn.style.animation = 'rpSlideOut 0.3s ease-out';
        setTimeout(() => {
          this.minimizedBtn.style.display = 'none';
          this.minimizedBtn.style.animation = '';
        }, 300);
      }
      
      sessionStorage.setItem('rewardspro-widget-state', 'maximized');
      
      // Load data if not already loaded
      if (!this.dataLoaded && !this.loadingData) {
        this.init();
      }
    }

    async init() {
      if (this.isMinimized) {
        return;
      }
      
      if (this.context && this.context.isLoggedIn === false) {
        this.showLoginPrompt();
        this.dataLoaded = true;
        return;
      }
      
      this.showLoading();
      this.loadingData = true;
      
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

        const contentType = response.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');
        
        if (!isJson) {
          this.showLoginPrompt();
          this.dataLoaded = true;
          return;
        }

        let data;
        try {
          data = await response.json();
        } catch (jsonError) {
          this.showLoginPrompt();
          this.dataLoaded = true;
          return;
        }
        
        if (data.requiresLogin === true) {
          this.showLoginPrompt();
          this.dataLoaded = true;
          return;
        }
        
        if (data.error && (
          data.error.toLowerCase().includes('not logged in') ||
          data.error.toLowerCase().includes('missing customer') ||
          data.error.toLowerCase().includes('auth')
        )) {
          this.showLoginPrompt();
          this.dataLoaded = true;
          return;
        }
        
        if (data.success) {
          this.updateWidgetData(data);
          return;
        }
        
        throw new Error(data.error || `HTTP ${response.status}`);
        
      } catch (error) {
        if (!this.context?.isLoggedIn || 
            error.message.includes('404') || 
            error.message.includes('401')) {
          this.showLoginPrompt();
          this.dataLoaded = true;
          return;
        }
        
        if (attempt < this.retryAttempts) {
          setTimeout(() => {
            this.fetchCustomerData(attempt + 1);
          }, this.retryDelay);
        } else {
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
      this.dataLoaded = true;
    }

    updatePageElements(data) {
      const creditElements = document.querySelectorAll('[data-rewards-credit]');
      creditElements.forEach(el => {
        const formattedCredit = `$${(data.balance?.storeCredit || 0).toFixed(2)}`;
        el.textContent = formattedCredit;
        
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
  function initWidgets() {
    const containers = document.querySelectorAll('[data-rewards-widget]');
    
    containers.forEach((container) => {
      if (!container.dataset.widgetInitialized) {
        new RewardsWidget(container);
        container.dataset.widgetInitialized = 'true';
      }
    });
    
    // Legacy selector support
    const legacyContainers = document.querySelectorAll('.rewardspro-widget');
    legacyContainers.forEach((container) => {
      if (!container.hasAttribute('data-rewards-widget') && !container.dataset.widgetInitialized) {
        new RewardsWidget(container);
        container.dataset.widgetInitialized = 'true';
      }
    });
  }

  // DOM ready handler
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidgets);
  } else {
    initWidgets();
  }

  // Export for global access
  window.RewardsWidget = RewardsWidget;

})();