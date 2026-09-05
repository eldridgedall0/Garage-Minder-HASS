#!/usr/bin/env python3
"""Turn the GarageMinder web app into the bundle the HA panel serves.

Usage:
    python tools/build_frontend.py --source /path/to/garageminder [--offline]

What it does:

* renders ``index.php`` into a static ``index.html`` (the PHP in that file is
  only echoing config values, all of which now come from the websocket),
* copies ``assets/`` verbatim -- the CSS is untouched, which is what keeps
  the design identical,
* vendors jQuery, jQuery UI, jsPDF, SheetJS and Bootstrap Icons locally,
  because a Home Assistant box may have no internet and a CDN font would
  otherwise silently swap every icon for a blank box,
* swaps ``gm.api.js`` for ``gm.api.ha.js`` and turns the script tags into a
  ``GM_SCRIPTS`` list that ``gm-boot.js`` injects in order,
* drops the PWA bits (service worker, manifest) -- Home Assistant's own app
  is the shell now.

Re-run it whenever you pull changes into the garageminder repo. Nothing in
this script edits the source repo.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parent / "custom_components" / "garageminder" / "frontend"
APP_DIR = FRONTEND / "app"

# Third-party files the app loaded from a CDN, vendored so the panel works on
# an offline Home Assistant box.
VENDOR: dict[str, str] = {
    "jquery.min.js": "https://code.jquery.com/jquery-3.7.1.min.js",
    "jquery-ui.min.js": "https://code.jquery.com/ui/1.13.3/jquery-ui.min.js",
    "jquery-ui.css": "https://code.jquery.com/ui/1.13.3/themes/base/jquery-ui.css",
    "jspdf.umd.min.js": "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    "jspdf.plugin.autotable.min.js": "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js",
    "xlsx.full.min.js": "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    "bootstrap-icons.min.css": "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css",
    "fonts/bootstrap-icons.woff2": "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2",
    "fonts/bootstrap-icons.woff": "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff",
}

VENDOR_SCRIPT_ORDER = [
    "vendor/jquery.min.js",
    "vendor/jquery-ui.min.js",
    "vendor/jspdf.umd.min.js",
    "vendor/jspdf.plugin.autotable.min.js",
    "vendor/xlsx.full.min.js",
]

# Scripts that only made sense on the hosted PWA.
#   gm.pwa.js            - install prompt / service worker lifecycle
#   gm.features.offline.js - IndexedDB mirror + a queue that polls api.php;
#                            pointless here, and its ping would 404 and raise
#                            a false "you're offline" banner. Every caller
#                            guards with `typeof gmOffline !== 'undefined'`,
#                            so dropping it is safe.
#
# gm.features.gdrive.js used to be dropped here too (a Google OAuth flow with
# no server to complete it), but Google Drive support was removed from
# garageminder itself -- the file, its button, and every call site are gone
# upstream, so there's nothing left to drop.
DROP_SCRIPTS = {
    "gm.pwa.js",
    "gm.features.offline.js",
}

# download.php was used directly in href/src attributes, which the fetch shim
# in gm-compat.js cannot intercept. These are the only two places that happens
# in a loaded script, and each is rewritten to use gmResolveDownload().
#
# Each patch MUST match, or the build fails loudly -- that way, if a future
# pull of the web app moves this code, you find out at build time instead of
# discovering broken downloads in the panel.
PATCHES: list[tuple[str, str, str]] = [
    (
        "assets/js/gm.handlers.js",
        r'const downloadUrl = "download\.php\?id=" \+ encodeURIComponent\(attId\);\s*'
        r"const link = document\.createElement\('a'\);\s*"
        r"link\.href = downloadUrl;\s*"
        r"link\.download = '';\s*"
        r"document\.body\.appendChild\(link\);\s*"
        r"link\.click\(\);\s*"
        r"document\.body\.removeChild\(link\);",
        """gmResolveDownload({ id: attId }).then(function (downloadUrl) {
      if (!downloadUrl) { showToast("Attachment not found"); return; }
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = '';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });""",
    ),
    (
        # PRE-EXISTING BUG IN THE WEB APP, not something this port introduced.
        # gm.fixes.js has a mojibake-repair map whose curly-quote keys were
        # themselves mangled into bare apostrophes, producing `''': "'"` --
        # a syntax error, so the entire file has silently failed to parse in
        # production. Fixed here with escaped code points; fix it upstream too.
        "assets/js/gm.fixes.js",
        r"'''\s*:\s*\"'\",\s*\n\s*'''\s*:\s*\"'\",",
        "'\\\\u2018': \"'\",\n    '\\\\u2019': \"'\",",
    ),
    (
        # The full-backup download was an <a href> to backup-create.php, which
        # the fetch shim cannot intercept. gmDownloadBackup() assembles the
        # same JSON in the browser and hands over a Blob instead.
        "assets/js/gm.handlers.js",
        r"const downloadUrl = 'backup-create\.php\?download=1&t=' \+ Date\.now\(\);\s*"
        r"const link = document\.createElement\('a'\);\s*"
        r"link\.href = downloadUrl;\s*"
        r"link\.download = 'garage_maintenance_backup_' \+ new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\] \+ '\.json';\s*"
        r"document\.body\.appendChild\(link\);\s*"
        r"link\.click\(\);\s*"
        r"document\.body\.removeChild\(link\);",
        "await gmDownloadBackup();",
    ),
    (
        "assets/js/gm.render.settings.js",
        r'const photoUrl = "download\.php\?type=vehicle&id=" \+ encodeURIComponent\(vehicle\.id\);\s*'
        r"\$container\.append\(\s*"
        r'\$\("<img>"\)\s*'
        r'\.attr\("src", photoUrl\)',
        """const $photo = $("<img>");
    gmResolveDownload({ type: "vehicle", id: vehicle.id }).then(function (url) {
      if (url) $photo.attr("src", url);
    });
    $container.append(
      $photo""",
    ),
]

PHP_BLOCK = re.compile(r"<\?php.*?\?>", re.DOTALL)
PHP_ECHO = re.compile(r"<\?=.*?\?>", re.DOTALL)
SCRIPT_TAG = re.compile(r'<script\s+src="(assets/js/[^"]+)"\s*></script>\s*', re.I)
INLINE_CONFIG = re.compile(
    r"<script>\s*\n\s*const GM_CONFIG.*?</script>", re.DOTALL
)
MANIFEST_LINK = re.compile(r'<link rel="manifest"[^>]*>\s*', re.I)
# The inline block that talks to the service worker; there is no SW here.
SW_INLINE = re.compile(
    r"<script>(?:(?!</script>).)*serviceWorker(?:(?!</script>).)*</script>\s*",
    re.DOTALL | re.I,
)


def main() -> int:
    """Build the bundle."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        required=True,
        type=Path,
        help="Path to a checkout of eldridgedall0/garageminder",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Skip downloading vendor files (reuse whatever is already there)",
    )
    args = parser.parse_args()

    source: Path = args.source.expanduser().resolve()
    index_php = source / "index.php"
    if not index_php.is_file():
        print(f"error: {index_php} not found", file=sys.stderr)
        return 1

    if APP_DIR.exists():
        shutil.rmtree(APP_DIR)
    APP_DIR.mkdir(parents=True)

    # 1. assets/ verbatim -- this is why the design survives intact.
    shutil.copytree(source / "assets", APP_DIR / "assets")

    # 2. the two call sites the fetch shim cannot reach
    apply_patches(APP_DIR)

    # 3. vendored third-party files
    fetch_vendor(APP_DIR / "vendor", offline=args.offline)

    # 4. index.php -> index.html
    html, app_scripts = transform_index(index_php.read_text(encoding="utf-8", errors="replace"))
    (APP_DIR / "index.html").write_text(
        html.replace("__GM_SCRIPTS__", scripts_literal(app_scripts)),
        encoding="utf-8",
    )

    print(f"built {APP_DIR}")
    print(f"  {len(app_scripts)} app scripts, {len(VENDOR_SCRIPT_ORDER)} vendor scripts")
    return 0


