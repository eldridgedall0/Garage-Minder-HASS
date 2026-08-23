/**
 * Drop-in replacement for assets/js/gm.api.js.
 *
 * It keeps the exact same public surface -- loadData(), saveData(),
 * saveDataSync(), _normalizeLoadedData(), gmSub -- so not one of the other
 * ~30 app scripts has to change. Only the transport differs: instead of
 * $.ajax to api.php it speaks to the integration over Home Assistant's
 * authenticated websocket.
 *
 * THE SYNCHRONOUS-LOAD PROBLEM
 * ----------------------------
 * The original loadData() used `async: false` XHR, and gm.handlers.js calls
 * it and then immediately renders. A websocket cannot be synchronous. Rather
 * than rewrite every caller, gm-boot.js resolves the first load *before* any
 * app script is injected and parks the result on window.__gmPreloaded. The
 * first loadData() call then returns from that cache synchronously, and the
 * boot sequence runs unchanged. Later calls refresh asynchronously and
 * re-render, which is exactly what the app's existing offline snapshot path
 * already did.
 */

/* global data, cloneDefaultData, DEFAULT_SETTINGS, renderAll, renderDashboard,
   initTemplatesFeature, gmSubUpdateUI, showToast, activeVehicleId */

(function () {
  "use strict";

  const WS_LOAD = "garageminder/load";
  const WS_SAVE = "garageminder/save";
  const WS_CLEAR = "garageminder/clear";

  function bridge() {
    const b = window.parent && window.parent.__gmBridge;
    if (!b) {
      throw new Error(
        "GarageMinder bridge unavailable — open the app from the Home Assistant sidebar."
      );
    }
    return b;
  }

  // Everything the app used to read off the WordPress-injected payload.
  function applyDataset(payload) {
    data = payload.data;
    window._gmDataVersion = payload.data_version;

    // No WordPress, no tiers: the local install is unrestricted. Kept in the
    // same shape so gm.subscription.js and every gmSub.can() call still work.
    window.GM_SUBSCRIPTION = {
      tier: "local",
      tier_name: "Home Assistant",
      is_active: true,
      limits: {},
      usage: {
        vehicles: { used: 0, max: -1, remaining: -1, unlimited: true },
        entries: { used: 0, max: -1, remaining: -1, unlimited: true },
      },
      features: {
        recalls: true,
        export: true,
        export_level: "advanced",
        export_bulk: true,
        attachments: true,
        attachments_per_entry: 10,
        local_upload: true,
        gdrive: false,
        vehicle_photos: true,
        templates: true,
        max_templates: -1,
      },
      upgrade_url: null,
    };

    _normalizeLoadedData();
  }

  function afterLoad() {
    if (typeof renderAll === "function") renderAll();
    else if (typeof renderDashboard === "function") renderDashboard();
    if (typeof initTemplatesFeature === "function") initTemplatesFeature();
    if (typeof gmSubUpdateUI === "function") gmSubUpdateUI();
    document.dispatchEvent(new CustomEvent("gm:dataLoaded"));
  }

  /**
   * Load the dataset. Synchronous on first call (served from the preload
   * gm-boot.js performed), asynchronous and self-rendering afterwards.
   */
  window.loadData = function loadData() {
    data = cloneDefaultData();

    if (window.__gmPreloaded) {
      applyDataset(window.__gmPreloaded);
      window.__gmPreloaded = null;
      document.dispatchEvent(new CustomEvent("gm:dataLoaded"));
      return;
    }

    bridge()
      .callWS({ type: WS_LOAD })
      .then(function (payload) {
        applyDataset(payload);
        afterLoad();
      })
      .catch(function (err) {
        console.error("[GarageMinder] load failed", err);
        if (typeof showToast === "function") {
          showToast("Couldn’t load your garage data.", 4000);
        }
      });
  };

  /**
   * Save the dataset. Same promise contract and the same 409-conflict
   * retry-once behaviour the PHP version had.
   */
  window.saveData = function saveData() {
    if (data && typeof data === "object") {
      data.activeVehicleId =
        activeVehicleId && activeVehicleId !== "" ? activeVehicleId : "all";
    }

    const payload = Object.assign({}, data || {});
    delete payload.data_version;

    return bridge()
      .callWS({
        type: WS_SAVE,
        data: payload,
        data_version: window._gmDataVersion || null,
      })
      .then(function (result) {
        window._gmDataVersion = result.data_version;
        if (typeof showToast === "function") showToast("Changes saved");
        return { success: true, data_version: result.data_version };
      })
      .catch(function (err) {
        if (err && err.code === "version_conflict") {
          console.warn("[GarageMinder] version conflict, refetching and retrying");
          return bridge()
            .callWS({ type: WS_LOAD })
            .then(function (fresh) {
              window._gmDataVersion = fresh.data_version;
              return window.saveData();
            });
        }
        console.error("[GarageMinder] save failed", err);
        if (typeof showToast === "function") {
          showToast("Couldn’t save — check the Home Assistant log.", 4000);
        }
        throw err;
      });
  };

  window.saveDataSync = function saveDataSync() {
    window.saveData().catch(function () {
      /* already reported */
    });
  };

  window.gmClearAllData = function gmClearAllData() {
    return bridge()
      .callWS({ type: WS_CLEAR })
      .then(function () {
        window.location.reload();
      });
  };

  /** Upload an attachment through HA's authenticated HTTP view. */
  window.gmUploadAttachment = function gmUploadAttachment(entryId, file) {
    const form = new FormData();
    form.append("file", file, file.name);
    return fetch("/api/garageminder/attachment/" + encodeURIComponent(entryId), {
      method: "POST",
      headers: { Authorization: "Bearer " + bridge().accessToken() },
      body: form,
    }).then(function (response) {
      if (!response.ok) throw new Error("Upload failed: " + response.status);
      return response.json();
    });
  };

  /** Signed, expiring URL so <img src> and download links work unauthenticated. */
  window.gmAttachmentUrl = function gmAttachmentUrl(entryId, attachmentId) {
    return bridge().signPath(
      "/api/garageminder/attachment/" +
        encodeURIComponent(entryId) +
        "/" +
        encodeURIComponent(attachmentId)
    );
  };

  window.gmDeleteAttachment = function gmDeleteAttachment(entryId, attachmentId) {
    return fetch(
      "/api/garageminder/attachment/" +
        encodeURIComponent(entryId) +
        "/" +
        encodeURIComponent(attachmentId),
      {
        method: "DELETE",
        headers: { Authorization: "Bearer " + bridge().accessToken() },
      }
    ).then(function (response) {
      if (!response.ok) throw new Error("Delete failed: " + response.status);
      return response.json();
    });
  };

  // ---------------------------------------------------------------------
  // _normalizeLoadedData(), unchanged from gm.api.js
  // ---------------------------------------------------------------------
  window._normalizeLoadedData = function _normalizeLoadedData() {
    if (!data.vehicles) data.vehicles = [];
    if (!data.serviceTypes) data.serviceTypes = [];
    if (!data.entries) data.entries = [];
    if (!data.reminders) data.reminders = [];
    if (!data.vehicleIntervals) data.vehicleIntervals = {};

    if (!data.settings) {
      data.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    } else {
      const s = data.settings;
      if (typeof s.siteTitle !== "string" || !s.siteTitle)
        s.siteTitle = DEFAULT_SETTINGS.siteTitle;
      if (!s.unit) s.unit = DEFAULT_SETTINGS.unit;
      [
        "timezone",
        "keepFormOpen",
        "upcomingThresholdDays",
        "upcomingThresholdMiles",
        "overdueThresholdDays",
        "overdueThresholdMiles",
      ].forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(s, key))
          s[key] = DEFAULT_SETTINGS[key];
      });
    }

    data.vehicles.forEach(function (v) {
      if (!Object.prototype.hasOwnProperty.call(v, "currentOdo")) v.currentOdo = null;
      if (!Object.prototype.hasOwnProperty.call(v, "vin")) v.vin = null;
      if (!Object.prototype.hasOwnProperty.call(v, "plate")) v.plate = null;
    });

    if (Array.isArray(data.serviceTypes) && data.serviceTypes.length) {
      data.serviceTypes = data.serviceTypes.map(function (st) {
        if (typeof st === "string")
          return { name: st, intervalMiles: null, intervalMonths: null };
        return {
          name: st.name || "",
          intervalMiles: st.intervalMiles != null ? st.intervalMiles : null,
          intervalMonths: st.intervalMonths != null ? st.intervalMonths : null,
        };
      });
    }
  };

  // ---------------------------------------------------------------------
  // gmSub — kept so the ~40 gmSub.can() calls across the app still resolve.
  // Locally everything is allowed; this is now a compatibility shim.
  // ---------------------------------------------------------------------
  const gmSub = {
    get: function () {
      return window.GM_SUBSCRIPTION || null;
    },
    can: function (featureKey) {
      const sub = this.get();
      if (!sub || !sub.features) return true;
      const val = sub.features[featureKey];
      if (val === undefined) return true;
      if (typeof val === "boolean") return val;
      if (typeof val === "number") return val > 0 || val === -1;
      return val !== "none" && val !== "0" && val !== "";
    },
    limit: function () {
      return -1;
    },
    atLimit: function () {
      return false;
    },
    remaining: function () {
      return -1;
    },
    used: function (countType) {
      if (!data) return 0;
      return countType === "vehicles"
        ? (data.vehicles || []).length
        : (data.entries || []).length;
    },
    max: function () {
      return -1;
    },
    upgradeUrl: function () {
      return null;
    },
    tierName: function () {
      return "Home Assistant";
    },
    tier: function () {
      return "local";
    },
    exportLevel: function () {
      return "advanced";
    },
    attachmentsPerEntry: function () {
      return 10;
    },
    maxTemplates: function () {
      return -1;
    },
  };

  window.gmSub = gmSub;
})();
