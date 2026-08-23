"""A to-do list per vehicle.

Ticking an item off is not cosmetic: it logs a real service entry against
the vehicle and re-bases the reminder, exactly as saving the entry form in
the app would. This is the shortest path from "HA told me it's due" to
"it's recorded".
"""

from __future__ import annotations

from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
try:  # HA 2024.12+
    from homeassistant.helpers.entity_platform import (
        AddConfigEntryEntitiesCallback as AddEntitiesCallback,
    )
except ImportError:  # pragma: no cover - older cores
    from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, LEVEL_OK
from .coordinator import GarageMinderCoordinator
from .entity import GarageMinderVehicleEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up one to-do list per vehicle."""
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
            GarageMinderTodoList(coordinator, vehicle_id) for vehicle_id in new
        )

    _add_new_vehicles()
    entry.async_on_unload(coordinator.async_add_listener(_add_new_vehicles))


class GarageMinderTodoList(GarageMinderVehicleEntity, TodoListEntity):
    """Due and overdue services for one vehicle."""

    _attr_name = "Due services"
    _attr_icon = "mdi:clipboard-check-outline"
    _attr_supported_features = TodoListEntityFeature.UPDATE_TODO_ITEM

    def __init__(
        self, coordinator: GarageMinderCoordinator, vehicle_id: str
    ) -> None:
        """Initialise the list."""
        super().__init__(coordinator, vehicle_id, "todo")

    @property
    def todo_items(self) -> list[TodoItem] | None:
        """Return one item per reminder that needs attention."""
        vehicle = self.vehicle
        if vehicle is None:
            return None

        items: list[TodoItem] = []
        for status in vehicle.reminders:
            if status.level == LEVEL_OK:
                continue
            detail = []
            if status.days_remaining is not None:
                detail.append(
                    f"{abs(status.days_remaining)} days "
                    f"{'overdue' if status.days_remaining < 0 else 'to go'}"
                )
            if status.miles_remaining is not None:
                detail.append(
                    f"{abs(status.miles_remaining)} {self.unit_label} "
                    f"{'overdue' if status.miles_remaining < 0 else 'to go'}"
                )
            items.append(
                TodoItem(
                    uid=f"{vehicle.id}:{status.name}",
                    summary=status.name,
                    status=TodoItemStatus.NEEDS_ACTION,
                    due=status.next_date,
                    description=" · ".join(detail) or None,
                )
            )
        return items

    async def async_update_todo_item(self, item: TodoItem) -> None:
        """Completing an item logs the service against the vehicle."""
        if item.status != TodoItemStatus.COMPLETED:
            return

        vehicle = self.vehicle
        if vehicle is None or not item.uid:
            return

        service_name = item.uid.split(":", 1)[1]
        await self.coordinator.async_log_service(
            vehicle.id,
            [service_name],
            odometer=vehicle.current_odo,
            notes="Logged from Home Assistant to-do list",
        )
