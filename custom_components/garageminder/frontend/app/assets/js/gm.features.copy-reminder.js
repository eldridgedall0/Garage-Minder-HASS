/**
 * GarageMinder - Copy Reminder Modal with Dynamic Auto-Fill & Duplicate Detection
 * 
 * Modal-based reminder copying with automatic recalculation
 * for the target vehicle based on its service history.
 * Includes duplicate detection and replacement functionality.
 */

let currentCopyReminder = null;
let existingDuplicateReminder = null; // Track if target has duplicate

/**
 * Check if target vehicle already has a reminder for this service
 */
function checkForDuplicateReminder(targetVehicleId, serviceName) {
  if (!targetVehicleId || !serviceName) return null;
  
  // Case-insensitive search for existing reminder
  const duplicate = data.reminders.find(r => 
    r.vehicleId === targetVehicleId && 
    r.serviceName.toLowerCase() === serviceName.toLowerCase()
  );
  
  return duplicate || null;
}

/**
 * Show or hide duplicate warning
 */
function updateDuplicateWarning(isDuplicate, targetVehicleName, serviceName) {
  const $warning = $("#copy-duplicate-warning");
  const $message = $("#copy-duplicate-message");
  const $confirmBtn = $("#copy-reminder-confirm");
  
  if (isDuplicate) {
    // Show warning
    $message.text(`${targetVehicleName} already has a reminder for "${serviceName}". This will replace the existing reminder.`);
    $warning.slideDown(200);
    
    // Change button text
    $confirmBtn.text("Replace Existing Reminder");
  } else {
    // Hide warning
    $warning.slideUp(200);
    
    // Reset button text
    $confirmBtn.text("Copy Reminder");
  }
}

/**
 * Open copy reminder modal
 */
function copyReminderFromCard($card) {
  const remId = $card.attr("data-id");
  if (!remId) return;
  
  const rem = data.reminders.find(r => r.id === remId);
  if (!rem) return;
  
  currentCopyReminder = rem;
  existingDuplicateReminder = null; // Reset
  
  // Get source vehicle name
  const sourceVehicle = data.vehicles.find(v => v.id === rem.vehicleId);
  const sourceVehicleName = sourceVehicle ? sourceVehicle.name : "Unknown Vehicle";
  
  // Populate modal
  $("#copy-source-vehicle").text(sourceVehicleName);
  $("#copy-source-service").text(rem.serviceName || "Reminder");
  
  // Populate target vehicle dropdown (exclude current vehicle)
  const $targetSelect = $("#copy-target-vehicle");
  $targetSelect.empty().append('<option value="">-- Select vehicle --</option>');
  
  data.vehicles.forEach(v => {
    if (v.id !== rem.vehicleId) {
      $targetSelect.append(
        $("<option>").val(v.id).text(v.name)
      );
    }
  });
  
  // Set read-only fields
  $("#copy-service-name").val(rem.serviceName || "");
  $("#copy-interval-miles").val(rem.intervalMiles != null ? rem.intervalMiles : "");
  $("#copy-interval-months").val(rem.intervalMonths != null ? rem.intervalMonths : "");
  $("#copy-notes").val(rem.notes || "");
  
  // Clear editable fields
  $("#copy-base-odo").val("");
  $("#copy-base-date").val("");
  $("#copy-next-odo").val("");
  $("#copy-next-date").val("");
  
  // Hide fields section and warning initially
  $("#copy-reminder-fields").hide();
  $("#copy-duplicate-warning").hide();
  $("#copy-reminder-confirm").prop("disabled", true).text("Copy Reminder");
  
  // Remove any existing auto-fill indicators
  $("#copy-reminder-modal .field").find(".reminder-autofill-indicator").remove();
  
  // Show modal
  $("#copy-reminder-modal").fadeIn(200);
  
  // Initialize date pickers for the modal fields
  initDatePickers($("#copy-reminder-modal"));
}

/**
 * Close copy reminder modal
 */
function closeCopyReminderModal() {
  $("#copy-reminder-modal").fadeOut(200);
  currentCopyReminder = null;
  existingDuplicateReminder = null;
  
  // Clear form
  $("#copy-target-vehicle").val("");
  $("#copy-base-odo").val("");
  $("#copy-base-date").val("");
  $("#copy-next-odo").val("");
  $("#copy-next-date").val("");
  $("#copy-notes").val("");
  $("#copy-duplicate-warning").hide();
  
  // Remove auto-fill indicators
  $("#copy-reminder-modal .field").find(".reminder-autofill-indicator").remove();
}

/**
 * Auto-fill copy reminder fields when target vehicle is selected
 */
