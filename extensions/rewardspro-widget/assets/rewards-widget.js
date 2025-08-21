// extensions/rewardspro-widget/assets/rewards-widget.js
// RewardsPro Widget - Production Version

(function() {
  'use strict';

  /**
   * RewardsWidget Class
   * Handles the rewards widget functionality
   */
  class RewardsWidget {
    constructor(container) {
      // Core elements
      this.container = container;
      this.id = container.id || 'rewards-widget';
      this.contentEl = container.querySelector('.rp-content');
      this.closeBtn = container.querySelector('.rp-close-btn');
      this.minimizedBtn = document.querySelector('.rp-minimized');
      
      // Configuration
      this.config = {
        retryAttempts: 3,
        retryDelay: 1000,
        animationDuration: 300,
        storageKey: 'rewardspro-widget-state'
      };
      
      // State
      this.state = {
        isMinimized: false,
        isLoading: false,
        dataLoaded: false,
        customerData: null
      };
      
      // Get context from Liquid template
      this.context = this.getContext();
      
      // Initialize
      this.init();
    }

    /**
     * Get context data from Liquid template
     */
    getContext() {
      const blockId = this.container.dataset.blockId;
      const contextEl = document.querySelector(`script[data-rewards-context="${blockId}"]`);
      
      if (contextEl) {
        try {
          return JSON.parse(contextEl.textContent);
        } catch (e) {
          console.warn('Failed to parse context data');
        }
      }
      
      // Fallback: detect from Shopify analytics
      return {
        isLoggedIn: this.isCustomerLoggedIn(),
        customerId: this.getCustomerId(),
        shopDomain: window.Shopify?.shop || null,
        apiUrl: '/apps/rewardspro/membership',
        settings: {}
      };
    }

    /**
     * Check if customer is logged in
     */
    isCustomerLoggedIn() {
      // Multiple detection methods for compatibility
      return !!(
        window.ShopifyAnalytics?.meta?.page?.customerId ||
        window.meta?.page?.customerId ||
        document.querySelector('body').classList.contains('customer-logged-in')
      );
    }

    /**
     * Get customer ID
     */
    getCustomerId() {
      return window.ShopifyAnalytics?.meta?.page?.customerId || 
             window.meta?.page?.customerId || 
             null;
    }

    /**
     * Initialize widget
     */
    init() {
      // Check saved state
      const savedState = this.getSavedState();
      if (savedState === 'minimized') {
        this.state.isMinimized = true;
        this.minimize(false);
      }
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Load data if visible
      if (!this.state.isMinimized) {
        this.loadData();
      }
      
      // Handle auto-open
      if (this.context.settings?.autoOpen && !this.state.isMinimized) {
        setTimeout(() => {
          if (this.state.isMinimized) {
            this.maximize();
          }
        }, this.context.settings.openDelay || 3000);
      }
    }

    /**
     * Setup event listeners
     */
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
      
      // Keyboard shortcut (Escape)
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !this.state.isMinimized) {
          this.minimize();
        }
      });
      
      // Handle visibility change (browser tab switching)
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !this.state.isMinimized && !this.state.dataLoaded) {
          this.loadData();
        }
      });
    }

    /**
     * Load customer data
     */
    loadData() {
      // Check if already loading or loaded
      if (this.state.isLoading || this.state.dataLoaded) {
        return;
      }
      
      // Check if customer is logged in
      if (!this.context.isLoggedIn) {
        this.showLoginPrompt();
        this.state.dataLoaded = true;
        return;
      }
      
      // Show loading state
      this.showLoading();
      
      // Fetch data
      this.fetchCustomerData();
    }

    /**
     * Fetch customer data from API
     */
    async fetchCustomerData(attempt = 1) {
      this.state.isLoading = true;
      
      try {
        // Build URL with query parameters
        const url = new URL(this.context.apiUrl, window.location.origin);
        
        // Add query parameters if available
        if (this.context.customerId) {
          url.searchParams.append('customer_id', this.context.customerId);
        }
        if (this.context.shopDomain) {
          url.searchParams.append('shop', this.context.shopDomain);
        }
        
        // Fetch data
        const response = await fetch(url.toString(), {
          method: 'GET',
          credentials: 'same-origin',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        
        // Check content type
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error('Invalid response format');
        }
        
        // Parse response
        const data = await response.json();
        
        // Handle response
        if (data.requiresLogin === true) {
          this.showLoginPrompt();
        } else if (data.success) {
          this.state.customerData = data;
          this.updateWidget(data);
        } else {
          throw new Error(data.error || 'Failed to load data');
        }
        
        this.state.dataLoaded = true;
        
      } catch (error) {
        // Retry logic
        if (attempt < this.config.retryAttempts) {
          setTimeout(() => {
            this.fetchCustomerData(attempt + 1);
          }, this.config.retryDelay * attempt);
        } else {
          // Final failure - show login prompt as fallback
          this.showLoginPrompt();
          this.state.dataLoaded = true;
        }
      } finally {
        this.state.isLoading = false;
      }
    }

    /**
     * Update widget with customer data
     */
    updateWidget(data) {
      const html = `
        <div class="rp-customer-info">
          <h3>${this.context.settings?.iconEmoji || '🎁'} Your Rewards</h3>
          
          <div class="rp-stats-grid">
            <div class="rp-stat-card rp-stat-card-primary">
              <div class="rp-stat-value">$${this.formatNumber(data.balance?.storeCredit || 0)}</div>
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
              <div class="rp-stat-value">$${this.formatNumber(data.balance?.totalEarned || 0)}</div>
              <div class="rp-stat-label">Total Earned</div>
            </div>
          </div>
          
          <div class="rp-customer-details">
            <p class="rp-customer-id">Customer ID: ${data.customer?.shopifyId || 'Unknown'}</p>
            ${data.customer?.memberSince ? `
              <p class="rp-member-since">Member since: ${this.formatDate(data.customer.memberSince)}</p>
            ` : ''}
          </div>
          
          <div class="rp-actions">
            <a href="${this.context.accountUrl || '/account'}" class="rp-action-link">
              View Account →
            </a>
          </div>
        </div>
      `;
      
      this.contentEl.innerHTML = html;
      this.updatePageElements(data);
    }

    /**
     * Update page elements with rewards data
     */
    updatePageElements(data) {
      // Update store credit displays
      const creditElements = document.querySelectorAll('[data-rewards-credit]');
      creditElements.forEach(el => {
        const amount = data.balance?.storeCredit || 0;
        el.textContent = `$${this.formatNumber(amount)}`;
        
        // Show/hide minimized button value
        if (el.classList.contains('rp-mini-value')) {
          el.style.display = amount > 0 ? 'inline-block' : 'none';
        }
      });
      
      // Update tier displays
      const tierElements = document.querySelectorAll('[data-rewards-tier]');
      tierElements.forEach(el => {
        el.textContent = data.membership?.tier?.name || 'Bronze';
      });
      
      // Update cashback rate displays
      const cashbackElements = document.querySelectorAll('[data-rewards-cashback]');
      cashbackElements.forEach(el => {
        el.textContent = `${data.membership?.tier?.cashbackPercent || 1}%`;
      });
    }

    /**
     * Show loading state
     */
    showLoading() {
      this.contentEl.innerHTML = `
        <div class="rp-loading">
          <div class="rp-spinner"></div>
          <p>Loading your rewards...</p>
        </div>
      `;
    }

    /**
     * Show login prompt
     */
    showLoginPrompt() {
      this.contentEl.innerHTML = `
        <div class="rp-login-prompt">
          <div class="rp-login-icon">${this.context.settings?.iconEmoji || '🎁'}</div>
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
            <a href="${this.context.loginUrl || '/account/login'}" class="rp-login-btn rp-btn-primary">
              Sign In
            </a>
            <a href="${this.context.registerUrl || '/account/register'}" class="rp-register-btn rp-btn-secondary">
              Create Account
            </a>
          </div>
          
          <p class="rp-login-footer">
            Already have an account? Sign in to view your rewards balance.
          </p>
        </div>
      `;
    }

    /**
     * Minimize widget
     */
    minimize(animate = true) {
      this.state.isMinimized = true;
      
      if (animate) {
        // Add animation class
        this.container.style.animation = 'rpSlideOut 0.3s ease-out';
        
        // Hide after animation
        setTimeout(() => {
          this.container.style.display = 'none';
          this.container.style.animation = '';
        }, this.config.animationDuration);
      } else {
        this.container.style.display = 'none';
      }
      
      // Show minimized button
      if (this.minimizedBtn) {
        this.minimizedBtn.style.display = 'flex';
        if (animate) {
          this.minimizedBtn.style.animation = 'rpSlideIn 0.3s ease-out';
        }
      }
      
      // Save state
      this.saveState('minimized');
    }

    /**
     * Maximize widget
     */
    maximize() {
      this.state.isMinimized = false;
      
      // Show widget
      this.container.style.display = 'block';
      this.container.style.animation = 'rpSlideIn 0.3s ease-out';
      
      // Hide minimized button
      if (this.minimizedBtn) {
        this.minimizedBtn.style.animation = 'rpSlideOut 0.3s ease-out';
        setTimeout(() => {
          this.minimizedBtn.style.display = 'none';
          this.minimizedBtn.style.animation = '';
        }, this.config.animationDuration);
      }
      
      // Load data if needed
      if (!this.state.dataLoaded) {
        this.loadData();
      }
      
      // Save state
      this.saveState('maximized');
    }

    /**
     * Save widget state
     */
    saveState(state) {
      try {
        sessionStorage.setItem(this.config.storageKey, state);
      } catch (e) {
        // SessionStorage might be disabled
      }
    }

    /**
     * Get saved widget state
     */
    getSavedState() {
      try {
        return sessionStorage.getItem(this.config.storageKey);
      } catch (e) {
        return null;
      }
    }

    /**
     * Format number with proper decimal places
     */
    formatNumber(num) {
      return Number(num).toFixed(2);
    }

    /**
     * Format date to locale string
     */
    formatDate(dateString) {
      try {
        const date = new Date(dateString);
        return date.toLocaleDateString();
      } catch (e) {
        return dateString;
      }
    }
  }

  /**
   * Initialize widgets when DOM is ready
   */
  function initializeWidgets() {
    // Find all widget containers
    const containers = document.querySelectorAll('[data-rewards-widget]');
    
    // Initialize each widget
    containers.forEach(container => {
      // Check if already initialized
      if (!container.dataset.initialized) {
        new RewardsWidget(container);
        container.dataset.initialized = 'true';
      }
    });
  }

  /**
   * DOM Ready handler
   */
  function domReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /**
   * Add required animations to page if not already present
   */
  function addAnimations() {
    if (!document.querySelector('#rp-animations')) {
      const style = document.createElement('style');
      style.id = 'rp-animations';
      style.textContent = `
        @keyframes rpSlideIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes rpSlideOut {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(20px); }
        }
        @keyframes rpSpin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  // Initialize
  domReady(() => {
    addAnimations();
    initializeWidgets();
  });

  // Export for global access if needed
  window.RewardsWidget = RewardsWidget;
  window.initializeRewardsWidgets = initializeWidgets;

})();