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
        return jsonResponse({ success: true, files: uploaded, attachments: uploaded });
      },
    },

    // ---- delete-attachment.php --------------------------------------
    {
      match: (url) => url.pathname.endsWith("/delete-attachment.php"),
      handle: async function (url, init) {
        const fields = await readBody(init);
        const entryId = fields.entry_id || fields.entryId || "unfiled";
        const attachmentId = fields.id || fields.attachment_id;
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
        return jsonResponse({ success: true, url: record.url, photo: record });
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

  function currentPhoto(vehicleId) {
    const bucket =
      window.data &&
      window.data.attachments &&
      window.data.attachments[VEHICLE_PHOTO_KEY + vehicleId];
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
  window.gmResolveDownload = function gmResolveDownload(params) {
    const entryKey =
      params.type === "vehicle"
        ? VEHICLE_PHOTO_KEY + params.id
        : params.entryId || "unfiled";
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
