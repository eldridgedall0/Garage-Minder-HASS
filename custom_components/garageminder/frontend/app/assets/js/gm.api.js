/**
 * Garage Maintenance - API Functions
 * Handles loading and saving data to backend
 * Multi-user ready with authentication error handling
 *
 * Offline sync additions:
 * - loadData() short-circuits to IDB snapshot when offline
 * - loadData() saves snapshot to IDB on every successful server load
 * - saveData() routes to offline queue when offline
 * - saveData() includes data_version token for optimistic locking
 * - saveData() handles 409 conflict with auto re-fetch and retry
 */

// ── Offline snapshot loader ────────────────────────────────────────────────
function _loadFromSnapshot() {
  var userId = (window.GM_USER && window.GM_USER.id)
    ? String(window.GM_USER.id) : 'default';
  if (typeof gmOffline === 'undefined') return;
  gmOffline.loadSnapshot(userId).then(function(snapshotData) {
    if (snapshotData) {
      data = snapshotData;
      if (snapshotData.user)         window.gmUser         = snapshotData.user;
      if (snapshotData.authUrls)     window.gmAuthUrls     = snapshotData.authUrls;
      if (snapshotData.subscription) window.GM_SUBSCRIPTION = snapshotData.subscription;
      if (snapshotData.data_version) window._gmDataVersion  = snapshotData.data_version;
      _normalizeLoadedData();
      if (typeof renderAll === 'function')       renderAll();
      else if (typeof renderDashboard === 'function') renderDashboard();
      // Re-run feature inits that depend on data — these already fired on
      // DOM-ready but data was empty then because IDB load is async.
      if (typeof initTemplatesFeature === 'function') initTemplatesFeature();
      if (typeof gmSubUpdateUI         === 'function') gmSubUpdateUI();
      document.dispatchEvent(new CustomEvent('gm:dataLoaded'));
      gmOffline.showBanner('offline',
        "You\u2019re offline \u2014 viewing data from your last session.");
    } else {
      gmOffline.showBanner('offline',
        "You\u2019re offline and no local data is available. Connect to load your data.");
    }
  });
}

