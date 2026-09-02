/**
 * GarageMinder sidebar panel.
 *
 * WHY AN IFRAME
 * -------------
 * The GarageMinder SPA is ~18k lines of classic (non-module) scripts that
 * talk to `document` directly: document.getElementById, document.querySelector,
 * global function names, jQuery bound to the page. Home Assistant renders
 * panels *inside shadow DOM*, where none of those document lookups resolve.
 * Mounting the app in a shadow root would mean rewriting every one of them.
 *
 * A same-origin iframe gives the app its own real `document`, its own CSS
 * scope (so HA's theme cannot leak in and change the design by a single
 * pixel), and its own script globals -- while `window.parent` still reaches
 * this element, which holds the authenticated `hass` object. That is the whole
 * trick: the design is preserved because the app keeps its own document, and
 * auth is free because the bridge lives in HA's window.
 */

class GarageMinderPanel extends HTMLElement {
  static get properties() {
    return { hass: {}, narrow: {}, route: {}, panel: {} };
  }

  constructor() {
    super();
    this._hass = null;
    this._iframe = null;
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    // Publish the bridge on the *top* window so the iframe can reach it as
    // window.parent.__gmBridge regardless of how deeply the panel is nested.
    window.__gmBridge = this._buildBridge();
    if (this._iframe && this._iframe.contentWindow) {
      this._iframe.contentWindow.__gmBridgeReady &&
        this._iframe.contentWindow.__gmBridgeReady(window.__gmBridge);
    }
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    if (this._iframe) return;

    const style = document.createElement("style");
    // height:100% here would resolve against a parent that does not set one,
    // collapsing the host to zero and rendering a blank panel with no error
    // anywhere. Custom panels own the whole view area (there is no HA toolbar
    // above them), so pin to the viewport and let the iframe fill the host.
    style.textContent = `
      :host {
        display: block;
        width: 100%;
        height: 100vh;
        height: 100dvh;
      }
      iframe {
        border: 0;
        width: 100%;
        height: 100%;
        display: block;
        background: var(--primary-background-color, #111);
      }
    `;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("title", "GarageMinder");
    // Same origin -- no sandbox attribute, or the bridge would be blocked.
    iframe.src = "/garageminder_static/app/index.html";
    iframe.allow = "clipboard-write";

    this.shadowRoot.append(style, iframe);
    this._iframe = iframe;

    this._releaseParentLayout();
  }

  disconnectedCallback() {
    delete window.__gmBridge;
    this._restoreParentLayout();
  }

  /**
   * Home Assistant's <ha-panel-custom> is `display: block` with no height of
   * its own, which clips the app. Removing that declaration fixes it — but
   * ha-panel-custom is compiled into the frontend package, so editing it
   * there is undone by the next HA update, and it is shared with every other
   * custom panel (HACS, Browser Mod, ...).
   *
   * So we neutralise it on OUR host only, at runtime, and put it back when
   * the panel is torn down. `revert` drops HA's declaration and falls back to
   * the browser default rather than inventing a value of our own.
   */
  _releaseParentLayout() {
    const parent = this.parentElement || this.getRootNode().host;
    if (!parent || parent.tagName !== "HA-PANEL-CUSTOM") return;

    this._parentDisplay = parent.style.display;
    parent.style.display = "revert";

    // Safety net: if the browser does not honour `revert` here, or the result
    // still leaves us with no usable height, fall back to taking the box out
    // of the layout entirely.
    requestAnimationFrame(() => {
      if (parent.getBoundingClientRect().height < 200) {
        parent.style.display = "contents";
      }
    });
  }

  _restoreParentLayout() {
    const parent = this.parentElement || this.getRootNode().host;
    if (!parent || parent.tagName !== "HA-PANEL-CUSTOM") return;
    parent.style.display = this._parentDisplay || "";
  }

  _buildBridge() {
    const hass = this._hass;
    return {
      /** Call a GarageMinder websocket command. */
      callWS: (message) => hass.connection.sendMessagePromise(message),

      /** Fire any HA service, so the app can drive automations directly. */
      callService: (domain, service, data) =>
        hass.callService(domain, service, data),

      /** Short-lived signed URL, for <img src> and download links. */
      signPath: async (path, expires = 300) => {
        const result = await hass.callWS({
          type: "auth/sign_path",
          path,
          expires,
        });
        return result.path;
      },

      /** Bearer token for fetch() calls the app makes itself (uploads). */
      accessToken: () => hass.auth.data.access_token,

      /** Who is looking at the page. */
      user: () => ({
        id: hass.user.id,
        name: hass.user.name,
        is_admin: hass.user.is_admin,
      }),

      /** HA's own theme mode, so the app can follow it if you want it to. */
      themeMode: () =>
        hass.themes && hass.themes.darkMode ? "dark" : "light",

      language: () => hass.language,
      currency: () => (hass.config && hass.config.currency) || "USD",
    };
  }
}

customElements.define("garageminder-panel", GarageMinderPanel);
