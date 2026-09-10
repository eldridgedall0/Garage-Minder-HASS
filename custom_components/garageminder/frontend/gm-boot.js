/**
 * Boot shim for the GarageMinder app inside the Home Assistant panel.
 *
 * Order matters here. The app's own boot (`$(function(){ loadData(); ... })`
 * in gm.handlers.js) expects data to be present the instant loadData()
 * returns, because it used a synchronous XHR. So before we inject a single
 * app script we:
 *
 *   1. wait for the panel bridge on window.parent,
 *   2. fetch config + the whole dataset over the websocket,
 *   3. park them on window.__gmPreloaded / window.GM_CONFIG,
 *   4. only then inject the app's scripts in their original order.
 *
 * The result is that the app boots exactly as it did on the web, with no
 * change to any of its ~30 files besides swapping gm.api.js for gm.api.ha.js.
 */

(function () {
  "use strict";

  const BRIDGE_TIMEOUT_MS = 10000;

  function waitForBridge() {
    return new Promise(function (resolve, reject) {
      const started = Date.now();
      (function poll() {
        const bridge = window.parent && window.parent.__gmBridge;
        if (bridge) {
          resolve(bridge);
          return;
        }
        if (Date.now() - started > BRIDGE_TIMEOUT_MS) {
          reject(new Error("Timed out waiting for the Home Assistant bridge"));
          return;
        }
        setTimeout(poll, 50);
      })();
    });
  }

  function injectScript(src) {
    return new Promise(function (resolve, reject) {
      const el = document.createElement("script");
      el.src = src;
      el.async = false; // preserve execution order
      el.onload = resolve;
      el.onerror = function () {
        reject(new Error("Failed to load " + src));
      };
      document.body.appendChild(el);
    });
  }

  /**
   * HA-only UI adjustments that are NOT part of the upstream `garageminder`
   * web app and must never be made by editing it (see the No-Edit Rule).
   *
   *  1. Hide the web app's WordPress "user menu" (avatar/name dropdown with
   *     My Profile / Upgrade / Log Out, and its mobile-drawer twin). It only
   *     renders when the loaded dataset has `multiUserEnabled: true` — which
   *     a dataset restored from a web-app backup can carry over — and every
   *     link in it (wp-admin/profile.php, wp-login.php?action=logout, ...)
   *     is meaningless here: this integration has no WordPress and treats
   *     one HA instance as one shared garage, not per-user accounts. Hidden
   *     with CSS rather than deleted, so a future HA-native version (e.g.
   *     showing the signed-in HA user) is a one-line change to bring back.
   *
   *  2. Add a "back to the Home Assistant dashboard" button, both in the
   *     desktop .nav bar and in the mobile hamburger drawer. Custom panels
   *     own the whole viewport — there is no HA toolbar above them to
   *     navigate back with (see the comment on :host in gm-panel.js) — so
   *     without this there is no way out of the panel except the sidebar.
   *
   * The desktop half (CSS + the .nav button) runs against markup that's
   * already in the static HTML, so it's applied immediately. The mobile
   * drawer (#mobile-nav-drawer) doesn't exist yet at that point -- it's
   * built entirely by gm.mobile-nav.js, itself one of the app scripts this
   * same boot() is still in the middle of injecting -- so a MutationObserver
   * catches it whenever it actually appears instead of guessing a delay.
   */
  function applyHaChrome() {
    if (!document.getElementById("gm-ha-overrides")) {
      const style = document.createElement("style");
      style.id = "gm-ha-overrides";
      style.textContent = [
        "#user-menu, #drawer-user-section { display: none !important; }",
        ".gm-ha-home-btn {",
        "  display: inline-flex; align-items: center; gap: var(--gm-space-2);",
        "  margin-left: auto; padding: var(--gm-space-2) var(--gm-space-4);",
        "  background-color: var(--gm-btn-ghost-bg); color: var(--gm-btn-ghost-text);",
        "  border: 1px solid var(--gm-btn-ghost-border); border-radius: var(--gm-radius);",
        "  font-size: var(--gm-font-size-sm); font-weight: var(--gm-font-weight-medium);",
        "  cursor: pointer; transition: all var(--gm-transition-fast); text-decoration: none;",
        "}",
        ".gm-ha-home-btn:hover { background-color: var(--gm-btn-ghost-bg-hover); color: var(--gm-btn-ghost-text-hover); }",
        ".gm-ha-home-btn i { font-size: 1rem; }",
        // Mirrors .drawer-nav-item (gm.22-mobile-nav.css) so it reads as a
        // normal row in the drawer's nav list, not a bolted-on extra.
        ".gm-ha-drawer-btn {",
        "  display: flex; align-items: center; gap: 14px; width: 100%;",
        "  padding: 14px 20px; background: transparent; border: none;",
        "  color: var(--gm-text-muted); font-size: 1rem; text-align: left;",
        "  cursor: pointer; transition: all var(--gm-transition);",
        "}",
        ".gm-ha-drawer-btn:hover { background: var(--gm-bg-hover); color: var(--gm-text-primary); }",
        ".gm-ha-drawer-btn-icon { font-size: 1.25rem; width: 28px; text-align: center; }",
        ".gm-ha-drawer-btn-label { font-weight: 500; }",
      ].join("\n");
      document.head.appendChild(style);
    }

    if (!document.getElementById("gm-ha-home-btn")) {
      const nav = document.querySelector(".nav");
      if (nav) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.id = "gm-ha-home-btn";
        // Deliberately NOT class "nav-btn": gm.handlers.js does
        // $(".nav-btn").on("click", ...) once, un-delegated, and calls
        // navigateTo($(this).data("view")) -- a button with no data-view
        // caught in that selector would call navigateTo(undefined). Styled
        // to match via .gm-ha-home-btn (added above) instead.
        btn.className = "gm-ha-home-btn";
        btn.title = "Back to the Home Assistant dashboard";
        btn.innerHTML = '<i class="bi bi-house-door-fill"></i> Home Assistant';
        btn.addEventListener("click", goToHaDashboard);
        nav.appendChild(btn);
      }
    }

    addMobileHomeButtonWhenDrawerAppears();
  }

  function goToHaDashboard() {
    window.parent.location.href = "/";
  }

  function addMobileHomeButtonToDrawer() {
    if (document.getElementById("gm-ha-drawer-home-btn")) return;
    const drawerNav = document.querySelector("#mobile-nav-drawer .drawer-nav");
    if (!drawerNav) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "gm-ha-drawer-home-btn";
    // Not "drawer-nav-item": that class only matters for CSS here (see
    // Gotcha about gm.handlers.js's un-delegated .nav-btn binding) -- this
    // element is created after gm.mobile-nav.js's own bindEvents() already
    // ran and captured its querySelectorAll('.drawer-nav-item') snapshot,
    // so it would never receive handleNavClick anyway. Own class regardless,
    // to not depend on that ordering staying true.
    btn.className = "gm-ha-drawer-btn";
    btn.innerHTML =
      '<span class="gm-ha-drawer-btn-icon"><i class="bi bi-house-door-fill"></i></span>' +
      '<span class="gm-ha-drawer-btn-label">Home Assistant</span>';
    btn.addEventListener("click", goToHaDashboard);
    drawerNav.appendChild(btn);
  }

  function addMobileHomeButtonWhenDrawerAppears() {
    if (document.getElementById("mobile-nav-drawer")) {
      addMobileHomeButtonToDrawer();
      return;
    }
    const observer = new MutationObserver(function () {
      if (document.getElementById("mobile-nav-drawer")) {
        addMobileHomeButtonToDrawer();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  }

  function applyBranding(config) {
    document.title = config.appName || "GarageMinder";

    const title = document.querySelector(".app-title");
    if (title && !title.textContent.trim()) title.textContent = document.title;

    const tagline = document.querySelector(".tagline");
    if (tagline && !tagline.textContent.trim() && config.appTagline) {
      tagline.textContent = config.appTagline;
    }

    const logo = document.querySelector(".app-logo");
    if (logo && !logo.getAttribute("alt")) logo.setAttribute("alt", document.title);

    const copyright = document.getElementById("gm-footer-copyright");
    if (copyright) {
      copyright.textContent =
        "© " + new Date().getFullYear() + " " + document.title;
    }
    const version = document.getElementById("gm-footer-version");
    if (version) version.textContent = "Home Assistant";
  }

  async function boot() {
    // Runs against the static markup that's already in the DOM, so it does
    // not wait on the bridge or the data load -- the home button in
    // particular should still work even if boot() fails below.
    applyHaChrome();

    const bridge = await waitForBridge();

    const [config, dataset] = await Promise.all([
      bridge.callWS({ type: "garageminder/config" }),
      bridge.callWS({ type: "garageminder/load" }),
    ]);

    // These stood in for the values index.php used to inject from PHP.
    window.GM_CONFIG = Object.assign(
      {
        appName: "GarageMinder",
        appShortName: "GarageMinder",
        appTagline: "Vehicle maintenance, tracked.",
        appDomain: "garageminder",
        themeMode: bridge.themeMode(),
        profileUrl: "/profile",
      },
      config
    );
    window.APP_CONFIG = window.GM_CONFIG;
    window.GM_USER = bridge.user();
    window.GM_AUTH_URLS = {};
    window.ATTACH_MAX_SIZE_MB = config.maxAttachmentSizeMB || 10;
    window.ATTACH_MAX_COUNT = config.maxAttachments || 10;
    window.__gmPreloaded = dataset;

    document.body.classList.add("gm-theme-" + window.GM_CONFIG.themeMode);

    // index.php printed these from PHP; nothing does now, so the header would
    // render with an empty <h1>.
    applyBranding(window.GM_CONFIG);

    // Vendor first (jQuery, jQuery UI), so we can hold jQuery's ready queue.
    for (const src of window.GM_VENDOR_SCRIPTS) {
      await injectScript(src);
    }

    // THE ORDERING PROBLEM
    // --------------------
    // The document finished loading long before these scripts arrive, so
    // jQuery's ready has already fired. Left alone, gm.handlers.js would boot
    // the whole app the instant it loads -- before gm.preloader.js and the
    // other later files even exist, so the splash screen would register its
    // 'gm:dataLoaded' listener after that event had already been dispatched
    // and hang on "STARTING UP..." forever.
    //
    // ($.holdReady does not help: ready had already fired by the time we
    // could call it.)
    //
    // So we queue every ready callback ourselves and flush them once all the
    // scripts are in, which reproduces the original "parse everything, then
    // boot" order exactly.
    const jq = window.jQuery;
    const readyQueue = [];
    const originalReady = jq && jq.fn.ready;
    if (originalReady) {
      jq.fn.ready = function (fn) {
        readyQueue.push(fn);
        return this;
      };
    }

    // GM_SCRIPTS is written into index.html by tools/build_frontend.py, in the
    // exact order index.php loaded them, with gm.api.js already swapped out.
    for (const src of window.GM_SCRIPTS) {
      await injectScript(src);
    }

    if (originalReady) {
      jq.fn.ready = originalReady;
      for (const fn of readyQueue) {
        try {
          fn(jq);
        } catch (err) {
          console.error("[GarageMinder] ready callback failed", err);
        }
      }
    }

    // Files that registered a native DOMContentLoaded listener would never
    // hear one, since the real event fired before they were injected.
    document.dispatchEvent(
      new Event("DOMContentLoaded", { bubbles: true, cancelable: false })
    );
  }

  boot().catch(function (err) {
    console.error("[GarageMinder] boot failed", err);
    const notice = document.createElement("div");
    notice.style.cssText =
      "padding:24px;font:15px/1.5 system-ui,sans-serif;color:#fff;background:#7f1d1d;";
    notice.textContent = "GarageMinder couldn’t start: " + err.message;
    document.body.prepend(notice);
  });
})();
