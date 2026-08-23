"""Shared entity base: one Home Assistant device per vehicle."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import GarageMinderCoordinator, VehicleView


class GarageMinderVehicleEntity(CoordinatorEntity[GarageMinderCoordinator]):
    """Base class for anything attached to a vehicle."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: GarageMinderCoordinator,
        vehicle_id: str,
        key: str,
    ) -> None:
        """Initialise the entity."""
        super().__init__(coordinator)
        self._vehicle_id = vehicle_id
        self._key = key
        self._attr_unique_id = f"{DOMAIN}_{vehicle_id}_{key}"

    @property
    def vehicle(self) -> VehicleView | None:
        """Return the current view of this vehicle, if it still exists."""
        if self.coordinator.data is None:
            return None
        return self.coordinator.data.vehicles.get(self._vehicle_id)

    @property
    def available(self) -> bool:
        """Entities go unavailable if the vehicle is deleted in the app."""
        return super().available and self.vehicle is not None

    @property
    def device_info(self) -> DeviceInfo:
        """Group every entity for this vehicle under one device."""
        vehicle = self.vehicle
        raw = vehicle.raw if vehicle else {}
        return DeviceInfo(
            identifiers={(DOMAIN, self._vehicle_id)},
            name=vehicle.name if vehicle else "Vehicle",
            manufacturer=str(raw.get("make") or "GarageMinder"),
            model=str(raw.get("model") or "Vehicle"),
            hw_version=str(raw.get("year")) if raw.get("year") else None,
            serial_number=str(raw.get("vin")) if raw.get("vin") else None,
        )

    @property
    def unit_label(self) -> str:
        """Distance unit configured in the app: 'mi' or 'km'."""
        if self.coordinator.data is None:
            return "mi"
        return self.coordinator.data.unit