def transform_index(raw: str) -> tuple[str, list[str]]:
    """Rewrite index.php's markup into a static, HA-ready page."""
    # The PHP-injected config block is replaced by gm-boot.js's websocket call.
    html = INLINE_CONFIG.sub("", raw)
    html = MANIFEST_LINK.sub("", html)
    html = SW_INLINE.sub("", html)

    # Favicons: the panel is an iframe, so nothing shows them, and two of the
    # sizes index.php asks for don't exist in the repo -- they were only ever
    # 404s in the console.
    html = re.sub(
        r'<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]*>\s*', "", html, flags=re.I
    )
    html = re.sub(
        r'<link[^>]+rel="apple-touch-icon"[^>]*>\s*', "", html, flags=re.I
    )

    # Collect the app scripts in order, then strip the tags: gm-boot.js
    # injects them itself once the dataset has been preloaded.
    # The fetch shim must be in place before any app script can call fetch().
    app_scripts: list[str] = ["../gm-compat.js"]
    for match in SCRIPT_TAG.finditer(html):
        name = Path(match.group(1)).name
        if name in DROP_SCRIPTS:
            continue
        if name == "gm.api.js":
            app_scripts.append("../gm.api.ha.js")
            continue
        app_scripts.append(match.group(1))
    html = SCRIPT_TAG.sub("", html)

    # Remove the CDN tags we vendored, plus any remaining PHP.
    html = re.sub(r'<script\s+src="https?://[^"]+"\s*></script>\s*', "", html, flags=re.I)
    html = re.sub(
        r'<link[^>]+href="https?://cdn\.jsdelivr\.net[^"]+"[^>]*>\s*',
        '<link rel="stylesheet" href="vendor/bootstrap-icons.min.css" />\n',
        html,
        flags=re.I,
    )
    html = re.sub(
        r'<link[^>]+href="https?://code\.jquery\.com[^"]+"[^>]*>\s*',
        '<link rel="stylesheet" href="vendor/jquery-ui.css" />\n',
        html,
        flags=re.I,
    )

    # Anything still in PHP was a config echo; the bridge supplies it now.
    html = PHP_BLOCK.sub("", html)
    html = PHP_ECHO.sub("", html)
    html = re.sub(r"<\?php.*", "", html, flags=re.DOTALL)

    # `<body class="gm-theme-<?= $themeMode ?>">` is left holding a dangling
    # class once the echo is gone; gm-boot.js adds the real one.
    html = html.replace('<body class="gm-theme-">', "<body>")

    # The footer was `&copy; <?= year ?> <?= appName ?>` and `Version <?= v ?>`;
    # with the echoes gone it reads "©  . All rights reserved." / "Version ".
    html = re.sub(
        r"<footer>.*?</footer>",
        '<footer>\n      <span id="gm-footer-copyright"></span>\n'
        '      <span id="gm-footer-version"></span>\n    </footer>',
        html,
        flags=re.DOTALL,
    )

    boot = (
        "\n<script>\n"
        "  window.GM_VENDOR_SCRIPTS = "
        + scripts_literal(VENDOR_SCRIPT_ORDER)
        + ";\n"
        "  window.GM_SCRIPTS = __GM_SCRIPTS__;\n"
        "</script>\n"
        '<script src="../gm-boot.js"></script>\n'
    )
    html = html.replace("</body>", boot + "</body>")
    return html, app_scripts


