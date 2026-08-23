"""Ticking a to-do item must log a real service entry."""

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.garageminder.const import DOMAIN, EVENT_SERVICE_LOGGED


@pytest.fixture
async def entry(hass):
    config_entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data={},
                                   options={"unit": "mi"})
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    coordinator = hass.data[DOMAIN][config_entry.entry_id]
    data = coordinator.store.data
    data["vehicles"] = [{"id": "v1", "name": "Civic", "currentOdo": 60000}]
    data["reminders"] = [
        {"vehicleId": "v1", "service": "Oil change",
         "intervalMiles": 5000, "baseOdo": 54000},
    ]
    await coordinator.async_save_dataset(data, None)
    await hass.async_block_till_done()
    return config_entry


async def test_ticking_logs_an_entry(hass, entry):
    """Complete the item -> an entry exists and the reminder re-bases."""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    assert coordinator.store.data["entries"] == []

    events = []
    hass.bus.async_listen(EVENT_SERVICE_LOGGED, events.append)

    state = hass.states.get("todo.civic_due_services")
    assert state.state == "1"  # next due at 59,000, odo is 60,000 -> overdue

    items = await hass.services.async_call(
        "todo", "get_items",
        {"entity_id": "todo.civic_due_services"},
        blocking=True, return_response=True,
    )
    item = items["todo.civic_due_services"]["items"][0]
    assert item["summary"] == "Oil change"

    await hass.services.async_call(
        "todo", "update_item",
        {"entity_id": "todo.civic_due_services", "item": item["uid"],
         "status": "completed"},
        blocking=True,
    )
    await hass.async_block_till_done()

    entries = coordinator.store.data["entries"]
    assert len(entries) == 1
    assert entries[0]["services"][0]["name"] == "Oil change"
    assert entries[0]["odo"] == 60000

    assert len(events) == 1
    assert events[0].data["services"] == ["Oil change"]

    # Re-based: next due is now 65,000, so nothing is outstanding.
    assert hass.states.get("todo.civic_due_services").state == "0"
