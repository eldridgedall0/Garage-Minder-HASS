"""HTTP views for attachments and vehicle photos.

These replace ``upload.php``, ``download.php``, ``delete-attachment.php``
and ``vehicle-photo.php``. Every view inherits HomeAssistantView's auth,
so there is no token handling, no CORS setup and no session code here --
that whole class of problem disappears with WordPress.
"""

from __future__ import annotations

import logging
import mimetypes
import re
import uuid
from pathlib import Path
from typing import Any

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback

try:  # HA 2024.6+
    from homeassistant.components.http import KEY_HASS
except ImportError:  # pragma: no cover - older cores
    KEY_HASS = "hass"  # type: ignore[assignment]

from .const import ATTACHMENT_DIR, DOMAIN, MAX_ATTACHMENT_MB
from .coordinator import GarageMinderCoordinator

_LOGGER = logging.getLogger(__name__)

ALLOWED_SUFFIXES = {
    ".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic",
}
MAX_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024

# Client-supplied attachment ids become filenames, so keep them boring.
_SAFE_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")


@callback
def async_register_views(hass: HomeAssistant) -> None:
    """Register the attachment views."""
    hass.http.register_view(AttachmentUploadView)
    hass.http.register_view(AttachmentDownloadView)


def _coordinator(hass: HomeAssistant) -> GarageMinderCoordinator | None:
    for coordinator in (hass.data.get(DOMAIN) or {}).values():
        return coordinator
    return None


def _storage_dir(hass: HomeAssistant) -> Path:
    return Path(hass.config.path(ATTACHMENT_DIR))


class AttachmentUploadView(HomeAssistantView):
    """Accept a file for one entry."""

    url = f"/api/{DOMAIN}/attachment/{{entry_id}}"
    name = f"api:{DOMAIN}:attachment:upload"
    requires_auth = True

    async def post(self, request: web.Request, entry_id: str) -> web.Response:
        """Store an uploaded file and record it against the entry."""
        hass: HomeAssistant = request.app[KEY_HASS]
        coordinator = _coordinator(hass)
        if coordinator is None:
            return self.json_message("GarageMinder is not set up", 503)

        reader = await request.multipart()
        field = await reader.next()
        if field is None or field.name != "file":
            return self.json_message("Expected a 'file' field", 400)

        filename = Path(field.filename or "upload").name
        suffix = Path(filename).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            return self.json_message(f"File type {suffix or '?'} is not allowed", 400)

        # A restore replays attachments that already have ids, and the entries
        # in the dataset still reference them. Honour a supplied id so those
        # references keep resolving; otherwise mint a fresh one.
        supplied = request.query.get("id", "")
        if supplied and _SAFE_ID.fullmatch(supplied):
            attachment_id = supplied
        else:
            attachment_id = uuid.uuid4().hex
        target = _storage_dir(hass) / f"{attachment_id}{suffix}"

        size = 0
        chunks: list[bytes] = []
        while True:
            chunk = await field.read_chunk()
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_BYTES:
                return self.json_message(
                    f"File is larger than {MAX_ATTACHMENT_MB}MB", 413
                )
            chunks.append(chunk)

        def _write() -> None:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("wb") as handle:
                for chunk in chunks:
                    handle.write(chunk)

        await hass.async_add_executor_job(_write)

        record: dict[str, Any] = {
            "id": attachment_id,
            "name": filename,
            "size": size,
            "mime": mimetypes.guess_type(filename)[0] or "application/octet-stream",
            "stored": target.name,
            "url": f"/api/{DOMAIN}/attachment/{entry_id}/{attachment_id}",
        }

        def _mutate(data: dict[str, Any]) -> None:
            data.setdefault("attachments", {}).setdefault(entry_id, []).append(record)

        await coordinator.async_mutate(_mutate)
        return self.json(record)


class AttachmentDownloadView(HomeAssistantView):
    """Serve or delete one stored file."""

    url = f"/api/{DOMAIN}/attachment/{{entry_id}}/{{attachment_id}}"
    name = f"api:{DOMAIN}:attachment:file"
    requires_auth = True

    async def get(
        self, request: web.Request, entry_id: str, attachment_id: str
    ) -> web.Response:
        """Return the stored file."""
        hass: HomeAssistant = request.app[KEY_HASS]
        record = _find(hass, entry_id, attachment_id)
        if record is None:
            return self.json_message("Attachment not found", 404)

        path = _storage_dir(hass) / record["stored"]
        if not await hass.async_add_executor_job(path.is_file):
            return self.json_message("File is missing from disk", 404)

        return web.FileResponse(
            path,
            headers={
                "Content-Disposition": f'inline; filename="{record["name"]}"',
                "Content-Type": record.get("mime", "application/octet-stream"),
            },
        )

    async def delete(
        self, request: web.Request, entry_id: str, attachment_id: str
    ) -> web.Response:
        """Delete the file and forget the record."""
        hass: HomeAssistant = request.app[KEY_HASS]
        coordinator = _coordinator(hass)
        if coordinator is None:
            return self.json_message("GarageMinder is not set up", 503)

        record = _find(hass, entry_id, attachment_id)
        if record is None:
            return self.json_message("Attachment not found", 404)

        path = _storage_dir(hass) / record["stored"]
        await hass.async_add_executor_job(lambda: path.unlink(missing_ok=True))

        def _mutate(data: dict[str, Any]) -> None:
            bucket = data.get("attachments", {}).get(entry_id, [])
            data["attachments"][entry_id] = [
                item for item in bucket if item.get("id") != attachment_id
            ]

        await coordinator.async_mutate(_mutate)
        return self.json({"success": True})


def _find(
    hass: HomeAssistant, entry_id: str, attachment_id: str
) -> dict[str, Any] | None:
    coordinator = _coordinator(hass)
    if coordinator is None:
        return None
    for record in coordinator.store.data.get("attachments", {}).get(entry_id, []):
        if record.get("id") == attachment_id:
            return record
    return None
