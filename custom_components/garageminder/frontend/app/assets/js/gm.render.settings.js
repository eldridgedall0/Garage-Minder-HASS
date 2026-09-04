/**
 * Garage Maintenance - Settings Rendering
 * Includes vehicle settings with:
 * - Vehicle details (year, make, model, engine)
 * - VIN decoder integration
 * - Vehicle photo upload
 * - Insurance/registration renewal fields
 */

function renderSettingsGeneral() {
  const s = data.settings || DEFAULT_SETTINGS;
  $("#settings-site-title").val(s.siteTitle || DEFAULT_SETTINGS.siteTitle);
  $("#settings-unit").val(s.unit || "mi");

  const $tz = $("#settings-timezone");
  if ($tz.length) {
    let currentTz =
      (s.timezone && typeof s.timezone === "string" && s.timezone.trim() !== "")
        ? s.timezone.trim()
        : (function() {
            try {
              const opts = Intl.DateTimeFormat().resolvedOptions();
              return opts.timeZone || "";
            } catch (e) {
              return "";
            }
          })();

    if (currentTz) {
      if ($tz.find('option[value="' + currentTz + '"]').length === 0) {
        $tz.append($("<option>").val(currentTz).text(currentTz + " (custom)"));
      }
      $tz.val(currentTz);
    } else {
      $tz.val("");
    }
  }

  // Render reminder threshold settings
  $("#settings-upcoming-days").val(s.upcomingThresholdDays != null ? s.upcomingThresholdDays : DEFAULT_SETTINGS.upcomingThresholdDays);
  $("#settings-upcoming-miles").val(s.upcomingThresholdMiles != null ? s.upcomingThresholdMiles : DEFAULT_SETTINGS.upcomingThresholdMiles);
  $("#settings-overdue-days").val(s.overdueThresholdDays != null ? s.overdueThresholdDays : DEFAULT_SETTINGS.overdueThresholdDays);
  $("#settings-overdue-miles").val(s.overdueThresholdMiles != null ? s.overdueThresholdMiles : DEFAULT_SETTINGS.overdueThresholdMiles);
  $("#settings-avg-daily-miles").val(s.avgDailyMiles != null ? s.avgDailyMiles : DEFAULT_SETTINGS.avgDailyMiles);
  
  // Render overview vehicles per page setting
  $("#settings-overview-vehicles-per-page").val(s.overviewVehiclesPerPage || "");
}

