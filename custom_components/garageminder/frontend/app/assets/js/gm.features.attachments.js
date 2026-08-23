/**
 * Garage Maintenance - Attachments & Entry Features
 * Updated with Google Drive integration
 * Multi-user ready with proper async save/upload flow
 */

const ATTACH_ALLOWED_EXT = ["pdf", "doc", "docx", "jpg", "jpeg", "png", "gif", "webp"];

const ATTACH_ALLOWED_MIME = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp"
];

function isAttachmentFileAllowed(file) {
    const name = (file && file.name) || "";
    const type = ((file && file.type) || "").toLowerCase();
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";

    if (type && ATTACH_ALLOWED_MIME.indexOf(type) !== -1) return true;
    if (type && type.startsWith("image/")) return true;
    if (ext && ATTACH_ALLOWED_EXT.indexOf(ext) !== -1) return true;
    return false;
}

/**
 * Check if user can use local file uploads.
 * Subscription gating removed — always allowed.
 */
function canUseLocalUpload() {
    // ATTACH_MAX_COUNT is set by index.php from the ENTRY_MAX_ATTACHMENTS PHP constant.
    // config.php resolves that constant from the user's WP tier (attachments_per_entry).
    // 0 means this tier does not allow attachments — no other files need changing.
    if (typeof ATTACH_MAX_COUNT !== 'undefined' && ATTACH_MAX_COUNT <= 0) {
        return false;
    }
    if (typeof GM_CONFIG !== 'undefined' && GM_CONFIG.maxAttachments !== undefined && GM_CONFIG.maxAttachments <= 0) {
        return false;
    }
    return true;
}

/**
 * Check if user can use Google Drive attachments.
 * Only gated by whether Google Drive is enabled in config.
 */
function canUseGoogleDrive() {
    if (typeof GM_CONFIG === 'undefined' || !GM_CONFIG.googleDriveEnabled) {
        return false;
    }
    return true;
}

/**
 * Get attachment limits.
 * Resolution order: GM_SUBSCRIPTION → GM_CONFIG → ATTACH_MAX constants.
 */
function getAttachmentLimits() {
    let maxCount  = 2;
    let maxSizeMB = 5;

    // Read limit from GM_CONFIG (set by config.php ENTRY_MAX_ATTACHMENTS) — no tier gating
    if (typeof GM_CONFIG !== 'undefined' && GM_CONFIG.maxAttachments) {
        maxCount = GM_CONFIG.maxAttachments;
    } else if (typeof ATTACH_MAX_COUNT !== 'undefined') {
        maxCount = ATTACH_MAX_COUNT;
    }

    if (typeof GM_CONFIG !== 'undefined' && GM_CONFIG.maxAttachmentSizeMB) {
        maxSizeMB = GM_CONFIG.maxAttachmentSizeMB;
    } else if (typeof ATTACH_MAX_SIZE_MB !== 'undefined') {
        maxSizeMB = ATTACH_MAX_SIZE_MB;
    }

    return {
        maxCount,
        maxSizeMB,
        maxBytes: maxSizeMB * 1024 * 1024
    };
}

