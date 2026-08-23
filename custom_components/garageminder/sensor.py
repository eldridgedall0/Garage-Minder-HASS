"""Sensors for each vehicle."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, time
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfLength
from homeassistant.core import HomeAssistant, callback
try:  # HA 2024.12+
    from homeassistant.helpers.entity_platform import (
        AddConfigEntryEntitiesCallback as AddEntitiesCallback,
    )
except ImportError:  # pragma: no cover - older cores
    from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .coordinator import GarageMinderCoordinator, VehicleView
from .entity import GarageMinderVehicleEntity


@dataclass(frozen=True, kw_only=True)
class GarageSensorDescription(SensorEntityDescription):
    """Describes one vehicle sensor."""

    value_fn: Callable[[VehicleView], Any]
    attributes_fn: Callable[[VehicleView], dict[str, Any]] | None = None
    is_distance: bool = False


def _next_due_timestamp(vehicle: VehicleView) -> datetime | None:
    status = vehicle.next_due
    if status is None or status.next_date is None:
        return None
    return dt_util.as_local(datetime.combine(status.next_date, time(9, 0)))


def _last_service_timestamp(vehicle: VehicleView) -> datetime | None:
    last = vehicle.last_service_date
    if last is None:
        return None
    return dt_util.as_local(datetime.combine(last, time(12, 0)))


SENSORS: tuple[GarageSensorDescription, ...] = (
    GarageSensorDescription(
        key="odometer",
        translation_key="odometer",
        name="Odometer",
        device_class=SensorDeviceClass.DISTANCE,
        state_class=SensorStateClass.TOTAL_INCREASING,
        icon="mdi:counter",
        is_distance=True,
        value_fn=lambda v: v.current_odo,
        attributes_fn=lambda v: {"odometer_source": v.odometer_source},
    ),
    GarageSensorDescription(
        key="next_service",
        translation_key="next_service",
        name="Next service",
        icon="mdi:wrench-clock",
        value_fn=lambda v: (v.next_due.name if v.next_due else None),
        attributes_fn=lambda v: (
            {
                "level": v.next_due.level,
                "days_remaining": v.next_due.days_remaining,
                "miles_remaining": v.next_due.miles_remaining,
                "next_odometer": v.next_due.next_odo,
            }
            if v.next_due
            else {}
        ),
    ),
    GarageSensorDescription(
        key="next_service_due",
        translation_key="next_service_due",
        name="Next service due",
        device_class=SensorDeviceClass.TIMESTAMP,
        icon="mdi:calendar-clock",
        value_fn=_next_due_timestamp,
    ),
    GarageSensorDescription(
        key="distance_to_next_service",
        translation_key="distance_to_next_service",
        name="Distance to next service",
        device_class=SensorDeviceClass.DISTANCE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:map-marker-distance",
        is_distance=True,
        value_fn=lambda v: (
            v.next_due.miles_remaining if v.next_due else None
        ),
    ),
    GarageSensorDescription(
        key="overdue_count",
        translation_key="overdue_count",
        name="Overdue services",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:alert-circle-outline",
        value_fn=lambda v: len(v.overdue),
        attributes_fn=lambda v: {"services": [s.name for s in v.overdue]},
    ),
    GarageSensorDescription(
        key="upcoming_count",
        translation_key="upcoming_count",
        name="Upcoming services",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:clock-alert-outline",
        value_fn=lambda v: len(v.upcoming),
        attributes_fn=lambda v: {"services": [s.name for s in v.upcoming]},
    ),
    GarageSensorDescription(
        key="last_service",
        translation_key="last_service",
        name="Last service",
        device_class=SensorDeviceClass.TIMESTAMP,
        icon="mdi:history",
        value_fn=_last_service_timestamp,
    ),
    GarageSensorDescription(
        key="spend_ytd",
        translation_key="spend_ytd",
        name="Spend this year",
        device_class=SensorDeviceClass.MONETARY,
        state_class=SensorStateClass.TOTAL,
        icon="mdi:cash-multiple",
        value_fn=lambda v: v.spend_ytd,
        attributes_fn=lambda v: {"entry_count": len(v.entries)},
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up sensors, adding more as vehicles are created in the app."""
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
            GarageMinderSensor(coordinator, vehicle_id, description)
            for vehicle_id in new
            for description in SENSORS
        )

    _add_new_vehicles()
    entry.async_on_unload(coordinator.async_add_listener(_add_new_vehicles))


class GarageMinderSensor(GarageMinderVehicleEntity, SensorEntity):
    """A single derived value for one vehicle."""

    entity_description: GarageSensorDescription

    def __init__(
        self,
        coordinator: GarageMinderCoordinator,
        vehicle_id: str,
        description: GarageSensorDescription,
    ) -> None:
        """Initialise the sensor."""
        super().__init__(coordinator, vehicle_id, description.key)
        self.entity_description = description

        # Without this, Home Assistant converts any DISTANCE sensor to the
        # unit system of the instance -- so an app set to miles would show
        # 135,989 km in HA while the panel showed 84,500 mi. Suggesting the
        # app's own unit makes the entity match what the app displays.
        # (It seeds the entity registry once; a later mi<->km switch in the
        # app needs the entity's unit changed in HA, or the entity removed
        # and re-added.)
        if description.is_distance:
            self._attr_suggested_unit_of_measurement = self._distance_unit()

    def _distance_unit(self) -> str:
        return (
            UnitOfLength.KILOMETERS
            if self.unit_label == "km"
            else UnitOfLength.MILES
        )

    @property
    def native_unit_of_measurement(self) -> str | None:
        """Follow the unit configured inside the app."""
        if self.entity_description.is_distance:
            return self._distance_unit()
        if self.entity_description.device_class is SensorDeviceClass.MONETARY:
            return self.hass.config.currency
        return self.entity_description.native_unit_of_measurement

    @property
    def native_value(self) -> Any:
        """Return the sensor value."""
        vehicle = self.vehicle
        if vehicle is None:
            return None
        return self.entity_description.value_fn(vehicle)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return extra detail, where the description provides it."""
        vehicle = self.vehicle
        if vehicle is None or self.entity_description.attributes_fn is None:
            return None
        return self.entity_description.attributes_fn(vehicle)