function renderSettingsVehicles() {
  const $list = $("#settings-vehicles");
  $list.empty();
  const unit = getUnitShort();
  
  if (!data.vehicles.length) {
    $list.append(
      $("<div>").addClass("settings-vehicles-empty")
        .html('<i class="bi bi-car-front-fill"></i> No vehicles yet.<br>Add your first vehicle below to get started.')
    );
    return;
  }
  
  // Create accordion-style cards container
  const $cardsContainer = $("<div>").addClass("settings-vehicles-list");
  
  data.vehicles.forEach(v => {
    const $card = $("<div>")
      .addClass("settings-vehicle-card")
      .attr("data-id", v.id);
    
    // Header (always visible)
    const $header = $("<div>").addClass("settings-vehicle-header");
    
    // Vehicle thumbnail in header
    const $headerThumb = $("<div>").addClass("settings-vehicle-header-thumb");
    $headerThumb.append(createVehicleThumbnail(v, 'small'));
    
    // Summary info
    const $summary = $("<div>").addClass("settings-vehicle-summary");
    $summary.append(
      $("<div>").addClass("settings-vehicle-name-display").text(v.name || "Unnamed Vehicle")
    );
    
    // Meta info (Year/Make/Model if available, or VIN/Plate)
    const $meta = $("<div>").addClass("settings-vehicle-meta");
    
    // Show year/make/model if available
    const vehicleInfo = buildVehicleInfoString(v);
    if (vehicleInfo) {
      $meta.append(
        $("<span>").addClass("settings-vehicle-meta-item vehicle-info").text(vehicleInfo)
      );
    }
    
    if (v.vin) {
      $meta.append(
        $("<span>").addClass("settings-vehicle-meta-item").html(
          '<span class="meta-label">VIN:</span> ' + escapeHtml(v.vin)
        )
      );
    }
    if (v.plate) {
      $meta.append(
        $("<span>").addClass("settings-vehicle-meta-item").html(
          '<span class="meta-label">Plate:</span> ' + escapeHtml(v.plate)
        )
      );
    }
    if (!v.vin && !v.plate && !vehicleInfo) {
      $meta.append(
        $("<span>").addClass("settings-vehicle-meta-item").css("opacity", "0.5")
          .text("No details set")
      );
    }
    $summary.append($meta);
    
    // Toggle indicator
    const $toggle = $("<div>").addClass("settings-vehicle-toggle").html('<i class=\"bi bi-chevron-down\"></i>');
    
    $header.append($headerThumb, $summary, $toggle);
    
    // Body (edit form - hidden by default)
    const $body = $("<div>").addClass("settings-vehicle-body");
    
    // ========== PHOTO SECTION ==========
    const $photoSection = $("<div>").addClass("settings-vehicle-photo-section");
    $photoSection.append(createVehiclePhotoEditor(v));
    $body.append($photoSection);
    
    const $fields = $("<div>").addClass("settings-vehicle-fields");
    
    // Vehicle name field
    $fields.append(
      $("<div>").addClass("field full-width").append(
        $("<label>").text("Vehicle Name"),
        $("<input>")
          .attr({ type: "text", placeholder: "e.g., My Daily Driver" })
          .addClass("settings-vehicle-name")
          .val(v.name || "")
      )
    );
    
    // Current mileage field
    $fields.append(
      $("<div>").addClass("field").append(
        $("<label>").html("Current Mileage (<span class=\"unit-label\">" + unit + "</span>)"),
        $("<input>")
          .attr({ type: "number", min: "0", step: "1", placeholder: "0" })
          .addClass("settings-vehicle-odo")
          .val(v.currentOdo != null ? v.currentOdo : "")
      )
    );
    
    // VIN field with decode button
    const $vinField = $("<div>").addClass("field vin-field-container");
    $vinField.append(
      $("<label>").text("VIN"),
      $("<div>").addClass("vin-input-row").append(
        $("<input>")
          .attr({ type: "text", placeholder: "17-character VIN", maxlength: 17 })
          .addClass("settings-vehicle-vin")
          .val(v.vin || ""),
        $("<button>")
          .attr("type", "button")
          .addClass("btn-ghost btn-small vin-decode-btn")
          .text("Decode VIN")
          .on("click", function() {
            decodeVehicleVIN(v.id);
          })
      ),
      $("<small>").addClass("text-muted").text("Enter VIN and click Decode to auto-fill vehicle details")
    );
    $fields.append($vinField);
    
    // Plate field
    $fields.append(
      $("<div>").addClass("field").append(
        $("<label>").text("Plate Number"),
        $("<input>")
          .attr({ type: "text", placeholder: "License plate" })
          .addClass("settings-vehicle-plate")
          .val(v.plate || "")
      )
    );
    
    $body.append($fields);
    
    // ========== VEHICLE DETAILS SECTION ==========
    const $detailsSection = $("<div>").addClass("settings-vehicle-details-section");
    $detailsSection.append(
      $("<div>").addClass("settings-section-title").html('<i class=\"bi bi-wrench\"></i> Vehicle Details')
    );
    
    const $detailsGrid = $("<div>").addClass("settings-details-grid");
    
    // Year field
    $detailsGrid.append(
      $("<div>").addClass("field").append(
        $("<label>").text("Year"),
        $("<input>")
          .attr({ type: "number", min: "1900", max: "2100", placeholder: "e.g., 2024" })
          .addClass("settings-vehicle-year")
          .val(v.year || "")
      )
    );
    
    // Make field
    $detailsGrid.append(
      $("<div>").addClass("field").append(
        $("<label>").text("Make"),
        $("<input>")
          .attr({ type: "text", placeholder: "e.g., Toyota" })
          .addClass("settings-vehicle-make")
          .val(v.make || "")
      )
    );
    
    // Model field
    $detailsGrid.append(
      $("<div>").addClass("field").append(
        $("<label>").text("Model"),
        $("<input>")
          .attr({ type: "text", placeholder: "e.g., Camry" })
          .addClass("settings-vehicle-model")
          .val(v.model || "")
      )
    );
    
    // Engine field
    $detailsGrid.append(
      $("<div>").addClass("field").append(
        $("<label>").text("Engine"),
        $("<input>")
          .attr({ type: "text", placeholder: "e.g., 3.5L V6" })
          .addClass("settings-vehicle-engine")
          .val(v.engine || "")
      )
    );
    
    $detailsSection.append($detailsGrid);
    
    // Body class (hidden but stored)
    $detailsSection.append(
      $("<input>")
        .attr("type", "hidden")
        .addClass("settings-vehicle-body-class")
        .val(v.bodyClass || "")
    );
    
    // Find Image button (opens Google Images search)
    const $findImageRow = $("<div>").addClass("find-image-row");
    $findImageRow.append(
      $("<button>")
        .attr("type", "button")
        .addClass("btn-ghost btn-small find-image-btn")
        .html('<i class=\"bi bi-search\"></i> Find Vehicle Image Online')
        .on("click", function() {
          openVehicleImageSearch(v);
        })
    );
    $detailsSection.append($findImageRow);
    
    $body.append($detailsSection);
    
    // ========== RENEWALS SECTION ==========
    const renewalInfo = getVehicleRenewalDates(v.id);
    
    const $renewalsSection = $("<div>").addClass("settings-renewals-section");
    $renewalsSection.append(
      $("<div>").addClass("settings-section-title").html('<i class=\"bi bi-calendar-event\"></i> Renewal Dates')
    );
    
    const $renewalsGrid = $("<div>").addClass("settings-renewals-grid");
    
    // Insurance expiry field
    $renewalsGrid.append(
      $("<div>").addClass("field").append(
        $("<label>").text("Insurance Expires"),
        $("<input>")
          .attr({ type: "text", placeholder: "YYYY-MM-DD", autocomplete: "off" })
          .addClass("settings-vehicle-insurance")
          .val(renewalInfo.insuranceDate || ""),
        $("<small>").addClass("text-muted").text("Auto-syncs with Insurance renewal reminder")
      )
    );
    
    // Registration expiry field
    $renewalsGrid.append(
      $("<div>").addClass("field").append(
        $("<label>").text("Registration Expires"),
        $("<input>")
          .attr({ type: "text", placeholder: "YYYY-MM-DD", autocomplete: "off" })
          .addClass("settings-vehicle-registration")
          .val(renewalInfo.registrationDate || ""),
        $("<small>").addClass("text-muted").text("Auto-syncs with Registration renewal reminder")
      )
    );
    
    $renewalsSection.append($renewalsGrid);
    $body.append($renewalsSection);
    
    // Action buttons
    const $actions = $("<div>").addClass("settings-vehicle-actions");
    $actions.append(
      $("<button>")
        .addClass("btn-danger btn-small settings-vehicle-delete")
        .attr("type", "button")
        .text("Delete Vehicle"),
      $("<button>")
        .addClass("btn-primary btn-small settings-vehicle-save")
        .attr("type", "button")
        .text("Save Changes")
    );
    
    $body.append($actions);
    
    $card.append($header, $body);
    $cardsContainer.append($card);
  });
  
  $list.append($cardsContainer);
  
  // Initialize date pickers for renewal fields
  initDatePickers($list);
}

