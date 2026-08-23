"""End-to-end: does the integration actually set up inside Home Assistant?"""

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.garageminder.const import DOMAIN

VEHICLE = {
    "id": "v1",
    "name": "F-150",
    "make": "Ford",
    "model": "F-150",
    "year": 2019,
    "vin": "1FTFW1E50KFA00000",
    "currentOdo": 84500,
}

REMINDERS = [
    # 4,500 mi since the base -> 500 to go -> "upcoming"
    {"vehicleId": "v1", "service": "Oil change", "intervalMiles": 5000, "baseOdo": 80000},
    # long overdue on date
    {"vehicleId": "v1", "service": "Registration renewal", "intervalMonths": 12,
     "baseDate": "2024-01-01"},
    # nowhere near due
    {"vehicleId": "v1", "service": "Coolant change", "intervalMiles": 60000,
     "baseOdo": 80000},
]

ENTRIES = [
    {"id": "e1", "vehicleId": "v1", "date": "2026-03-02", "odo": 80000,
     "services": [{"name": "Oil change", "cost": 62.5}], "cost": 5.0},
]


@pytest.fixture
async def entry(hass):
    """Set up the integration with a seeded dataset."""
    config_entry = MockConfigEntry(
        domain=DOMAIN, unique_id=DOMAIN, title="GarageMinder",
        data={}, options={"unit": "mi"},
    )
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()

    coordinator = hass.data[DOMAIN][config_entry.entry_id]
    data = coordinator.store.data
    data["vehicles"] = [dict(VEHICLE)]
    data["reminders"] = [dict(r) for r in REMINDERS]
    data["entries"] = [dict(e) for e in ENTRIES]
    await coordinator.async_save_dataset(data, None)
    await hass.async_block_till_done()
    return config_entry


async def test_entities_created(hass, entry):
    """Every platform produces entities for the vehicle."""
    for entity_id in (
        "sensor.f_150_odometer",
        "sensor.f_150_next_service",
        "sensor.f_150_overdue_services",
        "sensor.f_150_spend_this_year",
        "binary_sensor.f_150_maintenance_overdue",
        "binary_sensor.f_150_registration_due",
        "calendar.f_150_maintenance",
        "todo.f_150_due_services",
    ):
        assert hass.states.get(entity_id) is not None, f"missing {entity_id}"


async def test_derived_values(hass, entry):
    """The ported maths reaches the entity states."""
    assert hass.states.get("sensor.f_150_odometer").state == "84500"
    assert hass.states.get("sensor.f_150_overdue_services").state == "1"
    assert hass.states.get("sensor.f_150_upcoming_services").state == "1"
    assert hass.states.get("binary_sensor.f_150_maintenance_overdue").state == "on"
    assert hass.states.get("binary_sensor.f_150_registration_due").state == "on"
    assert hass.states.get("binary_sensor.f_150_insurance_due").state == "off"
    # 62.50 + 5.00, dated this year
    assert hass.states.get("sensor.f_150_spend_this_year").state == "67.5"


async def test_services_registered(hass, entry):
    """All four actions exist."""
    for service in ("log_service", "set_odometer", "add_vehicle", "snooze_reminder"):
        assert hass.services.has_service(DOMAIN, service), service


async def test_log_service_updates_state(hass, entry):
    """Logging a service re-bases the reminder and moves the odometer."""
    await hass.services.async_call(
        DOMAIN, "log_service",
        {"vehicle_id": "v1", "services": ["Oil change"], "odometer": 85000,
         "cost": 70.0},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert hass.states.get("sensor.f_150_odometer").state == "85000"
    # Oil change was upcoming; after logging it is not.
    assert hass.states.get("sensor.f_150_upcoming_services").state == "0"
    assert float(hass.states.get("sensor.f_150_spend_this_year").state) == 137.5


async def test_panel_registered(hass, entry):
    """The sidebar panel is registered by the integration itself."""
    assert "garageminder" in hass.data["frontend_panels"]


async def test_new_vehicle_gets_entities(hass, entry):
    """A vehicle added later gets entities without a reload."""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    await coordinator.async_add_vehicle("Civic", vin="2HGES16575H000000")
    await hass.async_block_till_done()
    assert hass.states.get("sensor.civic_odometer") is not None


async def test_unload(hass, entry):
    """Unloading cleans up."""
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert "garageminder" not in hass.data["frontend_panels"]
