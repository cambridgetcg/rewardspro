// extensions/rewardspro-widget/assets/rewards-widget.js
class RewardsWidget {
  async fetchCustomerData() {
    try {
      // App proxy URL - no need for API endpoint or customer ID!
      const url = '/apps/rewards/membership';
      
      console.log(`[RewardsWidget ${this.id}] Fetching via app proxy:`, url);
      
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include', // Include cookies for session
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        
        if (response.status === 401) {
          console.log('Customer not logged in');
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
      this.updateDebugStatus(`Error: ${error.message}`, true);
    }
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
}