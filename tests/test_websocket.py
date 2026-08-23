"""The websocket API is the panel's only lifeline -- test it directly."""

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.garageminder.const import DOMAIN


@pytest.fixture
async def entry(hass):
    config_entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data={},
                                   options={"unit": "mi"})
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    return config_entry


async def test_load_returns_defaults(hass, entry, hass_ws_client: WebSocketGenerator):
    """A fresh install looks like a fresh install of the web app."""
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "garageminder/load"})
    msg = await client.receive_json()
    assert msg["success"]
    data = msg["result"]["data"]
    assert data["vehicles"] == []
    # The 27 default service types ported from gm.core.js
    assert len(data["serviceTypes"]) == 27
    assert {"name": "Oil change", "intervalMiles": 5000, "intervalMonths": 6} in data["serviceTypes"]
    assert data["settings"]["upcomingThresholdMiles"] == 500
    assert msg["result"]["data_version"]


async def test_save_round_trip(hass, entry, hass_ws_client: WebSocketGenerator):
    """Save then load returns what was saved, with a new token."""
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "garageminder/load"})
    first = (await client.receive_json())["result"]
    version = first["data_version"]

    payload = dict(first["data"])
    payload["vehicles"] = [{"id": "v9", "name": "Civic", "currentOdo": 120}]

    await client.send_json({"id": 2, "type": "garageminder/save",
                            "data": payload, "data_version": version})
    saved = await client.receive_json()
    assert saved["success"]
    assert saved["result"]["data_version"] != version

    await client.send_json({"id": 3, "type": "garageminder/load"})
    reloaded = (await client.receive_json())["result"]
    assert reloaded["data"]["vehicles"][0]["name"] == "Civic"
    assert reloaded["data_version"] == saved["result"]["data_version"]


async def test_stale_token_is_rejected(hass, entry, hass_ws_client: WebSocketGenerator):
    """Optimistic locking still works -- this is what the SPA retries on."""
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "garageminder/load"})
    first = (await client.receive_json())["result"]

    await client.send_json({"id": 2, "type": "garageminder/save",
                            "data": first["data"],
                            "data_version": first["data_version"]})
    assert (await client.receive_json())["success"]

    # Second save with the now-stale token must fail, not silently clobber.
    await client.send_json({"id": 3, "type": "garageminder/save",
                            "data": first["data"],
                            "data_version": first["data_version"]})
    conflict = await client.receive_json()
    assert not conflict["success"]
    assert conflict["error"]["code"] == "version_conflict"


async def test_config_command(hass, entry, hass_ws_client: WebSocketGenerator):
    """gm-boot.js needs this before it injects a single app script."""
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "garageminder/config"})
    result = (await client.receive_json())["result"]
    assert result["isHomeAssistant"] is True
    assert result["unit"] == "mi"
    assert result["user"]["id"]