/**
 * Build a string like "2024 Toyota Camry" from vehicle data
 */
function buildVehicleInfoString(vehicle) {
  const parts = [];
  if (vehicle.year) parts.push(vehicle.year);
  if (vehicle.make) parts.push(vehicle.make);
  if (vehicle.model) parts.push(vehicle.model);
  return parts.join(' ');
}

/**
 * Create a vehicle thumbnail element
 * @param {Object} vehicle - The vehicle object
 * @param {string} size - 'small', 'medium', or 'large'
 */
function createVehicleThumbnail(vehicle, size = 'medium') {
  const $container = $("<div>").addClass("vehicle-thumbnail vehicle-thumbnail-" + size);
  
  if (vehicle.photoPath) {
    // Has custom photo
    const $photo = $("<img>");
    gmResolveDownload({ type: "vehicle", id: vehicle.id }).then(function (url) {
      if (url) $photo.attr("src", url);
    });
    $container.append(
      $photo
        .attr("alt", vehicle.name || "Vehicle")
        .addClass("vehicle-photo")
        .on("error", function() {
          // Fallback to silhouette on error
          $(this).replaceWith(createVehicleSilhouette(vehicle.bodyClass));
        })
    );
  } else {
    // Show silhouette based on body class
    $container.append(createVehicleSilhouette(vehicle.bodyClass));
  }
  
  return $container;
}

/**
 * Create an SVG silhouette based on body class
 */
