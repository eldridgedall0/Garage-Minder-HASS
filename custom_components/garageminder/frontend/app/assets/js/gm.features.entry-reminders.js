/**
 * GarageMinder - Entry Save with Smart Reminder Integration
 * 
 * Handles saving entries and showing smart notifications about reminders
 * Includes "Create Reminder" button for services without reminders
 * 
 * FIXED: Properly handles file uploads using the same approach as gm.features.attachments.js
 */

/**
 * Add or update entry from the main entry form
 */
async function addOrUpdateEntryFromForm() {
  if (!activeVehicleId || activeVehicleId === "all") {
    alert("Please select a specific vehicle first.");
    return;
  }
  
  const vehicle = data.vehicles.find(v => v.id === activeVehicleId);
  if (!vehicle) return;
  
  // Get form values
  const entryId = $("#entry-id").val();
  const isNew = !entryId;
  const date = $("#entry-date").val();
  const odoStr = $("#entry-odo").val();
  const odo = odoStr ? parseInt(odoStr, 10) : null;
  const miscCost = parseFloat($("#entry-cost").val()) || 0;
  const notes = $("#entry-notes").val().trim();
  
  // Validate
  if (!date) {
    alert("Please enter a date.");
    $("#entry-date").focus();
    return;
  }
  
  // Get services
  const services = getServicesFromChecklist(
    $("#service-checklist-container"),
    $("#entry-services-other").val()
  );
  
  if (!services || services.length === 0) {
    alert("Please select at least one service.");
    return;
  }
  
  // FIXED: Capture files BEFORE any async operations
  // Convert FileList to Array immediately to prevent race conditions
  const fileInput = document.getElementById("entry-files");
  const filesToUpload = fileInput && fileInput.files && fileInput.files.length > 0 
    ? Array.from(fileInput.files) 
    : [];
  const hasLocalFiles = filesToUpload.length > 0;

  // Debug logging
  console.log('[Entry] Files to upload:', filesToUpload.length);

  // Create entry object
  const now = new Date().toISOString();
  const entry = {
    id: isNew ? ("e_" + Date.now() + "_" + Math.random().toString(36).slice(2)) : entryId,
    vehicleId: activeVehicleId,
    date: date,
    odo: odo,
    services: services,
    cost: miscCost,
    notes: notes,
    attachments: [],
    createdAt: now,
    updatedAt: now
  };
  
  // If editing, preserve existing attachments and createdAt
  if (!isNew) {
    const existingEntry = data.entries.find(e => e.id === entryId);
    if (existingEntry) {
      entry.createdAt = existingEntry.createdAt || now;
      entry.attachments = existingEntry.attachments || [];
    }
  }
  
  // Add or update in data
  if (isNew) {
    data.entries.push(entry);
  } else {
    const idx = data.entries.findIndex(e => e.id === entryId);
    if (idx >= 0) {
      data.entries[idx] = entry;
    } else {
      data.entries.push(entry);
    }
  }
  
  // Update vehicle odometer if this is the most recent entry
  const allEntries = data.entries.filter(e => e.vehicleId === activeVehicleId);
  const sortedByDate = allEntries.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  if (sortedByDate[0] && sortedByDate[0].id === entry.id && odo != null) {
    vehicle.currentOdo = odo;
  }
  
  // Update reminders for each service
  resetRemindersForEntry(entry);
  
  try {
    await saveData();
  } catch (err) {
    if (err && (err.message === 'Authentication required' || err.message === 'offline_edit_blocked')) {
      showToast("Error saving entry");
      return;
    }
    console.warn('[Entry] saveData error:', err);
  }

  // Upload local files — ATTACH_MAX_COUNT (from config.php ENTRY_MAX_ATTACHMENTS,
  // resolved per-user from WP tier settings) gates the count inside uploadEntryFiles.
  if (hasLocalFiles && typeof uploadEntryFiles === 'function') {
    await uploadEntryFiles(entry.id, filesToUpload);
  }

  // Clear file input
  $("#entry-files").val("");

  // Show success notification with reminder info
  showEntrySuccessWithReminderInfo(entry, services);
  
  // Reload data from server to get updated attachments
  loadData();
  
  // Re-render
  renderDashboard();
  renderRemindersPage();
  renderDashboardRemindersSnippet();
  
  // Reset form
  renderNewEntryFormDefaults();
  initDatePickers($(document));
  $("#selected-files-preview").empty();
  
  // Check user preference for keeping form open
  if (typeof getKeepFormOpenPreference === 'function') {
    const keepOpen = getKeepFormOpenPreference();
    if (keepOpen && typeof toggleEntryForm === 'function') {
      toggleEntryForm(true);
    }
  }
}

/**
 * Check if a service has an active reminder
 */
function serviceHasReminder(vehicleId, serviceName) {
  if (!vehicleId || !serviceName) return false;
  
  return data.reminders.some(r => 
    r.vehicleId === vehicleId && 
    r.serviceName.toLowerCase() === serviceName.trim().toLowerCase()
  );
}

/**
 * Get services from entry that don't have reminders
 */
function getServicesWithoutReminders(vehicleId, services) {
  return services.filter(service => {
    const serviceName = typeof service === 'string' ? service : service.name;
    return !serviceHasReminder(vehicleId, serviceName);
  });
}

/**
 * Show success notification with smart reminder info
 */
