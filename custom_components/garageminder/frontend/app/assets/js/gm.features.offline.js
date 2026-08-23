/**
 * GarageMinder — Offline Sync Module
 *
 * Strategy: Online-first with offline fallback.
 * - Server is always authoritative.
 * - IndexedDB mirrors the last successful server load (snapshot).
 * - New additions made offline are queued and flushed on reconnect.
 * - Edits and deletes to existing records are blocked offline.
 * - Optimistic locking (data_version token) prevents blind overwrites
 *   when multiple devices are active.
 *
 * Public API (window.gmOffline):
 *   gmOffline.isOffline()              → bool
 *   gmOffline.saveSnapshot(userId, data)
 *   gmOffline.loadSnapshot(userId)     → data object or null
 *   gmOffline.getDataVersion(userId)   → token string or null
 *   gmOffline.queuePendingAdd(userId, type, items)
 *   gmOffline.hasPendingQueue(userId)  → bool
 *   gmOffline.getPendingCount(userId)  → int
 *   gmOffline.syncPendingQueue()       → Promise
 *   gmOffline.verifyCacheHealth()      → asks SW to check/heal CORE assets
 *   gmOffline.notifyOfflineReady()     → shows "ready for offline" toast once per session
 *   gmOffline.showBanner(type, msg)
 *   gmOffline.hideBanner()
 */

