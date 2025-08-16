// extensions/rewardspro-widget/assets/rewards-widget.js
class RewardsWidget {
  constructor(container) {
    this.container = container;
    this.id = container?.id || 'rewards-widget';
    this.contentEl = container?.querySelector('.rp-content') || container;
    this.init();
  }

  async init() {
    console.log(`[RewardsWidget ${this.id}] Initializing...`);
    await this.fetchCustomerData();
  }

  async fetchCustomerData() {
    try {
      // FIXED: URL now matches your Shopify proxy configuration
      const url = '/apps/rewardspro/membership'; // Changed from /apps/rewards/
      console.log(`[RewardsWidget ${this.id}] Fetching via app proxy:`, url);
      console.log(`[RewardsWidget ${this.id}] Full URL:`, window.location.origin + url);
      
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include', // Include cookies for session
        headers: {
          'Accept': 'application/json', // Better to use Accept for GET requests
        }
      });

      console.log(`[RewardsWidget ${this.id}] Response status:`, response.status);

      // Handle response
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ 
          error: 'Failed to parse error response' 
        }));
        
        if (response.status === 401) {
          console.log('[RewardsWidget] Customer not logged in');
          this.showLoginPrompt();
          return;
        }
        
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log(`[RewardsWidget ${this.id}] Received data:`, data);
      this.updateWidgetData(data);
      
    } catch (error) {
      console.error(`[RewardsWidget ${this.id}] Error:`, error);
      this.showError(`Error: ${error.message}`);
    }
  }

  updateWidgetData(data) {
    if (!data || !data.success) {
      this.showError('Invalid data received');
      return;
    }

    // Update your widget UI with the data
    const html = `
      <div class="rp-customer-info">
        <h3>Your Rewards</h3>
        <div class="rp-balance">
          <span class="rp-label">Store Credit:</span>
          <span class="rp-value">$${(data.balance?.storeCredit || 0).toFixed(2)}</span>
        </div>
        <div class="rp-tier">
          <span class="rp-label">Tier:</span>
          <span class="rp-value">${data.membership?.tier?.name || 'Bronze'}</span>
        </div>
        <div class="rp-cashback">
          <span class="rp-label">Cashback Rate:</span>
          <span class="rp-value">${data.membership?.tier?.cashbackPercent || 1}%</span>
        </div>
        <div class="rp-total-earned">
          <span class="rp-label">Total Earned:</span>
          <span class="rp-value">$${(data.balance?.totalEarned || 0).toFixed(2)}</span>
        </div>
      </div>
    `;
    
    this.contentEl.innerHTML = html;
  }

  showLoginPrompt() {
    const loginHtml = `
      <div class="rp-login-prompt">
        <p>Please log in to view your rewards</p>
        <a href="/account/login" class="rp-login-btn">Log In</a>
      </div>
    `;
    this.contentEl.innerHTML = loginHtml;
  }

  showError(message) {
    const errorHtml = `
      <div class="rp-error">
        <p>${message}</p>
        <button onclick="location.reload()" class="rp-retry-btn">Retry</button>
      </div>
    `;
    this.contentEl.innerHTML = errorHtml;
  }

  // Optional: Add method to test different endpoints
  async testEndpoints() {
    const endpoints = [
      '/apps/rewardspro/test',
      '/apps/rewardspro/membership',
      '/apps/rewardspro/balance'
    ];

    for (const endpoint of endpoints) {
      try {
        console.log(`[Test] Trying ${endpoint}...`);
        const response = await fetch(endpoint);
        console.log(`[Test] ${endpoint} returned:`, response.status);
      } catch (error) {
        console.error(`[Test] ${endpoint} failed:`, error);
      }
    }
  }
}

// Initialize widget when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const containers = document.querySelectorAll('[data-rewards-widget]');
  containers.forEach(container => {
    new RewardsWidget(container);
  });
});

// Also check if widget containers exist on the page
if (typeof window.RewardsWidget === 'undefined') {
  window.RewardsWidget = RewardsWidget;
}