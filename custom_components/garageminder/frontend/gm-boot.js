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
        googleDriveEnabled: false,
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