def scripts_literal(paths: list[str]) -> str:
    """Render a JS array literal, one entry per line."""
    body = ",\n    ".join(f'"{p}"' for p in paths)
    return "[\n    " + body + "\n  ]"


def apply_patches(app_dir: Path) -> None:
    """Rewrite the few call sites gm-compat.js's fetch shim cannot cover."""
    for relative, pattern, replacement in PATCHES:
        path = app_dir / relative
        original = path.read_text(encoding="utf-8")
        patched, count = re.subn(pattern, replacement, original)
        if count == 0:
            raise SystemExit(
                f"patch failed: {relative}\n"
                f"  pattern no longer matches -- the web app changed here.\n"
                f"  Update PATCHES in {Path(__file__).name} before shipping, or "
                f"downloads will silently break in the panel."
            )
        path.write_text(patched, encoding="utf-8")
        print(f"  patched {relative} ({count})")


def fetch_vendor(target: Path, *, offline: bool) -> None:
    """Download the third-party files the app used to pull from CDNs."""
    target.mkdir(parents=True, exist_ok=True)
    for name, url in VENDOR.items():
        path = target / name
        if path.is_file():
            continue
        if offline:
            print(f"  skipped {name} (offline)")
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"  fetching {name}")
        with urllib.request.urlopen(url, timeout=30) as response:
            path.write_bytes(response.read())

    # Bootstrap Icons' CSS points at ./fonts/ relative to itself, which is
    # exactly where we put them, so no rewriting is needed.


if __name__ == "__main__":
    raise SystemExit(main())