async function addOrUpdateEntryFromForm() {
  if (!activeVehicleId) {
    alert("Select a vehicle first.");
    return;
  }

  const id = $("#entry-id").val();
  const isNew = !id;
  const now = new Date().toISOString();
  const date = $("#entry-date").val() || null;
  if (!date) {
    alert("Date is required.");
    return;
  }

  const odo = $("#entry-odo").val();
  const miscCost = $("#entry-cost").val();
  const nextDate = $("#entry-next-date").val() || null;
  const nextOdo = $("#entry-next-odo").val();

  // Get services with cost/note from the new checklist format
  const services = getServicesFromChecklist(
    $("#service-checklist-container"),
    $("#entry-services-other").val()
  );
  
  if (!services.length) {
    if (!confirm("No services checked or entered. Continue?")) return;
  }

  const payload = {
    id: isNew ? ("e_" + Date.now() + "_" + Math.random().toString(36).slice(2)) : id,
    vehicleId: activeVehicleId,
    date: date,
    odo: odo !== "" ? Number(odo) : null,
    services: services,
    notes: $("#entry-notes").val().trim() || "",
    cost: miscCost !== "" ? Number(miscCost) : null,
    nextDate: nextDate,
    nextOdo: nextOdo !== "" ? Number(nextOdo) : null,
    updatedAt: now
  };

  if (isNew) {
    payload.createdAt = now;
    payload.attachments = [];
    data.entries.push(payload);
  } else {
    const idx = data.entries.findIndex(e => e.id === id);
    const existing = idx >= 0 ? data.entries[idx] : null;
    payload.createdAt = existing ? (existing.createdAt || now) : now;
    payload.attachments = existing ? (existing.attachments || []) : [];
    if (idx >= 0) {
      data.entries[idx] = payload;
    } else {
      data.entries.push(payload);
    }
  }

  resetRemindersForEntry(payload);
  
  // Convert FileList to Array immediately to prevent race conditions
  const fileInput = document.getElementById("entry-files");
  const filesToUpload = fileInput && fileInput.files && fileInput.files.length > 0 
    ? Array.from(fileInput.files) 
    : [];
  const hasFiles = filesToUpload.length > 0;
  
  // Check for pending Google Drive files
  const pendingGDriveFiles = (typeof GDrive !== 'undefined' && GDrive.getPendingFiles) 
    ? GDrive.getPendingFiles() 
    : [];
  const hasGDriveFiles = pendingGDriveFiles.length > 0;
  
  // Debug logging (can be removed after confirming fix works)
  console.log('[Attachments] Files to upload:', filesToUpload.length);
  console.log('[Attachments] Can use local upload:', canUseLocalUpload());
  
  try {
    // IMPORTANT: Wait for save to complete before uploading files
    await saveData();
  } catch (err) {
    // If save failed for a reason other than auth, log but still attempt upload
    // so attachment files aren't silently lost on plan-limit or conflict errors.
    if (err && (err.message === 'Authentication required' || err.message === 'offline_edit_blocked')) {
      console.error("Error saving entry:", err);
      showToast("Error saving entry");
      return;
    }
    console.warn("[Attachments] saveData error (will still attempt upload):", err);
  }

  // Upload files regardless of saveData result — the entry record exists in data
  if (hasFiles) {
    console.log('[Attachments] Starting upload for entry:', payload.id);
    await uploadEntryFiles(payload.id, filesToUpload);
  }

  // Handle pending Google Drive files
  if (hasGDriveFiles && typeof window.attachGoogleDriveFiles === 'function') {
    console.log('Attaching pending Google Drive files to entry:', payload.id);
    await window.attachGoogleDriveFiles(pendingGDriveFiles, payload.id);
  }

  $("#entry-files").val("");
  // Clear any pending Google Drive files display
  if (typeof GDrive !== 'undefined' && GDrive.clearPendingFiles) {
    GDrive.clearPendingFiles();
  }
  dashboardHistoryPage = 1;
  
  // Reload data from server to get updated attachments
  loadData();
  renderDashboard();
  renderRemindersPage();
  renderNewEntryFormDefaults();
  
  // Check user preference for keeping form open
  const keepOpen = getKeepFormOpenPreference();
  if (keepOpen) {
    toggleEntryForm(true);
  }
}

