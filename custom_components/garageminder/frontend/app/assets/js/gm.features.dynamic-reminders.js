/**
 * GarageMinder - Dynamic Reminder Auto-Fill
 * 
 * Automatically populates reminder fields based on:
 * - Most recent service entry
 * - Current vehicle odometer
 * - Interval calculations
 * 
 * Mobile-compatible with tap-enabled tooltips
 */

/**
 * Auto-fill reminder fields based on vehicle, service, and intervals
 */
function autoFillReminderFields($context, isEditMode = false) {
  // Get vehicle ID
  const vehicleId = isEditMode 
    ? activeVehicleId 
    : activeVehicleId;
  
  if (!vehicleId || vehicleId === "all") return;
  
  const vehicle = data.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return;
  
  // Get service name
  const serviceName = isEditMode
    ? $context.find(".rem-edit-service").val()?.trim()
    : ($context.find("#rem-new-service-custom").val()?.trim() || 
       $context.find("#rem-new-service").val());
  
  if (!serviceName) return;
  
  // Get intervals
  const intervalMiles = isEditMode
    ? parseInt($context.find(".rem-edit-interval-miles").val()) || null
    : parseInt($context.find("#rem-new-interval-miles").val()) || null;
  
  const intervalMonths = isEditMode
    ? parseInt($context.find(".rem-edit-interval-months").val()) || null
    : parseInt($context.find("#rem-new-interval-months").val()) || null;
  
  // Find most recent entry for this service
  const mostRecentEntry = findMostRecentEntryForService(vehicleId, serviceName);
  
  // Determine base values
  let baseOdo = null;
  let baseDate = null;
  let entrySource = null; // For tooltip
  
  if (mostRecentEntry) {
    baseOdo = mostRecentEntry.odo;
    baseDate = mostRecentEntry.date;
    entrySource = {
      date: mostRecentEntry.date,
      odo: mostRecentEntry.odo
    };
  } else {
    // No entries - use current vehicle odometer and today
    baseOdo = vehicle.currentOdo != null ? vehicle.currentOdo : null;
    baseDate = getTodayIsoInSettingsTz();
    entrySource = null; // No entry source
  }
  
  // Calculate next due values
  let nextOdo = null;
  let nextDate = null;
  
  if (intervalMiles && baseOdo != null) {
    nextOdo = baseOdo + intervalMiles;
  }
  
  if (intervalMonths && baseDate) {
    nextDate = addMonthsToDate(baseDate, intervalMonths);
  }
  
  // Update fields with auto-filled values
  const fields = isEditMode ? {
    baseOdo: $context.find(".rem-edit-base-odo"),
    baseDate: $context.find(".rem-edit-base-date"),
    nextOdo: $context.find(".rem-edit-next-odo"),
    nextDate: $context.find(".rem-edit-next-date")
  } : {
    baseOdo: $context.find("#rem-new-base-odo"),
    baseDate: $context.find("#rem-new-base-date"),
    nextOdo: $context.find("#rem-new-next-odo"),
    nextDate: $context.find("#rem-new-next-date")
  };
  
  // Set values and add/remove auto-fill indicators
  if (baseOdo != null) {
    fields.baseOdo.val(baseOdo);
    addAutoFillIndicator(fields.baseOdo, entrySource, "odo");
  } else {
    fields.baseOdo.val("");
    removeAutoFillIndicator(fields.baseOdo);
  }
  
  if (baseDate) {
    fields.baseDate.val(baseDate);
    addAutoFillIndicator(fields.baseDate, entrySource, "date");
  } else {
    fields.baseDate.val("");
    removeAutoFillIndicator(fields.baseDate);
  }
  
  if (nextOdo != null) {
    fields.nextOdo.val(nextOdo);
    addAutoFillIndicator(fields.nextOdo, null, "calculated");
  } else {
    fields.nextOdo.val("");
    removeAutoFillIndicator(fields.nextOdo);
  }
  
  if (nextDate) {
    fields.nextDate.val(nextDate);
    addAutoFillIndicator(fields.nextDate, null, "calculated");
  } else {
    fields.nextDate.val("");
    removeAutoFillIndicator(fields.nextDate);
  }
}

/**
 * Add auto-fill indicator icon with tooltip
 */
