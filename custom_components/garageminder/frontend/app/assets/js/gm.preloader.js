/**
 * GarageMinder Preloader — gm.preloader.js
 *
 * Branded gear+wrench loading screen that adapts to the user's
 * dark/light theme preference exactly as set in WordPress.
 *
 * THEME AWARENESS:
 *   Theme is applied server-side as a class on <body>:
 *     <body class="gm-theme-dark">  or  <body class="gm-theme-light">
 *
 *   The CSS file (gm.26-preloader.css) uses only var(--gm-*) custom
 *   properties, so it inherits the active theme tokens automatically.
 *
 *   Additionally, GM_CONFIG.themeMode ('dark'|'light') is read here
 *   so the preloader can be created with the correct class before the
 *   rest of the CSS has painted — avoiding any flash of wrong theme.
 *
 * USAGE:
 *   GmPreloader.show()              — show (auto-called on DOMContentLoaded)
 *   GmPreloader.setStatus(msg)      — update status text
 *   GmPreloader.setProgress(0-100)  — set deterministic progress
 *   GmPreloader.hide()              — fade out and remove
 *
 * AUTO-HIDE:
 *   Listens for the 'gm:dataLoaded' CustomEvent dispatched by gm.api.js
 *   after loadData() completes (online or offline/IDB path).
 *   Also has a 12-second failsafe to prevent stuck loaders on errors.
 */

