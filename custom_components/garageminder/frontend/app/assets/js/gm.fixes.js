/**
 * GarageMinder - Bug Fixes Patch
 * 
 * Add this script AFTER all other gm.*.js files in index.php
 * 
 * FIXES:
 * - Issue #2: Theme indicator shows correct theme state
 * - Issue #3: Replace invalid characters in reminders (â€", ðŸš—)
 * - Issue #5: Replace all invalid characters with stable ones or Bootstrap icons
 * - Issue #6: Limit service badges to 3 with "+X more"
 * - Issue #7: Remove "main" class distinction from service badges
 * - Issue #12: Reset toggle-entry-form button when navigating away
 */

(function() {
  'use strict';

  // ========================================
  // ISSUE #2: Fix Theme Indicator Display
  // ========================================
  function fixThemeIndicator() {
    const indicator = document.querySelector('.theme-indicator-current');
    if (!indicator) return;
    
    const isLight = document.body.classList.contains('gm-theme-light');
    const iconEl = indicator.querySelector('i');
    const textEl = indicator.querySelector('.theme-indicator-text');
    
    if (iconEl) {
      iconEl.className = isLight ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
    }
    if (textEl) {
      textEl.textContent = isLight ? 'Light Mode' : 'Dark Mode';
    }
  }

  // Run on load and observe for theme changes
  document.addEventListener('DOMContentLoaded', fixThemeIndicator);
  
  // Observe body class changes for theme switches
  const themeObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.attributeName === 'class') {
        fixThemeIndicator();
      }
    });
  });
  
  if (document.body) {
    themeObserver.observe(document.body, { attributes: true });
  }

  // ========================================
  // ISSUE #3 & #5: Fix Invalid Characters
  // ========================================
  const charReplacements = {
    // En-dash and em-dash
    'â€"': '-',
    'â€"': '-',
    '–': '-',
    '—': '-',
    
    // Car emoji and other emoji issues
    'ðŸš—': '<i class="bi bi-car-front"></i>',
    '🚗': '<i class="bi bi-car-front"></i>',
    
    // Close button character
    'Ã—': '<i class="bi bi-x-lg"></i>',
    '×': '<i class="bi bi-x-lg"></i>',
    
    // Quotes
    'â€œ': '"',
    'â€': '"',
    'â€˜': "'",
    'â€™': "'",
    '"': '"',
    '"': '"',
    '\u2018': "'",
    '\u2019': "'",
    
    // Other common encoding issues
    'Ã¢': '-',
    'â€¦': '...',
    '…': '...',
    'Â': '',
  };

  function fixInvalidCharacters(element) {
    if (!element) return;
    
    // Get all text nodes
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }
    
    textNodes.forEach(function(textNode) {
      let text = textNode.nodeValue;
      let changed = false;
      
      for (const [bad, good] of Object.entries(charReplacements)) {
        if (text.includes(bad)) {
          // If replacement contains HTML, we need to handle it differently
          if (good.includes('<')) {
            const span = document.createElement('span');
            span.innerHTML = text.replace(new RegExp(escapeRegex(bad), 'g'), good);
            textNode.parentNode.replaceChild(span, textNode);
            return;
          }
          text = text.replace(new RegExp(escapeRegex(bad), 'g'), good);
          changed = true;
        }
      }
      
      if (changed) {
        textNode.nodeValue = text;
      }
    });
  }

  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Fix characters on load and after any DOM updates
  function runCharacterFixes() {
    // Fix reminders section specifically (Issue #3)
    const remindersView = document.getElementById('reminders-view');
    if (remindersView) {
      fixInvalidCharacters(remindersView);
    }
    
    // Fix modals (Issue #4)
    document.querySelectorAll('.modal-close').forEach(function(btn) {
      // Clear any text content that might have encoding issues
      if (btn.textContent.trim() && !btn.querySelector('i')) {
        btn.textContent = '';
        // The CSS ::before/::after will draw the X
      }
    });
    
    // Fix entire document
    fixInvalidCharacters(document.body);
  }

  // ========================================
  // ISSUE #6 & #7: Fix Service Badges
  // ========================================
  const MAX_VISIBLE_BADGES = 3;

  function fixServiceBadges() {
    document.querySelectorAll('.entry-services').forEach(function(container) {
      const badges = container.querySelectorAll('.entry-service-tag, .service-badge');
      const existingMore = container.querySelector('.entry-service-more, .service-badge-more');
      
      // Remove existing "+X more" badge
      if (existingMore) {
        existingMore.remove();
      }
      
      // Issue #7: Remove "main" class distinction
      badges.forEach(function(badge) {
        badge.classList.remove('main');
      });
      
      // Issue #6: Limit to 3 badges
      if (badges.length > MAX_VISIBLE_BADGES) {
        const hiddenCount = badges.length - MAX_VISIBLE_BADGES;
        
        // Hide extra badges
        badges.forEach(function(badge, index) {
          if (index >= MAX_VISIBLE_BADGES) {
            badge.style.display = 'none';
          }
        });
        
        // Add "+X more" badge
        const moreEl = document.createElement('span');
        moreEl.className = 'entry-service-more';
        moreEl.textContent = '+' + hiddenCount + ' more';
        moreEl.title = Array.from(badges)
          .slice(MAX_VISIBLE_BADGES)
          .map(b => b.textContent.trim())
          .join(', ');
        container.appendChild(moreEl);
      }
    });
  }

  // ========================================
  // ISSUE #12: Fix Toggle Entry Form Button State
  // ========================================
  function resetEntryFormState() {
    const toggleBtn = document.getElementById('toggle-entry-form');
    const entryForm = document.getElementById('entry-form-card');
    
    if (toggleBtn && entryForm) {
      // Reset to closed state
      entryForm.style.display = 'none';
      toggleBtn.innerHTML = '<i class="bi bi-plus-circle"></i> Add Entry';
      toggleBtn.classList.remove('active');
    }
  }

  // Hook into navigation to reset form state
  function hookNavigationForFormReset() {
    // Find all nav buttons
    document.querySelectorAll('.nav-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        // If navigating away from dashboard, reset the form
        const targetView = this.dataset.view || this.getAttribute('data-view');
        if (targetView !== 'dashboard') {
          resetEntryFormState();
        }
      });
    });
    
    // Also hook into mobile nav if present
    document.querySelectorAll('[data-view]').forEach(function(item) {
      item.addEventListener('click', function() {
        const targetView = this.dataset.view;
        if (targetView !== 'dashboard') {
          resetEntryFormState();
        }
      });
    });
  }

  // ========================================
  // INITIALIZATION
  // ========================================
  function init() {
    // Run all fixes
    runCharacterFixes();
    fixServiceBadges();
    fixThemeIndicator();
    hookNavigationForFormReset();
    
    // Set up MutationObserver to catch dynamic content
    const observer = new MutationObserver(function(mutations) {
      let shouldFixChars = false;
      let shouldFixBadges = false;
      
      mutations.forEach(function(mutation) {
        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === 1) { // Element node
              // Check if it's a reminder or entry
              if (node.classList && 
                  (node.classList.contains('reminder-card') || 
                   node.classList.contains('entry-card') ||
                   node.classList.contains('entry-services'))) {
                shouldFixChars = true;
                shouldFixBadges = true;
              }
              // Check for modals
              if (node.classList && node.classList.contains('modal-overlay')) {
                shouldFixChars = true;
              }
            }
          });
        }
      });
      
      if (shouldFixChars) {
        runCharacterFixes();
      }
      if (shouldFixBadges) {
        fixServiceBadges();
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Also run after a short delay to catch late-rendered content
  setTimeout(function() {
    runCharacterFixes();
    fixServiceBadges();
    fixThemeIndicator();
  }, 500);

  // Expose functions globally for debugging
  window.gmFixes = {
    fixThemeIndicator: fixThemeIndicator,
    runCharacterFixes: runCharacterFixes,
    fixServiceBadges: fixServiceBadges,
    resetEntryFormState: resetEntryFormState
  };

})();
