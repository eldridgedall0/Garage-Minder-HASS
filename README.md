# GarageMinder for Home Assistant

[![Validate](https://github.com/eldridgedall0/garageminder-hass/actions/workflows/validate.yml/badge.svg)](https://github.com/eldridgedall0/garageminder-hass/actions/workflows/validate.yml)
[![hacs](https://img.shields.io/badge/HACS-custom-41BDF5.svg)](https://hacs.xyz)
[![licence](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

The GarageMinder web app, running as a native Home Assistant integration —
same screens, same CSS, same features — plus the things a website could
never do: entities, automations, notifications, and odometers that fill
themselves in.

> **Status: verified, not yet battle-tested.** The integration sets up
> inside a real Home Assistant (12 passing tests against HA core), and the
> panel boots, renders and saves in a headless browser. It has not yet run
> on a production instance for any length of time. Take a backup first.
>
> VIN decoding and recall checks are stubbed with a clear "not in this
> build" response. There is no importer yet — see *Getting your data in*.

---

## How the UI stays identical

The app is ~18,000 lines of classic scripts that talk to `document`
directly — `document.getElementById`, global functions, jQuery bound to the
page. Home Assistant renders panels **inside shadow DOM**, where none of
those lookups resolve. Mounting the app in a shadow root would mean
rewriting every one of them.

So the panel hosts the app in a **same-origin iframe**:

| | |
|---|---|
| Its own `document` | every `getElementById` works untouched |
| Its own CSS scope | HA's theme cannot shift the design by a pixel |
| `window.parent` reachable | the bridge holding the authenticated `hass` object |

`gm-panel.js` publishes `window.__gmBridge` (callWS, callService, signPath,
access token, user, theme). Everything inside the iframe goes through it.

### The three shims

| File | Replaces | Why |
|---|---|---|
| `gm.api.ha.js` | `assets/js/gm.api.js` | `loadData()` / `saveData()` over the HA websocket instead of `api.php`. Same function names, same promises, same 409-conflict retry — so none of the other 29 scripts change. |
| `gm-boot.js` | the inline PHP config block | Resolves config + dataset **before** injecting any app script, so the app's synchronous `loadData()` still returns data instantly and boots in its original order. Holds jQuery's ready queue to preserve that order. |
| `gm-compat.js` | `upload.php`, `delete-attachment.php`, `vehicle-photo.php`, `api.php?action=clearUserData` | Wraps `fetch` inside the iframe and reroutes those paths to HA's authenticated views. The app source is never edited, so `git pull` on garageminder keeps working. |

Only two call sites can't be intercepted — `download.php` used directly in
an `href` and an `img src`. `tools/build_frontend.py` rewrites those two,
and **fails the build** if the patterns ever stop matching, so a change in
the web app surfaces at build time rather than as a silently broken
download.

---

## Install

### Via HACS (recommended)

[![Open your Home Assistant instance and open this repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=eldridgedall0&repository=garageminder-hass&category=integration)

Or by hand: **HACS → ⋮ → Custom repositories →** add
`https://github.com/eldridgedall0/garageminder-hass` with category
**Integration**, then install it.

Restart Home Assistant, then **Settings → Devices & Services → Add
Integration → GarageMinder**. A *GarageMinder* item appears in the sidebar.

Updates arrive in HACS like any other integration.

### Manually

Download `garageminder.zip` from the
[latest release](https://github.com/eldridgedall0/garageminder-hass/releases/latest)
and unpack it into your config directory:

```bash
cd /config
unzip -q garageminder.zip -d custom_components/garageminder
```

Restart, then add the integration as above. To upgrade, replace the folder
with a newer release and restart.

Requires Home Assistant **2024.11** or newer.

To rebuild the bundle after pulling changes into the web app:

```bash
git clone https://github.com/eldridgedall0/garageminder.git
python tools/build_frontend.py --source ./garageminder
```

It vendors jQuery, jQuery UI, jsPDF, jsPDF-AutoTable, SheetJS and Bootstrap
Icons locally — a Home Assistant box may have no internet, and a CDN icon
font would otherwise turn every icon into a blank box.

## Getting your data in

There is no importer yet. Until there is, either add vehicles by hand, or
paste your existing dataset in directly — `api.php?action=load` on the
hosted app returns the whole thing in exactly the shape this store expects:

```bash
# from a browser logged into the web app, save the response of:
#   https://<your-app>/api.php?action=load
# then, with GarageMinder installed and running, in Developer Tools →
# Template is not enough; use the websocket via the panel's console:
#   await window.__gmBridge.callWS({type: "garageminder/save",
#                                   data: <the "data" object>,
#                                   data_version: null})
```

## Tests

```bash
pip install -r requirements-test.txt
pytest -q
```

They run the integration inside a real Home Assistant: setup, entity
creation, the ported reminder maths, the websocket load/save round trip,
optimistic-locking conflicts, and the to-do → service-entry path.

---

## What you get that the web app cannot do

**One device per vehicle**, with:

- `sensor` — odometer, next service, next service due, distance to next
  service, overdue count, upcoming count, last service, spend this year
- `binary_sensor` — maintenance overdue, service due soon, registration
  due, insurance due, inspection due (all `device_class: problem`)
- `calendar` — every reminder as an event
- `todo` — due items, and **ticking one logs a real service entry** and
  re-bases the reminder

**Actions**: `garageminder.log_service`, `.set_odometer`, `.add_vehicle`,
`.snooze_reminder`.

**Events**: `garageminder_service_overdue`, `garageminder_service_logged`.

### Odometer source entities

In the integration's options, point any vehicle at an entity that reports
mileage — a connected car, an OBD-II dongle, a template sensor fed by an
arrival automation, or a plain `input_number`. Mileage stops being
something you type in, and every reminder downstream recomputes itself.

```yaml
automation:
  - alias: Tell me when the truck is due
    triggers:
      - trigger: state
        entity_id: binary_sensor.f150_maintenance_overdue
        to: "on"
    actions:
      - action: notify.mobile_app
        data:
          message: >
            {{ state_attr('binary_sensor.f150_maintenance_overdue','services')
               | join(', ') }} overdue on the F-150.
```

---

## Data

Everything lives in one versioned JSON document at
`.storage/garageminder`, keeping the web app's exact shape and its
optimistic-locking token — which is why the port is small: `api.php` only
ever had four actions. Attachments are files under
`<config>/garageminder/attachments/`, served by an auth-required view.

Both are included in every Home Assistant backup. There is no MySQL, no
`schema.sql`, and no backup scripts.

**One instance is one shared garage.** Home Assistant integrations don't
partition data per user, so every `user_id` from the web app evaporates.
Anyone who can log into your Home Assistant sees the whole garage.

---

## What was deliberately dropped

WordPress and the entire `tmw-wp` repo · all six `api_*` tables · both
Google OAuth tables and the Drive flow · MySQL/PDO/`schema.sql` · the three
backup scripts · `service-worker.js` and `manifest.php` (Home Assistant's
own app is the shell now) · tier limits and `subscription.php` — a local
Python tier check is trivially bypassed, so it would be theatre.

If the subscription revenue matters, the honest plan is to run both: the
hosted app for paying customers, this as the free local option. That is
more work, not less — but it doesn't end the business to get the
integration.

## Two things found in the web app while porting

1. **`assets/js/gm.fixes.js` has a syntax error** and has therefore never
   executed in production. Its mojibake-repair map contains `''': "'"` —
   the curly-quote keys were themselves mangled into bare apostrophes.
   `tools/build_frontend.py` patches it for this bundle; the upstream fix
   is to change those two lines to `'‘'` and `'’'`.
2. Miles vs kilometres: HA converts any `DISTANCE` sensor to the unit
   system of the instance. The odometer entity pins itself to the app's own
   unit so the two always agree. If you switch mi↔km in the app later, the
   HA entity keeps its original display unit until you change it in the
   entity's settings.

## Not yet ported

VIN decoding and recall checks (`vin-decode.php`, `check-recalls.php`) —
both are NHTSA vPIC calls and are straightforward Python, but they aren't
in this build. The shim answers them with a clear message instead of
leaving the button spinning.

## Releases

Tag and push, and CI builds the installable zip and attaches it to a GitHub
release. The tag must match `version` in `manifest.json` or the job fails on
purpose:

```bash
# bump manifest.json first
git tag -a v0.2.0 -m "v0.2.0"
git push origin main --tags
```

HACS reads the newest **published release** as the available version — a
bare tag is not enough, so let the workflow finish and check the release
appears. Without a release, HACS falls back to the last commit hash, and
"update available" stops meaning anything useful.

## Contributing

Issues and pull requests are welcome. Run the tests before opening a PR;
CI runs hassfest, HACS validation and pytest on every push.

## Licence

MIT.
