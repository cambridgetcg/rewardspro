// Membership Popup JavaScript
(function() {
  'use strict';

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMembershipPopup);
  } else {
    initializeMembershipPopup();
  }

  function initializeMembershipPopup() {
    // Get config from window
    const config = window.membershipConfig || {};
    
    if (!config.customerId) {
      console.warn('Membership popup: No customer ID found');
      return;
    }

    // Cache DOM elements
    const elements = {
      trigger: document.getElementById('membership-popup-trigger'),
      popup: document.getElementById('membership-popup'),
      close: document.querySelector('.membership-popup-close'),
      tierBadge: document.getElementById('tier-badge'),
      cashbackRate: document.getElementById('cashback-rate'),
      creditAmount: document.getElementById('credit-amount')
    };

    // Check if all elements exist
    if (!elements.trigger || !elements.popup) {
      console.warn('Membership popup: Required elements not found');
      return;
    }

    // State
    let isDataLoaded = false;
    let membershipData = null;

    // Apply theme settings
    applyThemeSettings();

    // Event listeners
    elements.trigger.addEventListener('click', openPopup);
    elements.close?.addEventListener('click', closePopup);
    elements.popup.addEventListener('click', handleBackgroundClick);

    // Keyboard support
    document.addEventListener('keydown', handleEscapeKey);

    // Functions
    function applyThemeSettings() {
      const trigger = elements.trigger;
      const buttonBg = trigger.dataset.buttonBg || '#4F46E5';
      const buttonText = trigger.dataset.buttonText || '#FFFFFF';
      const position = trigger.dataset.position || 'bottom-right';
      const showMobile = trigger.dataset.showMobile !== 'false';

      // Apply colors
      trigger.style.setProperty('--button-bg', buttonBg);
      trigger.style.setProperty('--button-text', buttonText);

      // Apply position
      trigger.className = `membership-popup-trigger ${position}`;

      // Handle mobile visibility
      if (!showMobile) {
        trigger.classList.add('hide-mobile');
      }
    }

    function openPopup() {
      elements.popup.classList.add('active');
      document.body.style.overflow = 'hidden';
      
      // Load data if not already loaded
      if (!isDataLoaded) {
        loadMembershipData();
      }
      
      // Focus management for accessibility
      elements.close?.focus();
    }

    function closePopup() {
      elements.popup.classList.remove('active');
      document.body.style.overflow = '';
      
      // Return focus to trigger
      elements.trigger.focus();
    }

    function handleBackgroundClick(event) {
      if (event.target === elements.popup) {
        closePopup();
      }
    }

    function handleEscapeKey(event) {
      if (event.key === 'Escape' && elements.popup.classList.contains('active')) {
        closePopup();
      }
    }

    async function loadMembershipData() {
      try {
        // Show loading state
        showLoadingState();

        // Fetch data from API
        const response = await fetch(`${config.apiUrl}/api/customer/${config.customerId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          mode: 'cors'
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        membershipData = data;
        isDataLoaded = true;

        // Update UI with data
        updateUI(data);

      } catch (error) {
        console.error('Failed to load membership data:', error);
        showErrorState();
      }
    }

    function showLoadingState() {
      elements.tierBadge.innerHTML = '<span class="tier-loader"></span>';
      elements.creditAmount.innerHTML = '<span class="credit-loader"></span>';
    }

    function updateUI(data) {
      // Update tier badge
      if (data.tier && elements.tierBadge) {
        elements.tierBadge.textContent = data.tier.displayName || 'Bronze';
        elements.tierBadge.className = `tier-badge ${(data.tier.name || 'bronze').toLowerCase()}`;
      }

      // Update cashback rate
      if (data.tier && elements.cashbackRate) {
        elements.cashbackRate.textContent = `${data.tier.cashbackPercent || 1}% Cashback`;
      }

      // Update credit amount
      if (elements.creditAmount) {
        const amount = data.storeCredit || 0;
        elements.creditAmount.textContent = formatCurrency(amount);
      }
    }

    function showErrorState() {
      if (elements.tierBadge) {
        elements.tierBadge.textContent = config.translations?.error || 'Error loading';
        elements.tierBadge.className = 'tier-badge';
      }
      
      if (elements.creditAmount) {
        elements.creditAmount.textContent = '---';
      }
    }

    function formatCurrency(amount) {
      // Format as GBP
      return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    }

    // Public API
    window.membershipPopup = {
      open: openPopup,
      close: closePopup,
      reload: loadMembershipData
    };
  }
})();