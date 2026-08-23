"""Constants for the GarageMinder integration."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "garageminder"

# Storage
STORAGE_KEY: Final = "garageminder"
STORAGE_VERSION: Final = 1
SAVE_DELAY: Final = 2  # seconds of debounce before the store is written

# Panel
PANEL_URL_PATH: Final = "garageminder"
PANEL_TITLE: Final = "GarageMinder"
PANEL_ICON: Final = "mdi:car-wrench"
STATIC_URL: Final = "/garageminder_static"

# Attachments live under <config>/garageminder/attachments/
ATTACHMENT_DIR: Final = "garageminder/attachments"
MAX_ATTACHMENT_MB: Final = 10

# Config entry options
CONF_UNIT: Final = "unit"
CONF_UPCOMING_DAYS: Final = "upcoming_threshold_days"
CONF_UPCOMING_MILES: Final = "upcoming_threshold_miles"
CONF_OVERDUE_DAYS: Final = "overdue_threshold_days"
CONF_OVERDUE_MILES: Final = "overdue_threshold_miles"
CONF_ODOMETER_SOURCES: Final = "odometer_sources"  # {vehicle_id: entity_id}

DEFAULT_UNIT: Final = "mi"
DEFAULT_UPCOMING_DAYS: Final = 14
DEFAULT_UPCOMING_MILES: Final = 500
DEFAULT_OVERDUE_DAYS: Final = 0
DEFAULT_OVERDUE_MILES: Final = 0

# Events fired on the HA bus
EVENT_SERVICE_DUE: Final = "garageminder_service_due"
EVENT_SERVICE_OVERDUE: Final = "garageminder_service_overdue"
EVENT_SERVICE_LOGGED: Final = "garageminder_service_logged"

# Signal dispatched when the dataset changes (panel save, service call, ...)
SIGNAL_DATA_UPDATED: Final = f"{DOMAIN}_data_updated"

# Service names
SERVICE_LOG_SERVICE: Final = "log_service"
SERVICE_SET_ODOMETER: Final = "set_odometer"
SERVICE_ADD_VEHICLE: Final = "add_vehicle"
SERVICE_SNOOZE_REMINDER: Final = "snooze_reminder"
SERVICE_IMPORT_DATA: Final = "import_data"
SERVICE_EXPORT_DATA: Final = "export_data"

# Status levels, mirroring assets/js/gm.utils.js computeReminderDerived()
LEVEL_OK: Final = "ok"
LEVEL_UPCOMING: Final = "upcoming"
LEVEL_OVERDUE: Final = "overdue"

PLATFORMS: Final = ["sensor", "binary_sensor", "calendar", "todo"]