async function uploadEntryFiles(entryId, fileList) {
  // FIXED: Accept both FileList and Array
  const files = Array.isArray(fileList) ? fileList : Array.from(fileList || []);
  
  console.log('[Upload] Starting upload with', files.length, 'files for entry:', entryId);
  
  if (!files.length) {
    console.log('[Upload] No files to upload, returning');
    return;
  }

  // No subscription gating — all authenticated users can upload

  const { maxCount, maxSizeMB, maxBytes } = getAttachmentLimits();
  
  // Filter valid files
  const validFiles = [];
  const skippedFiles = [];  // ADD THIS
  
  for (const file of files) {
    if (validFiles.length >= maxCount) {
      skippedFiles.push({ name: file.name, reason: 'max count reached' });  // ADD THIS
      continue;  // CHANGE FROM break TO continue
    }
    
    if (!isAttachmentFileAllowed(file)) {
      skippedFiles.push({ name: file.name, reason: 'file type not allowed' });  // ADD THIS
      continue;
    }
    
    if (maxBytes && file.size > maxBytes) {
      skippedFiles.push({ name: file.name, reason: `exceeds ${maxSizeMB}MB limit` });  // ADD THIS
      continue;
    }
    
    validFiles.push(file);
  }
  
  console.log('[Upload] Valid files:', validFiles.length, 'Skipped:', skippedFiles.length);  // ADD THIS

  if (!validFiles.length) {
    // FIXED: Show more specific feedback about why no files are valid
    if (skippedFiles.length > 0) {
      const reasons = skippedFiles.map(f => `${f.name}: ${f.reason}`).join(', ');
      showToast("No valid files to upload: " + reasons);
    } else {
      showToast("No valid files to upload");
    }
    return;
  }

  // Create FormData
  const formData = new FormData();
  formData.append('entry_id', entryId);
  validFiles.forEach(file => {
    formData.append('files[]', file);
  });

  try {
    const response = await fetch('upload.php', {
      method: 'POST',
      body: formData,
      credentials: 'same-origin'
    });

    // Check for auth error
    if (response.status === 401) {
      showToast("Session expired. Please log in again.");
      window.location.reload();
      return;
    }

    const result = await response.json();
    
    if (result.success) {
      showToast(`${result.count} file(s) uploaded successfully`);
    } else {
      showToast("Upload failed: " + (result.message || "Unknown error"));
    }
    
    if (result.errors && result.errors.length) {
      console.warn("Upload errors:", result.errors);
    }
  } catch (error) {
    console.error("Upload error:", error);
    showToast("Upload failed: " + error.message);
  }
}

async function saveEntryFromAccordion($card) {
  const id = $card.attr("data-id");
  const entry = data.entries.find(e => e.id === id);
  if (!entry) return;

  const now = new Date().toISOString();
  const date = $card.find(".entry-edit-date").val() || null;
  const odoVal = $card.find(".entry-edit-odo").val();
  const miscCostVal = $card.find(".entry-edit-cost").val();
  const nextDate = $card.find(".entry-edit-next-date").val() || null;
  const nextOdoVal = $card.find(".entry-edit-next-odo").val();
  const notes = $card.find(".entry-edit-notes").val().trim() || "";

  // Get services with cost/note from the checklist
  const services = getServicesFromChecklist(
    $card.find(".entry-edit-services-wrapper"),
    $card.find(".entry-edit-services-other").val()
  );

  entry.date = date;
  entry.odo = odoVal !== "" ? Number(odoVal) : null;
  entry.cost = miscCostVal !== "" ? Number(miscCostVal) : null;
  entry.nextDate = nextDate;
  entry.nextOdo = nextOdoVal !== "" ? Number(nextOdoVal) : null;
  entry.notes = notes;
  entry.services = services;
  entry.updatedAt = now;

  resetRemindersForEntry(entry);
  
  // Check if we have LOCAL files to upload
  // Convert FileList to Array immediately to prevent race conditions
  const fileInput = $card.find(".entry-attach-files")[0];
  const filesToUpload = fileInput && fileInput.files && fileInput.files.length > 0 
    ? Array.from(fileInput.files) 
    : [];
  const hasFiles = filesToUpload.length > 0;
  
  // Debug logging
  console.log('[Attachments Edit] Files to upload:', filesToUpload.length);
  console.log('[Attachments Edit] Can use local upload:', canUseLocalUpload());
  
  try {
    // IMPORTANT: Wait for save to complete before uploading files
    await saveData();
  } catch (err) {
    if (err && (err.message === 'Authentication required' || err.message === 'offline_edit_blocked')) {
      console.error("Error saving entry:", err);
      showToast("Error saving entry");
      return;
    }
    console.warn("[Attachments Edit] saveData error (will still attempt upload):", err);
  }

  if (hasFiles) {
    console.log('[Attachments Edit] Starting upload for entry:', entry.id);
    await uploadEntryFiles(entry.id, filesToUpload);
  }

  // Reload data from server
  loadData();
  renderDashboard();
  renderRemindersPage();
}

function deleteEntryByCard($card) {
  const id = $card.attr("data-id");
  if (!confirm("Delete this entry? This cannot be undone.")) return;
  data.entries = data.entries.filter(e => e.id !== id);
  saveData();
  
  renderDashboard();
  renderRemindersPage();
}

