"""Problem binary sensors for each vehicle."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
    BinarySensorEntityDescription,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
try:  # HA 2024.12+
    from homeassistant.helpers.entity_platform import (
        AddConfigEntryEntitiesCallback as AddEntitiesCallback,
    )
except ImportError:  # pragma: no cover - older cores
    from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import GarageMinderCoordinator, VehicleView
from .entity import GarageMinderVehicleEntity

# Reminders whose name matches these are surfaced as their own binary sensor,
# because "your registration lapsed" deserves a different notification from
# "you are due for a tyre rotation".
REGISTRATION_KEYWORDS = ("registration",)
INSURANCE_KEYWORDS = ("insurance",)
INSPECTION_KEYWORDS = ("inspection (state", "emissions test")


def _matches(vehicle: VehicleView, keywords: tuple[str, ...]) -> bool:
    return any(
        any(keyword in status.name.lower() for keyword in keywords)
        and status.level in ("overdue", "upcoming")
        for status in vehicle.reminders
    )


def _matched_names(vehicle: VehicleView, keywords: tuple[str, ...]) -> list[str]:
    return [
        status.name
        for status in vehicle.reminders
        if any(keyword in status.name.lower() for keyword in keywords)
        and status.level in ("overdue", "upcoming")
    ]


@dataclass(frozen=True, kw_only=True)
class GarageBinarySensorDescription(BinarySensorEntityDescription):
    """Describes one vehicle binary sensor."""

    is_on_fn: Callable[[VehicleView], bool]
    attributes_fn: Callable[[VehicleView], dict[str, Any]] | None = None


BINARY_SENSORS: tuple[GarageBinarySensorDescription, ...] = (
    GarageBinarySensorDescription(
        key="maintenance_overdue",
        translation_key="maintenance_overdue",
        name="Maintenance overdue",
        device_class=BinarySensorDeviceClass.PROBLEM,
        is_on_fn=lambda v: bool(v.overdue),
        attributes_fn=lambda v: {
            "count": len(v.overdue),
            "services": [s.name for s in v.overdue],
        },
    ),
    GarageBinarySensorDescription(
        key="service_due_soon",
        translation_key="service_due_soon",
        name="Service due soon",
        device_class=BinarySensorDeviceClass.PROBLEM,
        is_on_fn=lambda v: bool(v.upcoming),
        attributes_fn=lambda v: {
            "count": len(v.upcoming),
            "services": [s.name for s in v.upcoming],
        },
    ),
    GarageBinarySensorDescription(
        key="registration_due",
        translation_key="registration_due",
        name="Registration due",
        device_class=BinarySensorDeviceClass.PROBLEM,
        is_on_fn=lambda v: _matches(v, REGISTRATION_KEYWORDS),
        attributes_fn=lambda v: {"items": _matched_names(v, REGISTRATION_KEYWORDS)},
    ),
    GarageBinarySensorDescription(
        key="insurance_due",
        translation_key="insurance_due",
        name="Insurance due",
        device_class=BinarySensorDeviceClass.PROBLEM,
        is_on_fn=lambda v: _matches(v, INSURANCE_KEYWORDS),
        attributes_fn=lambda v: {"items": _matched_names(v, INSURANCE_KEYWORDS)},
    ),
    GarageBinarySensorDescription(
        key="inspection_due",
        translation_key="inspection_due",
        name="Inspection due",
        device_class=BinarySensorDeviceClass.PROBLEM,
        is_on_fn=lambda v: _matches(v, INSPECTION_KEYWORDS),
        attributes_fn=lambda v: {"items": _matched_names(v, INSPECTION_KEYWORDS)},
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up binary sensors, adding more as vehicles appear."""
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
            GarageMinderBinarySensor(coordinator, vehicle_id, description)
            for vehicle_id in new
            for description in BINARY_SENSORS
        )

    _add_new_vehicles()
    entry.async_on_unload(coordinator.async_add_listener(_add_new_vehicles))


class GarageMinderBinarySensor(GarageMinderVehicleEntity, BinarySensorEntity):
    """A problem flag for one vehicle."""

    entity_description: GarageBinarySensorDescription

    def __init__(
        self,
        coordinator: GarageMinderCoordinator,
        vehicle_id: str,
        description: GarageBinarySensorDescription,
    ) -> None:
        """Initialise the binary sensor."""
        super().__init__(coordinator, vehicle_id, description.key)
        self.entity_description = description

    @property
    def is_on(self) -> bool | None:
        """Return whether the problem is currently present."""
        vehicle = self.vehicle
        if vehicle is None:
            return None
        return self.entity_description.is_on_fn(vehicle)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return the services behind the flag."""
        vehicle = self.vehicle
        if vehicle is None or self.entity_description.attributes_fn is None:
            return None
        return self.entity_description.attributes_fn(vehicle)
