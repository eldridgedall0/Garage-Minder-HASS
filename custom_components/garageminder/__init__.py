"""The GarageMinder integration.

Registers a sidebar panel that serves the GarageMinder single-page app,
a websocket API that replaces ``api.php``, HTTP views for attachments,
and a set of entities per vehicle.
"""

from __future__ import annotations

import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from .const import (
    ATTACHMENT_DIR,
    DOMAIN,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    PLATFORMS,
    SERVICE_ADD_VEHICLE,
    SERVICE_LOG_SERVICE,
    SERVICE_SET_ODOMETER,
    SERVICE_SNOOZE_REMINDER,
    STATIC_URL,
)
from .coordinator import GarageMinderCoordinator
from .http import async_register_views
from .store import GarageMinderStore
from .websocket_api import async_register_websocket_api

_LOGGER = logging.getLogger(__name__)

LOG_SERVICE_SCHEMA = vol.Schema(
    {
        vol.Required("vehicle_id"): cv.string,
        vol.Required("services"): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional("odometer"): vol.Coerce(int),
        vol.Optional("cost"): vol.Coerce(float),
        vol.Optional("notes", default=""): cv.string,
        vol.Optional("date"): cv.string,
    }
)

SET_ODOMETER_SCHEMA = vol.Schema(
    {
        vol.Required("vehicle_id"): cv.string,
        vol.Required("odometer"): vol.Coerce(int),
    }
)

ADD_VEHICLE_SCHEMA = vol.Schema(
    {
        vol.Required("name"): cv.string,
        vol.Optional("vin"): cv.string,
        vol.Optional("plate"): cv.string,
    }
)

SNOOZE_SCHEMA = vol.Schema(
    {
        vol.Required("vehicle_id"): cv.string,
        vol.Required("service"): cv.string,
        vol.Optional("days", default=7): vol.Coerce(int),
    }
)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up GarageMinder from a config entry."""
    store = GarageMinderStore(hass)
    coordinator = GarageMinderCoordinator(hass, entry, store)
    await coordinator.async_setup()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    # Make sure the attachment directory exists before any upload lands.
    attachment_path = Path(hass.config.path(ATTACHMENT_DIR))
    await hass.async_add_executor_job(
        lambda: attachment_path.mkdir(parents=True, exist_ok=True)
    )

    await _async_register_frontend(hass)
    async_register_websocket_api(hass)
    async_register_views(hass)
    _async_register_services(hass, coordinator)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        coordinator: GarageMinderCoordinator = hass.data[DOMAIN].pop(entry.entry_id)
        coordinator.async_shutdown_sources()
        await coordinator.store.async_save_now()
        if not hass.data[DOMAIN]:
            frontend.async_remove_panel(hass, PANEL_URL_PATH)
            for service in (
                SERVICE_LOG_SERVICE,
                SERVICE_SET_ODOMETER,
                SERVICE_ADD_VEHICLE,
                SERVICE_SNOOZE_REMINDER,
            ):
                hass.services.async_remove(DOMAIN, service)
    return unloaded


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload when options change (odometer sources, thresholds, units)."""
    await hass.config_entries.async_reload(entry.entry_id)


async def _async_register_frontend(hass: HomeAssistant) -> None:
    """Serve the bundled SPA and register the sidebar panel.

    The panel is registered by the integration, so nobody has to hand-edit
    ``panel_custom:`` in configuration.yaml.
    """
    if PANEL_URL_PATH in hass.data.get("frontend_panels", {}):
        return

    root = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL, str(root), cache_headers=False)]
    )

    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=PANEL_URL_PATH,
        require_admin=False,
        config={
            "_panel_custom": {
                "name": "garageminder-panel",
                "module_url": f"{STATIC_URL}/gm-panel.js",
                "embed_iframe": False,
                "trust_external": False,
            }
        },
    )


def _async_register_services(
    hass: HomeAssistant, coordinator: GarageMinderCoordinator
) -> None:
    """Register the integration's actions."""
    if hass.services.has_service(DOMAIN, SERVICE_LOG_SERVICE):
        return

    async def _log_service(call: ServiceCall) -> None:
        await coordinator.async_log_service(
            call.data["vehicle_id"],
            call.data["services"],
            odometer=call.data.get("odometer"),
            cost=call.data.get("cost"),
            notes=call.data.get("notes", ""),
            service_date=call.data.get("date"),
        )

    async def _set_odometer(call: ServiceCall) -> None:
        await coordinator.async_set_odometer(
            call.data["vehicle_id"], call.data["odometer"]
        )

    async def _add_vehicle(call: ServiceCall) -> None:
        await coordinator.async_add_vehicle(
            call.data["name"],
            vin=call.data.get("vin"),
            plate=call.data.get("plate"),
        )

    async def _snooze(call: ServiceCall) -> None:
        await coordinator.async_snooze_reminder(
            call.data["vehicle_id"], call.data["service"], call.data.get("days", 7)
        )

    hass.services.async_register(
        DOMAIN, SERVICE_LOG_SERVICE, _log_service, schema=LOG_SERVICE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_ODOMETER, _set_odometer, schema=SET_ODOMETER_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_ADD_VEHICLE, _add_vehicle, schema=ADD_VEHICLE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SNOOZE_REMINDER, _snooze, schema=SNOOZE_SCHEMA
    )
