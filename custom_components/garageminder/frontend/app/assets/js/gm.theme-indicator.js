/**
 * GarageMinder Theme Indicator
 * 
 * Standalone script that adds a read-only theme indicator to Settings > General
 * Shows the current theme (from WordPress) with a link to change it in the profile.
 * 
 * INSTALLATION:
 * 1. Save this file as: assets/js/gm.theme-indicator.js
 * 2. Add this line to index.php AFTER the other gm.*.js scripts:
 *    <script src="assets/js/gm.theme-indicator.js"></script>
 */

(function() {
  'use strict';

  /**
   * Render the theme indicator HTML
   * FIX Issue #2: Now detects actual theme from body class, not just APP_CONFIG
   */
  function renderThemeIndicator() {
    // Detect actual theme from body class (more reliable than APP_CONFIG)
    const isLightTheme = document.body.classList.contains('gm-theme-light');
    const themeMode = isLightTheme ? 'light' : 'dark';
    const profileUrl = (window.APP_CONFIG && APP_CONFIG.profileUrl) || '/my-profile/';
    
    // Determine icon based on actual theme
    const themeIcon = isLightTheme 
      ? '<i class="bi bi-sun-fill"></i>' 
      : '<i class="bi bi-moon-stars-fill"></i>';
    
    // Capitalize for display
    const themeModeDisplay = themeMode.charAt(0).toUpperCase() + themeMode.slice(1);
    
    // Create the HTML
    return `
      <div class="theme-indicator-section" id="gm-theme-indicator">
        <div class="theme-indicator-info">
          <div class="theme-indicator-icon">
            ${themeIcon}
          </div>
          <div class="theme-indicator-text">
            <span class="theme-indicator-label">Current Theme</span>
            <span class="theme-indicator-value">${themeModeDisplay} Mode</span>
          </div>
        </div>
        <a href="${profileUrl}" class="theme-indicator-link" target="_blank" rel="noopener">
          <i class="bi bi-pencil-square"></i>
          Change in Profile
        </a>
      </div>
    `;
  }

  /**
   * Inject the theme indicator into the General settings tab
   */
  function injectThemeIndicator() {
    const generalTab = document.getElementById('settings-tab-general');
    if (!generalTab) return false;
    
    // Check if already injected
    if (document.getElementById('gm-theme-indicator')) return true;
    
    // Find insertion point - after PWA container or before first settings-section
    const pwaContainer = generalTab.querySelector('#pwa-install-container');
    const firstSection = generalTab.querySelector('.settings-section');
    
    // Create theme indicator element
    const indicatorDiv = document.createElement('div');
    indicatorDiv.innerHTML = renderThemeIndicator();
    const indicatorElement = indicatorDiv.firstElementChild;
    
    // Insert in the right place
    if (pwaContainer && pwaContainer.nextSibling) {
      pwaContainer.parentNode.insertBefore(indicatorElement, pwaContainer.nextSibling);
    } else if (firstSection) {
      firstSection.parentNode.insertBefore(indicatorElement, firstSection);
    } else {
      // Fallback: append to general tab
      generalTab.insertBefore(indicatorElement, generalTab.firstChild);
    }
    
    return true;
  }

  /**
   * Initialize - set up observers and event listeners
   */
  function init() {
    // Try to inject immediately if settings is visible
    if (document.querySelector('#view-settings.active')) {
      setTimeout(injectThemeIndicator, 100);
    }
    
    // Listen for clicks on settings nav button
    const settingsBtn = document.querySelector('[data-view="settings"]');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function() {
        // Small delay to ensure tab content is rendered
        setTimeout(injectThemeIndicator, 100);
      });
    }
    
    // Also listen for settings tab clicks (General tab)
    document.addEventListener('click', function(e) {
      const tabBtn = e.target.closest('.settings-tab-btn[data-tab="general"]');
      if (tabBtn) {
        setTimeout(injectThemeIndicator, 50);
      }
    });
    
    // Use MutationObserver as backup to catch dynamic content changes
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.addedNodes.length) {
          const generalTab = document.getElementById('settings-tab-general');
          if (generalTab && generalTab.classList.contains('active')) {
            injectThemeIndicator();
          }
        }
      });
    });
    
    // Observe the settings view for changes
    const settingsView = document.getElementById('view-settings');
    if (settingsView) {
      observer.observe(settingsView, { childList: true, subtree: true });
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Also try again after a short delay (in case content loads asynchronously)
  setTimeout(function() {
    if (document.querySelector('#view-settings.active')) {
      injectThemeIndicator();
    }
  }, 500);

  // FIX Issue #2: Re-render indicator when theme changes
  function updateThemeIndicator() {
    const existing = document.getElementById('gm-theme-indicator');
    if (existing) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = renderThemeIndicator();
      const newIndicator = tempDiv.firstElementChild;
      existing.parentNode.replaceChild(newIndicator, existing);
    }
  }

  // Watch for body class changes (theme switches)
  const themeObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.attributeName === 'class') {
        updateThemeIndicator();
      }
    });
  });
  
  if (document.body) {
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

})();