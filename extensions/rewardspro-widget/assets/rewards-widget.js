// File: extensions/rewardspro-widget/assets/rewards-widget.js

(function() {
  'use strict';

  // RewardsPro Widget Class
  class RewardsProWidget {
    constructor(blockId, settings) {
      this.blockId = blockId;
      this.settings = settings;
      this.container = document.getElementById(`rewardspro-widget-${blockId}`);
      this.widget = this.container.querySelector('.rewardspro-widget');
      this.minimized = this.container.querySelector('.rewardspro-minimized');
      this.isMinimized = settings.startMinimized;
      this.customerData = null;
      
      this.init();
    }

    init() {
      if (!this.container) return;
      
      // Apply theme settings
      this.applyTheme();
      
      // Set position
      this.container.setAttribute('data-position', this.settings.position);
      
      // Check if customer is logged in
      this.checkCustomerStatus();
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Apply saved state
      this.applySavedState();
      
      // Check mobile visibility
      this.checkMobileVisibility();
    }

    applyTheme() {
      const { theme } = this.settings;
      this.container.style.setProperty('--rp-primary', theme.primaryColor);
      this.container.style.setProperty('--rp-secondary', theme.secondaryColor);
      this.container.style.setProperty('--rp-text', theme.textColor);
      this.container.style.setProperty('--rp-background', theme.backgroundColor);
    }

    checkCustomerStatus() {
      // Check if customer is logged in using Shopify's analytics
      const customerId = window.ShopifyAnalytics?.meta?.page?.customerId;
      
      if (customerId) {
        this.fetchCustomerData();
      } else {
        this.showGuestContent();
      }
    }

    async fetchCustomerData() {
      try {
        // Get shop domain from Shopify global object
        const shop = window.Shopify?.shop || window.location.hostname;
        
        const response = await fetch(`${this.settings.apiEndpoint}/membership?shop=${shop}`, {
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Customer-Id': window.ShopifyAnalytics.meta.page.customerId
          }
        });

        if (!response.ok) throw new Error('Failed to fetch membership data');

        const data = await response.json();
        this.customerData = data;
        this.displayMemberData(data);
        
        // Auto-show for new members if enabled
        if (this.settings.autoShow && !this.hasSeenWidget()) {
          this.show();
          this.markWidgetAsSeen();
        }
        
      } catch (error) {
        console.error('RewardsPro Error:', error);
        this.showGuestContent();
      }
    }

    displayMemberData(data) {
      // Hide loading state
      this.container.querySelector('.rewardspro-loading-state').style.display = 'none';
      
      // Show member content
      const memberContent = this.container.querySelector('.rewardspro-member-content');
      memberContent.style.display = 'block';
      
      // Update points
      const pointsValue = memberContent.querySelector('.rewardspro-points-value');
      if (pointsValue) {
        pointsValue.textContent = this.formatNumber(data.points || 0);
      }
      
      // Update minimized points
      const minimizedPoints = this.minimized.querySelector('.rewardspro-minimized-points');
      if (minimizedPoints) {
        minimizedPoints.textContent = `${this.formatNumber(data.points || 0)} pts`;
      }
      
      // Update tier
      const tierName = memberContent.querySelector('.rewardspro-tier-name');
      if (tierName && data.tier) {
        tierName.textContent = data.tier.name;
      }
      
      // Update progress bar
      if (data.tierProgress) {
        this.updateProgressBar(data.tierProgress);
      }
      
      // Show appropriate state
      if (this.isMinimized) {
        this.widget.style.display = 'none';
        this.minimized.style.display = 'flex';
      } else {
        this.widget.style.display = 'block';
        this.minimized.style.display = 'none';
      }
    }

    updateProgressBar(progress) {
      const progressContainer = this.container.querySelector('.rewardspro-progress-container');
      if (!progressContainer) return;
      
      const progressText = progressContainer.querySelector('.rewardspro-progress-text');
      const progressFill = progressContainer.querySelector('.rewardspro-progress-fill');
      
      if (progressText) {
        progressText.textContent = `${this.formatNumber(progress.current)} / ${this.formatNumber(progress.required)} points`;
      }
      
      if (progressFill) {
        const percentage = Math.min((progress.current / progress.required) * 100, 100);
        progressFill.style.width = `${percentage}%`;
      }
    }

    showGuestContent() {
      // Hide loading state
      this.container.querySelector('.rewardspro-loading-state').style.display = 'none';
      
      // Show guest content
      const guestContent = this.container.querySelector('.rewardspro-guest-content');
      guestContent.style.display = 'block';
      
      // Update minimized text for guests
      const minimizedText = this.minimized.querySelector('.rewardspro-minimized-text');
      if (minimizedText) {
        minimizedText.textContent = 'Join Rewards';
      }
      
      // Hide points in minimized state
      const minimizedPoints = this.minimized.querySelector('.rewardspro-minimized-points');
      if (minimizedPoints) {
        minimizedPoints.style.display = 'none';
      }
      
      // Show appropriate state
      if (this.isMinimized) {
        this.widget.style.display = 'none';
        this.minimized.style.display = 'flex';
      } else {
        this.widget.style.display = 'block';
        this.minimized.style.display = 'none';
      }
    }

    setupEventListeners() {
      // Close button
      const closeBtn = this.widget.querySelector('.rewardspro-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.minimize());
      }
      
      // Minimized button
      this.minimized.addEventListener('click', () => this.show());
      
      // Redeem button
      const redeemBtn = this.widget.querySelector('.rewardspro-btn-redeem');
      if (redeemBtn) {
        redeemBtn.addEventListener('click', () => this.handleRedeem());
      }
      
      // Window resize
      window.addEventListener('resize', () => this.checkMobileVisibility());
    }

    show() {
      this.isMinimized = false;
      this.saveState();
      
      // Apply animation
      const animationType = this.settings.animation;
      if (animationType !== 'none') {
        this.widget.classList.add(`rewardspro-animate-${animationType}-in`);
      }
      
      this.widget.style.display = 'block';
      this.minimized.style.display = 'none';
      
      // Remove animation class after completion
      setTimeout(() => {
        this.widget.classList.remove(`rewardspro-animate-${animationType}-in`);
      }, 300);
      
      // Dispatch custom event
      this.dispatchEvent('opened');
    }

    minimize() {
      this.isMinimized = true;
      this.saveState();
      
      // Apply animation
      const animationType = this.settings.animation;
      if (animationType !== 'none') {
        this.widget.classList.add(`rewardspro-animate-${animationType}-out`);
      }
      
      setTimeout(() => {
        this.widget.style.display = 'none';
        this.minimized.style.display = 'flex';
        this.widget.classList.remove(`rewardspro-animate-${animationType}-out`);
      }, animationType !== 'none' ? 300 : 0);
      
      // Dispatch custom event
      this.dispatchEvent('closed');
    }

    handleRedeem() {
      // Dispatch custom event
      this.dispatchEvent('redeem_clicked');
      
      // Redirect to rewards page or open modal
      window.location.href = `${this.settings.dashboardUrl || '/pages/rewards'}#redeem`;
    }

    checkMobileVisibility() {
      if (!this.settings.showOnMobile && window.innerWidth <= 480) {
        this.container.style.display = 'none';
      } else {
        this.container.style.display = 'block';
      }
    }

    saveState() {
      const state = {
        isMinimized: this.isMinimized,
        timestamp: Date.now()
      };
      localStorage.setItem(`rewardspro_state_${this.blockId}`, JSON.stringify(state));
    }

    applySavedState() {
      try {
        const saved = localStorage.getItem(`rewardspro_state_${this.blockId}`);
        if (saved) {
          const state = JSON.parse(saved);
          const expiryTime = this.settings.cookieExpiry * 24 * 60 * 60 * 1000; // Convert days to ms
          
          if (Date.now() - state.timestamp < expiryTime) {
            this.isMinimized = state.isMinimized;
          }
        }
      } catch (error) {
        console.error('Error loading saved state:', error);
      }
    }

    hasSeenWidget() {
      try {
        return localStorage.getItem('rewardspro_widget_seen') === 'true';
      } catch (error) {
        return false;
      }
    }

    markWidgetAsSeen() {
      try {
        localStorage.setItem('rewardspro_widget_seen', 'true');
      } catch (error) {
        // Fail silently
      }
    }

    formatNumber(num) {
      return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    dispatchEvent(eventName, detail = {}) {
      const event = new CustomEvent(`rewardspro:${eventName}`, {
        detail: {
          blockId: this.blockId,
          customerData: this.customerData,
          ...detail
        }
      });
      document.dispatchEvent(event);
    }
  }

  // Initialize all widgets when DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    // Get all RewardsPro settings
    if (window.RewardsProSettings) {
      Object.keys(window.RewardsProSettings).forEach(blockId => {
        const settings = window.RewardsProSettings[blockId];
        new RewardsProWidget(blockId, settings);
      });
    }
  });

  // Expose class for external use if needed
  window.RewardsProWidget = RewardsProWidget;
})();