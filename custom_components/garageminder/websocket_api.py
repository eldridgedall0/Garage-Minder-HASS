"""Websocket API -- the replacement for ``api.php``.

The web app only ever had four actions (``load``, ``save``, ``user``,
``clearUserData``) because the whole dataset moves as one JSON blob with a
version token. That is why this port is small: two commands do the work of
the entire PHP backend.
"""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .coordinator import GarageMinderCoordinator
from .store import VersionConflict, default_data

_LOGGER = logging.getLogger(__name__)


@callback
def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register the websocket commands (idempotent)."""
    websocket_api.async_register_command(hass, ws_load)
    websocket_api.async_register_command(hass, ws_save)
    websocket_api.async_register_command(hass, ws_clear)
    websocket_api.async_register_command(hass, ws_config)


def _coordinator(hass: HomeAssistant) -> GarageMinderCoordinator | None:
    entries = hass.data.get(DOMAIN) or {}
    for coordinator in entries.values():
        return coordinator
    return None


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/load"})
@websocket_api.async_response
async def ws_load(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return the whole dataset plus its version token."""
    coordinator = _coordinator(hass)
    if coordinator is None:
        connection.send_error(msg["id"], "not_loaded", "GarageMinder is not set up")
        return

    connection.send_result(
        msg["id"],
        {
            "data": coordinator.store.data,
            "data_version": coordinator.store.version,
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save",
        vol.Required("data"): dict,
        vol.Optional("data_version"): vol.Any(str, None),
    }
)
@websocket_api.async_response
async def ws_save(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Persist the dataset, honouring the optimistic-locking token."""
    coordinator = _coordinator(hass)
    if coordinator is None:
        connection.send_error(msg["id"], "not_loaded", "GarageMinder is not set up")
        return

    payload = dict(msg["data"])
    # The SPA round-trips the token inside the payload; strip it before store.
    payload.pop("data_version", None)

    try:
        version = await coordinator.async_save_dataset(
            payload, msg.get("data_version")
        )
    except VersionConflict as err:
        # Mirrors api.php's HTTP 409. The SPA already knows how to re-fetch
        # and retry once when it sees this.
        connection.send_error(msg["id"], "version_conflict", str(err))
        return

    connection.send_result(msg["id"], {"data_version": version})


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/clear"})
@websocket_api.async_response
async def ws_clear(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Reset the dataset to defaults (``clearUserData`` in the web app)."""
    coordinator = _coordinator(hass)
    if coordinator is None:
        connection.send_error(msg["id"], "not_loaded", "GarageMinder is not set up")
        return

    version = await coordinator.async_save_dataset(default_data(), None)
    connection.send_result(msg["id"], {"data_version": version})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/config"})
@websocket_api.async_response
async def ws_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return what the SPA used to get injected from PHP in index.php."""
    coordinator = _coordinator(hass)
    user = connection.user
    settings = coordinator.store.data.get("settings", {}) if coordinator else {}

    connection.send_result(
        msg["id"],
        {
            "appName": settings.get("siteTitle") or "GarageMinder",
            "appShortName": "GarageMinder",
            "appTagline": "Vehicle maintenance, tracked.",
            "appDomain": "garageminder",
            "unit": settings.get("unit", "mi"),
            "maxAttachments": 10,
            "maxAttachmentSizeMB": 10,
            "user": {"id": user.id, "name": user.name, "is_admin": user.is_admin},
            "isHomeAssistant": True,
        },
    )
