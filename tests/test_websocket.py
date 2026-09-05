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


async def test_attachments_join_onto_entries(hass, entry, hass_ws_client: WebSocketGenerator):
    """Regression test for the missing entry<->attachments join in store.py.

    AttachmentUploadView (http.py) records uploads in the flat
    ``data["attachments"]`` bucket, keyed by entry id -- mirroring
    api.php's separate ``entry_attachments`` table -- rather than nesting
    them directly on the entry. api.php's ``load`` action joins that table
    onto each entry before returning it (see api.php ~line 328); without
    the equivalent join in store.py's ``_normalize()``, the SPA (which only
    ever reads ``entry.attachments``) would show freshly uploaded files as
    if they never existed, even though they were written to disk and
    recorded server-side. This is exactly what Ken saw as a green "undefined
    file(s) uploaded" toast with nothing actually attached.
    """
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "garageminder/load"})
    first = (await client.receive_json())["result"]
    version = first["data_version"]
    payload = dict(first["data"])
    payload["vehicles"] = [{"id": "v1", "name": "Civic", "currentOdo": 1000}]
    payload["entries"] = [
        {"id": "e1", "vehicleId": "v1", "date": "2026-01-01", "odo": 1000,
         "services": [{"name": "Oil change", "cost": 50}], "cost": 50,
         "attachments": []},
        {"id": "e2", "vehicleId": "v1", "date": "2026-02-01", "odo": 1100,
         "services": [{"name": "Tire rotation", "cost": 20}], "cost": 20,
         "attachments": []},
    ]
    await client.send_json({"id": 2, "type": "garageminder/save",
                            "data": payload, "data_version": version})
    saved = await client.receive_json()
    assert saved["success"]
    version = saved["result"]["data_version"]

    await client.send_json({"id": 3, "type": "garageminder/load"})
    reloaded = (await client.receive_json())["result"]

    # Simulate what AttachmentUploadView.post() does on a real upload: record
    # the file in the flat bucket, keyed by entry id, and save. It never
    # touches entry["attachments"] itself -- the join is store.py's job.
    payload = dict(reloaded["data"])
    record = {"id": "att_1", "name": "receipt.pdf", "size": 15,
              "mime": "application/pdf", "stored": "att_1_receipt.pdf"}
    payload["attachments"] = {"e1": [record]}
    await client.send_json({"id": 4, "type": "garageminder/save",
                            "data": payload, "data_version": version})
    saved = await client.receive_json()
    assert saved["success"]

    await client.send_json({"id": 5, "type": "garageminder/load"})
    loaded = (await client.receive_json())["result"]["data"]

    by_id = {e["id"]: e for e in loaded["entries"]}
    assert by_id["e1"]["attachments"] == [record]
    # An entry with nothing in the bucket must come back empty, not stale
    # or missing -- the join is authoritative in both directions.
    assert by_id["e2"]["attachments"] == []
