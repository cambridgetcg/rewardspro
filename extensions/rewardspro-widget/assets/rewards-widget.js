// File: extensions/rewardspro-widget/assets/rewards-widget.js
(function() {
  'use strict';
  
  // Initialize widgets when DOM is ready
  function init() {
    console.log('[RewardsWidget] Initializing widgets...');
    const widgets = document.querySelectorAll('[id^="rewardspro-widget-"]');
    console.log(`[RewardsWidget] Found ${widgets.length} widget(s)`);
    
    widgets.forEach(widget => {
      const blockId = widget.dataset.blockId;
      const position = widget.dataset.position;
      console.log(`[RewardsWidget] Creating widget with ID: ${blockId}`);
      new RewardsWidget(widget, blockId, position);
    });
  }
  
  class RewardsWidget {
    constructor(element, blockId, position) {
      this.el = element;
      this.id = blockId;
      this.pos = position;
      this.isMinimized = false;
      this.contentEl = element.querySelector('.rp-content');
      this.minimizedBtn = element.querySelector('.rp-minimized');
      this.closeBtn = element.querySelector('.rp-close');
      
      // Get data from global window object
      this.data = window.RewardsProData?.[blockId];
      console.log(`[RewardsWidget ${this.id}] Data:`, this.data);
      
      // Initialize widget
      this.setPosition();
      this.setupEventListeners();
      
      // Fetch customer data if logged in
      if (this.data?.customerId) {
        console.log(`[RewardsWidget ${this.id}] Customer detected, fetching data...`);
        this.updateDebugStatus('Fetching data...');
        this.fetchCustomerData();
      } else {
        console.log(`[RewardsWidget ${this.id}] No customer ID found`);
        this.updateDebugStatus('No customer ID');
      }
      
      // Show the widget
      this.show();
    }
    
    setPosition() {
      this.el.classList.add(`rp-position-${this.pos}`);
    }
    
    setupEventListeners() {
      this.closeBtn?.addEventListener('click', () => this.minimize());
      this.minimizedBtn?.addEventListener('click', () => this.expand());
    }
    
    updateDebugStatus(message, isError = false) {
      const statusEl = this.el.querySelector('#debug-api-status');
      if (statusEl) {
        statusEl.textContent = `API Status: ${message}`;
        statusEl.style.color = isError ? '#dc3545' : '#28a745';
      }
    }
    
    async fetchCustomerData() {
      if (!this.data) {
        console.error(`[RewardsWidget ${this.id}] No data available`);
        this.updateDebugStatus('No data available', true);
        return;
      }
      
      try {
        const { customerId, shopDomain, apiEndpoint } = this.data;
        const url = `${apiEndpoint}/membership?shop=${encodeURIComponent(shopDomain)}`;
        
        console.log(`[RewardsWidget ${this.id}] Fetching from:`, url);
        console.log(`[RewardsWidget ${this.id}] Customer ID:`, customerId);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Customer-Id': customerId.toString()
          }
        });
        
        console.log(`[RewardsWidget ${this.id}] Response status:`, response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[RewardsWidget ${this.id}] API Error:`, response.status, errorText);
          this.updateDebugStatus(`Error: ${response.status}`, true);
          return;
        }
        
        const data = await response.json();
        console.log(`[RewardsWidget ${this.id}] Received data:`, data);
        
        this.updateDebugStatus('Success!', false);
        this.updateWidgetData(data);
        
      } catch (error) {
        console.error(`[RewardsWidget ${this.id}] Fetch error:`, error);
        this.updateDebugStatus(`Error: ${error.message}`, true);
      }
    }
    
    updateWidgetData(data) {
      // Update store credit value
      const creditEl = this.el.querySelector('.rp-value[data-credit]');
      if (creditEl) {
        const formattedCredit = this.formatCurrency(data.storeCredit || 0);
        creditEl.textContent = formattedCredit;
        creditEl.dataset.credit = data.storeCredit || 0;
        console.log(`[RewardsWidget ${this.id}] Updated credit to:`, formattedCredit);
      }
      
      // Update minimized button value
      const miniValueEl = this.el.querySelector('.rp-mini-value');
      if (miniValueEl) {
        miniValueEl.textContent = this.formatCurrency(data.storeCredit || 0);
      }
      
      // Update tier information
      const tierEl = this.el.querySelector('.rp-tier-name');
      if (tierEl && data.tier) {
        tierEl.textContent = `${data.tier.name} (${data.tier.cashbackPercent}% cashback)`;
        console.log(`[RewardsWidget ${this.id}] Updated tier to:`, data.tier.name);
      }
    }
    
    formatCurrency(amount) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(amount);
    }
    
    show() {
      this.contentEl.style.display = 'block';
      this.minimizedBtn.style.display = 'none';
      this.isMinimized = false;
    }
    
    minimize() {
      this.contentEl.style.display = 'none';
      this.minimizedBtn.style.display = 'flex';
      this.isMinimized = true;
    }
    
    expand() {
      this.show();
    }
  }
  
  // Export to window for debugging
  window.RewardsWidget = RewardsWidget;
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();