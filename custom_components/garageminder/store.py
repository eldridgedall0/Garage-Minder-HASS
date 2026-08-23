"""Persistent storage for GarageMinder.

The web app moved its whole dataset as a single JSON blob with an
optimistic-locking token (``api.php?action=load`` / ``?action=save``).
We keep exactly that contract, so the bundled SPA needs no rework beyond
swapping its transport -- only now the blob lives in HA's ``.storage``
directory and is therefore included in every Home Assistant backup.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import SAVE_DELAY, STORAGE_KEY, STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)


class VersionConflict(Exception):
    """Raised when a save is attempted against a stale data_version token."""


# Ported verbatim from DEFAULT_DATA in assets/js/gm.core.js so a fresh
# install looks identical to a fresh install of the web app.
DEFAULT_SERVICE_TYPES: list[dict[str, Any]] = [
    {"name": "Oil change", "intervalMiles": 5000, "intervalMonths": 6},
    {"name": "Oil filter change", "intervalMiles": 5000, "intervalMonths": 6},
    {"name": "Engine air filter replacement", "intervalMiles": None, "intervalMonths": 24},
    {"name": "Cabin air filter replacement", "intervalMiles": None, "intervalMonths": 12},
    {"name": "Spark plug replacement", "intervalMiles": 60000, "intervalMonths": None},
    {"name": "Serpentine / drive belt replacement", "intervalMiles": 60000, "intervalMonths": None},
    {"name": "Transmission fluid change", "intervalMiles": 60000, "intervalMonths": 60},
    {"name": "Differential fluid change", "intervalMiles": 60000, "intervalMonths": None},
    {"name": "Transfer case fluid change", "intervalMiles": 60000, "intervalMonths": None},
    {"name": "Power steering fluid change", "intervalMiles": 60000, "intervalMonths": None},
    {"name": "Brake fluid change", "intervalMiles": None, "intervalMonths": 24},
    {"name": "Brake pad replacement", "intervalMiles": 40000, "intervalMonths": None},
    {"name": "Brake rotor replacement", "intervalMiles": 80000, "intervalMonths": None},
    {"name": "Coolant change", "intervalMiles": 60000, "intervalMonths": 60},
    {"name": "Radiator / cooling system service", "intervalMiles": None, "intervalMonths": None},
    {"name": "Tire rotation", "intervalMiles": 5000, "intervalMonths": 6},
    {"name": "Wheel alignment", "intervalMiles": None, "intervalMonths": 12},
    {"name": "Wheel balance", "intervalMiles": None, "intervalMonths": None},
    {"name": "12V battery replacement", "intervalMiles": None, "intervalMonths": 48},
    {"name": "Charging system service", "intervalMiles": None, "intervalMonths": None},
    {"name": "Suspension inspection", "intervalMiles": None, "intervalMonths": 12},
    {"name": "Steering inspection", "intervalMiles": None, "intervalMonths": 12},
    {"name": "Vehicle inspection (state / safety)", "intervalMiles": None, "intervalMonths": 12},
    {"name": "Emissions test", "intervalMiles": None, "intervalMonths": 24},
    {"name": "Registration renewal", "intervalMiles": None, "intervalMonths": 12},
    {"name": "Insurance renewal", "intervalMiles": None, "intervalMonths": 12},
    {"name": "Recall service completed", "intervalMiles": None, "intervalMonths": None},
]

DEFAULT_SETTINGS: dict[str, Any] = {
    "siteTitle": "GarageMinder",
    "unit": "mi",
    "timezone": None,
    "keepFormOpen": False,
    "upcomingThresholdDays": 14,
    "upcomingThresholdMiles": 500,
    "overdueThresholdDays": 0,
    "overdueThresholdMiles": 0,
    "avgDailyMiles": 40,
}


def default_data() -> dict[str, Any]:
    """Return a fresh dataset shaped exactly like the web app's DEFAULT_DATA."""
    return {
        "vehicles": [],
        "serviceTypes": [dict(st) for st in DEFAULT_SERVICE_TYPES],
        "entries": [],
        "reminders": [],
        "vehicleIntervals": {},
        "entryTemplates": [],
        "attachments": {},  # entry_id -> [{id, name, size, mime, stored}]
        "settings": dict(DEFAULT_SETTINGS),
        "activeVehicleId": "all",
    }