function loadData() {
  data = cloneDefaultData();
  if (!data.settings) {
    data.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  } else {
    if (typeof data.settings.siteTitle !== "string" || !data.settings.siteTitle)
      data.settings.siteTitle = DEFAULT_SETTINGS.siteTitle;
    if (!data.settings.unit)
      data.settings.unit = DEFAULT_SETTINGS.unit;
    if (!Object.prototype.hasOwnProperty.call(data.settings, "timezone"))
      data.settings.timezone = DEFAULT_SETTINGS.timezone;
    if (!Object.prototype.hasOwnProperty.call(data.settings, "keepFormOpen"))
      data.settings.keepFormOpen = DEFAULT_SETTINGS.keepFormOpen;
  }

  // Offline short-circuit: skip the sync XHR when we know we're offline
  if (typeof gmOffline !== 'undefined' && gmOffline.isOffline()) {
    _loadFromSnapshot();
    return;
  }

  try {
    $.ajax({
      url: BACKEND_URL,
      method: "GET",
      dataType: "json",
      data: { action: "load", ts: Date.now() },
      cache: false,
      async: false,
      success: function(resp) {
        if (resp && resp.db_error) {
          var banner = document.getElementById("db-error-banner");
          if (banner) banner.style.display = "block";
          return;
        }
        if (resp && resp.error === 'authentication_required') {
          if (resp.login_url) window.location.href = resp.login_url;
          else window.location.reload();
          return;
        }
        if (resp && resp.success && resp.data) {
          data = resp.data;
          if (resp.data.user)     window.gmUser     = resp.data.user;
          if (resp.data.authUrls) window.gmAuthUrls = resp.data.authUrls;

          if (resp.data.subscription) {
            window.GM_SUBSCRIPTION = resp.data.subscription;
          } else {
            // Single-user / no WP data — grant full access.
            // export_level uses WP admin values: 'none' | 'basic' | 'advanced'
            window.GM_SUBSCRIPTION = {
              tier: 'free', tier_name: 'Free', is_active: true, limits: {},
              usage: {
                vehicles: { used: 0, max: -1, remaining: -1, unlimited: true },
                entries:  { used: 0, max: -1, remaining: -1, unlimited: true }
              },
              features: {
                recalls: true, export: true, export_level: 'advanced',
                export_bulk: true,
                attachments: true, attachments_per_entry: 5,
                local_upload: true, gdrive: true,
                vehicle_photos: true, templates: true, max_templates: -1
              },
              upgrade_url: '/pricing/'
            };
          }

          // Store data_version for optimistic locking
          if (resp.data.data_version) window._gmDataVersion = resp.data.data_version;

          // Save snapshot for offline use; verify/heal SW cache; confirm offline readiness
          if (typeof gmOffline !== 'undefined') {
            var uid = (window.GM_USER && window.GM_USER.id)
              ? String(window.GM_USER.id) : 'default';
            gmOffline.saveSnapshot(uid, resp.data).then(function () {
              // Notify user that offline is ready (first time only per session)
              gmOffline.notifyOfflineReady();
            });
            // Ask SW to check/heal core asset cache — runs in background, no UI impact
            gmOffline.verifyCacheHealth();
            gmOffline.hideBanner();
          }
        }
      },
      error: function(xhr, status, err) {
        if (xhr.status === 401) {
          try {
            var r = JSON.parse(xhr.responseText);
            if (r.login_url) { window.location.href = r.login_url; return; }
          } catch(e) {}
          window.location.reload();
          return;
        }
        console.warn("[gmOffline] Network load failed, trying snapshot.", err);
        if (typeof gmOffline !== 'undefined') {
          gmOffline.showBanner('offline', "Can\u2019t reach server \u2014 showing last synced data.");
          _loadFromSnapshot();
        } else {
          console.error("Error loading from backend, using defaults.", err);
        }
      }
    });

    _normalizeLoadedData();
    document.dispatchEvent(new CustomEvent('gm:dataLoaded'));

  } catch(e) {
    console.error("Error loading data, resetting.", e);
    data = cloneDefaultData();
  }
}

function _normalizeLoadedData() {
  if (!data.vehicles)         data.vehicles = [];
  if (!data.serviceTypes)     data.serviceTypes = [];
  if (!data.entries)          data.entries = [];
  if (!data.reminders)        data.reminders = [];
  if (!data.vehicleIntervals) data.vehicleIntervals = {};
  if (!data.settings) {
    data.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  } else {
    if (typeof data.settings.siteTitle !== "string" || !data.settings.siteTitle)
      data.settings.siteTitle = DEFAULT_SETTINGS.siteTitle;
    if (!data.settings.unit)
      data.settings.unit = DEFAULT_SETTINGS.unit;
    if (!Object.prototype.hasOwnProperty.call(data.settings, "timezone"))
      data.settings.timezone = DEFAULT_SETTINGS.timezone;
    if (!Object.prototype.hasOwnProperty.call(data.settings, "upcomingThresholdDays"))
      data.settings.upcomingThresholdDays = DEFAULT_SETTINGS.upcomingThresholdDays;
    if (!Object.prototype.hasOwnProperty.call(data.settings, "upcomingThresholdMiles"))
      data.settings.upcomingThresholdMiles = DEFAULT_SETTINGS.upcomingThresholdMiles;
    if (!Object.prototype.hasOwnProperty.call(data.settings, "overdueThresholdDays"))
      data.settings.overdueThresholdDays = DEFAULT_SETTINGS.overdueThresholdDays;
    if (!Object.prototype.hasOwnProperty.call(data.settings, "overdueThresholdMiles"))
      data.settings.overdueThresholdMiles = DEFAULT_SETTINGS.overdueThresholdMiles;
  }

  data.vehicles.forEach(function(v) {
    if (!Object.prototype.hasOwnProperty.call(v, "currentOdo")) v.currentOdo = null;
    if (!Object.prototype.hasOwnProperty.call(v, "vin"))        v.vin = null;
    if (!Object.prototype.hasOwnProperty.call(v, "plate"))      v.plate = null;
  });

  if (Array.isArray(data.serviceTypes) && data.serviceTypes.length) {
    if (typeof data.serviceTypes[0] === "string") {
      data.serviceTypes = data.serviceTypes.map(function(n) {
        return { name: n, intervalMiles: null, intervalMonths: null };
      });
    } else {
      data.serviceTypes = data.serviceTypes.map(function(st) {
        if (typeof st === "string")
          return { name: st, intervalMiles: null, intervalMonths: null };
        return {
          name: st.name || "",
          intervalMiles:  (st.intervalMiles  != null ? st.intervalMiles  : null),
          intervalMonths: (st.intervalMonths != null ? st.intervalMonths : null)
        };
      });
    }
  }
}


