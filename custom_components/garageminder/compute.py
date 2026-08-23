"""Derived values for GarageMinder.

This is a faithful port of the maths in ``assets/js/gm.utils.js``
(``computeReminderDerived``) and ``calculateEntryTotalCost``. Keeping the
two implementations in step matters: the bundled SPA still computes these
client-side for its own rendering, while the entity layer computes them
here. If you change a threshold rule, change it in both places.
"""

from __future__ import annotations

import calendar as _calendar
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from .const import LEVEL_OK, LEVEL_OVERDUE, LEVEL_UPCOMING


@dataclass(slots=True)
class Thresholds:
    """Status thresholds, read from the dataset's settings block."""

    upcoming_days: int = 14
    upcoming_miles: int = 500
    overdue_days: int = 0
    overdue_miles: int = 0

    @classmethod
    def from_settings(cls, settings: dict[str, Any] | None) -> "Thresholds":
        """Build thresholds from the settings dict, falling back to defaults."""
        s = settings or {}
        return cls(
            upcoming_days=_int_or(s.get("upcomingThresholdDays"), 14),
            upcoming_miles=_int_or(s.get("upcomingThresholdMiles"), 500),
            overdue_days=_int_or(s.get("overdueThresholdDays"), 0),
            overdue_miles=_int_or(s.get("overdueThresholdMiles"), 0),
        )


@dataclass(slots=True)
class ReminderStatus:
    """The derived state of a single reminder."""

    reminder: dict[str, Any]
    vehicle_id: str | None
    name: str
    level: str
    next_odo: int | None
    next_date: date | None
    miles_remaining: int | None
    days_remaining: int | None

    @property
    def is_overdue(self) -> bool:
        """Return True when the reminder is past its grace period."""
        return self.level == LEVEL_OVERDUE

    @property
    def is_due_soon(self) -> bool:
        """Return True when the reminder is inside the upcoming window."""
        return self.level == LEVEL_UPCOMING


def add_months(iso_date: str, months: int) -> date | None:
    """Add whole months to an ISO date, clamping to the end of short months."""
    base = parse_date(iso_date)
    if base is None:
        return None
    total = base.month - 1 + int(months)
    year = base.year + total // 12
    month = total % 12 + 1
    day = min(base.day, _calendar.monthrange(year, month)[1])
    return date(year, month, day)


def parse_date(value: Any) -> date | None:
    """Parse a YYYY-MM-DD string; return None for anything unusable."""
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


def compute_reminder(
    reminder: dict[str, Any],
    current_odo: int | None,
    thresholds: Thresholds,
    today: date,
) -> ReminderStatus:
    """Derive next-due targets and a status level for one reminder."""
    next_odo = _int_or_none(reminder.get("nextOdo"))
    next_date = parse_date(reminder.get("nextDate"))

    interval_miles = _int_or_none(reminder.get("intervalMiles"))
    interval_months = _int_or_none(reminder.get("intervalMonths"))

    if interval_miles and interval_miles > 0 and next_odo is None:
        base_odo = _int_or_none(reminder.get("baseOdo"))
        if base_odo is not None:
            next_odo = base_odo + interval_miles
        elif current_odo is not None:
            next_odo = current_odo + interval_miles

    if interval_months and interval_months > 0 and next_date is None:
        base_date = reminder.get("baseDate")
        if base_date:
            next_date = add_months(base_date, interval_months)
        else:
            next_date = add_months(today.isoformat(), interval_months)

    miles_diff = (
        next_odo - current_odo
        if next_odo is not None and current_odo is not None
        else None
    )
    days_diff = (next_date - today).days if next_date is not None else None

    level = LEVEL_OK
    overdue_miles = miles_diff is not None and miles_diff < -thresholds.overdue_miles
    overdue_days = days_diff is not None and days_diff < -thresholds.overdue_days
    upcoming_miles = (
        miles_diff is not None
        and miles_diff <= thresholds.upcoming_miles
        and miles_diff >= -thresholds.overdue_miles
    )
    upcoming_days = (
        days_diff is not None
        and days_diff <= thresholds.upcoming_days
        and days_diff >= -thresholds.overdue_days
    )

    if overdue_miles or overdue_days:
        level = LEVEL_OVERDUE
    elif upcoming_miles or upcoming_days:
        level = LEVEL_UPCOMING

    return ReminderStatus(
        reminder=reminder,
        vehicle_id=_str_or_none(reminder.get("vehicleId")),
        name=str(reminder.get("service") or reminder.get("name") or "Service"),
        level=level,
        next_odo=next_odo,
        next_date=next_date,
        miles_remaining=miles_diff,
        days_remaining=days_diff,
    )


def entry_total_cost(entry: dict[str, Any]) -> float:
    """Sum per-service costs plus the misc cost, as gm.utils.js does."""
    total = 0.0
    for service in normalize_services(entry.get("services") or []):
        if service.get("cost") is not None:
            total += _float_or(service["cost"], 0.0)
    if entry.get("cost") is not None:
        total += _float_or(entry["cost"], 0.0)
    return round(total, 2)


def normalize_services(services: Any) -> list[dict[str, Any]]:
    """Accept both the legacy string list and the {name, cost, note} form."""
    out: list[dict[str, Any]] = []
    if not isinstance(services, list):
        return out
    for item in services:
        if isinstance(item, str):
            out.append({"name": item, "cost": None, "note": ""})
        elif isinstance(item, dict):
            out.append(
                {
                    "name": item.get("name") or "",
                    "cost": item.get("cost"),
                    "note": item.get("note") or "",
                }
            )
    return out


def vehicle_entries(data: dict[str, Any], vehicle_id: str) -> list[dict[str, Any]]:
    """Return this vehicle's entries, newest first."""
    entries = [
        e
        for e in data.get("entries", [])
        if str(e.get("vehicleId")) == str(vehicle_id)
    ]
    entries.sort(key=lambda e: str(e.get("date") or ""), reverse=True)
    return entries


def vehicle_current_odo(vehicle: dict[str, Any], entries: list[dict[str, Any]]) -> int | None:
    """Current mileage: the vehicle field, else the highest odo ever logged."""
    current = _int_or_none(vehicle.get("currentOdo"))
    logged = [o for o in (_int_or_none(e.get("odo")) for e in entries) if o is not None]
    if logged:
        highest = max(logged)
        return highest if current is None else max(current, highest)
    return current


def spend_this_year(entries: list[dict[str, Any]], today: date) -> float:
    """Total spend on entries dated in the current calendar year."""
    total = 0.0
    for entry in entries:
        entry_date = parse_date(entry.get("date"))
        if entry_date and entry_date.year == today.year:
            total += entry_total_cost(entry)
    return round(total, 2)


def _int_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _int_or(value: Any, fallback: int) -> int:
    parsed = _int_or_none(value)
    return fallback if parsed is None else parsed


def _float_or(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text or None