function createVehicleSilhouette(bodyClass) {
  const type = getVehicleSilhouetteType(bodyClass);
  const svgHtml = VEHICLE_SILHOUETTES[type] || VEHICLE_SILHOUETTES['sedan'];
  
  return $("<div>")
    .addClass("vehicle-silhouette")
    .attr("data-body-type", type)
    .html(svgHtml);
}

/**
 * Map NHTSA body class to silhouette type
 */
function getVehicleSilhouetteType(bodyClass) {
  if (!bodyClass) return 'sedan';
  
  const bc = bodyClass.toLowerCase();
  
  if (bc.includes('pickup') || bc.includes('truck')) return 'truck';
  if (bc.includes('suv') || bc.includes('sport utility')) return 'suv';
  if (bc.includes('crossover') || bc.includes('cuv')) return 'suv';
  if (bc.includes('van') || bc.includes('minivan')) return 'van';
  if (bc.includes('coupe')) return 'coupe';
  if (bc.includes('convertible') || bc.includes('roadster')) return 'convertible';
  if (bc.includes('hatchback')) return 'hatchback';
  if (bc.includes('wagon') || bc.includes('estate')) return 'wagon';
  if (bc.includes('motorcycle') || bc.includes('bike')) return 'motorcycle';
  
  return 'sedan';
}

/**
 * Create the vehicle photo editor component
 */
function createVehiclePhotoEditor(vehicle) {
  const $editor = $("<div>").addClass("vehicle-photo-editor").attr("data-vehicle-id", vehicle.id);
  
  // Photo preview
  const $preview = $("<div>").addClass("photo-preview-container");
  $preview.append(createVehicleThumbnail(vehicle, 'large'));
  
  // Overlay with upload prompt (shown when no photo)
  if (!vehicle.photoPath) {
    $preview.append(
      $("<div>").addClass("photo-upload-overlay").html(
        '<span class="upload-icon"><i class="bi bi-camera"></i></span><span>Click to add photo</span>'
      )
    );
  }
  
  $editor.append($preview);
  
  // File input (hidden)
  const $fileInput = $("<input>")
    .attr({
      type: "file",
      accept: "image/jpeg,image/png,image/gif,image/webp",
      style: "display: none"
    })
    .addClass("photo-file-input")
    .on("change", function() {
      handleVehiclePhotoSelect(vehicle.id, this);
    });
  $editor.append($fileInput);
  
  // Action buttons
  const $actions = $("<div>").addClass("photo-actions");
  
  $actions.append(
    $("<button>")
      .attr("type", "button")
      .addClass("btn-ghost btn-small photo-upload-btn")
      .text(vehicle.photoPath ? "Change Photo" : "Upload Photo")
      .on("click", function() {
        $fileInput.click();
      })
  );
  
  if (vehicle.photoPath) {
    $actions.append(
      $("<button>")
        .attr("type", "button")
        .addClass("btn-ghost btn-small btn-danger-text photo-remove-btn")
        .text("Remove")
        .on("click", function() {
          removeVehiclePhoto(vehicle.id);
        })
    );
  }
  
  $editor.append($actions);
  
  // Click on preview to upload
  $preview.on("click", function() {
    $fileInput.click();
  });
  
  return $editor;
}

/**
 * Handle vehicle photo file selection
 */
function handleVehiclePhotoSelect(vehicleId, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  
  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    showToast("Please select a valid image file (JPG, PNG, GIF, or WebP)", "error");
    return;
  }
  
  // Validate file size (5MB max)
  if (file.size > 5 * 1024 * 1024) {
    showToast("Image must be smaller than 5MB", "error");
    return;
  }
  
  uploadVehiclePhoto(vehicleId, file);
}

/**
 * Upload vehicle photo to server
 */