function showEntrySuccessWithReminderInfo(entry, services) {
  const vehicle = data.vehicles.find(v => v.id === entry.vehicleId);
  if (!vehicle) {
    showToast("Entry saved successfully");
    return;
  }
  
  const unit = typeof getUnitShort === 'function' ? getUnitShort() : 'mi';
  const servicesWithReminders = [];
  const servicesWithoutReminders = [];
  
  // Categorize services
  services.forEach(service => {
    const serviceName = typeof service === 'string' ? service : service.name;
    
    if (serviceHasReminder(entry.vehicleId, serviceName)) {
      // Find the reminder
      const reminder = data.reminders.find(r => 
        r.vehicleId === entry.vehicleId && 
        r.serviceName.toLowerCase() === serviceName.toLowerCase()
      );
      
      if (reminder && typeof computeReminderDerived === 'function') {
        const derived = computeReminderDerived(reminder, vehicle.currentOdo);
        servicesWithReminders.push({
          name: serviceName,
          reminder: reminder,
          derived: derived
        });
      }
    } else {
      servicesWithoutReminders.push(serviceName);
    }
  });
  
  // Build notification HTML
  let html = `<div class="entry-success-notification">`;
  html += `<div class="entry-success-header">`;
  html += `<i class="bi bi-check-circle-fill" style="color: var(--gm-success); font-size: 1.2rem;"></i>`;
  html += `<strong>Entry saved${entry.odo ? ` at ${entry.odo.toLocaleString()} ${unit}` : ''}</strong>`;
  html += `</div>`;
  
  // Show updated reminders
  if (servicesWithReminders.length > 0) {
    html += `<div class="entry-success-reminders">`;
    servicesWithReminders.forEach(item => {
      html += `<div class="entry-success-reminder-item">`;
      html += `<span class="reminder-service-name">${item.name}</span>`;
      
      const nextInfo = [];
      if (item.derived.nextOdo) {
        nextInfo.push(`${item.derived.nextOdo.toLocaleString()} ${unit}`);
      }
      if (item.derived.nextDate && typeof formatDateNice === 'function') {
        nextInfo.push(formatDateNice(item.derived.nextDate));
      }
      
      if (nextInfo.length > 0) {
        html += `<span class="reminder-next-info">Next: ${nextInfo.join(" • ")}</span>`;
      }
      html += `</div>`;
    });
    html += `</div>`;
  }
  
  // Show "Create Reminder" buttons for services without reminders
  if (servicesWithoutReminders.length > 0) {
    html += `<div class="entry-success-no-reminders">`;
    html += `<div class="no-reminder-label">No reminders set for:</div>`;
    servicesWithoutReminders.forEach(serviceName => {
      html += `<button class="btn-create-reminder btn-ghost btn-small" data-vehicle-id="${entry.vehicleId}" data-service-name="${serviceName}">`;
      html += `<i class="bi bi-bell"></i> Create "${serviceName}" Reminder`;
      html += `</button>`;
    });
    html += `</div>`;
  }
  
  html += `</div>`;
  
  // Show custom notification with longer duration
  showCustomNotification(html, 8000); // 8 seconds
}

/**
 * Show custom HTML notification (enhanced toast)
 */
function showCustomNotification(html, duration = 5000) {
  // Remove any existing notification
  $(".custom-notification").remove();
  
  const $notification = $("<div>")
    .addClass("custom-notification")
    .html(html)
    .appendTo("body");
  
  // Fade in
  setTimeout(() => {
    $notification.addClass("show");
  }, 10);
  
  // Auto-dismiss
  setTimeout(() => {
    $notification.removeClass("show");
    setTimeout(() => {
      $notification.remove();
    }, 300);
  }, duration);
  
  // Click to dismiss
  $notification.on("click", function(e) {
    // Don't dismiss if clicking a button
    if (!$(e.target).is("button") && !$(e.target).closest("button").length) {
      $notification.removeClass("show");
      setTimeout(() => {
        $notification.remove();
      }, 300);
    }
  });
}

/**
 * Handle "Create Reminder" button click from notification
 */
$(document).on("click", ".btn-create-reminder", function() {
  const vehicleId = $(this).data("vehicle-id");
  const serviceName = $(this).data("service-name");
  
  if (!vehicleId || !serviceName) return;
  
  // Close notification
  $(".custom-notification").remove();
  
  // Navigate to reminders page (same as clicking nav button)
  $(".nav-btn").removeClass("active");
  $(".nav-btn[data-view='reminders']").addClass("active");
  $(".view").removeClass("active");
  $("#view-reminders").addClass("active");
  
  // Set active vehicle
  if (typeof setActiveVehicle === 'function') {
    setActiveVehicle(vehicleId);
  }
  
  // Re-render reminders page with new vehicle
  if (typeof renderRemindersPage === "function") {
    renderRemindersPage();
  }
  
  // Pre-fill reminder form
  setTimeout(() => {
    const $serviceSelect = $("#rem-new-service");
    const $serviceCustom = $("#rem-new-service-custom");
    
    // Check if service exists in dropdown
    const optionExists = $serviceSelect.find(`option[value="${serviceName}"]`).length > 0;
    
    if (optionExists) {
      $serviceSelect.val(serviceName).trigger("change");
    } else {
      $serviceCustom.val(serviceName).trigger("blur");
    }
    
    // Scroll to form
    const $form = $("#reminder-form");
    if ($form.length && $form[0].scrollIntoView) {
      $form[0].scrollIntoView({ behavior: "smooth", block: "center" });
    }
    
    // Highlight the form briefly
    $form.addClass("highlight-form");
    setTimeout(() => {
      $form.removeClass("highlight-form");
    }, 2000);
  }, 300);
});