/**
 * Save data to backend - returns a Promise for async usage
 *
 * offlineIntent (optional): { type: 'entries'|'vehicles'|'reminders'|'entryTemplates', items: [...] }
 *   When provided and we are offline, the items are queued in IDB instead of sent to server.
 */
function saveData(offlineIntent) {
  return new Promise(function(resolve, reject) {

    // Offline queue path
    if (typeof gmOffline !== 'undefined' && gmOffline.isOffline()) {
      if (offlineIntent && offlineIntent.type && offlineIntent.items) {
        var uid = (window.GM_USER && window.GM_USER.id)
          ? String(window.GM_USER.id) : 'default';
        gmOffline.queuePendingAdd(uid, offlineIntent.type, offlineIntent.items)
          .then(function() {
            showToast("Saved locally \u2014 will sync when you reconnect");
            resolve({ success: true, queued: true });
          })
          .catch(reject);
      } else {
        if (typeof showToast === 'function') {
          showToast("Editing existing records requires a connection.", 4000);
        }
        reject(new Error('offline_edit_blocked'));
      }
      return;
    }

    // Online save path
    try {
      if (data && typeof data === "object") {
        if (activeVehicleId === "all")       data.activeVehicleId = "all";
        else if (activeVehicleId)            data.activeVehicleId = activeVehicleId;
        else                                 data.activeVehicleId = "all";
      }

      // Include data_version token for optimistic locking
      var payload = Object.assign({}, data || {});
      if (window._gmDataVersion) payload.data_version = window._gmDataVersion;

      $.ajax({
        url: BACKEND_URL + "?action=save",
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify({ data: payload }),
        success: function(resp) {
          if (resp && resp.success) {
            showToast("Changes saved");
            // Update data_version with new token from server
            if (resp.data_version) {
              window._gmDataVersion = resp.data_version;
              if (typeof gmOffline !== 'undefined') {
                var uid2 = (window.GM_USER && window.GM_USER.id)
                  ? String(window.GM_USER.id) : 'default';
                gmOffline.onSaveSuccess(uid2, resp.data_version);
              }
            }
            resolve(resp);
          } else if (resp && resp.db_error) {
            var banner = document.getElementById("db-error-banner");
            if (banner) banner.style.display = "block";
            reject(new Error("Database error"));
          } else if (resp && resp.error === 'authentication_required') {
            if (resp.login_url) window.location.href = resp.login_url;
            else window.location.reload();
            reject(new Error("Authentication required"));
          } else {
            resolve(resp);
          }
        },
        error: function(xhr, status, err) {
          // Auth error
          if (xhr.status === 401) {
            try {
              var r = JSON.parse(xhr.responseText);
              if (r.login_url) { window.location.href = r.login_url; return; }
            } catch(e) {}
            window.location.reload();
            return;
          }

          // Version conflict — re-fetch token and retry once
          if (xhr.status === 409) {
            console.warn('[gmOffline] Version conflict on save, re-fetching token and retrying.');
            $.ajax({
              url: BACKEND_URL,
              method: "GET", dataType: "json",
              data: { action: "load", ts: Date.now() },
              cache: false, async: false,
              success: function(freshResp) {
                if (freshResp && freshResp.success && freshResp.data) {
                  window._gmDataVersion = freshResp.data.data_version;
                  // Retry save with updated token (no offlineIntent on retry)
                  saveData().then(resolve).catch(reject);
                } else {
                  reject(new Error('conflict_reload_failed'));
                }
              },
              error: function() { reject(new Error('conflict_reload_failed')); }
            });
            return;
          }

          // Plan limit errors
          if (xhr.status === 403) {
            try {
              var r2 = JSON.parse(xhr.responseText);
              var limitErrors = [
                'vehicle_limit_reached','entry_limit_reached',
                'template_limit_reached','local_upload_not_allowed','attachment_limit_reached'
              ];
              if (r2 && limitErrors.includes(r2.error)) {
                if (typeof showUpgradeModal === 'function') {
                  showUpgradeModal({
                    title: 'Plan Limit Reached',
                    message: r2.message || 'This action is not available on your current plan.',
                    feature: r2.error
                  });
                } else {
                  alert(r2.message || 'Plan limit reached. Please upgrade.');
                }
                reject(new Error(r2.error));
                return;
              }
            } catch(e) {}
          }

          // Network failure
          if (typeof gmOffline !== 'undefined' && !navigator.onLine) {
            showToast("Connection lost \u2014 please try again when reconnected.", 4000);
          } else {
            console.error("Error saving data:", err);
          }
          reject(err);
        }
      });
    } catch(e) {
      console.error("Error in saveData:", e);
      reject(e);
    }
  });
}

