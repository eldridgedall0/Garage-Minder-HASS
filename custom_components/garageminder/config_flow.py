"""Config flow for GarageMinder.

There are no credentials to collect -- the data lives in Home Assistant.
The flow exists so the integration can be added from the UI, and the
options flow is where the interesting part lives: pointing each vehicle at
an odometer source entity.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .const import (
    CONF_ODOMETER_SOURCES,
    CONF_OVERDUE_DAYS,
    CONF_OVERDUE_MILES,
    CONF_UNIT,
    CONF_UPCOMING_DAYS,
    CONF_UPCOMING_MILES,
    DEFAULT_OVERDUE_DAYS,
    DEFAULT_OVERDUE_MILES,
    DEFAULT_UNIT,
    DEFAULT_UPCOMING_DAYS,
    DEFAULT_UPCOMING_MILES,
    DOMAIN,
)


class GarageMinderConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the initial setup."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Create the single GarageMinder entry."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(
                title="GarageMinder",
                data={},
                options={
                    CONF_UNIT: user_input[CONF_UNIT],
                    CONF_UPCOMING_DAYS: DEFAULT_UPCOMING_DAYS,
                    CONF_UPCOMING_MILES: DEFAULT_UPCOMING_MILES,
                    CONF_OVERDUE_DAYS: DEFAULT_OVERDUE_DAYS,
                    CONF_OVERDUE_MILES: DEFAULT_OVERDUE_MILES,
                    CONF_ODOMETER_SOURCES: {},
                },
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_UNIT, default=DEFAULT_UNIT): SelectSelector(
                        SelectSelectorConfig(
                            options=["mi", "km"],
                            mode=SelectSelectorMode.DROPDOWN,
                        )
                    )
                }
            ),
        )

    @staticmethod
    @callback
    def async_get_options_flow(entry: ConfigEntry) -> OptionsFlow:
        """Return the options flow."""
        return GarageMinderOptionsFlow()


class GarageMinderOptionsFlow(OptionsFlow):
    """Thresholds, units, and per-vehicle odometer sources."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show and save the options."""
        options = dict(self.config_entry.options)

        if user_input is not None:
            sources = {
                key.removeprefix("odo_"): value
                for key, value in user_input.items()
                if key.startswith("odo_") and value
            }
            return self.async_create_entry(
                data={
                    CONF_UNIT: user_input[CONF_UNIT],
                    CONF_UPCOMING_DAYS: int(user_input[CONF_UPCOMING_DAYS]),
                    CONF_UPCOMING_MILES: int(user_input[CONF_UPCOMING_MILES]),
                    CONF_OVERDUE_DAYS: int(user_input[CONF_OVERDUE_DAYS]),
                    CONF_OVERDUE_MILES: int(user_input[CONF_OVERDUE_MILES]),
                    CONF_ODOMETER_SOURCES: sources,
                }
            )

        schema: dict[Any, Any] = {
            vol.Required(
                CONF_UNIT, default=options.get(CONF_UNIT, DEFAULT_UNIT)
            ): SelectSelector(
                SelectSelectorConfig(
                    options=["mi", "km"], mode=SelectSelectorMode.DROPDOWN
                )
            ),
            vol.Required(
                CONF_UPCOMING_DAYS,
                default=options.get(CONF_UPCOMING_DAYS, DEFAULT_UPCOMING_DAYS),
            ): _number(0, 365),
            vol.Required(
                CONF_UPCOMING_MILES,
                default=options.get(CONF_UPCOMING_MILES, DEFAULT_UPCOMING_MILES),
            ): _number(0, 20000),
            vol.Required(
                CONF_OVERDUE_DAYS,
                default=options.get(CONF_OVERDUE_DAYS, DEFAULT_OVERDUE_DAYS),
            ): _number(0, 365),
            vol.Required(
                CONF_OVERDUE_MILES,
                default=options.get(CONF_OVERDUE_MILES, DEFAULT_OVERDUE_MILES),
            ): _number(0, 20000),
        }

        # One optional odometer source picker per vehicle currently in the app.
        coordinator = (self.hass.data.get(DOMAIN) or {}).get(
            self.config_entry.entry_id
        )
        existing: dict[str, str] = options.get(CONF_ODOMETER_SOURCES, {}) or {}
        if coordinator and coordinator.data:
            for vehicle in coordinator.data.vehicles.values():
                key = f"odo_{vehicle.id}"
                current = existing.get(vehicle.id)
                marker = vol.Optional(key, description={"suggested_value": current})
                schema[marker] = EntitySelector(
                    EntitySelectorConfig(domain=["sensor", "number", "input_number"])
                )

        return self.async_show_form(step_id="init", data_schema=vol.Schema(schema))


def _number(minimum: int, maximum: int) -> NumberSelector:
    return NumberSelector(
        NumberSelectorConfig(
            min=minimum, max=maximum, step=1, mode=NumberSelectorMode.BOX
        )
    )