function findLastEntryForService(vehicleId, serviceName) {
  const candidates = data.entries.filter(e => {
    if (e.vehicleId !== vehicleId) return false;
    const serviceNames = getServiceNames(e.services || []);
    return serviceNames.includes(serviceName);
  });
  if (!candidates.length) return null;
  candidates.sort((a,b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
  return candidates[0];
}

function addReminderFromForm() {
  if (!activeVehicleId) {
    alert("Select a vehicle first.");
    return;
  }

  const templateName = $("#rem-new-service").val();
  const customName = $("#rem-new-service-custom").val().trim();
  const serviceName = customName || templateName;

  if (!serviceName) {
    alert("Service name is required (select a template or type one).");
    return;
  }

  const intervalMilesVal = $("#rem-new-interval-miles").val();
  const intervalMonthsVal = $("#rem-new-interval-months").val();
  const notes = $("#rem-new-notes").val().trim() || "";

  let intervalMiles = intervalMilesVal !== "" ? Number(intervalMilesVal) : null;
  let intervalMonths = intervalMonthsVal !== "" ? Number(intervalMonthsVal) : null;

  if (templateName && (!intervalMiles && !intervalMonths)) {
    const iv = getIntervalForService(activeVehicleId, templateName);
    if (intervalMiles == null && iv.intervalMiles != null) intervalMiles = iv.intervalMiles;
    if (intervalMonths == null && iv.intervalMonths != null) intervalMonths = iv.intervalMonths;
  }

  const last = findLastEntryForService(activeVehicleId, serviceName);
  let baseOdo = last && last.odo != null ? last.odo : null;
  let baseDate = last && last.date ? last.date : null;

  const vehicle = data.vehicles.find(v => v.id === activeVehicleId) || null;
  const currentOdo = vehicle && vehicle.currentOdo != null ? vehicle.currentOdo : null;

  let nextOdo = null;
  let nextDate = null;

  if (intervalMiles && intervalMiles > 0) {
    if (baseOdo != null) nextOdo = baseOdo + intervalMiles;
    else if (currentOdo != null) nextOdo = currentOdo + intervalMiles;
  }

  if (intervalMonths && intervalMonths > 0) {
    if (baseDate) nextDate = addMonthsToDate(baseDate, intervalMonths);
    else {
      const todayIso = getTodayIsoInSettingsTz();
      baseDate = baseDate || todayIso;
      nextDate = addMonthsToDate(baseDate, intervalMonths);
    }
  }

  const now = new Date().toISOString();

  const reminder = {
    id: "r_" + Date.now() + "_" + Math.random().toString(36).slice(2),
    vehicleId: activeVehicleId,
    serviceName,
    title: "",
    baseOdo,
    baseDate,
    intervalMiles: intervalMiles,
    intervalMonths: intervalMonths,
    nextOdo,
    nextDate,
    notes,
    createdAt: now,
    updatedAt: now
  };

  data.reminders.push(reminder);
  saveData();
  $("#reminder-form")[0].reset();
  renderRemindersPage();
  renderDashboardRemindersSnippet();
}

function saveReminderFromCard($card) {
  const id = $card.attr("data-id");
  const rem = data.reminders.find(r => r.id === id);
  if (!rem) return;

  const now = new Date().toISOString();
  const serviceName = $card.find(".rem-edit-service").val().trim() || "Reminder";
  const intervalMilesVal = $card.find(".rem-edit-interval-miles").val();
  const intervalMonthsVal = $card.find(".rem-edit-interval-months").val();
  const baseOdoVal = $card.find(".rem-edit-base-odo").val();
  const baseDateVal = $card.find(".rem-edit-base-date").val() || null;
  const nextOdoVal = $card.find(".rem-edit-next-odo").val();
  const nextDateVal = $card.find(".rem-edit-next-date").val() || null;
  const notesVal = $card.find(".rem-edit-notes").val().trim() || "";

  let intervalMiles = intervalMilesVal !== "" ? Number(intervalMilesVal) : null;
  let intervalMonths = intervalMonthsVal !== "" ? Number(intervalMonthsVal) : null;
  let baseOdo = baseOdoVal !== "" ? Number(baseOdoVal) : null;
  let baseDate = baseDateVal;
  let nextOdo = nextOdoVal !== "" ? Number(nextOdoVal) : null;
  let nextDate = nextDateVal;

  const vehicle = data.vehicles.find(v => v.id === rem.vehicleId) || null;
  const currentOdo = vehicle && vehicle.currentOdo != null ? vehicle.currentOdo : null;

  if ((nextOdoVal === "" || nextOdo == null) && intervalMiles && intervalMiles > 0) {
    if (baseOdo != null) nextOdo = baseOdo + intervalMiles;
    else if (currentOdo != null) nextOdo = currentOdo + intervalMiles;
  }

  if (!nextDate && intervalMonths && intervalMonths > 0) {
    if (baseDate) nextDate = addMonthsToDate(baseDate, intervalMonths);
    else {
      const todayIso = getTodayIsoInSettingsTz();
      baseDate = baseDate || todayIso;
      nextDate = addMonthsToDate(baseDate, intervalMonths);
    }
  }

  rem.serviceName = serviceName;
  rem.intervalMiles = intervalMiles;
  rem.intervalMonths = intervalMonths;
  rem.baseOdo = baseOdo;
  rem.baseDate = baseDate;
  rem.nextOdo = nextOdo;
  rem.nextDate = nextDate;
  rem.notes = notesVal;
  rem.updatedAt = now;

  saveData();
  renderRemindersPage();
  renderDashboardRemindersSnippet();
}

function deleteReminderFromCard($card) {
  const id = $card.attr("data-id");
  const rem = data.reminders.find(r => r.id === id);
  if (!rem) return;
  if (!confirm(`Delete reminder "${rem.serviceName || "Reminder"}"?`)) return;
  data.reminders = data.reminders.filter(r => r.id !== id);
  saveData();
  renderRemindersPage();
  renderDashboardRemindersSnippet();
}

function copyReminderFromCard($card) {
  const id = $card.attr("data-id");
  const rem = data.reminders.find(r => r.id === id);
  if (!rem) return;

  const vehicles = (data.vehicles || []).filter(v => v.id !== rem.vehicleId);
  if (!vehicles.length) {
    alert("There are no other vehicles to copy this reminder to.");
    return;
  }

  let $panel = $card.find(".reminder-copy-panel");
  if ($panel.length) {
    $panel.remove();
    return;
  }

  $panel = $("<div>").addClass("reminder-copy-panel");
  const $label = $("<label>").text("Copy to vehicle:");
  const $select = $("<select>").addClass("rem-copy-vehicle");
  vehicles.forEach(v => {
    $select.append(
      $("<option>")
        .val(v.id)
        .text(v.name || ("Vehicle " + v.id))
    );
  });

  const $confirm = $("<button>")
    .addClass("btn-primary btn-small rem-copy-confirm")
    .attr("type","button")
    .text("Copy");
  const $cancel = $("<button>")
    .addClass("btn-ghost btn-small rem-copy-cancel")
    .attr("type","button")
    .text("Cancel");

  $panel.append($label, $select, $confirm, $cancel);
  $card.find(".reminder-body-buttons").after($panel);
}

function openGoogleReminderFromCard($card) {
  const id = $card.attr("data-id");
  const rem = data.reminders.find(r => r.id === id);
  if (!rem) return;

  const vehicle = data.vehicles.find(v => v.id === rem.vehicleId);
  const derived = computeReminderDerived(rem, vehicle ? vehicle.currentOdo : null);

  if (!derived.nextDate) {
    alert("This reminder does not have a next due date set. Add a date or interval first.");
    return;
  }

  const title = (rem.serviceName || "Maintenance reminder") +
    (vehicle ? ` – ${vehicle.name}` : "");
  const details = rem.notes || "";
  const ymd = derived.nextDate.replace(/-/g,"");
  const datesParam = `${ymd}/${ymd}`;

  const url =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    "&text=" + encodeURIComponent(title) +
    "&details=" + encodeURIComponent(details) +
    "&dates=" + encodeURIComponent(datesParam);

  window.open(url, "_blank");
}

/**
 * Delete attachment via API
 */
async function deleteAttachment(attachmentId, entryId) {
  if (!confirm("Delete this attachment?")) return false;
  
  try {
    const formData = new FormData();
    formData.append('attachment_id', attachmentId);
    
    const response = await fetch('delete-attachment.php', {
      method: 'POST',
      body: formData,
      credentials: 'same-origin'
    });
    
    if (response.status === 401) {
      showToast("Session expired. Please log in again.");
      window.location.reload();
      return false;
    }
    
    const result = await response.json();
    
    if (result.success) {
      showToast("Attachment deleted");
      
      // Remove from local data
      if (entryId) {
        const entry = data.entries.find(e => e.id === entryId);
        if (entry && entry.attachments) {
          entry.attachments = entry.attachments.filter(a => a.id !== attachmentId);
        }
      }
      
      return true;
    } else {
      showToast("Delete failed: " + (result.message || "Unknown error"));
      return false;
    }
  } catch (error) {
    console.error("Delete error:", error);
    showToast("Delete failed: " + error.message);
    return false;
  }
}

/**
 * Render attachment upload area with Google Drive and Local options
 */
function renderAttachmentUploadArea(entryId, currentCount, maxCount, $container) {
  const canDrive = canUseGoogleDrive();
  const canLocal = canUseLocalUpload();
  const remainingSlots = Math.max(0, maxCount - currentCount);
  
  // Clear existing
  $container.empty();
  
  if (remainingSlots <= 0) {
    $container.append(
      $('<div>').addClass('attachment-limit-reached text-muted')
        .text(`Maximum ${maxCount} attachments reached`)
    );
    return;
  }
  
  const $uploadArea = $('<div>').addClass('attachment-upload-container');
  
  // Google Drive button (available to all users if enabled)
  if (canDrive && typeof GDrive !== 'undefined') {
    const $driveBtn = $('<button>')
      .addClass('btn-ghost btn-attachment-drive')
      .attr('type', 'button')
      .html('<i class="bi bi-google"></i> Add from Google Drive')
      .on('click', function(e) {
        e.preventDefault();
        GDrive.openPicker(entryId, async function(files, eId) {
          await GDrive.attachGoogleDriveFiles ? 
            window.attachGoogleDriveFiles(files, eId) : 
            attachGoogleDriveFiles(files, eId);
        });
      });
    
    $uploadArea.append($driveBtn);
  }
  
  // Local upload (paid users only)
  if (canLocal) {
    const $localInput = $('<input>')
      .attr({
        type: 'file',
        multiple: true,
        accept: ATTACH_ALLOWED_EXT.map(e => '.' + e).join(',')
      })
      .addClass('entry-attach-files')
      .css('display', 'none');
    
    const $localBtn = $('<button>')
      .addClass('btn-ghost btn-attachment-local')
      .attr('type', 'button')
      .html('<i class="bi bi-upload"></i> Upload File')
      .on('click', function(e) {
        e.preventDefault();
        $localInput.click();
      });
    
    $uploadArea.append($localBtn, $localInput);
  }
  
  // Show allowed file types
  const maxSizeMB = (typeof ATTACH_MAX_SIZE_MB !== 'undefined') ? ATTACH_MAX_SIZE_MB : 5;
  const $hint = $('<div>')
    .addClass('attachment-hint text-muted')
    .text(`Allowed: ${ATTACH_ALLOWED_EXT.join(', ').toUpperCase()} (max ${maxSizeMB}MB)`);
  
  $uploadArea.append($hint);
  $container.append($uploadArea);
}

// Make function available globally for Google Drive module
window.attachGoogleDriveFiles = async function(files, entryId) {
  if (!files || !files.length) return;
  
  showToast('Attaching files from Google Drive...');
  
  try {
    const response = await fetch('google-drive-upload.php?action=attach', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        entry_id: entryId,
        files: files
      })
    });
    
    if (response.status === 401) {
      showToast('Session expired. Please log in again.');
      window.location.reload();
      return;
    }
    
    const result = await response.json();
    
    if (result.success) {
      showToast(`${result.count} file(s) attached from Google Drive`);
      
      // Update local data
      const entry = data.entries.find(e => e.id === entryId);
      if (entry) {
        if (!entry.attachments) entry.attachments = [];
        result.attached.forEach(att => {
          entry.attachments.push(att);
        });
      }
      
      // Refresh the UI
      loadData();
      renderDashboard();
    } else {
      showToast('Failed to attach files: ' + (result.message || result.error || 'Unknown error'));
    }
    
    if (result.errors && result.errors.length) {
      console.warn('Attachment errors:', result.errors);
    }
  } catch (error) {
    console.error('Google Drive attach error:', error);
    showToast('Failed to attach files: ' + error.message);
  }
};