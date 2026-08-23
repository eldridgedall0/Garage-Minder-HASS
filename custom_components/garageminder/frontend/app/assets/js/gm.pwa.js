/**
 * TrackMyWrench PWA Module
 * Handles Progressive Web App installation and service worker
 * Compatible with iOS, Android, macOS, and Windows
 */

(function() {
  'use strict';

  // PWA state
  let deferredPrompt = null;
  let isAppInstalled = false;
  let swRegistration = null;

  // Detect platform
  const platform = {
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream,
    isAndroid: /Android/.test(navigator.userAgent),
    isMac: /Mac/.test(navigator.platform),
    isWindows: /Win/.test(navigator.platform),
    isStandalone: window.matchMedia('(display-mode: standalone)').matches ||
                  window.navigator.standalone === true ||
                  document.referrer.includes('android-app://'),
    isSafari: /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
    isChrome: /Chrome/.test(navigator.userAgent) && !/Edge|Edg/.test(navigator.userAgent),
    isEdge: /Edge|Edg/.test(navigator.userAgent),
    isFirefox: /Firefox/.test(navigator.userAgent)
  };

  /**
   * Initialize PWA functionality
   */
  function initPWA() {
    // Check if already installed/standalone
    if (platform.isStandalone) {
      isAppInstalled = true;
      console.log('[PWA] Running in standalone mode');
      return;
    }

    // Register service worker (skipped when OFFLINE_STORAGE_ENABLED=false in config.php)
    if (typeof GM_CONFIG === 'undefined' || GM_CONFIG.offlineStorageEnabled !== false) {
      registerServiceWorker();
    } else {
      // Dev mode: unregister any existing SW so no stale caches survive a reload
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          regs.forEach(function(reg) { reg.unregister(); });
          if (regs.length) console.info('[PWA] SW unregistered (OFFLINE_STORAGE_ENABLED=false)');
        });
        // Also wipe any leftover caches from previous sessions
        if ('caches' in window) {
          caches.keys().then(function(names) {
            names.forEach(function(name) { caches.delete(name); });
            if (names.length) console.info('[PWA] Caches cleared (OFFLINE_STORAGE_ENABLED=false)');
          });
        }
      }
    }

    // Listen for install prompt (Chrome, Edge, Samsung Internet)
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);

    // Listen for successful installation
    window.addEventListener('appinstalled', handleAppInstalled);

    // Check if we should show install UI
    setTimeout(checkAndShowInstallUI, 2000);

    // Handle URL shortcuts
    handleURLShortcuts();
  }

  /**
   * Register the service worker
   */
  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.log('[PWA] Service workers not supported');
      return;
    }

    try {
      swRegistration = await navigator.serviceWorker.register('./service-worker.js', {
        scope: './'
      });
      
      console.log('[PWA] Service worker registered:', swRegistration.scope);

      // Check for updates
      swRegistration.addEventListener('updatefound', () => {
        const newWorker = swRegistration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available
            showUpdateAvailable();
          }
        });
      });

    } catch (error) {
      console.error('[PWA] Service worker registration failed:', error);
    }
  }

  /**
   * Handle the beforeinstallprompt event
   */
  function handleInstallPrompt(event) {
    console.log('[PWA] Install prompt available');
    
    // Prevent the mini-infobar from appearing on mobile
    event.preventDefault();
    
    // Store the event for later use
    deferredPrompt = event;
    
    // Show our custom install UI
    showInstallUI();
  }

  /**
   * Handle successful app installation
   */
  function handleAppInstalled(event) {
    console.log('[PWA] App installed');
    isAppInstalled = true;
    deferredPrompt = null;
    hideInstallUI();
    
    // Show success message
    if (typeof showToast === 'function') {
      showToast('App installed successfully! 🎉', 'success');
    }
  }

  /**
   * Check if we should show the install UI
   */
  function checkAndShowInstallUI() {
    if (isAppInstalled || platform.isStandalone) {
      return;
    }

    // Check if user dismissed install prompt recently
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
      if (daysSinceDismissed < 7) {
        return; // Don't show for 7 days after dismissal
      }
    }

    // iOS Safari needs special handling (no install prompt)
    if (platform.isIOS && platform.isSafari) {
      showIOSInstallInstructions();
      return;
    }

    // If we have a deferred prompt, show install UI
    if (deferredPrompt) {
      showInstallUI();
    }
  }

  /**
   * Show the install UI in settings
   */
  function showInstallUI() {
    const container = document.getElementById('pwa-install-container');
    if (!container) return;

    let instructions = '';
    let buttonText = '📲 Install App';
    let canAutoInstall = !!deferredPrompt;

    if (platform.isIOS) {
      instructions = `
        <div class="pwa-instructions pwa-instructions-ios">
          <p><strong>To install on iPhone/iPad:</strong></p>
          <ol>
            <li>Tap the <strong>Share</strong> button <span class="pwa-icon">⬆️</span> in Safari</li>
            <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
            <li>Tap <strong>"Add"</strong> in the top right</li>
          </ol>
        </div>
      `;
      buttonText = 'ℹ️ Show Install Instructions';
      canAutoInstall = false;
    } else if (platform.isAndroid) {
      if (!deferredPrompt) {
        instructions = `
          <div class="pwa-instructions">
            <p><strong>To install on Android:</strong></p>
            <ol>
              <li>Tap the menu <strong>⋮</strong> in Chrome</li>
              <li>Tap <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong></li>
            </ol>
          </div>
        `;
        canAutoInstall = false;
      }
    } else if (platform.isMac || platform.isWindows) {
      if (!deferredPrompt) {
        instructions = `
          <div class="pwa-instructions">
            <p><strong>To install on desktop:</strong></p>
            <p>Look for the install icon <span class="pwa-icon">⊕</span> in the address bar (Chrome/Edge), or use the browser menu.</p>
          </div>
        `;
        canAutoInstall = false;
      }
    }

    container.innerHTML = `
      <div class="pwa-install-section">
        <div class="pwa-install-header">
          <span class="pwa-install-icon">📱</span>
          <div class="pwa-install-text">
            <strong>Install as App</strong>
            <span class="pwa-install-desc">Add to your home screen for quick access</span>
          </div>
        </div>
        ${instructions}
        <div class="pwa-install-actions">
          ${canAutoInstall ? `<button type="button" class="btn-primary btn-small" id="pwa-install-btn">${buttonText}</button>` : ''}
          <button type="button" class="btn-ghost btn-small" id="pwa-dismiss-btn">Not now</button>
        </div>
        <div class="pwa-install-platforms">
          <span class="pwa-platform ${platform.isIOS ? 'active' : ''}">iOS</span>
          <span class="pwa-platform ${platform.isAndroid ? 'active' : ''}">Android</span>
          <span class="pwa-platform ${platform.isWindows ? 'active' : ''}">Windows</span>
          <span class="pwa-platform ${platform.isMac ? 'active' : ''}">macOS</span>
        </div>
      </div>
    `;

    container.style.display = 'block';

    // Attach event listeners
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
      installBtn.addEventListener('click', triggerInstall);
    }

    const dismissBtn = document.getElementById('pwa-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', dismissInstallUI);
    }
  }

  /**
   * Show iOS-specific install instructions
   */
  function showIOSInstallInstructions() {
    const container = document.getElementById('pwa-install-container');
    if (!container) return;

    container.innerHTML = `
      <div class="pwa-install-section pwa-ios-instructions">
        <div class="pwa-install-header">
          <span class="pwa-install-icon">📱</span>
          <div class="pwa-install-text">
            <strong>Install on iPhone/iPad</strong>
            <span class="pwa-install-desc">Add to your home screen for the best experience</span>
          </div>
        </div>
        <div class="pwa-ios-steps">
          <div class="pwa-ios-step">
            <span class="pwa-step-number">1</span>
            <span class="pwa-step-text">Tap <strong>Share</strong> <span class="pwa-share-icon">⬆️</span></span>
          </div>
          <div class="pwa-ios-step">
            <span class="pwa-step-number">2</span>
            <span class="pwa-step-text">Tap <strong>"Add to Home Screen"</strong> ➕</span>
          </div>
          <div class="pwa-ios-step">
            <span class="pwa-step-number">3</span>
            <span class="pwa-step-text">Tap <strong>"Add"</strong> ✓</span>
          </div>
        </div>
        <div class="pwa-install-actions">
          <button type="button" class="btn-ghost btn-small" id="pwa-dismiss-btn">Got it</button>
        </div>
      </div>
    `;

    container.style.display = 'block';

    const dismissBtn = document.getElementById('pwa-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', dismissInstallUI);
    }
  }

  /**
   * Hide the install UI
   */
  function hideInstallUI() {
    const container = document.getElementById('pwa-install-container');
    if (container) {
      container.style.display = 'none';
    }
  }

  /**
   * Dismiss the install UI and remember preference
   */
  function dismissInstallUI() {
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
    hideInstallUI();
  }

  /**
   * Trigger the install prompt
   */
  async function triggerInstall() {
    if (!deferredPrompt) {
      console.log('[PWA] No install prompt available');
      
      // Show manual instructions
      if (platform.isIOS) {
        showIOSInstallInstructions();
      } else if (typeof showToast === 'function') {
        showToast('Use your browser\'s menu to install the app', 'info');
      }
      return;
    }

    try {
      // Show the install prompt
      deferredPrompt.prompt();
      
      // Wait for user response
      const { outcome } = await deferredPrompt.userChoice;
      console.log('[PWA] Install prompt outcome:', outcome);
      
      if (outcome === 'accepted') {
        if (typeof showToast === 'function') {
          showToast('Installing app...', 'info');
        }
      }
      
      // Clear the prompt
      deferredPrompt = null;
      
    } catch (error) {
      console.error('[PWA] Install prompt error:', error);
    }
  }

  /**
   * Show update available notification
   */
  function showUpdateAvailable() {
    if (typeof showToast === 'function') {
      showToast('A new version is available. Refresh to update.', 'info', 10000);
    }
    
    // Could also show a more prominent update banner
    const banner = document.createElement('div');
    banner.id = 'pwa-update-banner';
    banner.className = 'pwa-update-banner';
    banner.innerHTML = `
      <span>🔄 A new version is available</span>
      <button type="button" class="btn-primary btn-small" onclick="window.location.reload()">Update Now</button>
      <button type="button" class="btn-ghost btn-small" onclick="this.parentElement.remove()">Later</button>
    `;
    document.body.appendChild(banner);
  }

  /**
   * Handle URL shortcuts (from manifest)
   */
  function handleURLShortcuts() {
    const params = new URLSearchParams(window.location.search);
    
    // Handle ?action=add-entry
    if (params.get('action') === 'add-entry') {
      // Wait for app to load, then show entry form
      setTimeout(() => {
        const toggleBtn = document.getElementById('toggle-entry-form');
        const form = document.getElementById('dashboard-entry-form');
        if (toggleBtn && form && form.style.display === 'none') {
          toggleBtn.click();
        }
      }, 1000);
    }
    
    // Handle ?view=reminders
    if (params.get('view') === 'reminders') {
      setTimeout(() => {
        const reminderBtn = document.querySelector('.nav-btn[data-view="reminders"]');
        if (reminderBtn) {
          reminderBtn.click();
        }
      }, 500);
    }
  }

  /**
   * Clear service worker cache (for debugging/updates)
   */
  function clearCache() {
    if (swRegistration && swRegistration.active) {
      const messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = (event) => {
        if (event.data.success) {
          console.log('[PWA] Cache cleared');
          if (typeof showToast === 'function') {
            showToast('Cache cleared. Refresh the page.', 'success');
          }
        }
      };
      swRegistration.active.postMessage(
        { type: 'CLEAR_CACHE' },
        [messageChannel.port2]
      );
    }
  }

  /**
   * Check if app is installed
   */
  function isInstalled() {
    return isAppInstalled || platform.isStandalone;
  }

  /**
   * Get platform info
   */
  function getPlatformInfo() {
    return { ...platform };
  }

  // Export PWA functions
  window.PWA = {
    init: initPWA,
    install: triggerInstall,
    isInstalled: isInstalled,
    getPlatform: getPlatformInfo,
    clearCache: clearCache,
    showInstallUI: showInstallUI,
    hideInstallUI: hideInstallUI
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPWA);
  } else {
    initPWA();
  }

})();