(function () {
  'use strict';

  // ── SVG assets (inline — zero network deps, works 100% offline) ──────────

  const SVG_GEAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" width="100%" height="100%" aria-hidden="true">
    <path d="M8.932.727c-.243-.97-1.62-.97-1.864 0l-.071.286a.96.96 0 0 1-1.622.434l-.205-.211c-.695-.719-1.888-.03-1.613.931l.08.284a.96.96 0 0 1-1.186 1.187l-.284-.081c-.96-.275-1.65.918-.931 1.613l.211.205a.96.96 0 0 1-.434 1.622l-.286.071c-.97.243-.97 1.62 0 1.864l.286.071a.96.96 0 0 1 .434 1.622l-.211.205c-.719.695-.03 1.888.931 1.613l.284-.08a.96.96 0 0 1 1.187 1.187l-.081.283c-.275.96.918 1.65 1.613.931l.205-.211a.96.96 0 0 1 1.622.434l.071.286c.243.97 1.62.97 1.864 0l.071-.286a.96.96 0 0 1 1.622-.434l.205.211c.695.719 1.888.03 1.613-.931l-.08-.284a.96.96 0 0 1 1.187-1.187l.283.081c.96.275 1.65-.918.931-1.613l-.211-.205a.96.96 0 0 1 .434-1.622l.286-.071c.97-.243.97-1.62 0-1.864l-.286-.071a.96.96 0 0 1-.434-1.622l.211-.205c.719-.695.03-1.888-.931-1.613l-.284.08a.96.96 0 0 1-1.187-1.186l.081-.284c.275-.96-.918-1.65-1.613-.931l-.205.211a.96.96 0 0 1-1.622-.434L8.932.727zM8 5.196a2.804 2.804 0 1 1 0 5.608 2.804 2.804 0 0 1 0-5.608z"/>
  </svg>`;

  const SVG_WRENCH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" width="100%" height="100%" aria-hidden="true">
    <path d="M.102 2.223A3.004 3.004 0 0 0 3.78 5.897l6.341 6.252A3.003 3.003 0 0 0 13 16a3 3 0 1 0-.851-5.878L5.897 3.781A3.004 3.004 0 0 0 2.223.1l2.141 2.142L.102 2.223zm13.37 9.019.528.026.287.445.445.287.026.529L15 13l-.242.47-.026.529-.445.287-.287.445-.529.026L13 15l-.47-.242-.529-.026-.287-.445-.445-.287-.026-.529L11 13l.242-.47.026-.529.445-.287.287-.445.529-.026L13 11l.47.242z"/>
  </svg>`;

  // ── Resolve theme early ────────────────────────────────────────────────────
  /**
   * Returns 'light' or 'dark'.
   *
   * Priority:
   *   1. <body> class already set by PHP (most reliable — server knows the user's preference)
   *   2. GM_CONFIG.themeMode (injected by PHP into <script> before this file loads)
   *   3. Default: 'dark'
   */
  function resolveTheme() {
    // 1. Body class set by PHP server-side — definitive source of truth
    if (document.body) {
      if (document.body.classList.contains('gm-theme-light')) return 'light';
      if (document.body.classList.contains('gm-theme-dark'))  return 'dark';
    }
    // 2. GM_CONFIG injected into <head> by PHP
    if (typeof GM_CONFIG !== 'undefined' && GM_CONFIG.themeMode) {
      return GM_CONFIG.themeMode === 'light' ? 'light' : 'dark';
    }
    // 3. APP_CONFIG (backwards-compat alias)
    if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.themeMode) {
      return APP_CONFIG.themeMode === 'light' ? 'light' : 'dark';
    }
    return 'dark';
  }

  // ── DOM construction ───────────────────────────────────────────────────────

  function buildPreloader(theme) {
    const el = document.createElement('div');
    el.id = 'gm-preloader';

    /*
     * We add the theme class directly to the preloader element so that
     * CSS selectors like `.gm-theme-light #gm-preloader` resolve correctly
     * even if the preloader is inserted before the body class is available.
     * In practice, PHP sets body class before <body> renders, but this is
     * a belt-and-suspenders guarantee.
     */
    el.classList.add('gm-theme-' + theme);

    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Loading application');

    el.innerHTML = `
      <div class="gm-preloader__icons" aria-hidden="true">
        <span class="gm-preloader__gear-large">${SVG_GEAR}</span>
        <span class="gm-preloader__gear-small">${SVG_GEAR}</span>
        <span class="gm-preloader__wrench">${SVG_WRENCH}</span>
      </div>

      <div class="gm-preloader__text">
        <span class="gm-preloader__app-name" id="gm-preloader-name">TrackMyWrench</span>
        <span class="gm-preloader__status"   id="gm-preloader-status">Starting up…</span>
      </div>

      <div class="gm-preloader__bar-wrap" aria-hidden="true">
        <div class="gm-preloader__bar gm-preloader__bar--indeterminate" id="gm-preloader-bar"></div>
      </div>

      <span class="gm-preloader__offline" id="gm-preloader-offline">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-1px;margin-right:3px" aria-hidden="true">
          <path d="M10.706 3.294A12.545 12.545 0 0 0 8 3C5.259 3 2.723 3.994.921 5.796a.5.5 0 1 0 .814.566A11.545 11.545 0 0 1 8 4c.94 0 1.85.12 2.706.351l-.294.294A10.46 10.46 0 0 0 8 4.5c-1.927 0-3.718.55-5.219 1.487l.71.71A9.455 9.455 0 0 1 8 5.5c1.173 0 2.286.215 3.31.604l-.282.282A8.433 8.433 0 0 0 8 6c-1.282 0-2.5.26-3.605.73l.72.72A7.4 7.4 0 0 1 8 7c.86 0 1.689.135 2.464.385L8.707 9.15A2 2 0 0 0 8 9a2 2 0 1 0 2 2 2 2 0 0 0-.207-.907l6.114-6.114a.5.5 0 0 0-.707-.707l-6.5 6.5a.5.5 0 0 0 0 .707A1 1 0 0 1 8 11a1 1 0 1 1 0-2 1 1 0 0 1 .793.388zM1.146 13.146a.5.5 0 1 0 .707.707L14 1.707a.5.5 0 0 0-.707-.707L1.146 13.146z"/>
        </svg>
        Offline — loading from cache
      </span>
    `;

    return el;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  let _el        = null;
  let _hideTimer = null;
  let _indeterminate = true;

  const GmPreloader = {

    /** Inject and display the preloader. Safe to call multiple times. */
    show: function () {
      if (_el) return;

      const theme = resolveTheme();
      _el = buildPreloader(theme);

      // Resolve the app name
      const appName = (typeof GM_CONFIG !== 'undefined' && GM_CONFIG.appName)
        || (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.appName)
        || 'TrackMyWrench';
      const nameEl = _el.querySelector('#gm-preloader-name');
      if (nameEl) nameEl.textContent = appName;

      // Prepend so it sits on top of everything
      document.body.prepend(_el);

      // Show offline badge if network is unavailable right now
      if (!navigator.onLine) {
        this._showOffline(true);
      }

      // Listen for online/offline changes during the load
      window.addEventListener('online',  () => this._showOffline(false), { once: true });
      window.addEventListener('offline', () => this._showOffline(true),  { once: true });

      // Keep the preloader theme class in sync if the body class ever changes
      // (e.g. theme-indicator toggles it at runtime)
      this._watchThemeChanges();
    },

    /** Update the status text shown below the icons. */
    setStatus: function (msg) {
      if (!_el) return;
      const el = _el.querySelector('#gm-preloader-status');
      if (el) el.textContent = msg;
    },

    /**
     * Set deterministic progress (0–100).
     * Switches the bar from indeterminate shimmer to a real width.
     */
    setProgress: function (pct) {
      if (!_el) return;
      const bar = _el.querySelector('#gm-preloader-bar');
      if (!bar) return;

      if (_indeterminate) {
        bar.classList.remove('gm-preloader__bar--indeterminate');
        _indeterminate = false;
      }
      bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    },

    /** Fade out and remove the preloader from the DOM. */
    hide: function (delayMs) {
      if (!_el) return;
      clearTimeout(_hideTimer);

      this.setProgress(100);
      this.setStatus('Ready');

      _hideTimer = setTimeout(() => {
        if (!_el) return;
        _el.classList.add('gm-preloader--hidden');

        // Remove after CSS transition ends
        _el.addEventListener('transitionend', () => {
          if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
          _el = null;
        }, { once: true });

        // Safety timeout in case transitionend doesn't fire (e.g. background tab)
        setTimeout(() => {
          if (_el && _el.parentNode) { _el.parentNode.removeChild(_el); _el = null; }
        }, 600);
      }, typeof delayMs === 'number' ? delayMs : 0);
    },

    /** Whether the preloader is currently visible */
    isVisible: function () {
      return !!_el && !_el.classList.contains('gm-preloader--hidden');
    },

    // ── Private ─────────────────────────────────────────────────────────────

    _showOffline: function (isOffline) {
      if (!_el) return;
      const badge = _el.querySelector('#gm-preloader-offline');
      if (badge) badge.classList.toggle('visible', isOffline);
      if (isOffline) this.setStatus('Loading from cache…');
    },

    /**
     * Watch for body class changes so the preloader theme class stays in sync.
     * This handles the rare case where JS switches the theme after page load but
     * before the preloader has hidden (e.g. a very fast theme toggle).
     */
    _watchThemeChanges: function () {
      const observer = new MutationObserver(() => {
        if (!_el) { observer.disconnect(); return; }
        const newTheme = resolveTheme();
        _el.classList.toggle('gm-theme-light', newTheme === 'light');
        _el.classList.toggle('gm-theme-dark',  newTheme === 'dark');
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    },
  };

  // ── Auto-show ──────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => GmPreloader.show());
  } else {
    GmPreloader.show();
  }

  // ── Auto-hide hooks ────────────────────────────────────────────────────────

  // Primary: gm.api.js dispatches 'gm:dataLoaded' when loadData() completes
  document.addEventListener('gm:dataLoaded', function () {
    GmPreloader.hide(200);
  });

  // Warning at 5s if still loading
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(() => {
      if (GmPreloader.isVisible()) GmPreloader.setStatus('Taking longer than expected…');
    }, 5000);

    // Hard failsafe: force-hide at 12s to prevent stuck loader on errors
    setTimeout(() => {
      if (GmPreloader.isVisible()) GmPreloader.hide(0);
    }, 12000);
  });

  // ── Export ─────────────────────────────────────────────────────────────────
  window.GmPreloader = GmPreloader;

})();
