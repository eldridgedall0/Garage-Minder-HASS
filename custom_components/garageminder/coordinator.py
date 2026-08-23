"""Coordinator: owns the dataset and everything derived from it."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator
from homeassistant.util import dt as dt_util

from .compute import (
    ReminderStatus,
    Thresholds,
    compute_reminder,
    entry_total_cost,
    parse_date,
    spend_this_year,
    vehicle_current_odo,
    vehicle_entries,
)
from .const import (
    CONF_ODOMETER_SOURCES,
    DOMAIN,
    EVENT_SERVICE_LOGGED,
    EVENT_SERVICE_OVERDUE,
    LEVEL_OVERDUE,
    LEVEL_UPCOMING,
)
from .store import GarageMinderStore, VersionConflict

_LOGGER = logging.getLogger(__name__)

# Time-based statuses drift as the day passes, so recompute periodically even
# when nothing was written. Cheap: it's pure maths over an in-memory dict.
RECOMPUTE_INTERVAL = timedelta(minutes=30)


@dataclass(slots=True)
class VehicleView:
    """Everything the entity layer needs about one vehicle."""

    id: str
    raw: dict[str, Any]
    name: str
    current_odo: int | None
    entries: list[dict[str, Any]] = field(default_factory=list)
    reminders: list[ReminderStatus] = field(default_factory=list)
    odometer_source: str | None = None

    @property
    def overdue(self) -> list[ReminderStatus]:
        """Reminders past their grace period."""
        return [r for r in self.reminders if r.level == LEVEL_OVERDUE]

    @property
    def upcoming(self) -> list[ReminderStatus]:
        """Reminders inside the upcoming window."""
        return [r for r in self.reminders if r.level == LEVEL_UPCOMING]

    @property
    def next_due(self) -> ReminderStatus | None:
        """The soonest reminder, overdue first, then by days/miles remaining."""
        ranked = [r for r in self.reminders if r.days_remaining is not None or r.miles_remaining is not None]
        if not ranked:
            return None
        return min(ranked, key=_due_sort_key)

    @property
    def last_service_date(self) -> date | None:
        """Date of the most recent entry."""
        for entry in self.entries:
            parsed = parse_date(entry.get("date"))
            if parsed:
                return parsed
        return None

    @property
    def spend_ytd(self) -> float:
        """Total spend so far this calendar year."""
        return spend_this_year(self.entries, dt_util.now().date())


def _due_sort_key(status: ReminderStatus) -> tuple[int, float]:
    overdue_first = 0 if status.level == LEVEL_OVERDUE else 1
    if status.days_remaining is not None:
        return (overdue_first, float(status.days_remaining))
    # No date target: approximate days from miles at an assumed 40 mi/day so
    # mileage-only and date-based reminders can be ranked against each other.
    if status.miles_remaining is not None:
        return (overdue_first, status.miles_remaining / 40.0)
    return (overdue_first, float("inf"))


@dataclass(slots=True)
class GarageData:
    """Snapshot handed to every entity on each coordinator update."""

    raw: dict[str, Any]
    version: str
    vehicles: dict[str, VehicleView]
    settings: dict[str, Any]

    @property
    def unit(self) -> str:
        """Distance unit label, 'mi' or 'km'."""
        return str(self.settings.get("unit") or "mi")


class GarageMinderCoordinator(DataUpdateCoordinator[GarageData]):
    """Owns the store, recomputes derived state, and fires events."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        store: GarageMinderStore,
    ) -> None:
        """Initialise the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=RECOMPUTE_INTERVAL,
        )
        self.entry = entry
        self.store = store
        self._odo_unsub = None
        self._known_overdue: set[str] = set()
        # Suppress the overdue event on the very first build, or every HA
        # restart would re-fire an event for everything already overdue and
        # re-send every notification the user has already seen.
        self._primed = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def async_setup(self) -> None:
        """Load the dataset and start watching any odometer source entities."""
        await self.store.async_load()
        await self.async_refresh()
        self._resubscribe_odometer_sources()

    @callback
    def async_shutdown_sources(self) -> None:
        """Drop odometer source subscriptions."""
        if self._odo_unsub:
            self._odo_unsub()
            self._odo_unsub = None

    async def _async_update_data(self) -> GarageData:
        """Recompute the derived view from whatever is in the store."""
        return self._build()

    # ------------------------------------------------------------------
    # Derived view
    # ------------------------------------------------------------------

    def _build(self) -> GarageData:
        data = self.store.data
        settings = data.get("settings") or {}
        thresholds = Thresholds.from_settings(settings)
        today = dt_util.now().date()
        sources: dict[str, str] = self.entry.options.get(CONF_ODOMETER_SOURCES, {})

        vehicles: dict[str, VehicleView] = {}
        for vehicle in data.get("vehicles", []):
            vehicle_id = str(vehicle.get("id"))
            entries = vehicle_entries(data, vehicle_id)
            odo = vehicle_current_odo(vehicle, entries)

            # An odometer source entity always wins over the stored value --
            # this is the thing a web app cannot do.
            source_entity = sources.get(vehicle_id)
            if source_entity:
                sourced = self._read_source_odometer(source_entity)
                if sourced is not None:
                    odo = sourced

            reminders = [
                compute_reminder(rem, odo, thresholds, today)
                for rem in data.get("reminders", [])
                if str(rem.get("vehicleId")) == vehicle_id
            ]

            vehicles[vehicle_id] = VehicleView(
                id=vehicle_id,
                raw=vehicle,
                name=_vehicle_name(vehicle),
                current_odo=odo,
                entries=entries,
                reminders=reminders,
                odometer_source=source_entity,
            )

        built = GarageData(
            raw=data,
            version=self.store.version,
            vehicles=vehicles,
            settings=settings,
        )
        self._fire_transitions(built)
        return built

    def _read_source_odometer(self, entity_id: str) -> int | None:
        state = self.hass.states.get(entity_id)
        if state is None or state.state in ("unknown", "unavailable", ""):
            return None
        try:
            return int(float(state.state))
        except (TypeError, ValueError):
            return None

    @callback
    def _fire_transitions(self, built: GarageData) -> None:
        """Fire an event the first time each reminder goes overdue."""
        now_overdue: set[str] = set()
        for vehicle in built.vehicles.values():
            for status in vehicle.overdue:
                key = f"{vehicle.id}:{status.name}"
                now_overdue.add(key)
                if self._primed and key not in self._known_overdue:
                    self.hass.bus.async_fire(
                        EVENT_SERVICE_OVERDUE,
                        {
                            "vehicle_id": vehicle.id,
                            "vehicle_name": vehicle.name,
                            "service": status.name,
                            "miles_remaining": status.miles_remaining,
                            "days_remaining": status.days_remaining,
                        },
                    )
        self._known_overdue = now_overdue
        self._primed = True

    # ------------------------------------------------------------------
    # Mutations
    # ------------------------------------------------------------------

    async def async_save_dataset(
        self, data: dict[str, Any], expected_version: str | None
    ) -> str:
        """Replace the whole dataset (the panel's save path)."""
        version = await self.store.async_save(data, expected_version)
        self._resubscribe_odometer_sources()
        await self.async_refresh()
        return version

    async def async_mutate(self, mutator) -> None:
        """Apply an in-place change to the dataset and persist it.

        Service calls and entity writes go through here so they never trip
        the optimistic-locking check against themselves.
        """
        data = self.store.data
        mutator(data)
        await self.store.async_save(data, expected_version=None)
        await self.async_refresh()

    async def async_log_service(
        self,
        vehicle_id: str,
        services: list[str],
        *,
        odometer: int | None = None,
        cost: float | None = None,
        notes: str = "",
        service_date: str | None = None,
    ) -> dict[str, Any]:
        """Add a service entry, exactly as the SPA's entry form would."""
        entry = {
            "id": uuid.uuid4().hex,
            "vehicleId": str(vehicle_id),
            "date": service_date or dt_util.now().date().isoformat(),
            "odo": odometer,
            "services": [{"name": s, "cost": None, "note": ""} for s in services],
            "cost": cost,
            "notes": notes,
        }

        def _mutate(data: dict[str, Any]) -> None:
            data.setdefault("entries", []).append(entry)
            if odometer is not None:
                for vehicle in data.get("vehicles", []):
                    if str(vehicle.get("id")) == str(vehicle_id):
                        current = vehicle.get("currentOdo")
                        if current is None or odometer > current:
                            vehicle["currentOdo"] = odometer
            # Re-base any reminder this entry satisfies, so "next due" moves.
            for reminder in data.get("reminders", []):
                if str(reminder.get("vehicleId")) != str(vehicle_id):
                    continue
                if (reminder.get("service") or reminder.get("name")) in services:
                    reminder["baseDate"] = entry["date"]
                    if odometer is not None:
                        reminder["baseOdo"] = odometer
                    reminder["nextDate"] = None
                    reminder["nextOdo"] = None

        await self.async_mutate(_mutate)

        self.hass.bus.async_fire(
            EVENT_SERVICE_LOGGED,
            {
                "vehicle_id": str(vehicle_id),
                "entry_id": entry["id"],
                "services": services,
                "odometer": odometer,
                "cost": entry_total_cost(entry),
                "date": entry["date"],
            },
        )
        return entry

    async def async_set_odometer(self, vehicle_id: str, odometer: int) -> None:
        """Write a new current mileage for one vehicle."""

        def _mutate(data: dict[str, Any]) -> None:
            for vehicle in data.get("vehicles", []):
                if str(vehicle.get("id")) == str(vehicle_id):
                    vehicle["currentOdo"] = odometer

        await self.async_mutate(_mutate)

    async def async_add_vehicle(
        self, name: str, *, vin: str | None = None, plate: str | None = None
    ) -> str:
        """Create a vehicle and return its id."""
        vehicle_id = uuid.uuid4().hex

        def _mutate(data: dict[str, Any]) -> None:
            data.setdefault("vehicles", []).append(
                {
                    "id": vehicle_id,
                    "name": name,
                    "vin": vin,
                    "plate": plate,
                    "currentOdo": None,
                }
            )

        await self.async_mutate(_mutate)
        return vehicle_id

    async def async_snooze_reminder(
        self, vehicle_id: str, service: str, days: int
    ) -> None:
        """Push a reminder's next due date out by N days."""
        target = dt_util.now().date() + timedelta(days=days)

        def _mutate(data: dict[str, Any]) -> None:
            for reminder in data.get("reminders", []):
                if str(reminder.get("vehicleId")) != str(vehicle_id):
                    continue
                if (reminder.get("service") or reminder.get("name")) == service:
                    reminder["nextDate"] = target.isoformat()

        await self.async_mutate(_mutate)

    # ------------------------------------------------------------------
    # Odometer source entities
    # ------------------------------------------------------------------

    @callback
    def _resubscribe_odometer_sources(self) -> None:
        """(Re)subscribe to whichever entities feed vehicle mileage."""
        self.async_shutdown_sources()
        sources: dict[str, str] = self.entry.options.get(CONF_ODOMETER_SOURCES, {})
        entity_ids = [e for e in sources.values() if e]
        if not entity_ids:
            return

        @callback
        def _changed(event: Event) -> None:
            self.hass.async_create_task(self.async_refresh())

        self._odo_unsub = async_track_state_change_event(
            self.hass, entity_ids, _changed
        )


def _vehicle_name(vehicle: dict[str, Any]) -> str:
    """Build a display name from whatever fields the vehicle has."""
    if vehicle.get("name"):
        return str(vehicle["name"])
    parts = [
        str(vehicle.get(key))
        for key in ("year", "make", "model")
        if vehicle.get(key)
    ]
    return " ".join(parts) if parts else "Vehicle"


__all__ = [
    "GarageData",
    "GarageMinderCoordinator",
    "VehicleView",
    "VersionConflict",
]