function autoFillCopyReminderFields() {
  const targetVehicleId = $("#copy-target-vehicle").val();
  
  if (!targetVehicleId || !currentCopyReminder) {
    $("#copy-reminder-fields").hide();
    $("#copy-duplicate-warning").hide();
    $("#copy-reminder-confirm").prop("disabled", true);
    existingDuplicateReminder = null;
    return;
  }
  
  // Show fields section
  $("#copy-reminder-fields").slideDown(200);
  $("#copy-reminder-confirm").prop("disabled", false);
  
  const targetVehicle = data.vehicles.find(v => v.id === targetVehicleId);
  if (!targetVehicle) return;
  
  const serviceName = currentCopyReminder.serviceName;
  const intervalMiles = currentCopyReminder.intervalMiles;
  const intervalMonths = currentCopyReminder.intervalMonths;
  
  // Check for duplicate reminder
  existingDuplicateReminder = checkForDuplicateReminder(targetVehicleId, serviceName);
  updateDuplicateWarning(!!existingDuplicateReminder, targetVehicle.name, serviceName);
  
  // Find most recent entry for this service on target vehicle
  const mostRecentEntry = findMostRecentEntryForService(targetVehicleId, serviceName);
  
  // Determine base values
  let baseOdo = null;
  let baseDate = null;
  let entrySource = null;
  
  if (mostRecentEntry) {
    baseOdo = mostRecentEntry.odo;
    baseDate = mostRecentEntry.date;
    entrySource = {
      date: mostRecentEntry.date,
      odo: mostRecentEntry.odo
    };
  } else {
    // No entries - use current vehicle odometer and today
    baseOdo = targetVehicle.currentOdo != null ? targetVehicle.currentOdo : null;
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
  
  // Get field references
  const fields = {
    baseOdo: $("#copy-base-odo"),
    baseDate: $("#copy-base-date"),
    nextOdo: $("#copy-next-odo"),
    nextDate: $("#copy-next-date")
  };
  
  // Set values and add auto-fill indicators
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
 * Confirm copy reminder to target vehicle
 */
function confirmCopyReminder() {
  const targetVehicleId = $("#copy-target-vehicle").val();
  
  if (!targetVehicleId || !currentCopyReminder) {
    alert("Please select a target vehicle.");
    return;
  }
  
  const targetVehicle = data.vehicles.find(v => v.id === targetVehicleId);
  if (!targetVehicle) return;
  
  // Get values from modal (auto-filled or manually edited)
  const baseOdoStr = $("#copy-base-odo").val();
  const baseOdo = baseOdoStr ? parseInt(baseOdoStr, 10) : null;
  const baseDate = $("#copy-base-date").val() || null;
  
  const nextOdoStr = $("#copy-next-odo").val();
  const nextOdo = nextOdoStr ? parseInt(nextOdoStr, 10) : null;
  const nextDate = $("#copy-next-date").val() || null;
  
  const notes = $("#copy-notes").val().trim();
  
  // If duplicate exists, delete it first
  if (existingDuplicateReminder) {
    console.log("Deleting existing duplicate reminder:", existingDuplicateReminder.id);
    data.reminders = data.reminders.filter(r => r.id !== existingDuplicateReminder.id);
  }
  
  // Create new reminder for target vehicle
  const now = new Date().toISOString();
  const newReminder = {
    id: "r_" + Date.now() + "_" + Math.random().toString(36).slice(2),
    vehicleId: targetVehicleId,
    serviceName: currentCopyReminder.serviceName,
    intervalMiles: currentCopyReminder.intervalMiles,
    intervalMonths: currentCopyReminder.intervalMonths,
    baseOdo: baseOdo,
    baseDate: baseDate,
    nextOdo: nextOdo,
    nextDate: nextDate,
    notes: notes,
    createdAt: now,
    updatedAt: now
  };
  
  // Add to data
  data.reminders.push(newReminder);
  
  // Save and re-render
  saveData();
  renderRemindersPage();
  renderDashboardRemindersSnippet();
  
  // Close modal
  closeCopyReminderModal();
  
  // Show success message
  const action = existingDuplicateReminder ? "replaced on" : "copied to";
  showToast(`Reminder ${action} ${targetVehicle.name}`);
}

/**
 * Initialize copy reminder modal event handlers
 */
function initCopyReminderModal() {
  // Close modal buttons
  $("#copy-reminder-close, #copy-reminder-cancel").on("click", function() {
    closeCopyReminderModal();
  });
  
  // Close modal when clicking overlay
  $("#copy-reminder-modal").on("click", function(e) {
    if ($(e.target).is("#copy-reminder-modal")) {
      closeCopyReminderModal();
    }
  });
  
  // Target vehicle selection change
  $("#copy-target-vehicle").on("change", function() {
    autoFillCopyReminderFields();
  });
  
  // Confirm button
  $("#copy-reminder-confirm").on("click", function() {
    confirmCopyReminder();
  });
  
  // Remove auto-fill indicator when user manually edits
  $("#copy-base-odo, #copy-base-date, #copy-next-odo, #copy-next-date").on("input", function() {
    const $field = $(this);
    if ($field.data("auto-filled")) {
      removeAutoFillIndicator($field);
    }
  });
  
  // ESC key to close modal
  $(document).on("keydown", function(e) {
    if (e.key === "Escape" && $("#copy-reminder-modal").is(":visible")) {
      closeCopyReminderModal();
    }
  });
}

// Initialize on document ready
$(document).ready(function() {
  initCopyReminderModal();
});
