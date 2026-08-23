"""A calendar per vehicle, exposing reminders as all-day events."""

from __future__ import annotations

from datetime import datetime, timedelta

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
try:  # HA 2024.12+
    from homeassistant.helpers.entity_platform import (
        AddConfigEntryEntitiesCallback as AddEntitiesCallback,
    )
except ImportError:  # pragma: no cover - older cores
    from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .coordinator import GarageMinderCoordinator
from .entity import GarageMinderVehicleEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up one calendar per vehicle."""
    coordinator: GarageMinderCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()

    @callback
    def _add_new_vehicles() -> None:
        if coordinator.data is None:
            return
        new = [vid for vid in coordinator.data.vehicles if vid not in known]
        if not new:
            return
        known.update(new)
        async_add_entities(
            GarageMinderCalendar(coordinator, vehicle_id) for vehicle_id in new
        )

    _add_new_vehicles()
    entry.async_on_unload(coordinator.async_add_listener(_add_new_vehicles))


class GarageMinderCalendar(GarageMinderVehicleEntity, CalendarEntity):
    """Reminders for one vehicle, as calendar events."""

    _attr_name = "Maintenance"
    _attr_icon = "mdi:calendar-check"

    def __init__(
        self, coordinator: GarageMinderCoordinator, vehicle_id: str
    ) -> None:
        """Initialise the calendar."""
        super().__init__(coordinator, vehicle_id, "calendar")

    def _events(self) -> list[CalendarEvent]:
        vehicle = self.vehicle
        if vehicle is None:
            return []

        events: list[CalendarEvent] = []
        for status in vehicle.reminders:
            if status.next_date is None:
                continue
            description_parts = []
            if status.miles_remaining is not None:
                unit = self.unit_label
                if status.miles_remaining < 0:
                    description_parts.append(
                        f"Overdue by {abs(status.miles_remaining)} {unit}"
                    )
                else:
                    description_parts.append(
                        f"Due in {status.miles_remaining} {unit}"
                    )
            if status.next_odo is not None:
                description_parts.append(f"Target odometer: {status.next_odo}")

            events.append(
                CalendarEvent(
                    summary=f"{vehicle.name}: {status.name}",
                    start=status.next_date,
                    end=status.next_date + timedelta(days=1),
                    description=" · ".join(description_parts) or None,
                    uid=f"{vehicle.id}-{status.name}",
                )
            )
        events.sort(key=lambda event: event.start)
        return events

    @property
    def event(self) -> CalendarEvent | None:
        """Return the next upcoming event."""
        today = dt_util.now().date()
        upcoming = [e for e in self._events() if e.end > today]
        return upcoming[0] if upcoming else None

    async def async_get_events(
        self,
        hass: HomeAssistant,
        start_date: datetime,
        end_date: datetime,
    ) -> list[CalendarEvent]:
        """Return events inside the requested window."""
        start = dt_util.as_local(start_date).date()
        end = dt_util.as_local(end_date).date()
        return [e for e in self._events() if e.start < end and e.end > start]