async function uploadVehiclePhoto(vehicleId, file) {
  const $card = $(`.settings-vehicle-card[data-id="${vehicleId}"]`);
  const $editor = $card.find(".vehicle-photo-editor");
  
  // Show loading state
  $editor.addClass("uploading");
  showToast("Uploading photo...", "info");
  
  try {
    const formData = new FormData();
    formData.append("vehicle_id", vehicleId);
    formData.append("photo", file);
    
    const response = await fetch("vehicle-photo.php", {
      method: "POST",
      body: formData
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Update local data
      const vehicle = data.vehicles.find(v => v.id === vehicleId);
      if (vehicle) {
        vehicle.photoPath = result.photoPath;
      }
      
      // Re-render the vehicle card
      renderSettingsVehicles();
      showToast("Photo uploaded successfully!", "success");
    } else {
      throw new Error(result.message || "Upload failed");
    }
  } catch (error) {
    console.error("Photo upload error:", error);
    showToast("Failed to upload photo: " + error.message, "error");
  } finally {
    $editor.removeClass("uploading");
  }
}

/**
 * Remove vehicle photo
 */
async function removeVehiclePhoto(vehicleId) {
  if (!confirm("Remove this vehicle's photo?")) return;
  
  try {
    const response = await fetch(`vehicle-photo.php?vehicle_id=${encodeURIComponent(vehicleId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "_method=DELETE&vehicle_id=" + encodeURIComponent(vehicleId)
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Update local data
      const vehicle = data.vehicles.find(v => v.id === vehicleId);
      if (vehicle) {
        vehicle.photoPath = null;
      }
      
      // Re-render
      renderSettingsVehicles();
      showToast("Photo removed", "success");
    } else {
      throw new Error(result.message || "Failed to remove photo");
    }
  } catch (error) {
    console.error("Photo removal error:", error);
    showToast("Failed to remove photo: " + error.message, "error");
  }
}

/**
 * Decode VIN using server-side NHTSA API proxy
 */
async function decodeVehicleVIN(vehicleId) {
  const $card = $(`.settings-vehicle-card[data-id="${vehicleId}"]`);
  const vin = $card.find(".settings-vehicle-vin").val().trim().toUpperCase();
  
  if (!vin) {
    showToast("Please enter a VIN first", "error");
    return;
  }
  
  if (vin.length !== 17) {
    showToast("VIN must be exactly 17 characters", "error");
    return;
  }
  
  const $btn = $card.find(".vin-decode-btn");
  const originalText = $btn.text();
  $btn.text("Decoding...").prop("disabled", true);
  
  try {
    const response = await fetch(`vin-decode.php?vin=${encodeURIComponent(vin)}`);
    const result = await response.json();
    
    if (result.success && result.data) {
      const d = result.data;
      
      // Fill in the fields
      if (d.year) $card.find(".settings-vehicle-year").val(d.year);
      if (d.make) $card.find(".settings-vehicle-make").val(d.make);
      if (d.model) $card.find(".settings-vehicle-model").val(d.model);
      if (d.engine) $card.find(".settings-vehicle-engine").val(d.engine);
      if (d.bodyClass) $card.find(".settings-vehicle-body-class").val(d.bodyClass);
      
      // Optionally update vehicle name if empty
      const currentName = $card.find(".settings-vehicle-name").val().trim();
      if (!currentName || currentName === "Unnamed Vehicle") {
        const suggestedName = [d.year, d.make, d.model].filter(Boolean).join(" ");
        if (suggestedName) {
          $card.find(".settings-vehicle-name").val(suggestedName);
        }
      }
      
      // Show success with details
      let msg = "VIN decoded successfully!";
      if (result.warning) {
        msg += " (Note: " + result.warning + ")";
      }
      showToast(msg, "success");
      
      // Highlight the filled fields briefly
      $card.find(".settings-vehicle-year, .settings-vehicle-make, .settings-vehicle-model, .settings-vehicle-engine")
        .addClass("field-updated");
      setTimeout(() => {
        $card.find(".field-updated").removeClass("field-updated");
      }, 2000);
      
    } else {
      throw new Error(result.message || "Could not decode VIN");
    }
  } catch (error) {
    console.error("VIN decode error:", error);
    showToast("VIN decode failed: " + error.message, "error");
  } finally {
    $btn.text(originalText).prop("disabled", false);
  }
}

/**
 * Open Google Images search for vehicle
 */
function openVehicleImageSearch(vehicle) {
  // Build search query from vehicle details
  const parts = [];
  if (vehicle.year) parts.push(vehicle.year);
  if (vehicle.make) parts.push(vehicle.make);
  if (vehicle.model) parts.push(vehicle.model);
  
  // Get values from form fields if not in object
  if (parts.length === 0) {
    const $card = $(`.settings-vehicle-card[data-id="${vehicle.id}"]`);
    const year = $card.find(".settings-vehicle-year").val();
    const make = $card.find(".settings-vehicle-make").val();
    const model = $card.find(".settings-vehicle-model").val();
    if (year) parts.push(year);
    if (make) parts.push(make);
    if (model) parts.push(model);
  }
  
  if (parts.length === 0) {
    showToast("Please fill in Year, Make, and Model first", "info");
    return;
  }
  
  const query = encodeURIComponent(parts.join(" ") + " car");
  const url = `https://www.google.com/search?tbm=isch&q=${query}`;
  
  window.open(url, "_blank");
}

/**
 * Get current renewal dates from existing reminders for a vehicle
 */
function getVehicleRenewalDates(vehicleId) {
  const result = {
    insuranceDate: null,
    registrationDate: null
  };
  
  const reminders = data.reminders.filter(r => r.vehicleId === vehicleId);
  
  reminders.forEach(r => {
    const serviceName = (r.serviceName || "").toLowerCase();
    
    if (serviceName.includes("insurance") && serviceName.includes("renewal")) {
      result.insuranceDate = r.nextDate || null;
    }
    
    if (serviceName.includes("registration") && serviceName.includes("renewal")) {
      result.registrationDate = r.nextDate || null;
    }
  });
  
  return result;
}

/**
 * Sync insurance/registration dates with reminders (Option 2: Auto-Sync)
 * Creates or updates the corresponding reminder when date is set in vehicle settings
 */
function syncRenewalReminder(vehicleId, type, newDate) {
  const serviceName = type === "insurance" ? "Insurance renewal" : "Registration renewal";
  const now = new Date().toISOString();
  
  // Find existing reminder
  let reminder = data.reminders.find(r => 
    r.vehicleId === vehicleId && 
    (r.serviceName || "").toLowerCase() === serviceName.toLowerCase()
  );
  
  if (newDate && newDate.trim() !== "") {
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      console.warn("Invalid date format for renewal:", newDate);
      return;
    }
    
    if (reminder) {
      // Update existing reminder
      reminder.nextDate = newDate;
      reminder.updatedAt = now;
      
      // Calculate base date (1 year before next date for annual renewals)
      const nextDateObj = new Date(newDate + "T00:00:00");
      const baseDateObj = new Date(nextDateObj);
      baseDateObj.setFullYear(baseDateObj.getFullYear() - 1);
      reminder.baseDate = formatDateISO(baseDateObj);
      
      // Set default interval of 12 months if not set
      if (reminder.intervalMonths == null) {
        reminder.intervalMonths = 12;
      }
    } else {
      // Create new reminder
      const nextDateObj = new Date(newDate + "T00:00:00");
      const baseDateObj = new Date(nextDateObj);
      baseDateObj.setFullYear(baseDateObj.getFullYear() - 1);
      
      reminder = {
        id: "r_" + Date.now() + "_" + Math.random().toString(36).slice(2),
        vehicleId: vehicleId,
        serviceName: serviceName,
        title: "",
        baseOdo: null,
        baseDate: formatDateISO(baseDateObj),
        intervalMiles: null,
        intervalMonths: 12, // Annual renewal
        nextOdo: null,
        nextDate: newDate,
        notes: "Auto-created from vehicle settings. " + (type === "insurance" ? "Insurance" : "Registration") + " renewal reminder.",
        createdAt: now,
        updatedAt: now
      };
      
      data.reminders.push(reminder);
    }
  } else {
    // Date cleared - optionally remove or keep the reminder
    // We'll keep the reminder but clear the next date
    if (reminder) {
      reminder.nextDate = null;
      reminder.updatedAt = now;
    }
  }
}

/**
 * Format a Date object to YYYY-MM-DD string
 */
function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

// Helper function to escape HTML
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderSettingsServices() {
  const $list = $("#settings-services");
  $list.empty();
  if (!data.serviceTypes.length) {
    $list.append(
      $("<div>").addClass("entry-empty")
        .text("No service types yet. Add one below.")
    );
    return;
  }
  data.serviceTypes.forEach((st, index) => {
    const name = st.name || "";

    const $row = $("<div>").addClass("settings-row").attr("data-index", index);
    const $main = $("<div>").addClass("settings-service-main");

    const $nameField = $("<div>").addClass("field").append(
      $("<label>").text("Service name"),
      $("<input>")
        .attr("type","text")
        .val(name)
        .addClass("settings-service-name")
    );

    $main.append($nameField);

    const $actions = $("<div>").addClass("settings-row-actions").append(
      $("<button>").addClass("btn-ghost btn-small settings-service-save")
        .attr("type","button").text("Save"),
      $("<button>").addClass("btn-danger btn-small settings-service-delete")
        .attr("type","button").text("Delete")
    );

    $row.append($main, $actions);
    $list.append($row);
  });
}

function renderSettingsIntervals() {
  const $sel = $("#settings-intervals-vehicle");
  const $list = $("#settings-intervals-list");
  $sel.empty();
  $list.empty();

  if (!data.vehicles.length) {
    $list.append(
      $("<div>").addClass("entry-empty")
        .text("No vehicles yet. Add one in the Vehicles tab.")
    );
    return;
  }

  data.vehicles.forEach(v => {
    $sel.append($("<option>").val(v.id).text(v.name));
  });

  let vid = activeVehicleId && activeVehicleId !== "all" ? activeVehicleId : data.vehicles[0].id;
  $sel.val(vid);
  renderSettingsIntervalsForVehicle(vid);
}

function renderSettingsIntervalsForVehicle(vehicleId) {
  const $list = $("#settings-intervals-list");
  $list.empty();
  const unit = getUnitShort();

  const services = data.serviceTypes || [];
  if (!services.length) {
    $list.append(
      $("<div>").addClass("entry-empty")
        .text("No service types yet. Add some in the Service types tab.")
    );
    return;
  }

  const vMap = (data.vehicleIntervals && data.vehicleIntervals[vehicleId]) || {};

  services.forEach(st => {
    const sName = st.name || "";
    const override = vMap[sName] || {};
    const intervalMiles = override.intervalMiles != null ? override.intervalMiles : "";
    const intervalMonths = override.intervalMonths != null ? override.intervalMonths : "";

    const defaults = getIntervalForService(null, sName);
    const placeholderMiles = defaults.intervalMiles != null ? defaults.intervalMiles : "";
    const placeholderMonths = defaults.intervalMonths != null ? defaults.intervalMonths : "";

    const $row = $("<div>")
      .addClass("settings-row settings-intervals-row")
      .attr("data-vehicle-id", vehicleId)
      .attr("data-service", sName);

    const $main = $("<div>").addClass("settings-intervals-main");

    const $serviceField = $("<div>").addClass("field").append(
      $("<label>").text("Service type"),
      $("<div>").css({fontSize:"0.8rem"}).text(sName || "(Unnamed)")
    );

    const $milesField = $("<div>").addClass("field").append(
      $("<label>").html("Interval (<span class=\"unit-label\">" + unit + "</span>, optional)"),
      $("<input>")
        .attr({type:"number",min:"0",step:"100"})
        .addClass("settings-intervals-miles")
        .val(intervalMiles)
        .prop("placeholder", placeholderMiles ? placeholderMiles + " " + unit : "")
    );

    const $monthsField = $("<div>").addClass("field").append(
      $("<label>").text("Interval (months, optional)"),
      $("<input>")
        .attr({type:"number",min:"0",step:"1"})
        .addClass("settings-intervals-months")
        .val(intervalMonths)
        .prop("placeholder", placeholderMonths ? String(placeholderMonths) : "")
    );

    $main.append($serviceField, $milesField, $monthsField);

    const $actions = $("<div>").addClass("settings-row-actions").append(
      $("<button>").addClass("btn-ghost btn-small settings-intervals-save")
        .attr("type","button").text("Save"),
      $("<button>").addClass("btn-danger btn-small settings-intervals-clear")
        .attr("type","button").text("Clear")
    );

    $row.append($main, $actions);
    $list.append($row);
  });

  updateUnitLabels();
}

function renderSettings() {
  renderSettingsGeneral();
  renderSettingsVehicles();
  renderSettingsServices();
  renderSettingsIntervals();
  updateUnitLabels();
}

function renderReminderServiceSelect() {
  const $sel = $("#rem-new-service");
  const currentVal = $sel.val();
  $sel.empty();
  $sel.append($("<option>").val("").text("Select service template (optional)"));
  (data.serviceTypes || []).forEach(st => {
    $sel.append($("<option>").val(st.name).text(st.name));
  });
  // Preserve the current selection across re-renders triggered while the
  // form is open (e.g. switching vehicles, editing another reminder).
  if (currentVal && (data.serviceTypes || []).some(st => st.name === currentVal)) {
    $sel.val(currentVal);
  }
}

// ============================================
// VEHICLE SILHOUETTES (SVG)
// ============================================
const VEHICLE_SILHOUETTES = {
  sedan: `<svg viewBox="0 0 100 40" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 28 Q5 28 5 25 L5 22 Q5 18 10 18 L25 18 L32 10 Q35 7 40 7 L60 7 Q65 7 68 10 L75 18 L90 18 Q95 18 95 22 L95 25 Q95 28 90 28 L80 28 L80 30 Q80 33 75 33 L70 33 Q65 33 65 30 L65 28 L35 28 L35 30 Q35 33 30 33 L25 33 Q20 33 20 30 L20 28 Z"/>
  </svg>`,
  
  suv: `<svg viewBox="0 0 100 45" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 32 Q3 32 3 28 L3 22 Q3 18 8 18 L20 18 L25 8 Q27 4 32 4 L68 4 Q73 4 75 8 L80 18 L92 18 Q97 18 97 22 L97 28 Q97 32 92 32 L82 32 L82 35 Q82 39 76 39 L70 39 Q64 39 64 35 L64 32 L36 32 L36 35 Q36 39 30 39 L24 39 Q18 39 18 35 L18 32 Z"/>
  </svg>`,
  
  truck: `<svg viewBox="0 0 100 45" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 32 Q2 32 2 28 L2 18 Q2 14 6 14 L40 14 L40 8 Q40 4 44 4 L56 4 Q60 4 62 8 L68 14 L94 14 Q98 14 98 18 L98 28 Q98 32 94 32 L84 32 L84 35 Q84 39 78 39 L72 39 Q66 39 66 35 L66 32 L34 32 L34 35 Q34 39 28 39 L22 39 Q16 39 16 35 L16 32 Z"/>
  </svg>`,
  
  coupe: `<svg viewBox="0 0 100 38" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 26 Q3 26 3 22 L3 20 Q3 16 8 16 L30 16 L42 6 Q46 3 52 3 L62 3 Q68 3 70 6 L78 16 L92 16 Q97 16 97 20 L97 22 Q97 26 92 26 L82 26 L82 29 Q82 32 76 32 L71 32 Q65 32 65 29 L65 26 L35 26 L35 29 Q35 32 29 32 L24 32 Q18 32 18 29 L18 26 Z"/>
  </svg>`,
  
  hatchback: `<svg viewBox="0 0 100 40" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 28 Q3 28 3 24 L3 20 Q3 16 8 16 L22 16 L30 8 Q33 5 38 5 L65 5 Q72 5 72 12 L72 16 L92 16 Q97 16 97 20 L97 24 Q97 28 92 28 L82 28 L82 31 Q82 34 76 34 L71 34 Q65 34 65 31 L65 28 L35 28 L35 31 Q35 34 29 34 L24 34 Q18 34 18 31 L18 28 Z"/>
  </svg>`,
  
  wagon: `<svg viewBox="0 0 100 40" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 28 Q3 28 3 24 L3 20 Q3 16 8 16 L22 16 L30 8 Q33 5 38 5 L80 5 Q85 5 85 10 L85 16 L92 16 Q97 16 97 20 L97 24 Q97 28 92 28 L82 28 L82 31 Q82 34 76 34 L71 34 Q65 34 65 31 L65 28 L35 28 L35 31 Q35 34 29 34 L24 34 Q18 34 18 31 L18 28 Z"/>
  </svg>`,
  
  van: `<svg viewBox="0 0 100 45" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 33 Q2 33 2 29 L2 12 Q2 6 8 6 L70 6 Q75 6 78 10 L88 20 L94 20 Q98 20 98 24 L98 29 Q98 33 94 33 L84 33 L84 36 Q84 40 78 40 L72 40 Q66 40 66 36 L66 33 L34 33 L34 36 Q34 40 28 40 L22 40 Q16 40 16 36 L16 33 Z"/>
  </svg>`,
  
  convertible: `<svg viewBox="0 0 100 35" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 24 Q3 24 3 20 L3 18 Q3 14 8 14 L35 14 L42 8 Q45 5 50 5 L60 5 Q65 5 67 8 L72 14 L92 14 Q97 14 97 18 L97 20 Q97 24 92 24 L82 24 L82 27 Q82 30 76 30 L71 30 Q65 30 65 27 L65 24 L35 24 L35 27 Q35 30 29 30 L24 30 Q18 30 18 27 L18 24 Z"/>
  </svg>`,
  
  motorcycle: `<svg viewBox="0 0 100 45" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="20" cy="32" rx="12" ry="12"/>
    <ellipse cx="80" cy="32" rx="12" ry="12"/>
    <path d="M25 28 L40 15 L55 10 L70 10 L75 28"/>
    <path d="M40 15 L45 25 L55 25 L60 15"/>
  </svg>`
};