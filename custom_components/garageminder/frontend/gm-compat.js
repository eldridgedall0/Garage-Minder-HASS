/**
 * Legacy endpoint shim.
 *
 * Besides api.php, the SPA calls a handful of small PHP endpoints directly:
 * upload.php, delete-attachment.php, download.php, vehicle-photo.php,
 * vin-decode.php. Rather than edit those ~13 call sites across five files --
 * which would mean re-doing the edits every time you pull the web app -- this
 * shim wraps window.fetch inside the panel iframe and reroutes those paths to
 * Home Assistant's authenticated views.
 *
 * The app source stays untouched, so `git pull` on garageminder keeps working
 * and the bundle rebuild stays a one-command job.
 *
 * Loaded before every app script (see gm-boot.js).
 */

(function () {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const ATTACH_BASE = "/api/garageminder/attachment/";
  const VEHICLE_PHOTO_KEY = "vehicle-photo:";

  function bridge() {
    return window.parent && window.parent.__gmBridge;
  }

  /**
   * The app's live dataset, if it exists yet.
   *
   * The app declares its dataset with `let data = null;` at the top level of
   * gm.core.js -- a *classic* <script>, not a module. A top-level `let` (or
   * `const`/`class`) creates a binding in the page's shared global lexical
   * environment, not a property of `window`; that part is exactly like
   * `var`-declared globals for every OTHER classic script that runs after it,
   * but it means `window.data` is simply never set -- there is no such
   * property, ever, regardless of what the app does. Every place below that
   * used to read/write `window.data` was silently working with an object the
   * app itself never sees or updates, so entryIdForAttachment() and
   * currentPhoto() always fell through to their last-resort guess and
   * misidentified which entry (or vehicle) owned an attachment.
   *
   * `data` (the bare identifier, no `window.` prefix) resolves through that
   * same shared global scope, so it *does* reach the app's real dataset --
   * as long as this only runs after gm.core.js has declared it, which is
   * always true here: every caller of appData() runs from inside a fetch
   * route handler, i.e. in response to something the user did after the app
   * finished booting, never at this file's own top-level (this file loads
   * before gm.core.js, so referencing `data` at parse time would throw).
   */
  function appData() {
    return typeof data !== "undefined" ? data : null;
  }

  function authHeaders() {
    return { Authorization: "Bearer " + bridge().accessToken() };
  }

  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  async function readBody(init) {
    if (!init || !init.body) return {};
    if (init.body instanceof FormData) {
      const out = {};
      init.body.forEach(function (value, key) {
        out[key] = value;
      });
      return out;
    }
    if (typeof init.body === "string") {
      try {
        return JSON.parse(init.body);
      } catch (err) {
        return {};
      }
    }
    return {};
  }

  /** POST one file to the HA attachment view. */
  async function uploadTo(entryKey, file) {
    const form = new FormData();
    form.append("file", file, file.name);
    const response = await nativeFetch(
      ATTACH_BASE + encodeURIComponent(entryKey),
      { method: "POST", headers: authHeaders(), body: form }
    );
    if (!response.ok) throw new Error("Upload failed: " + response.status);
    return response.json();
  }

  const routes = [
    // ---- upload.php --------------------------------------------------
    {
      match: (url) => url.pathname.endsWith("/upload.php"),
      handle: async function (url, init) {
        const fields = await readBody(init);
        const entryId = fields.entry_id || fields.entryId || "unfiled";
        const files = [];
        if (init && init.body instanceof FormData) {
          init.body.forEach(function (value) {
            if (value instanceof File) files.push(value);
          });
        }
        if (!files.length) return jsonResponse({ success: false, error: "no_file" }, 400);

        const uploaded = [];
        for (const file of files) {
          uploaded.push(await uploadTo(entryId, file));
        }
        // uploadEntryFiles() in gm.features.attachments.js reads result.count
        // for its toast ("${result.count} file(s) uploaded successfully").
        // Without it the toast reads "undefined file(s) uploaded".
        return jsonResponse({
          success: true,
          count: uploaded.length,
          files: uploaded,
          attachments: uploaded,
        });
      },
    },

    // ---- delete-attachment.php --------------------------------------
    {
      match: (url) => url.pathname.endsWith("/delete-attachment.php"),
      handle: async function (url, init) {
        const fields = await readBody(init);
        const attachmentId = fields.id || fields.attachment_id;
        const entryId =
          fields.entry_id || fields.entryId || entryIdForAttachment(attachmentId);
        const response = await nativeFetch(
          ATTACH_BASE +
            encodeURIComponent(entryId) +
            "/" +
            encodeURIComponent(attachmentId),
          { method: "DELETE", headers: authHeaders() }
        );
        return jsonResponse({ success: response.ok });
      },
    },

    // ---- vehicle-photo.php ------------------------------------------
    // Stored as an attachment under a reserved key, so there is only one
    // storage path to back up and one view to secure.
    {
      match: (url) => url.pathname.endsWith("/vehicle-photo.php"),
      handle: async function (url, init) {
        const method = (init && init.method) || "GET";
        const fields = await readBody(init);
        const vehicleId =
          fields.vehicle_id || url.searchParams.get("vehicle_id") || "";
        const key = VEHICLE_PHOTO_KEY + vehicleId;

        if (method.toUpperCase() === "DELETE") {
          const existing = currentPhoto(vehicleId);
          if (existing) {
            await nativeFetch(
              ATTACH_BASE + encodeURIComponent(key) + "/" + existing.id,
              { method: "DELETE", headers: authHeaders() }
            );
            // Mirror the delete into the app's live dataset too -- see the
            // matching comment in the upload branch below for why:
            // removeVehiclePhoto() re-renders from its `data` immediately,
            // without reloading.
            const app = appData();
            if (app && app.attachments && app.attachments[key]) {
              app.attachments[key] = app.attachments[key].filter(
                (item) => item.id !== existing.id
              );
            }
          }
          return jsonResponse({ success: true });
        }

        let file = null;
        if (init && init.body instanceof FormData) {
          init.body.forEach(function (value) {
            if (value instanceof File) file = value;
          });
        }
        if (!file) return jsonResponse({ success: false, error: "no_file" }, 400);

        const record = await uploadTo(key, file);

        // uploadVehiclePhoto() in gm.render.settings.js re-renders immediately
        // from the in-memory `data` object -- it never calls loadData() -- so
        // without patching it here the new photo only appears after the next
        // full reload. It also reads result.photoPath, which this response
        // didn't use to carry.
        const app = appData();
        if (app) {
          const buckets = (app.attachments = app.attachments || {});
          (buckets[key] = buckets[key] || []).push(record);
        }

        return jsonResponse({
          success: true,
          url: record.url,
          photoPath: record.url,
          photo: record,
        });
      },
    },

    // ---- restore-full.php --------------------------------------------
    // The web app posted the backup to PHP, which unpacked it server-side.
    // Here the whole thing happens in the browser: parse the file, save the
    // dataset over the websocket, then replay the embedded attachments and
    // vehicle photos into Home Assistant's attachment store.
    {
      match: (url) => url.pathname.endsWith("/restore-full.php"),
      handle: async function (url, init) {
        let file = null;
        if (init && init.body instanceof FormData) {
          init.body.forEach(function (value) {
            if (value instanceof File) file = value;
          });
        }
        if (!file) {
          return jsonResponse(
            { success: false, message: "No backup file was selected." },
            400
          );
        }

        let payload;
        try {
          payload = JSON.parse(await file.text());
        } catch (err) {
          return jsonResponse(
            {
              success: false,
              message:
                "That file isn’t valid JSON — is it a GarageMinder backup?",
            },
            400
          );
        }

        // Backups wrap the dataset in {version, created_at, data: {...}};
        // a plain export is the dataset itself.
        const dataset = payload && payload.data ? payload.data : payload;
        if (!dataset || !Array.isArray(dataset.vehicles)) {
          return jsonResponse(
            {
              success: false,
              message:
                "That file doesn’t look like a GarageMinder backup — no vehicles in it.",
            },
            400
          );
        }

        // Save the dataset FIRST: each attachment upload mutates the stored
        // dataset, so doing it the other way round would discard them.
        await bridge().callWS({
          type: "garageminder/save",
          data: dataset,
          data_version: null,
        });

        const errors = [];
        let restored = 0;

        for (const item of payload.attachments_embedded || []) {
          try {
            await uploadEmbedded(item.entry_id, item.id, item.name, item.mime_type, item.data_base64);
            restored += 1;
          } catch (err) {
            errors.push(`${item.name}: ${err.message}`);
          }
        }

        for (const photo of payload.vehicle_photos_embedded || []) {
          try {
            const ext = (photo.mime_type || "image/jpeg").split("/")[1] || "jpg";
            await uploadEmbedded(
              VEHICLE_PHOTO_KEY + photo.vehicle_id,
              null,
              `photo.${ext}`,
              photo.mime_type,
              photo.data_base64
            );
            restored += 1;
          } catch (err) {
            errors.push(`vehicle photo: ${err.message}`);
          }
        }

        // Hand back the dataset as it now stands, which is what the app's
        // restore handler renders from.
        const fresh = await bridge().callWS({ type: "garageminder/load" });
        window._gmDataVersion = fresh.data_version;

        return jsonResponse({
          success: true,
          data: fresh.data,
          attachments_restored: restored,
          attachments_errors: errors,
        });
      },
    },

    // ---- backup-create.php -------------------------------------------
    {
      match: (url) => url.pathname.endsWith("/backup-create.php"),
      handle: async function () {
        // The download itself is an <a href>, which fetch cannot intercept;
        // tools/build_frontend.py rewrites that call site to use
        // gmDownloadBackup() instead. This only has to satisfy the
        // pre-flight check and the toast that follows it.
        const buckets = (appData() || {}).attachments || {};
        let count = 0;
        for (const key of Object.keys(buckets)) count += (buckets[key] || []).length;
        return jsonResponse({
          success: true,
          size_formatted: "full backup",
          attachment_count: count,
          warnings: [],
        });
      },
    },

    // ---- api.php?action=clearUserData -------------------------------
    {
      match: (url) =>
        url.pathname.endsWith("/api.php") &&
        url.searchParams.get("action") === "clearUserData",
      handle: async function () {
        await bridge().callWS({ type: "garageminder/clear" });
        return jsonResponse({ success: true });
      },
    },

    // ---- vin-decode.php / check-recalls.php -------------------------
    // Not ported yet. Answer clearly instead of leaving the button spinning.
    {
      match: (url) =>
        url.pathname.endsWith("/vin-decode.php") ||
        url.pathname.endsWith("/check-recalls.php"),
      handle: async function () {
        return jsonResponse(
          {
            success: false,
            error: "not_available",
            message:
              "VIN decoding and recall checks aren’t part of this build yet.",
          },
          501
        );
      },
    },
  ];

  /** base64 -> Blob -> the authenticated HA upload view. */
  async function uploadEmbedded(entryKey, id, name, mime, base64) {
    if (!base64) throw new Error("no file data in the backup");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], name, {
      type: mime || "application/octet-stream",
    });

    const form = new FormData();
    form.append("file", file, name);

    let target = ATTACH_BASE + encodeURIComponent(entryKey);
    if (id) target += "?id=" + encodeURIComponent(id);

    const response = await nativeFetch(target, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    if (!response.ok) {
      throw new Error(await response.text().catch(() => response.status));
    }
    return response.json();
  }

  /**
   * The app's download button only knows an attachment id, but Home
   * Assistant's view is addressed by entry as well. Entries carry their
   * attachments inline, so look the owner up there.
   */
  function entryIdForAttachment(attachmentId) {
    const app = appData();
    const entries = (app && app.entries) || [];
    for (const entry of entries) {
      for (const att of entry.attachments || []) {
        if (att.id === attachmentId) return entry.id;
      }
    }
    const buckets = (app && app.attachments) || {};
    for (const key of Object.keys(buckets)) {
      if ((buckets[key] || []).some((a) => a.id === attachmentId)) return key;
    }
    return "unfiled";
  }

  function currentPhoto(vehicleId) {
    const app = appData();
    const bucket = app && app.attachments && app.attachments[VEHICLE_PHOTO_KEY + vehicleId];
    return bucket && bucket.length ? bucket[bucket.length - 1] : null;
  }

  window.fetch = function (input, init) {
    let url;
    try {
      url = new URL(
        typeof input === "string" ? input : input.url,
        window.location.href
      );
    } catch (err) {
      return nativeFetch(input, init);
    }

    if (url.origin === window.location.origin) {
      for (const route of routes) {
        if (route.match(url)) {
          return route.handle(url, init).catch(function (err) {
            console.error("[GarageMinder] shim failed for " + url.pathname, err);
            return jsonResponse({ success: false, error: String(err) }, 500);
          });
        }
      }
    }
    return nativeFetch(input, init);
  };

  /**
   * download.php was also used directly in href/src attributes, which fetch
   * cannot intercept. gmResolveDownload() returns a signed HA URL instead;
   * tools/build_frontend.py rewrites those few call sites to use it.
   */
  /**
   * Full backup, built in the browser, in the same shape restore reads back.
   * The web app generated this server-side and served it as a download; here
   * the page assembles it and hands the viewer a Blob.
   */
  window.gmDownloadBackup = async function gmDownloadBackup() {
    const fresh = await bridge().callWS({ type: "garageminder/load" });
    const dataset = fresh.data;

    const attachments = [];
    const photos = [];
    const buckets = dataset.attachments || {};

    for (const key of Object.keys(buckets)) {
      for (const record of buckets[key] || []) {
        try {
          const signed = await bridge().signPath(
            ATTACH_BASE + encodeURIComponent(key) + "/" + encodeURIComponent(record.id)
          );
          const blob = await (await nativeFetch(signed)).blob();
          const base64 = await blobToBase64(blob);
          if (key.startsWith(VEHICLE_PHOTO_KEY)) {
            photos.push({
              vehicle_id: key.slice(VEHICLE_PHOTO_KEY.length),
              mime_type: record.mime,
              size: record.size,
              data_base64: base64,
            });
          } else {
            attachments.push({
              id: record.id,
              entry_id: key,
              name: record.name,
              mime_type: record.mime,
              size: record.size,
              data_base64: base64,
            });
          }
        } catch (err) {
          console.warn("[GarageMinder] skipped in backup:", record.name, err);
        }
      }
    }

    const backup = {
      version: "2.2",
      created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      created_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      source: "home-assistant",
      data: dataset,
      attachments_embedded: attachments,
      vehicle_photos_embedded: photos,
      attachment_count: attachments.length,
      vehicle_photo_count: photos.length,
      backup_type: "full_json",
    };

    const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download =
      "garage_maintenance_backup_" +
      new Date().toISOString().slice(0, 10) +
      ".json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  };

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  window.gmResolveDownload = function gmResolveDownload(params) {
    const entryKey =
      params.type === "vehicle"
        ? VEHICLE_PHOTO_KEY + params.id
        : params.entryId || entryIdForAttachment(params.id);
    const attachmentId =
      params.type === "vehicle"
        ? (currentPhoto(params.id) || {}).id
        : params.id;
    if (!attachmentId) return Promise.resolve(null);
    return bridge().signPath(
      ATTACH_BASE +
        encodeURIComponent(entryKey) +
        "/" +
        encodeURIComponent(attachmentId)
    );
  };
})();