(function () {
  'use strict';

  // ─── Dev flag: OFFLINE_STORAGE_ENABLED ────────────────────────────────────
  // Controlled by define('OFFLINE_STORAGE_ENABLED', true/false) in config.php,
  // exposed to JS via GM_CONFIG.offlineStorageEnabled in index.php.
  // When false: all public API methods are no-ops — IDB is never touched,
  // no snapshot is saved, no queue is maintained, no banner is shown.
  // The service worker still caches static files (that's the SW's own concern);
  // this flag only controls the data-layer (IDB snapshot + sync queue).
  if (
    typeof GM_CONFIG !== 'undefined' &&
    GM_CONFIG.offlineStorageEnabled === false
  ) {
    var _noop = function() { return Promise.resolve(null); };
    window.gmOffline = {
      isOffline:              function() { return false; },
      saveSnapshot:           _noop,
      loadSnapshot:           _noop,
      getDataVersion:         _noop,
      updateSnapshotVersion:  _noop,
      queuePendingAdd:        _noop,
      hasPendingQueue:        function() { return Promise.resolve(false); },
      getPendingQueue:        function() { return Promise.resolve([]); },
      getPendingCount:        function() { return Promise.resolve(0); },
      clearQueue:             _noop,
      syncPendingQueue:       _noop,
      verifyCacheHealth:      function() {},
      notifyOfflineReady:     function() {},
      showBanner:             function() {},
      hideBanner:             function() {},
      notifyUpdateAvailable:  function() {},
      probeConnectivity:      function() { return Promise.resolve(true); },
      onSaveSuccess:          _noop,
    };
    console.info('[gmOffline] Offline storage disabled (OFFLINE_STORAGE_ENABLED=false)');
    return; // Exit IIFE — nothing else in this module runs
  }

  // ─── Constants ────────────────────────────────────────────────────────────

  const IDB_NAME    = 'gm_offline';
  const IDB_VERSION = 1;

  // Object stores
  const STORE_SNAPSHOT = 'gm_data_cache';   // last server snapshot per user
  const STORE_QUEUE    = 'gm_pending_queue'; // offline additions awaiting sync

  // How long to wait before probing the network again after going offline (ms)
  const PROBE_INTERVAL = 15000;

  // Jitter range on reconnect before flushing queue (ms) — prevents server spike
  const RECONNECT_JITTER_MIN = 1000;
  const RECONNECT_JITTER_MAX = 5000;

  // Maximum save retry attempts on 409 version conflict
  const MAX_CONFLICT_RETRIES = 3;

  // ─── State ────────────────────────────────────────────────────────────────

  let _db         = null;   // IDBDatabase instance
  let _dbReady    = false;
  let _dbPromise  = null;

  let _isOffline  = false;  // current offline state
  let _probeTimer = null;   // setInterval handle for connectivity probes
  let _syncInProgress = false;

  // ─── IDB Initialization ───────────────────────────────────────────────────

  function openDB() {
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn('[gmOffline] IndexedDB not available — offline mode disabled');
        resolve(null);
        return;
      }

      const req = indexedDB.open(IDB_NAME, IDB_VERSION);

      req.onupgradeneeded = function (e) {
        const db = e.target.result;

        // Snapshot store: one record per user_id
        if (!db.objectStoreNames.contains(STORE_SNAPSHOT)) {
          db.createObjectStore(STORE_SNAPSHOT, { keyPath: 'userId' });
        }

        // Pending queue: auto-increment key, indexed by userId
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          const qs = db.createObjectStore(STORE_QUEUE, {
            keyPath: 'id',
            autoIncrement: true,
          });
          qs.createIndex('by_user', 'userId', { unique: false });
        }
      };

      req.onsuccess = function (e) {
        _db      = e.target.result;
        _dbReady = true;
        resolve(_db);
      };

      req.onerror = function (e) {
        console.error('[gmOffline] IDB open failed:', e.target.error);
        resolve(null); // degrade gracefully, don't reject
      };
    });

    return _dbPromise;
  }

  function idbTx(store, mode) {
    if (!_db) return null;
    try {
      return _db.transaction([store], mode).objectStore(store);
    } catch (e) {
      console.error('[gmOffline] IDB transaction error:', e);
      return null;
    }
  }

  function idbPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  // ─── Snapshot (mirror of last server load) ────────────────────────────────

  /**
   * Save the full server response payload to IDB for a user.
   * Called every time a successful load response is received.
   */
  async function saveSnapshot(userId, responseData) {
    await openDB();
    const store = idbTx(STORE_SNAPSHOT, 'readwrite');
    if (!store) return;

    const record = {
      userId:      String(userId),
      data:        responseData,
      savedAt:     Date.now(),
      dataVersion: responseData.data_version || responseData.dataVersion || null,
    };

    try {
      await idbPromise(store.put(record));
    } catch (e) {
      console.error('[gmOffline] Failed to save snapshot:', e);
    }
  }

  /**
   * Load the last cached snapshot for a user.
   * Returns the data object (same shape as api.php load response data),
   * or null if nothing is cached.
   */
  async function loadSnapshot(userId) {
    await openDB();
    const store = idbTx(STORE_SNAPSHOT, 'readonly');
    if (!store) return null;

    try {
      const record = await idbPromise(store.get(String(userId)));
      return record ? record.data : null;
    } catch (e) {
      console.error('[gmOffline] Failed to load snapshot:', e);
      return null;
    }
  }

  /**
   * Get the stored data_version token from the last snapshot.
   */
  async function getDataVersion(userId) {
    await openDB();
    const store = idbTx(STORE_SNAPSHOT, 'readonly');
    if (!store) return null;

    try {
      const record = await idbPromise(store.get(String(userId)));
      return record ? record.dataVersion : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Update only the data_version in the stored snapshot (after a save).
   */
  async function updateSnapshotVersion(userId, newVersion) {
    await openDB();
    const store = idbTx(STORE_SNAPSHOT, 'readwrite');
    if (!store) return;

    try {
      const record = await idbPromise(
        _db.transaction([STORE_SNAPSHOT], 'readonly')
           .objectStore(STORE_SNAPSHOT)
           .get(String(userId))
      );
      if (record) {
        record.dataVersion = newVersion;
        if (record.data) record.data.data_version = newVersion;
        const wx = idbTx(STORE_SNAPSHOT, 'readwrite');
        if (wx) await idbPromise(wx.put(record));
      }
    } catch (e) {
      console.error('[gmOffline] Failed to update snapshot version:', e);
    }
  }

  // ─── Pending Queue (offline additions awaiting sync) ─────────────────────

  /**
   * Queue one or more new records added while offline.
   *
   * @param {string} userId
   * @param {string} type  — 'vehicles' | 'entries' | 'reminders' | 'entryTemplates'
   * @param {Array}  items — array of new objects to add
   */
  async function queuePendingAdd(userId, type, items) {
    await openDB();
    const store = idbTx(STORE_QUEUE, 'readwrite');
    if (!store) return;

    const record = {
      userId:    String(userId),
      type:      type,
      items:     items,
      queuedAt:  Date.now(),
      synced:    false,
    };

    try {
      await idbPromise(store.add(record));
      updateQueueBadge(userId);
    } catch (e) {
      console.error('[gmOffline] Failed to queue pending add:', e);
    }
  }

  /**
   * Get all pending queue records for a user.
   */
  async function getPendingQueue(userId) {
    await openDB();
    if (!_db) return [];

    try {
      const tx    = _db.transaction([STORE_QUEUE], 'readonly');
      const store = tx.objectStore(STORE_QUEUE);
      const index = store.index('by_user');
      const records = await idbPromise(index.getAll(String(userId)));
      return records || [];
    } catch (e) {
      console.error('[gmOffline] Failed to get pending queue:', e);
      return [];
    }
  }

  /**
   * Clear all pending queue records for a user (after successful sync).
   */
  async function clearQueue(userId) {
    await openDB();
    if (!_db) return;

    try {
      const tx    = _db.transaction([STORE_QUEUE], 'readwrite');
      const store = tx.objectStore(STORE_QUEUE);
      const index = store.index('by_user');
      const keys  = await idbPromise(index.getAllKeys(String(userId)));

      await Promise.all(
        keys.map(key => idbPromise(store.delete(key)))
      );

      updateQueueBadge(userId);
    } catch (e) {
      console.error('[gmOffline] Failed to clear queue:', e);
    }
  }

  async function hasPendingQueue(userId) {
    const q = await getPendingQueue(userId);
    return q.length > 0;
  }

  async function getPendingCount(userId) {
    const q = await getPendingQueue(userId);
    return q.reduce((sum, r) => sum + (r.items ? r.items.length : 0), 0);
  }

  // ─── Online / Offline Detection ───────────────────────────────────────────

  /**
   * Check actual connectivity by probing the backend.
   * navigator.onLine alone is unreliable (returns true even with no server access).
   */
  async function probeConnectivity() {
    try {
      const resp = await fetch(
        (window.BACKEND_URL || 'api.php') + '?action=ping&ts=' + Date.now(),
        { method: 'GET', cache: 'no-store', credentials: 'same-origin' }
      );
      // A 401 (auth required) still means the server is reachable
      return resp.status < 500;
    } catch (e) {
      return false;
    }
  }

  function isOffline() {
    return _isOffline;
  }

  function handleGoOffline() {
    if (_isOffline) return;
    _isOffline = true;
    console.log('[gmOffline] Gone offline');
    showBanner('offline', 'You\'re offline — viewing last synced data. New entries will sync when you reconnect.');

    // Start probing for reconnection
    if (!_probeTimer) {
      _probeTimer = setInterval(async () => {
        const online = await probeConnectivity();
        if (online) handleGoOnline();
      }, PROBE_INTERVAL);
    }

    // Disable edit/delete controls
    setOfflineUIState(true);
  }

  function handleGoOnline() {
    if (!_isOffline) return;
    _isOffline = false;
    console.log('[gmOffline] Back online');

    if (_probeTimer) {
      clearInterval(_probeTimer);
      _probeTimer = null;
    }

    setOfflineUIState(false);

    // Jitter before syncing to prevent server spike when many users reconnect
    const jitter = Math.random() * (RECONNECT_JITTER_MAX - RECONNECT_JITTER_MIN) + RECONNECT_JITTER_MIN;
    showBanner('syncing', 'Back online — syncing your changes\u2026');

    setTimeout(() => syncPendingQueue(), jitter);
  }

  function initConnectivityListeners() {
    window.addEventListener('online',  () => {
      // browser online event fires, but probe first to confirm
      probeConnectivity().then(ok => { if (ok) handleGoOnline(); });
    });

    window.addEventListener('offline', () => handleGoOffline());

    // Initial state check on load
    if (!navigator.onLine) {
      handleGoOffline();
    } else {
      // Probe on startup to catch captive portals / firewalls
      probeConnectivity().then(ok => {
        if (!ok) handleGoOffline();
      });
    }
  }

  // ─── Reconnect Sync ───────────────────────────────────────────────────────

  /**
   * On reconnect: fetch fresh server data, merge queued offline additions,
   * save back to server, then reload the UI.
   *
   * The merge strategy for offline additions:
   *   1. Fetch latest data from server (with current data_version).
   *   2. For each queued item type, append items whose IDs don't already
   *      exist on the server (guards against duplicate submissions).
   *   3. Save the merged payload with the server's current data_version.
   *   4. On success: clear queue, update snapshot, reload UI.
   *   5. On 409 conflict: retry up to MAX_CONFLICT_RETRIES times.
   */
  async function syncPendingQueue() {
    if (_syncInProgress) return;

    const userId = _getCurrentUserId();
    if (!userId) {
      hideBanner();
      return;
    }

    const queue = await getPendingQueue(userId);
    if (queue.length === 0) {
      // No pending changes — just reload fresh data from server
      showBanner('syncing', 'Refreshing data from server\u2026');
      await _reloadFromServer();
      hideBanner();
      return;
    }

    _syncInProgress = true;
    showBanner('syncing', `Syncing ${queue.length} pending change(s)\u2026`);

    try {
      await _mergeAndSync(userId, queue, 0);
    } catch (e) {
      console.error('[gmOffline] Sync failed:', e);
      showBanner('error', 'Sync failed — will retry automatically. Your data is safe.');
    } finally {
      _syncInProgress = false;
    }
  }

  async function _mergeAndSync(userId, queue, retryCount) {
    if (retryCount >= MAX_CONFLICT_RETRIES) {
      showBanner('error', 'Could not sync — please refresh the page manually.');
      return;
    }

    // Step 1: Fetch fresh server data
    let freshData;
    try {
      const resp = await fetch(
        (window.BACKEND_URL || 'api.php') + '?action=load&ts=' + Date.now(),
        { method: 'GET', cache: 'no-store', credentials: 'same-origin' }
      );

      // Session expired while offline — queue is safe in IDB, redirect to login
      if (resp.status === 401) {
        let loginUrl = null;
        try {
          const errJson = await resp.json();
          loginUrl = errJson.login_url || null;
        } catch(e) {}

        showBanner('error',
          'Your session expired while offline. ' +
          '<a href="' + (loginUrl || (window.gmAuthUrls && window.gmAuthUrls.login_url) || '/gm/') + '" ' +
          'style="color:inherit;text-decoration:underline">Sign in again</a> ' +
          'to sync your ' + (await getPendingCount(userId)) + ' pending change(s). Your data is safe.'
        );
        _syncInProgress = false;
        return;
      }

      const json = await resp.json();

      // Other auth/server errors
      if (json && json.error === 'authentication_required') {
        const loginUrl2 = json.login_url || (window.gmAuthUrls && window.gmAuthUrls.login_url) || '/gm/';
        showBanner('error',
          'Please <a href="' + loginUrl2 + '" style="color:inherit;text-decoration:underline">sign in</a> ' +
          'to sync your pending changes. Your data is safe.'
        );
        _syncInProgress = false;
        return;
      }

      if (!json.success || !json.data) throw new Error('Load failed');
      freshData = json.data;
    } catch (e) {
      showBanner('error', 'Could not reach server \u2014 will retry when connected.');
      _isOffline = true;
      setOfflineUIState(true);
      return;
    }

    // Step 2: Merge queued additions into fresh data
    const merged = Object.assign({}, freshData);

    for (const queueRecord of queue) {
      const type  = queueRecord.type;
      const items = queueRecord.items || [];

      if (!Array.isArray(merged[type])) merged[type] = [];

      const existingIds = new Set(merged[type].map(r => r.id || r.vehicleId));

      for (const item of items) {
        const itemId = item.id || item.vehicleId;
        if (!existingIds.has(itemId)) {
          merged[type].push(item);
          existingIds.add(itemId);
        }
        // If ID already exists on server, skip silently (already synced somehow)
      }
    }

    // Step 3: Save merged data with server's current data_version
    let saveResp;
    try {
      const payload = {
        data: Object.assign({}, merged, {
          data_version: freshData.data_version,
        }),
      };

      const resp = await fetch(
        (window.BACKEND_URL || 'api.php') + '?action=save',
        {
          method:      'POST',
          credentials: 'same-origin',
          headers:     { 'Content-Type': 'application/json' },
          body:        JSON.stringify(payload),
        }
      );

      saveResp = await resp.json();

      // Session expired between load and save steps
      if (resp.status === 401) {
        const loginUrl = saveResp.login_url || (window.gmAuthUrls && window.gmAuthUrls.login_url) || '/gm/';
        showBanner('error',
          'Session expired. <a href="' + loginUrl + '" style="color:inherit;text-decoration:underline">Sign in</a> ' +
          'to complete the sync. Your pending changes are safe.'
        );
        _syncInProgress = false;
        return;
      }

      if (resp.status === 409) {
        // Version conflict — another device saved between our load and save
        // Retry: re-fetch and re-merge
        console.warn('[gmOffline] Version conflict on sync, retrying (' + (retryCount + 1) + ')');
        await _mergeAndSync(userId, queue, retryCount + 1);
        return;
      }

      if (!saveResp.success) {
        throw new Error(saveResp.message || 'Save failed');
      }
    } catch (e) {
      throw e;
    }

    // Step 4: Success — clear queue, update snapshot, reload UI
    await clearQueue(userId);

    // Update snapshot with merged data + new version
    const updatedData = Object.assign({}, merged, {
      data_version: saveResp.data_version,
    });
    await saveSnapshot(userId, updatedData);

    const count = queue.reduce((s, r) => s + (r.items ? r.items.length : 0), 0);
    showBanner('success', `Sync complete — ${count} change(s) saved.`);

    // Reload the app UI with fresh data
    setTimeout(() => {
      hideBanner();
      _reloadFromServer();
    }, 2500);
  }

  async function _reloadFromServer() {
    // Trigger a full data reload through the existing loadData() function
    if (typeof loadData === 'function' && typeof renderAll === 'function') {
      loadData();
      renderAll();
    } else if (typeof loadData === 'function') {
      loadData();
    }
  }

  // ─── UI State ─────────────────────────────────────────────────────────────

  /**
   * Lock/unlock edit and delete controls when offline.
   * Adds 'gm-offline-locked' class to buttons that shouldn't work offline.
   */
  function setOfflineUIState(offline) {
    const lockTargets = document.querySelectorAll(
      '.edit-vehicle-btn, .delete-vehicle-btn, ' +
      '.edit-entry-btn, .delete-entry-btn, ' +
      '.edit-reminder-btn, .delete-reminder-btn, ' +
      '.edit-template-btn, .delete-template-btn, ' +
      '.save-settings-btn, [data-offline-lock]'
    );

    lockTargets.forEach(el => {
      if (offline) {
        el.classList.add('gm-offline-locked');
        if (!el.dataset.originalTitle) {
          el.dataset.originalTitle = el.title || '';
        }
        el.title = 'Not available offline';
      } else {
        el.classList.remove('gm-offline-locked');
        if (el.dataset.originalTitle !== undefined) {
          el.title = el.dataset.originalTitle;
          delete el.dataset.originalTitle;
        }
      }
    });

    // Also update Add buttons to show offline-aware state
    const addBtns = document.querySelectorAll('[data-offline-allow]');
    addBtns.forEach(el => {
      el.classList.toggle('gm-offline-mode', offline);
    });
  }

  // ─── Banner UI ────────────────────────────────────────────────────────────

  /**
   * Show the offline/sync status banner.
   * type: 'offline' | 'syncing' | 'success' | 'error' | 'update'
   */
  function showBanner(type, message) {
    let banner = document.getElementById('gm-offline-banner');

    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'gm-offline-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      document.body.appendChild(banner);
    }

    // Remove all type classes
    banner.className = 'gm-offline-banner gm-offline-banner--' + type;

    const icons = {
      offline: '&#9888;',  // ⚠
      syncing: '<span class="gm-offline-spinner"></span>',
      success: '&#10003;', // ✓
      error:   '&#10005;', // ✕
      update:  '&#8593;',  // ↑
    };

    const icon = icons[type] || '';

    if (type === 'update') {
      banner.innerHTML =
        `<span class="gm-offline-icon">${icon}</span>` +
        `<span class="gm-offline-msg">${message}</span>` +
        `<button class="gm-offline-action" id="gm-update-btn">Refresh now</button>` +
        `<button class="gm-offline-dismiss" id="gm-banner-dismiss" aria-label="Dismiss">\u00D7</button>`;

      const updateBtn = document.getElementById('gm-update-btn');
      if (updateBtn) {
        updateBtn.addEventListener('click', () => window.location.reload());
      }

      const dismissBtn = document.getElementById('gm-banner-dismiss');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', hideBanner);
      }
    } else {
      banner.innerHTML =
        `<span class="gm-offline-icon">${icon}</span>` +
        `<span class="gm-offline-msg">${message}</span>`;
    }

    banner.classList.add('gm-offline-banner--visible');
  }

  function hideBanner() {
    const banner = document.getElementById('gm-offline-banner');
    if (banner) {
      banner.classList.remove('gm-offline-banner--visible');
    }
  }

  /**
   * Update the pending queue badge count in the banner (if visible).
   */
  async function updateQueueBadge(userId) {
    const count = await getPendingCount(userId);
    const badge = document.getElementById('gm-queue-badge');
    if (badge) {
      badge.textContent  = count > 0 ? `${count} pending` : '';
      badge.style.display = count > 0 ? 'inline' : 'none';
    }

    // If offline and we have pending items, update the banner message
    if (_isOffline && count > 0) {
      showBanner('offline',
        `You're offline — ${count} change(s) will sync when you reconnect.`
      );
    }
  }

  // ─── Update Available Notification ────────────────────────────────────────

  /**
   * Called by the service worker when a new version has been installed.
   * Shows the "Update available" banner.
   */
  function notifyUpdateAvailable() {
    showBanner('update', 'A new version of the app is available.');
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function _getCurrentUserId() {
    // Try in order: GM_USER (injected by index.php), gmUser (set by gm.api.js)
    if (window.GM_USER && window.GM_USER.id) return String(window.GM_USER.id);
    if (window.gmUser  && window.gmUser.id)  return String(window.gmUser.id);
    return 'default';
  }

  // ─── Cache health check ────────────────────────────────────────────────────

  /**
   * Ask the service worker to verify all CORE assets are cached and re-fetch
   * any that are missing. Called by gm.api.js after every successful online load.
   * Silent on success; logs warnings on partial failure.
   * No-op if SW is not available.
   */
  function verifyCacheHealth() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;

    const channel = new MessageChannel();
    channel.port1.onmessage = function (e) {
      const { type, healed, missing, version } = e.data || {};
      if (type === 'CACHE_HEALTHY') {
        console.log('[gmOffline] Cache healthy v' + version);
      } else if (type === 'CACHE_HEALED') {
        console.log('[gmOffline] Cache self-healed ' + (healed || []).length + ' asset(s)');
        notifyOfflineReady(true); // re-notify since cache was repaired
      } else if (type === 'CACHE_INCOMPLETE') {
        console.warn('[gmOffline] Cache incomplete — ' + (missing || []).length + ' asset(s) still missing:', missing);
        showBanner('error',
          'Some offline files couldn\u2019t be cached. Stay online to retry, or reload the page.');
      }
    };

    navigator.serviceWorker.controller.postMessage(
      { type: 'VERIFY_CACHE' },
      [channel.port2]
    );
  }

  /**
   * Show a one-time "ready for offline use" confirmation after the IDB snapshot
   * is saved for the first time in this browser session.
   * Subsequent online loads in the same session are silent.
   * @param {boolean} [force] - Show even if already shown this session
   */
  var _offlineReadyShown = false;
  function notifyOfflineReady(force) {
    if (_offlineReadyShown && !force) return;
    _offlineReadyShown = true;
    // Use a subtle toast rather than the banner — it's good news, not an error
    if (typeof showToast === 'function') {
      showToast('\u2713 Ready for offline use', 2500);
    }
  }

  // ─── Handle INSTALL_INCOMPLETE from SW ─────────────────────────────────────
  // Shown when SW install failed to cache one or more core assets.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (!e.data) return;
      if (e.data.type === 'INSTALL_INCOMPLETE') {
        console.warn('[gmOffline] SW install incomplete, missing:', e.data.missing);
        showBanner('error',
          'Offline setup incomplete \u2014 some files couldn\u2019t be cached. ' +
          'Stay connected and reload to finish setup.');
      }
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  window.gmOffline = {
    isOffline,
    saveSnapshot,
    loadSnapshot,
    getDataVersion,
    updateSnapshotVersion,
    queuePendingAdd,
    hasPendingQueue,
    getPendingQueue,
    getPendingCount,
    clearQueue,
    syncPendingQueue,
    verifyCacheHealth,
    notifyOfflineReady,
    showBanner,
    hideBanner,
    notifyUpdateAvailable,
    probeConnectivity,

    // Called by gm.api.js after a successful online save to keep token in sync
    onSaveSuccess: async function (userId, newVersion) {
      await updateSnapshotVersion(userId, newVersion);
    },
  };

  // ─── Init ─────────────────────────────────────────────────────────────────

  // Open IDB eagerly so it's ready before the first load/save
  openDB().then(() => {
    console.log('[gmOffline] IDB ready, state:', _dbReady ? 'ok' : 'unavailable');
  });

  // Start connectivity monitoring after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConnectivityListeners);
  } else {
    initConnectivityListeners();
  }

})();