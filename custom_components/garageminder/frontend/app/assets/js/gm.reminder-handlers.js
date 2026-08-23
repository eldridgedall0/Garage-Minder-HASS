/**
 * GarageMinder - Updated Reminder Handlers
 * 
 * This file contains updated/new functions for reminder management
 * with dynamic auto-fill support.
 * 
 * Add to index.php AFTER gm.features.dynamic-reminders.js
 * and BEFORE gm.handlers.js
 */

/**
 * Add a new reminder from the form
 */
function addReminderFromForm() {
  if (!activeVehicleId || activeVehicleId === "all") {
    alert("Please select a specific vehicle first.");
    return;
  }
  
  // Get service name (from select or custom input)
  let serviceName = $("#rem-new-service-custom").val().trim();
  if (!serviceName) {
    serviceName = $("#rem-new-service").val();
  }
  
  if (!serviceName) {
    alert("Please enter or select a service name.");
    return;
  }
  
  // Get intervals
  const intervalMilesStr = $("#rem-new-interval-miles").val();
  const intervalMonthsStr = $("#rem-new-interval-months").val();
  const intervalMiles = intervalMilesStr ? parseInt(intervalMilesStr, 10) : null;
  const intervalMonths = intervalMonthsStr ? parseInt(intervalMonthsStr, 10) : null;
  
  if (!intervalMiles && !intervalMonths) {
    alert("Please enter at least one interval (mileage or months).");
    return;
  }
  
  // Get base values (auto-filled or manually entered)
  const baseOdoStr = $("#rem-new-base-odo").val();
  const baseOdo = baseOdoStr ? parseInt(baseOdoStr, 10) : null;
  const baseDate = $("#rem-new-base-date").val() || null;
  
  // Get next due values (auto-calculated or manually entered)
  const nextOdoStr = $("#rem-new-next-odo").val();
  const nextOdo = nextOdoStr ? parseInt(nextOdoStr, 10) : null;
  const nextDate = $("#rem-new-next-date").val() || null;
  
  // Get notes
  const notes = $("#rem-new-notes").val().trim();
  
  // Create reminder object
  const now = new Date().toISOString();
  const reminder = {
    id: "r_" + Date.now() + "_" + Math.random().toString(36).slice(2),
    vehicleId: activeVehicleId,
    serviceName: serviceName,
    intervalMiles: intervalMiles,
    intervalMonths: intervalMonths,
    baseOdo: baseOdo,
    baseDate: baseDate,
    nextOdo: nextOdo,
    nextDate: nextDate,
    notes: notes,
    createdAt: now,
    updatedAt: now
  };
  
  // Add to data
  data.reminders.push(reminder);
  
  // Save and re-render
  saveData();
  renderRemindersPage();
  renderDashboardRemindersSnippet();
  
  // Clear form
  $("#rem-new-service").val("");
  $("#rem-new-service-custom").val("");
  $("#rem-new-interval-miles").val("");
  $("#rem-new-interval-months").val("");
  $("#rem-new-base-odo").val("");
  $("#rem-new-base-date").val("");
  $("#rem-new-next-odo").val("");
  $("#rem-new-next-date").val("");
  $("#rem-new-notes").val("");
  
  // Remove any auto-fill indicators
  $("#reminder-form .field").find(".reminder-autofill-indicator").remove();
  
  showToast("Reminder added successfully");
}

/**
 * Save changes to a reminder from edit mode
 */
function saveReminderFromCard($card) {
  const remId = $card.attr("data-id");
  if (!remId) return;
  
  const rem = data.reminders.find(r => r.id === remId);
  if (!rem) return;
  
  // Get updated values
  const serviceName = $card.find(".rem-edit-service").val().trim();
  if (!serviceName) {
    alert("Service name is required.");
    return;
  }
  
  const intervalMilesStr = $card.find(".rem-edit-interval-miles").val();
  const intervalMonthsStr = $card.find(".rem-edit-interval-months").val();
  const intervalMiles = intervalMilesStr ? parseInt(intervalMilesStr, 10) : null;
  const intervalMonths = intervalMonthsStr ? parseInt(intervalMonthsStr, 10) : null;
  
  if (!intervalMiles && !intervalMonths) {
    alert("Please enter at least one interval (mileage or months).");
    return;
  }
  
  const baseOdoStr = $card.find(".rem-edit-base-odo").val();
  const baseOdo = baseOdoStr ? parseInt(baseOdoStr, 10) : null;
  const baseDate = $card.find(".rem-edit-base-date").val() || null;
  
  const nextOdoStr = $card.find(".rem-edit-next-odo").val();
  const nextOdo = nextOdoStr ? parseInt(nextOdoStr, 10) : null;
  const nextDate = $card.find(".rem-edit-next-date").val() || null;
  
  const notes = $card.find(".rem-edit-notes").val().trim();
  
  // Update reminder
  rem.serviceName = serviceName;
  rem.intervalMiles = intervalMiles;
  rem.intervalMonths = intervalMonths;
  rem.baseOdo = baseOdo;
  rem.baseDate = baseDate;
  rem.nextOdo = nextOdo;
  rem.nextDate = nextDate;
  rem.notes = notes;
  rem.updatedAt = new Date().toISOString();
  
  // Save and re-render
  saveData();
  renderRemindersPage();
  renderDashboardRemindersSnippet();
  
  showToast("Reminder updated successfully");
}

/**
 * Delete a reminder
 */
function deleteReminderFromCard($card) {
  const remId = $card.attr("data-id");
  if (!remId) return;
  
  const rem = data.reminders.find(r => r.id === remId);
  if (!rem) return;
  
  if (!confirm(`Delete reminder for "${rem.serviceName}"?`)) return;
  
  // Remove from data
  data.reminders = data.reminders.filter(r => r.id !== remId);
  
  // Save and re-render
  saveData();
  renderRemindersPage();
  renderDashboardRemindersSnippet();
  
  showToast("Reminder deleted");
}

/**
 * Open Google Calendar reminder
 */
function openGoogleReminderFromCard($card) {
  const remId = $card.attr("data-id");
  if (!remId) return;
  
  const rem = data.reminders.find(r => r.id === remId);
  if (!rem) return;
  
  if (!rem.nextDate) {
    alert("No next due date set for this reminder.");
    return;
  }
  
  const serviceName = rem.serviceName || "Service Reminder";
  const vehicle = data.vehicles.find(v => v.id === rem.vehicleId);
  const vehicleName = vehicle ? vehicle.name : "Vehicle";
  
  let details = `${serviceName} for ${vehicleName}`;
  if (rem.nextOdo) {
    const unit = getUnitShort();
    details += `\nNext due: ${rem.nextOdo.toLocaleString()} ${unit}`;
  }
  if (rem.notes) {
    details += `\nNotes: ${rem.notes}`;
  }
  
  const url = "https://calendar.google.com/calendar/render?action=TEMPLATE"
    + "&text=" + encodeURIComponent(serviceName + " - " + vehicleName)
    + "&dates=" + encodeURIComponent(rem.nextDate.replace(/-/g, "")) + "/" + encodeURIComponent(rem.nextDate.replace(/-/g, ""))
    + "&details=" + encodeURIComponent(details);
  
  window.open(url, "_blank");
}