class GarageMinderStore:
    """Thin wrapper around HA's Store with the app's version token semantics."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialise the store."""
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, STORAGE_KEY, private=True
        )
        self._data: dict[str, Any] = default_data()
        self._version: str = secrets.token_hex(8)

    @property
    def data(self) -> dict[str, Any]:
        """Return the current dataset."""
        return self._data

    @property
    def version(self) -> str:
        """Return the current optimistic-locking token."""
        return self._version

    async def async_load(self) -> dict[str, Any]:
        """Load from disk, filling in anything a newer version added."""
        stored = await self._store.async_load()
        if stored:
            self._data = _normalize(stored.get("data") or {})
            self._version = stored.get("data_version") or secrets.token_hex(8)
        else:
            self._data = default_data()
            self._version = secrets.token_hex(8)
            await self.async_save(self._data, expected_version=None)
        return self._data

    async def async_save(
        self, data: dict[str, Any], expected_version: str | None
    ) -> str:
        """Persist a new dataset, returning the new version token.

        ``expected_version`` mirrors the web app's ``data_version`` check:
        pass the token you loaded with, or ``None`` to force the write.
        """
        if expected_version is not None and expected_version != self._version:
            raise VersionConflict(
                f"stale data_version {expected_version!r}, current is {self._version!r}"
            )

        self._data = _normalize(data)
        self._version = secrets.token_hex(8)
        self._store.async_delay_save(self._snapshot, SAVE_DELAY)
        return self._version

    async def async_save_now(self) -> None:
        """Flush any debounced write immediately."""
        await self._store.async_save(self._snapshot())

    def _snapshot(self) -> dict[str, Any]:
        return {"data": self._data, "data_version": self._version}


def _normalize(data: dict[str, Any]) -> dict[str, Any]:
    """Mirror _normalizeLoadedData() from assets/js/gm.api.js."""
    base = default_data()
    out = {**base, **(data or {})}

    settings = {**DEFAULT_SETTINGS, **(out.get("settings") or {})}
    if not isinstance(settings.get("siteTitle"), str) or not settings["siteTitle"]:
        settings["siteTitle"] = DEFAULT_SETTINGS["siteTitle"]
    if not settings.get("unit"):
        settings["unit"] = DEFAULT_SETTINGS["unit"]
    out["settings"] = settings

    for key in ("vehicles", "entries", "reminders", "entryTemplates"):
        if not isinstance(out.get(key), list):
            out[key] = []
    if not isinstance(out.get("vehicleIntervals"), dict):
        out["vehicleIntervals"] = {}
    if not isinstance(out.get("attachments"), dict):
        out["attachments"] = {}

    for vehicle in out["vehicles"]:
        vehicle.setdefault("currentOdo", None)
        vehicle.setdefault("vin", None)
        vehicle.setdefault("plate", None)

    # serviceTypes may still be a plain list of names in very old exports.
    service_types = out.get("serviceTypes") or []
    normalized: list[dict[str, Any]] = []
    for item in service_types:
        if isinstance(item, str):
            normalized.append(
                {"name": item, "intervalMiles": None, "intervalMonths": None}
            )
        elif isinstance(item, dict):
            normalized.append(
                {
                    "name": item.get("name") or "",
                    "intervalMiles": item.get("intervalMiles"),
                    "intervalMonths": item.get("intervalMonths"),
                }
            )
    out["serviceTypes"] = normalized or [dict(st) for st in DEFAULT_SERVICE_TYPES]

    return out