/**
 * Helper function for backward compatibility - fire and forget save
 */
function saveDataSync() {
  saveData().catch(function(err) {
    if (err.message !== 'offline_edit_blocked') {
      console.error("Save failed:", err);
    }
  });
}

// ============================================================
// GM SUBSCRIPTION HELPERS
// ============================================================

const gmSub = {
  get: function() { return window.GM_SUBSCRIPTION || null; },

  can: function(featureKey) {
    var sub = this.get();
    if (!sub || !sub.features) return true;
    var val = sub.features[featureKey];
    if (val === undefined)      return true;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number')  return val > 0 || val === -1;
    return val !== 'none' && val !== '0' && val !== '';
  },

  limit: function(key) {
    var sub = this.get();
    if (!sub || !sub.limits) return -1;
    var v = sub.limits[key];
    return v !== undefined ? Number(v) : -1;
  },

  atLimit: function(countType) {
    var sub = this.get();
    if (!sub || !sub.usage || !sub.usage[countType]) return false;
    var u = sub.usage[countType];
    if (u.unlimited) return false;
    return u.remaining <= 0;
  },

  remaining: function(countType) {
    var sub = this.get();
    if (!sub || !sub.usage || !sub.usage[countType]) return -1;
    var u = sub.usage[countType];
    if (u.unlimited) return -1;
    return u.remaining;
  },

  used: function(countType) {
    var sub = this.get();
    if (!sub || !sub.usage || !sub.usage[countType]) return 0;
    return sub.usage[countType].used || 0;
  },

  max: function(countType) {
    var sub = this.get();
    if (!sub || !sub.usage || !sub.usage[countType]) return -1;
    var u = sub.usage[countType];
    return u.unlimited ? -1 : (u.max || -1);
  },

  upgradeUrl:          function() { return (this.get() || {}).upgrade_url || '/pricing/'; },
  tierName:            function() { return (this.get() || {}).tier_name   || 'Free'; },
  tier:                function() { return (this.get() || {}).tier        || 'free'; },
  exportLevel:         function() { var s = this.get(); return s && s.features ? s.features.export_level || 'none' : 'none'; },
  attachmentsPerEntry: function() { var s = this.get(); return s && s.features ? (s.features.attachments_per_entry || 0) : 0; },
  maxTemplates:        function() { var s = this.get(); return s && s.features ? (s.features.max_templates !== undefined ? s.features.max_templates : -1) : -1; }
};

window.gmSub = gmSub;