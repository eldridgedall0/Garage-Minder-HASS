/**
 * Garage Maintenance - Event Handlers
 * Updated with "All Vehicles" support and renewal date sync
 */

$(function() {
  loadData();
  setActiveVehicleFromStorageOrDefault();
  applyThemeFromSettings();
  applySiteTitle();
  updateUnitLabels();
  renderVehiclePicker();
  
  // Initialize templates feature (after data is loaded)
  if (typeof initTemplatesFeature === "function") {
    initTemplatesFeature();
  }
  
  // Initialize router (will handle initial rendering based on URL)
  if (typeof initRouter === "function") {
    initRouter();
  } else {
    // Fallback if router not loaded
    console.warn("Router not loaded, using fallback rendering");
    renderDashboard();
    renderSettings();
    renderReminderServiceSelect();
    renderRemindersPage();
    renderNewEntryFormDefaults();
  }
  
  // Apply subscription UI gates after everything is rendered
  if (typeof gmSubUpdateUI === "function") {
    gmSubUpdateUI();
  }
  
  initDatePickers($(document));
  
  if (activeVehicleId && activeVehicleId !== "all") {
    updateSafetyStatus();
    autoCheckRecallsOnLoad();
  }
  
  // Check recalls button
  $("#check-recalls-btn").on("click", function(e) {
    e.preventDefault();

    // ── Subscription: gate recalls behind feature flag ───────────────────
    if (typeof gmSub !== 'undefined' && !gmSub.can('recalls')) {
      showUpgradeModal({
        title: 'Recall Checking Requires an Upgrade',
        message: `Vehicle recall checking is not available on the ${gmSub.tierName()} plan. Upgrade to enable this feature.`,
        feature: 'recalls',
      });
      return;
    }

    checkVehicleRecalls();
  });
  
  // Close recall modal
  $("#close-recall-modal, .recall-modal-overlay").on("click", function() {
    $("#recall-modal").fadeOut(200);
  });
  
  // Prevent modal close when clicking inside content
  $(".recall-modal-content").on("click", function(e) {
    e.stopPropagation();
  });
  
  // ============================================
  // BACKUP HANDLERS
  // ============================================
  
  // Full backup - Download JSON with data + embedded attachments
  $("#backup-export-full").on("click", async function() {
    // No tier restriction on full backup

    const $btn = $(this);
    const originalText = $btn.html();
    
    try {
      $btn.prop("disabled", true).html("⏳ Creating backup...");
      
      const checkResponse = await fetch('backup-create.php?t=' + Date.now());
      const checkResult = await checkResponse.json();
      
      if (!checkResult.success) {
        throw new Error(checkResult.message || 'Backup creation failed');
      }
      
      $btn.html("⏳ Downloading...");
      
      const downloadUrl = 'backup-create.php?download=1&t=' + Date.now();
      
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'garage_maintenance_backup_' + new Date().toISOString().split('T')[0] + '.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      let message = "✓ Backup downloaded! (" + checkResult.size_formatted + ")";
      if (checkResult.attachment_count > 0) {
        message = "✓ Backup: " + checkResult.size_formatted + ", " + checkResult.attachment_count + " attachments";
      }
      showToast(message);
      
      if (checkResult.warnings && checkResult.warnings.length > 0) {
        console.warn("Backup warnings:", checkResult.warnings);
      }
      
    } catch (error) {
      console.error("Backup error:", error);
      alert("❌ Backup failed:\n\n" + error.message);
    } finally {
      $btn.prop("disabled", false).html(originalText);
    }
  });
  
  // Full restore - Upload JSON and restore everything
  $("#backup-import-full").on("change", async function() {
    const file = this.files[0];
    if (!file) return;
    
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (ext !== 'json') {
      alert("Please select a .json backup file.");
      this.value = "";
      return;
    }
    
    const confirmMsg = "⚠  RESTORE FROM BACKUP\n\n" +
      "This will:\n" +
      "• Delete ALL current data and attachments\n" +
      "• Replace with data from the backup file\n" +
      "• Cannot be undone!\n\n" +
      "Make sure you have a current backup before proceeding.\n\n" +
      "Continue with restore?";
    
    if (!confirm(confirmMsg)) {
      this.value = "";
      return;
    }
    
    const $overlay = $("<div>")
      .css({
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        flexDirection: "column",
        gap: "20px"
      })
      .append(
        $("<div>").css({
          fontSize: "1.5rem",
          color: "#fff",
          fontWeight: "600"
        }).text("Restoring backup..."),
        $("<div>").css({
          fontSize: "1rem",
          color: "#ccc"
        }).text("Please wait, this may take a moment")
      );
    
    $("body").append($overlay);
    
    try {
      const formData = new FormData();
      formData.append('backup_file', file);
      
      const response = await fetch('restore-full.php', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (result.success) {
        if (result.data) {
          data = result.data;
          setActiveVehicleFromStorageOrDefault();
        } else {
          loadData();
        }
        
        applyThemeFromSettings();
        applySiteTitle();
        updateUnitLabels();
        renderDashboard();
        renderSettings();
        renderReminderServiceSelect();
        renderRemindersPage();
        
        $overlay.remove();
        
        let successMsg = "✓ Backup restored successfully!";
        if (result.attachments_restored && result.attachments_restored > 0) {
          successMsg += "\n\n" + result.attachments_restored + " attachment(s) restored.";
        }
        if (result.attachments_errors && result.attachments_errors.length > 0) {
          successMsg += "\n\n⚠  " + result.attachments_errors.length + " attachment(s) had issues.";
        }
        
        alert(successMsg);
      } else {
        $overlay.remove();
        alert("❌ Restore failed:\n\n" + (result.message || "Unknown error"));
      }
      
    } catch (error) {
      console.error("Restore error:", error);
      $overlay.remove();
      alert("❌ Restore failed:\n\n" + error.message);
    }
    
    this.value = "";
  });
  
  // ============================================
  // ENTRY FORM HANDLERS
  // ============================================
  
  // Toggle entry form button
  $("#toggle-entry-form").on("click", function() {
    toggleEntryForm();
  });

  // Keep form open preference checkbox
  $("#keep-form-open-pref").on("change", function() {
    const checked = $(this).is(":checked");
    setKeepFormOpenPreference(checked);
    showToast(checked ? "Form will stay open after adding entries" : "Form will close after adding entries");
  });

  // ============================================
  // ATTACHMENT BUTTON HANDLERS
  // ============================================
  
  // Local upload button - triggers hidden file input
  $("#btn-local-attach").on("click", function(e) {
    e.preventDefault();
    $("#entry-files").click();
  });
  
  // File input change - show selected files as feedback
  $("#entry-files").on("change", function() {
    const files = this.files;
    const $preview = $("#selected-files-preview");
    
    $preview.empty();
    if (files && files.length > 0) {
      const $list = $("<div>").css({"padding": "8px", "background": "var(--gm-bg-subtle)", "border-radius": "4px"});
      $list.append($("<div>").css({"font-weight": "500", "margin-bottom": "4px"}).text(`${files.length} file(s) selected (will upload on save):`));
      for (let i = 0; i < files.length; i++) {
        const size = (files[i].size / 1024).toFixed(1);
        const $fileRow = $("<div>").css({"color": "var(--gm-text-secondary)", "display": "flex", "align-items": "center", "gap": "8px"});
        $fileRow.append(
          $("<span>").html(`<i class="bi bi-file-earmark"></i> ${files[i].name} <span class="text-muted">(${size} KB)</span>`)
        );
        $list.append($fileRow);
      }
      $preview.append($list);
    }
  });
  
  // Google Drive button - opens Google Drive picker
  $("#btn-gdrive-attach").on("click", function(e) {
    e.preventDefault();
    if (typeof GDrive !== 'undefined' && GDrive.openPicker) {
      const entryId = $("#entry-id").val() || null;
      GDrive.openPicker(entryId, function(files, eId) {
        if (typeof window.attachGoogleDriveFiles === 'function') {
          window.attachGoogleDriveFiles(files, eId);
        } else {
          showToast('Google Drive attachment handler not available');
        }
      });
    } else {
      showToast('Google Drive is not configured. Please set up Google Drive integration.');
    }
  });

  if (document.getElementById("entry-attach-limit-text")) {
    document.getElementById("entry-attach-limit-text").textContent = getAttachmentHelpText();
  }

  // ============================================
  // NAVIGATION HANDLERS (Router-Integrated)
  // ============================================
  
  $(".nav-btn").on("click", function() {
    const view = $(this).data("view");
    
    // FIX Issue #12: Reset entry form button state when navigating away from dashboard
    if (view !== "dashboard") {
      // Hide the form and reset button to closed state
      $("#dashboard-entry-form").hide();
      if (typeof resetEntryFormButton === "function") {
        resetEntryFormButton();
      } else {
        // Fallback if function not available
        const $btn = $("#toggle-entry-form");
        $btn.removeClass("form-open");
        $btn.find("span:first").text("+");
        $btn.contents().filter(function() { return this.nodeType === 3; }).last().replaceWith(" Add New Service Entry");
      }
    }
    
    // Use router for navigation (updates URL + renders view)
    if (typeof navigateTo === "function") {
      navigateTo(view);
    } else {
      // Fallback if router not loaded
      $(".nav-btn").removeClass("active");
      $(this).addClass("active");
      $(".view").removeClass("active");
      $("#view-" + view).addClass("active");
      
      if (view === "dashboard") {
        renderDashboard();
      } else if (view === "reminders") {
        renderRemindersPage();
      } else if (view === "settings") {
        renderSettings();
      }
    }
  });

  $(".settings-tab-btn").on("click", function() {
    const tab = $(this).data("tab");
    
    // Use router for navigation (updates URL + renders tab)
    if (typeof navigateTo === "function") {
      navigateTo('settings', null, tab);
    } else {
      // Fallback if router not loaded
      $(".settings-tab-btn").removeClass("active");
      $(this).addClass("active");
      $(".settings-tab-view").removeClass("active");
      $("#settings-tab-" + tab).addClass("active");
      
      if (tab === "intervals") {
        renderSettingsIntervals();
      }
    }
  });

  // ============================================
  // VEHICLE PICKER HANDLER (Router-Integrated)
  // ============================================
  
  $("#active-vehicle").on("change", function() {
    dashboardHistoryPage = 1;
    const selectedValue = $(this).val();
    
    // Always use setActiveVehicle to ensure saveData() is called
    setActiveVehicle(selectedValue);
    
    // Use router to navigate with new vehicle context
    if (typeof navigateTo === "function" && typeof getCurrentRoute === "function") {
      const currentRoute = getCurrentRoute();
      navigateTo(currentRoute.view, selectedValue, currentRoute.subview);
    } else {
      // Fallback if router not loaded
      renderDashboard();
      renderRemindersPage();
      
      // Update safety status only for specific vehicles
      if (activeVehicleId && activeVehicleId !== "all") {
        updateSafetyStatus();
      }
    }
  });

  // ============================================
  // ENTRY FORM HANDLERS
  // ============================================
  
  $("#entry-form").on("submit", async function(e) {
    e.preventDefault();
    await addOrUpdateEntryFromForm();
  });

  $("#entry-reset").on("click", function() {
    renderNewEntryFormDefaults();
    initDatePickers($(document));
    // Clear file preview
    $("#selected-files-preview").empty();
  });

  $("#service-checklist-container").on("change", "input[type='checkbox']", function() {
    autoFillNextOdoFromIntervals();
  });
  
  $("#entry-odo").on("change blur", function() {
    autoFillNextOdoFromIntervals();
  });
  
  $("#entry-services-other").on("change blur", function() {
    autoFillNextOdoFromIntervals();
  });

  // ============================================
  // ENTRY LIST HANDLERS
  // ============================================
  
  // Toggle expand/collapse
  $("#entry-list").on("click", ".entry-header", function(e) {
    const $card = $(this).closest(".entry-card");
    const $body = $card.find(".entry-body");
    const open = $body.is(":visible");
    
    $(".entry-body").slideUp(120);
    $(".entry-toggle").html('Tap to expand <i class="bi bi-chevron-down"></i>');
    $(".entry-card").removeClass("expanded");
    
    $(".entry-view-mode").show();
    $(".entry-edit-mode").hide();
    
    if (!open) {
      $body.slideDown(120);
      $card.find(".entry-toggle").html('Tap to collapse <i class="bi bi-chevron-up"></i>');
      $card.addClass("expanded");
    }
  });

  // Switch to edit mode
  $("#entry-list").on("click", ".entry-btn-edit", function(e) {
    e.stopPropagation();
    const $card = $(this).closest(".entry-card");
    $card.find(".entry-view-mode").hide();
    $card.find(".entry-edit-mode").show();
    initDatePickers($card.find(".entry-edit-mode"));
  });

  // Cancel edit mode
  $("#entry-list").on("click", ".entry-btn-cancel", function(e) {
    e.stopPropagation();
    const $card = $(this).closest(".entry-card");
    $card.find(".entry-edit-mode").hide();
    $card.find(".entry-view-mode").show();
  });

  // Save changes
  $("#entry-list").on("click", ".entry-btn-save", async function(e) {
    e.stopPropagation();
    const $card = $(this).closest(".entry-card");
    await saveEntryFromAccordion($card);
    
    $card.find(".entry-body").slideUp(120);
    $card.find(".entry-toggle").html('Tap to expand <i class="bi bi-chevron-down"></i>');
    $card.find(".entry-edit-mode").hide();
    $card.find(".entry-view-mode").show();
  });

  // Delete entry
  $("#entry-list").on("click", ".entry-btn-delete", function(e) {
    e.stopPropagation();
    const $card = $(this).closest(".entry-card");
    deleteEntryByCard($card);
  });

  // Delete attachment
  $("#entry-list").on("click", ".entry-attach-delete", async function(e) {
    e.preventDefault();
    e.stopPropagation();
    const $btn = $(this);
    const attId = $btn.attr("data-att-id");
    
    console.log("Delete attachment clicked, attId:", attId);
    
    if (!attId) {
      showToast("Error: No attachment ID");
      return;
    }
    
    if (!confirm("Delete this attachment?")) return;
    
    try {
      $btn.prop("disabled", true).text("Deleting...");
      
      const formData = new FormData();
      formData.append('attachment_id', attId);
      
      const response = await fetch('delete-attachment.php', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      console.log("Delete result:", result);
      
      if (result.success) {
        showToast("Attachment deleted");
        await loadData();
        renderDashboard();
        renderRemindersPage();
      } else {
        showToast("Delete failed: " + (result.message || "Unknown error"));
        $btn.prop("disabled", false).html('<i class="bi bi-trash"></i> Delete');
      }
    } catch (error) {
      console.error("Delete error:", error);
      showToast("Delete failed: " + error.message);
      $btn.prop("disabled", false).html('<i class="bi bi-trash"></i> Delete');
    }
  });

  // Download attachment
  $("#entry-list").on("click", ".entry-attach-download", function(e) {
    e.stopPropagation();
    const $btn = $(this);
    const attId = $btn.attr("data-att-id");
    
    if (!attId) {
      showToast("Error: No attachment ID");
      return;
    }
    
    gmResolveDownload({ id: attId }).then(function (downloadUrl) {
      if (!downloadUrl) { showToast("Attachment not found"); return; }
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = '';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  });

  // ============================================
  // SETTINGS HANDLERS
  // ============================================
  
  $("#settings-general-save").on("click", function() {
    const title = $("#settings-site-title").val().trim() || DEFAULT_SETTINGS.siteTitle;
    const unit = $("#settings-unit").val() || "mi";
    const timezone = $("#settings-timezone").val() || "";
    
    const upcomingDays = $("#settings-upcoming-days").val();
    const upcomingMiles = $("#settings-upcoming-miles").val();
    const overdueDays = $("#settings-overdue-days").val();
    const overdueMiles = $("#settings-overdue-miles").val();
    const avgDailyMiles = $("#settings-avg-daily-miles").val();
    const overviewVehiclesPerPage = $("#settings-overview-vehicles-per-page").val();

    if (!data.settings) data.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

    data.settings.siteTitle = title;
    data.settings.unit = unit;
    data.settings.timezone = timezone;
    
    data.settings.upcomingThresholdDays = upcomingDays !== "" ? Number(upcomingDays) : DEFAULT_SETTINGS.upcomingThresholdDays;
    data.settings.upcomingThresholdMiles = upcomingMiles !== "" ? Number(upcomingMiles) : DEFAULT_SETTINGS.upcomingThresholdMiles;
    data.settings.overdueThresholdDays = overdueDays !== "" ? Number(overdueDays) : DEFAULT_SETTINGS.overdueThresholdDays;
    data.settings.overdueThresholdMiles = overdueMiles !== "" ? Number(overdueMiles) : DEFAULT_SETTINGS.overdueThresholdMiles;
    data.settings.avgDailyMiles = avgDailyMiles !== "" ? Number(avgDailyMiles) : DEFAULT_SETTINGS.avgDailyMiles;
    
    // Overview settings
    data.settings.overviewVehiclesPerPage = overviewVehiclesPerPage !== "" ? Number(overviewVehiclesPerPage) : null;
    
    // Reset pagination when changing per-page setting
    overviewVehiclePage = 1;

    saveData();
    applyThemeFromSettings();
    applySiteTitle();
    updateUnitLabels();
    renderDashboard();
    renderSettings();
    renderRemindersPage();
  });

  $("#settings-vehicle-add").on("click", function() {
    const name = $("#settings-vehicle-new").val().trim();
    if (!name) return;

    // ── Subscription: check vehicle limit before adding ──────────────────
    if (typeof gmSub !== 'undefined' && gmSub.atLimit('vehicles')) {
      showUpgradeModal({
        title: 'Vehicle Limit Reached',
        message: `Your ${gmSub.tierName()} plan allows a maximum of ${gmSub.max('vehicles')} vehicle(s). Upgrade to add more.`,
        feature: 'vehicles',
      });
      return;
    }

    const id = "v_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    data.vehicles.push({
      id, 
      name, 
      currentOdo: null, 
      vin: null, 
      plate: null,
      // New vehicle detail fields
      year: null,
      make: null,
      model: null,
      engine: null,
      bodyClass: null,
      photoPath: null
    });
    saveData();
    $("#settings-vehicle-new").val("");
    setActiveVehicle(id);
    renderDashboard();
    renderSettingsVehicles();
    renderSettingsIntervals();
    renderRemindersPage();
  });

  // Settings Vehicle Card - Accordion toggle
  $("#settings-vehicles").on("click", ".settings-vehicle-header", function(e) {
    const $card = $(this).closest(".settings-vehicle-card");
    const isExpanded = $card.hasClass("expanded");
    
    $(".settings-vehicle-card").removeClass("expanded");
    
    if (!isExpanded) {
      $card.addClass("expanded");
      // Initialize date pickers when card expands
      initDatePickers($card);
    }
  });

  // Prevent header click when clicking inside the body
  $("#settings-vehicles").on("click", ".settings-vehicle-body", function(e) {
    e.stopPropagation();
  });

  // ========== UPDATED VEHICLE SAVE HANDLER WITH DETAILS & RENEWAL SYNC ==========
  $("#settings-vehicles").on("click", ".settings-vehicle-save", function(e) {
    e.stopPropagation();
    const $card = $(this).closest(".settings-vehicle-card");
    const id = $card.attr("data-id");
    const name = $card.find(".settings-vehicle-name").val().trim();
    const odoVal = $card.find(".settings-vehicle-odo").val();
    const vinVal = $card.find(".settings-vehicle-vin").val().trim().toUpperCase();
    const plateVal = $card.find(".settings-vehicle-plate").val().trim();
    
    // Get vehicle detail fields
    const yearVal = $card.find(".settings-vehicle-year").val();
    const makeVal = $card.find(".settings-vehicle-make").val().trim();
    const modelVal = $card.find(".settings-vehicle-model").val().trim();
    const engineVal = $card.find(".settings-vehicle-engine").val().trim();
    const bodyClassVal = $card.find(".settings-vehicle-body-class").val().trim();
    
    // Get renewal dates
    const insuranceDate = $card.find(".settings-vehicle-insurance").val().trim();
    const registrationDate = $card.find(".settings-vehicle-registration").val().trim();
    
    if (!name) {
      alert("Vehicle name is required.");
      return;
    }
    
    const v = data.vehicles.find(v => v.id === id);
    if (v) {
      v.name = name;
      v.currentOdo = odoVal !== "" ? Number(odoVal) : null;
      v.vin = vinVal || null;
      v.plate = plateVal || null;
      
      // Save vehicle detail fields
      v.year = yearVal !== "" ? Number(yearVal) : null;
      v.make = makeVal || null;
      v.model = modelVal || null;
      v.engine = engineVal || null;
      v.bodyClass = bodyClassVal || null;
      // Note: photoPath is managed separately via upload/delete handlers
      
      // Sync renewal dates with reminders (Option 2: Auto-Sync)
      syncRenewalReminder(id, "insurance", insuranceDate);
      syncRenewalReminder(id, "registration", registrationDate);
      
      saveData();
      
      // Collapse the card after saving
      $card.removeClass("expanded");
      
      renderDashboard();
      renderRemindersPage();
      renderSettingsIntervals();
      renderSettingsVehicles();
      
      showToast("Vehicle saved successfully");
    }
  });

  $("#settings-vehicles").on("click", ".settings-vehicle-delete", function(e) {
    e.stopPropagation();
    const $card = $(this).closest(".settings-vehicle-card");
    const id = $card.attr("data-id");
    const v = data.vehicles.find(v => v.id === id);
    if (!v) return;
    
    if (!confirm("Delete \"" + v.name + "\"?\n\nThis will also remove all entries and reminders for this vehicle. This cannot be undone.")) return;
    
    data.vehicles = data.vehicles.filter(v => v.id !== id);
    data.entries = data.entries.filter(e => e.vehicleId !== id);
    data.reminders = data.reminders.filter(r => r.vehicleId !== id);
    if (data.vehicleIntervals && data.vehicleIntervals[id]) {
      delete data.vehicleIntervals[id];
    }
    
    if (activeVehicleId === id) {
      activeVehicleId = data.vehicles[0]?.id || "all";
    }
    
    saveData();
    renderDashboard();
    renderSettingsVehicles();
    renderSettingsIntervals();
    renderRemindersPage();
    
    showToast("Vehicle deleted");
  });

  $("#settings-service-add").on("click", function() {
    const name = $("#settings-service-new").val().trim();
    if (!name) return;
    const existingNames = new Set((data.serviceTypes || []).map(st => st.name));
    if (!existingNames.has(name)) {
      data.serviceTypes.push({ name, intervalMiles: null, intervalMonths: null });
      saveData();
      $("#settings-service-new").val("");
      renderSettingsServices();
      renderDashboard();
      renderReminderServiceSelect();
      renderSettingsIntervals();
      renderRemindersPage();
    }
  });

  $("#settings-services").on("click", ".settings-service-save", function() {
    const $row = $(this).closest(".settings-row");
    const index = Number($row.attr("data-index"));
    const name = $row.find(".settings-service-name").val().trim();
    if (!name) return;
    if (index >= 0 && index < data.serviceTypes.length) {
      const st = data.serviceTypes[index];
      st.name = name;
      saveData();
      renderSettingsServices();
      renderDashboard();
      renderReminderServiceSelect();
      renderSettingsIntervals();
      renderRemindersPage();
    }
  });

  $("#settings-services").on("click", ".settings-service-delete", function() {
    const $row = $(this).closest(".settings-row");
    const index = Number($row.attr("data-index"));
    const st = data.serviceTypes[index];
    const name = st ? st.name : "";
    if (!name && name !== "") return;
    if (!confirm("Delete service type \"" + name + "\"? Existing entries and reminders keep their text/intervals.")) return;
    data.serviceTypes.splice(index, 1);
    saveData();
    renderSettingsServices();
    renderDashboard();
    renderReminderServiceSelect();
    renderSettingsIntervals();
    renderRemindersPage();
  });

  $("#settings-intervals-vehicle").on("change", function() {
    const vid = $(this).val();
    renderSettingsIntervalsForVehicle(vid);
  });

  $("#settings-intervals-list").on("click", ".settings-intervals-save", function() {
    const $row = $(this).closest(".settings-row");
    const vehicleId = $row.attr("data-vehicle-id");
    const serviceName = $row.attr("data-service");

    const milesVal = $row.find(".settings-intervals-miles").val();
    const monthsVal = $row.find(".settings-intervals-months").val();

    if (!data.vehicleIntervals) data.vehicleIntervals = {};
    if (!data.vehicleIntervals[vehicleId]) data.vehicleIntervals[vehicleId] = {};
    const vMap = data.vehicleIntervals[vehicleId];

    const intervalMiles = milesVal !== "" ? Number(milesVal) : null;
    const intervalMonths = monthsVal !== "" ? Number(monthsVal) : null;

    if (intervalMiles == null && intervalMonths == null) {
      delete vMap[serviceName];
    } else {
      vMap[serviceName] = { intervalMiles, intervalMonths };
    }

    saveData();
    renderSettingsIntervalsForVehicle(vehicleId);
  });

  $("#settings-intervals-list").on("click", ".settings-intervals-clear", function() {
    const $row = $(this).closest(".settings-row");
    const vehicleId = $row.attr("data-vehicle-id");
    const serviceName = $row.attr("data-service");
    $row.find(".settings-intervals-miles").val("");
    $row.find(".settings-intervals-months").val("");

    if (data.vehicleIntervals && data.vehicleIntervals[vehicleId]) {
      delete data.vehicleIntervals[vehicleId][serviceName];
      saveData();
    }
  });

  // ============================================
  // BACKUP/EXPORT HANDLERS
  // ============================================
  
  $("#backup-export").on("click", function() {
    exportDataJSON();
  });

  $("#backup-import").on("change", function() {
    const file = this.files[0];
    if (!file) return;
    
    const confirmMsg = "⚠  IMPORT DATA (JSON)\n\n" +
      "Note: This imports database data only.\n" +
      "Attachment files are NOT included in JSON backups.\n\n" +
      "For complete backup with attachments, use 'Full Backup (ZIP)'.\n\n" +
      "Continue with JSON import?";
    
    if (confirm(confirmMsg)) {
      importData(file);
    }
    
    this.value = "";
  });

  $("#backup-reset").on("click", function() {
    resetAllData();
  });

  $("#export-excel").on("click", function() {
    // ── Subscription gate ─────────────────────────────────────────────
    if (typeof gmSub !== 'undefined' && !gmSub.can('export')) {
      showUpgradeModal({
        title: 'Export Requires an Upgrade',
        message: `Data export is not available on the ${gmSub.tierName()} plan.`,
        feature: 'export',
      });
      return;
    }
    exportTableCSV();
  });

  $("#export-word").on("click", function() {
    if (typeof gmSub !== 'undefined' && !gmSub.can('export')) {
      showUpgradeModal({
        title: 'Export Requires an Upgrade',
        message: `Data export is not available on the ${gmSub.tierName()} plan.`,
        feature: 'export',
      });
      return;
    }
    exportTableWord();
  });

  $("#export-pdf").on("click", function() {
    if (typeof gmSub !== 'undefined' && !gmSub.can('export')) {
      showUpgradeModal({
        title: 'Export Requires an Upgrade',
        message: `Data export is not available on the ${gmSub.tierName()} plan.`,
        feature: 'export',
      });
      return;
    }
    exportTablePDF();
  });

  // ============================================
  // REMINDER HANDLERS
  // ============================================
  
  $("#reminder-form").on("submit", function(e) {
    e.preventDefault();
    addReminderFromForm();
  });

  $("#rem-new-service").on("change", function() {
    const name = $(this).val();
    if (!name) {
      $("#rem-new-interval-miles").val("");
      $("#rem-new-interval-months").val("");
      return;
    }
    const iv = getIntervalForService(activeVehicleId, name);
    $("#rem-new-interval-miles").val(iv.intervalMiles != null ? iv.intervalMiles : "");
    $("#rem-new-interval-months").val(iv.intervalMonths != null ? iv.intervalMonths : "");
  });

  $("#reminders-list").on("click", ".reminder-header", function() {
    const $card = $(this).closest(".reminder-card");
    const $body = $card.find(".reminder-body");
    const open = $body.is(":visible");
    $(".reminder-body").slideUp(120);
    if (!open) {
      $body.slideDown(120);
    }
  });

  $("#reminders-list").on("click", ".rem-btn-save", function(e) {
    e.stopPropagation();
    const $card = $(this).closest(".reminder-card");
    saveReminderFromCard($card);
  });

  $("#reminders-list").on("click", ".rem-btn-delete", function(e) {
    e.stopPropagation();
    const $card = $(this).closest(".reminder-card");
    deleteReminderFromCard($card);
  });

  $("#reminders-list").on("click", ".rem-btn-copy", function(e) {
    e.stopPropagation();
    const $card = $(this).closest(".reminder-card");
    copyReminderFromCard($card); // Now opens modal (see gm.features.copy-reminder.js)
  });

  // Old inline copy panel handlers removed - now using modal with dynamic auto-fill
  // (see gm.features.copy-reminder.js for new implementation)

  $("#reminders-list").on("click", ".rem-btn-google", function(e) {
    e.stopPropagation();
    const $card = $(this).closest(".reminder-card");
    openGoogleReminderFromCard($card);
  });
});