function addAutoFillIndicator($field, entrySource, type) {
  // Remove existing indicator if present
  removeAutoFillIndicator($field);
  
  // Create tooltip text
  let tooltipText = "";
  const unit = getUnitShort();
  
  if (type === "odo" && entrySource) {
    tooltipText = `Auto-filled from entry: ${formatDateNice(entrySource.date)} @ ${entrySource.odo?.toLocaleString()} ${unit}`;
  } else if (type === "date" && entrySource) {
    tooltipText = `Auto-filled from entry: ${formatDateNice(entrySource.date)}`;
  } else if (type === "calculated") {
    tooltipText = "Auto-calculated from last service + interval";
  } else if (type === "odo" && !entrySource) {
    tooltipText = "Using current vehicle odometer (no entries found)";
  } else if (type === "date" && !entrySource) {
    tooltipText = "Using today's date (no entries found)";
  }
  
  if (!tooltipText) return;
  
  // Mark field as auto-filled (for detecting manual edits)
  $field.data("auto-filled", true);
  
  // Create indicator container
  const $indicator = $("<div>")
    .addClass("reminder-autofill-indicator")
    .attr("data-tooltip", tooltipText);
  
  // Add icon
  const $icon = $("<span>")
    .addClass("reminder-autofill-icon")
    .html("&#9432;"); // ℹ️ info icon
  
  $indicator.append($icon);
  
  // Insert after the field's parent (.field div)
  const $fieldContainer = $field.closest(".field");
  $fieldContainer.css("position", "relative");
  $fieldContainer.append($indicator);
  
  // Desktop: hover to show tooltip
  // Mobile: tap to toggle tooltip
  let tooltipVisible = false;
  
  $indicator.on("click", function(e) {
    e.preventDefault();
    e.stopPropagation();
    toggleTooltip($indicator, tooltipText);
    tooltipVisible = !tooltipVisible;
  });
  
  // Hide tooltip when clicking outside (mobile)
  $(document).on("click.autofill-tooltip", function(e) {
    if (!$(e.target).closest(".reminder-autofill-indicator").length) {
      hideAllTooltips();
    }
  });
}

/**
 * Remove auto-fill indicator
 */
function removeAutoFillIndicator($field) {
  $field.data("auto-filled", false);
  const $fieldContainer = $field.closest(".field");
  $fieldContainer.find(".reminder-autofill-indicator").remove();
}

/**
 * Toggle tooltip visibility (mobile)
 */
function toggleTooltip($indicator, text) {
  const $existing = $indicator.find(".reminder-autofill-tooltip");
  
  if ($existing.length) {
    $existing.remove();
  } else {
    hideAllTooltips(); // Hide other tooltips first
    
    const $tooltip = $("<div>")
      .addClass("reminder-autofill-tooltip")
      .text(text);
    
    $indicator.append($tooltip);
    
    // Position tooltip (above the icon)
    setTimeout(() => {
      $tooltip.addClass("show");
    }, 10);
  }
}

/**
 * Hide all tooltips
 */
function hideAllTooltips() {
  $(".reminder-autofill-tooltip").remove();
}

/**
 * Initialize auto-fill for new reminder form
 */
function initNewReminderAutoFill() {
  const $form = $("#reminder-form");
  
  // Trigger auto-fill on blur/change of relevant fields
  $form.find("#rem-new-service, #rem-new-service-custom, #rem-new-interval-miles, #rem-new-interval-months").on("blur change", function() {
    autoFillReminderFields($form, false);
  });
  
  // Remove indicator when user manually edits an auto-filled field
  $form.find("#rem-new-base-odo, #rem-new-base-date, #rem-new-next-odo, #rem-new-next-date").on("input", function() {
    const $field = $(this);
    if ($field.data("auto-filled")) {
      removeAutoFillIndicator($field);
    }
  });
}

/**
 * Initialize auto-fill for reminder edit mode
 */
function initReminderEditAutoFill($card) {
  // Trigger auto-fill on blur/change of relevant fields
  $card.find(".rem-edit-service, .rem-edit-interval-miles, .rem-edit-interval-months").on("blur change", function() {
    autoFillReminderFields($card, true);
  });
  
  // Remove indicator when user manually edits an auto-filled field
  $card.find(".rem-edit-base-odo, .rem-edit-base-date, .rem-edit-next-odo, .rem-edit-next-date").on("input", function() {
    const $field = $(this);
    if ($field.data("auto-filled")) {
      removeAutoFillIndicator($field);
    }
  });
}
