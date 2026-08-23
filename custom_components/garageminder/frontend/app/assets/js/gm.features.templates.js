/**
 * Garage Maintenance - Entry Templates Feature
 * Allows users to create and use reusable service entry templates
 */

// ============================================
// TEMPLATE DATA MANAGEMENT
// ============================================

/**
 * Get all templates for the current user
 */
function getTemplates() {
  return data.entryTemplates || [];
}

/**
 * Find a template by ID
 */
function getTemplateById(id) {
  return getTemplates().find(t => t.id === id) || null;
}

/**
 * Generate a unique template ID
 */
function generateTemplateId() {
  return "tpl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

/**
 * Add a new template
 */
function addTemplate(templateData) {
  if (!data.entryTemplates) {
    data.entryTemplates = [];
  }

  // ── Subscription: template limit gate ───────────────────────────────────
  if (typeof gmSub !== 'undefined' && window.GM_SUBSCRIPTION) {
    const maxTemplates = gmSub.maxTemplates();
    if (maxTemplates !== -1 && maxTemplates >= 0) {
      const currentCount = (data.entryTemplates || []).length;
      if (currentCount >= maxTemplates) {
        showUpgradeModal({
          title: 'Template Limit Reached',
          message: `Your ${gmSub.tierName()} plan allows up to ${maxTemplates} template(s). Upgrade to create more.`,
          feature: 'templates',
        });
        return null;
      }
    }
    // Check if templates feature is enabled at all
    if (!gmSub.can('templates')) {
      showUpgradeModal({
        title: 'Templates Require an Upgrade',
        message: `Entry templates are not available on the ${gmSub.tierName()} plan.`,
        feature: 'templates',
      });
      return null;
    }
  }

  const now = new Date().toISOString();
  const template = {
    id: generateTemplateId(),
    name: templateData.name || "Untitled Template",
    services: templateData.services || [],
    miscCost: templateData.miscCost != null ? Number(templateData.miscCost) : null,
    notes: templateData.notes || "",
    nextDateOffsetDays: templateData.nextDateOffsetDays != null ? Number(templateData.nextDateOffsetDays) : null,
    nextOdoOffset: templateData.nextOdoOffset != null ? Number(templateData.nextOdoOffset) : null,
    createdAt: now,
    updatedAt: now
  };
  
  data.entryTemplates.push(template);
  saveData();
  
  return template;
}

/**
 * Update an existing template
 */
function updateTemplate(id, templateData) {
  const template = getTemplateById(id);
  if (!template) return null;
  
  template.name = templateData.name || template.name;
  template.services = templateData.services || template.services;
  template.miscCost = templateData.miscCost != null ? Number(templateData.miscCost) : null;
  template.notes = templateData.notes !== undefined ? templateData.notes : template.notes;
  template.nextDateOffsetDays = templateData.nextDateOffsetDays != null ? Number(templateData.nextDateOffsetDays) : null;
  template.nextOdoOffset = templateData.nextOdoOffset != null ? Number(templateData.nextOdoOffset) : null;
  template.updatedAt = new Date().toISOString();
  
  saveData();
  return template;
}

/**
 * Delete a template
 */
function deleteTemplate(id) {
  if (!data.entryTemplates) return false;
  
  const index = data.entryTemplates.findIndex(t => t.id === id);
  if (index === -1) return false;
  
  data.entryTemplates.splice(index, 1);
  saveData();
  return true;
}

// ============================================
// TEMPLATE SELECTOR IN ENTRY FORM
// ============================================

/**
 * Render the template selector dropdown in the entry form
 */
function renderTemplateSelector() {
  const $container = $("#template-selector-container");
  if (!$container.length) return;
  
  $container.empty();
  
  const templates = getTemplates();
  
  const $row = $("<div>").addClass("template-selector-row");
  
  const $label = $("<label>").attr("for", "entry-template-select").text("Quick fill:");
  
  const $select = $("<select>").attr("id", "entry-template-select");
  $select.append($("<option>").val("").text("– Select a template –"));
  
  templates.forEach(t => {
    const serviceCount = (t.services || []).length;
    const label = t.name + (serviceCount > 0 ? ` (${serviceCount} service${serviceCount !== 1 ? 's' : ''})` : '');
    $select.append($("<option>").val(t.id).text(label));
  });
  
  const $loadBtn = $("<button>")
    .attr("type", "button")
    .addClass("btn-ghost btn-small")
    .text("Load")
    .prop("disabled", true);
  
  $select.on("change", function() {
    $loadBtn.prop("disabled", !$(this).val());
  });
  
  $loadBtn.on("click", function() {
    const templateId = $select.val();
    if (templateId) {
      loadTemplateIntoForm(templateId);
      $select.val("");
      $loadBtn.prop("disabled", true);
    }
  });
  
  $row.append($label, $select, $loadBtn);
  
  if (templates.length === 0) {
    const $hint = $("<div>").addClass("template-selector-hint")
      .html('No templates yet. <a href="#" class="template-create-link">Create one</a> in Settings → Templates.');
    $hint.find(".template-create-link").on("click", function(e) {
      e.preventDefault();
      // Navigate to settings templates tab
      $(".nav-btn").removeClass("active");
      $(".nav-btn[data-view='settings']").addClass("active");
      $(".view").removeClass("active");
      $("#view-settings").addClass("active");
      $(".settings-tab-btn").removeClass("active");
      $(".settings-tab-btn[data-tab='templates']").addClass("active");
      $(".settings-tab-view").removeClass("active");
      $("#settings-tab-templates").addClass("active");
    });
    $container.append($row, $hint);
  } else {
    $container.append($row);
  }
}

/**
 * Load a template into the entry form
 */
function loadTemplateIntoForm(templateId) {
  const template = getTemplateById(templateId);
  if (!template) {
    showToast("Template not found");
    return;
  }
  
  // Clear current form values (but not date/odo as those are entry-specific)
  $("#entry-services-other").val("");
  $("#entry-cost").val("");
  $("#entry-notes").val("");
  $("#entry-next-date").val("");
  $("#entry-next-odo").val("");
  
  // Build a map of template services
  const templateServices = normalizeServices(template.services || []);
  const templateServiceMap = {};
  templateServices.forEach(svc => {
    templateServiceMap[svc.name] = svc;
  });
  
  // Update service checklist (supports both old .service-item and new .service-selector-item)
  const $checklist = $("#service-checklist-container");
  
  // Uncheck all first
  $checklist.find(".service-selector-checkbox, input[type='checkbox']").prop("checked", false);
  $checklist.find(".service-selector-item, .service-item").removeClass("selected");
  $checklist.find(".service-details-row").hide();
  $checklist.find(".service-cost-input").val("");
  $checklist.find(".service-note-input").val("");
  
  // Check and fill template services
  $checklist.find(".service-selector-item, .service-item").each(function() {
    const $item = $(this);
    const serviceName = $item.attr("data-service-name") || "";
    
    // Find matching template service (data-service-name is already lowercase)
    let matchedSvc = null;
    for (const [name, svc] of Object.entries(templateServiceMap)) {
      if (name.toLowerCase() === serviceName.toLowerCase()) {
        matchedSvc = svc;
        break;
      }
    }
    
    if (matchedSvc) {
      const $checkbox = $item.find(".service-selector-checkbox, input[type='checkbox']");
      $checkbox.prop("checked", true);
      $item.addClass("selected");
      
      // For old style
      const $details = $item.find(".service-details-row");
      $details.show();
      
      if (matchedSvc.cost != null) {
        $item.find(".service-cost-input").val(matchedSvc.cost);
      }
      if (matchedSvc.note) {
        $item.find(".service-note-input").val(matchedSvc.note);
      }
    }
  });
  
  // Handle custom services (not in service types)
  const serviceTypeNames = new Set((data.serviceTypes || []).map(st => st.name.toLowerCase()));
  const customServices = templateServices.filter(svc => !serviceTypeNames.has(svc.name.toLowerCase()));
  if (customServices.length > 0) {
    $("#entry-services-other").val(customServices.map(s => s.name).join("; "));
  }
  
  // Set misc cost
  if (template.miscCost != null) {
    $("#entry-cost").val(template.miscCost);
  }
  
  // Set notes
  if (template.notes) {
    $("#entry-notes").val(template.notes);
  }
  
  // Calculate next due date if offset is set
  if (template.nextDateOffsetDays != null && template.nextDateOffsetDays > 0) {
    const entryDate = $("#entry-date").val();
    if (entryDate && /^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
      const nextDate = addDaysToDate(entryDate, template.nextDateOffsetDays);
      $("#entry-next-date").val(nextDate);
    }
  }
  
  // Calculate next due odo if offset is set
  if (template.nextOdoOffset != null && template.nextOdoOffset > 0) {
    const entryOdo = $("#entry-odo").val();
    if (entryOdo && !isNaN(Number(entryOdo))) {
      const nextOdo = Number(entryOdo) + template.nextOdoOffset;
      $("#entry-next-odo").val(nextOdo);
    }
  }
  
  // Update cost total
  updateServiceCostTotal($("#service-checklist-container"));
  
  showToast(`Loaded template: ${template.name}`);
}

/**
 * Add days to a date string
 */
function addDaysToDate(dateStr, days) {
  const date = new Date(dateStr + "T00:00:00");
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ============================================
// SAVE CURRENT FORM AS TEMPLATE
// ============================================

/**
 * Show modal to save current form as a template
 */
function showSaveAsTemplateModal() {
  // Gather current form data
  const services = getSelectedServicesFromForm();
  const miscCost = $("#entry-cost").val();
  const notes = $("#entry-notes").val();
  
  if (services.length === 0 && !notes && !miscCost) {
    showToast("Please fill in some services or notes first");
    return;
  }
  
  // Create modal
  const $overlay = $("<div>").addClass("template-modal-overlay").attr("id", "save-template-modal");
  
  const $modal = $("<div>").addClass("template-modal");
  
  const $header = $("<div>").addClass("template-modal-header").append(
    $("<h3>").text("Save as Template"),
    $("<button>").addClass("template-modal-close").html("×").on("click", closeSaveTemplateModal)
  );
  
  const $body = $("<div>").addClass("template-modal-body");
  
  // Template name field
  const $nameField = $("<div>").addClass("field").append(
    $("<label>").text("Template Name"),
    $("<input>").attr({
      type: "text",
      id: "save-template-name",
      placeholder: "e.g., Full Synthetic Oil Change at Jiffy Lube"
    })
  );
  
  // Preview of what will be saved
  const $preview = $("<div>").addClass("template-services-preview").css("margin-top", "12px");
  $preview.append($("<div>").addClass("template-services-label").text("Services to save:"));
  
  const $servicesList = $("<div>").addClass("template-services-list");
  if (services.length === 0) {
    $servicesList.append($("<span>").addClass("text-muted").css("font-size", "0.75rem").text("No services selected"));
  } else {
    services.forEach(svc => {
      const costText = svc.cost != null ? ` ($${Number(svc.cost).toFixed(2)})` : "";
      $servicesList.append(
        $("<span>").addClass("template-service-chip").append(
          $("<span>").text(svc.name),
          costText ? $("<span>").addClass("cost").text(costText) : null
        )
      );
    });
  }
  $preview.append($servicesList);
  
  if (notes) {
    $preview.append(
      $("<div>").addClass("template-services-label").css("margin-top", "8px").text("Notes:"),
      $("<div>").addClass("template-notes-preview").text(notes)
    );
  }
  
  // Next due offset fields
  const $offsetFields = $("<div>").addClass("field-grid").css("margin-top", "12px").append(
    $("<div>").addClass("field").append(
      $("<label>").text("Next due offset (days)"),
      $("<input>").attr({
        type: "number",
        id: "save-template-offset-days",
        min: "0",
        placeholder: "e.g., 180 for 6 months"
      }),
      $("<small>").addClass("text-muted").text("Auto-calculate next due date")
    ),
    $("<div>").addClass("field").append(
      $("<label>").html("Next due offset (<span class='unit-label'>" + getUnitShort() + "</span>)"),
      $("<input>").attr({
        type: "number",
        id: "save-template-offset-odo",
        min: "0",
        placeholder: "e.g., 5000"
      }),
      $("<small>").addClass("text-muted").text("Auto-calculate next due mileage")
    )
  );
  
  $body.append($nameField, $preview, $offsetFields);
  
  const $footer = $("<div>").addClass("template-modal-footer").append(
    $("<button>").addClass("btn-ghost btn-small").text("Cancel").on("click", closeSaveTemplateModal),
    $("<button>").addClass("btn-primary btn-small").text("Save Template").on("click", function() {
      saveCurrentFormAsTemplate();
    })
  );
  
  $modal.append($header, $body, $footer);
  $overlay.append($modal);
  
  // Close on overlay click
  $overlay.on("click", function(e) {
    if (e.target === this) {
      closeSaveTemplateModal();
    }
  });
  
  $("body").append($overlay);
  $("#save-template-name").focus();
}

function closeSaveTemplateModal() {
  $("#save-template-modal").remove();
}

/**
 * Get selected services from the entry form
 */
function getSelectedServicesFromForm() {
  const services = [];
  
  // Get from checklist (supports both old .service-item and new .service-selector-item)
  $("#service-checklist-container .service-selector-item, #service-checklist-container .service-item").each(function() {
    const $item = $(this);
    const $checkbox = $item.find(".service-selector-checkbox, input[type='checkbox']");
    
    if ($checkbox.is(":checked")) {
      const name = $checkbox.val();
      const cost = $item.find(".service-cost-input").val();
      const note = $item.find(".service-note-input").val();
      
      services.push({
        name: name,
        cost: cost !== "" ? Number(cost) : null,
        note: note || ""
      });
    }
  });
  
  // Get from "other" field
  const otherText = $("#entry-services-other").val().trim();
  if (otherText) {
    const otherServices = otherText.split(/[,;]+/).map(s => s.trim()).filter(s => s);
    otherServices.forEach(name => {
      services.push({ name: name, cost: null, note: "" });
    });
  }
  
  return services;
}

/**
 * Save the current form data as a new template
 */
function saveCurrentFormAsTemplate() {
  const name = $("#save-template-name").val().trim();
  
  if (!name) {
    alert("Please enter a template name");
    return;
  }
  
  const services = getSelectedServicesFromForm();
  const miscCost = $("#entry-cost").val();
  const notes = $("#entry-notes").val();
  const offsetDays = $("#save-template-offset-days").val();
  const offsetOdo = $("#save-template-offset-odo").val();
  
  const template = addTemplate({
    name: name,
    services: services,
    miscCost: miscCost !== "" ? Number(miscCost) : null,
    notes: notes,
    nextDateOffsetDays: offsetDays !== "" ? Number(offsetDays) : null,
    nextOdoOffset: offsetOdo !== "" ? Number(offsetOdo) : null
  });
  
  closeSaveTemplateModal();
  renderTemplateSelector();
  showToast(`Template "${name}" saved!`);
}

// ============================================
// TEMPLATES SETTINGS TAB
// ============================================

/**
 * Render the templates settings tab
 */
function renderSettingsTemplates() {
  const $list = $("#settings-templates-list");
  if (!$list.length) return;
  
  $list.empty();
  
  const templates = getTemplates();
  
  if (templates.length === 0) {
    $list.append(
      $("<div>").addClass("templates-empty")
        .html('<i class="bi bi-clipboard-check"></i> No templates yet.<br>Create your first template below or save one from the entry form.')
    );
    return;
  }
  
  templates.forEach(template => {
    const $card = createTemplateCard(template);
    $list.append($card);
  });
}

/**
 * Create a template card for the settings list
 */
function createTemplateCard(template) {
  const services = normalizeServices(template.services || []);
  const totalCost = services.reduce((sum, s) => sum + (s.cost || 0), 0) + (template.miscCost || 0);
  
  const $card = $("<div>").addClass("template-card").attr("data-id", template.id);
  
  // Header
  const $header = $("<div>").addClass("template-card-header");
  
  const $summary = $("<div>").addClass("template-card-summary");
  $summary.append($("<div>").addClass("template-card-name").text(template.name));
  
  const $meta = $("<div>").addClass("template-card-meta");
  $meta.append(
    $("<span>").addClass("template-card-meta-item").text(`${services.length} service${services.length !== 1 ? 's' : ''}`)
  );
  if (totalCost > 0) {
    $meta.append(
      $("<span>").addClass("template-card-meta-item").text(`$${totalCost.toFixed(2)}`)
    );
  }
  if (template.nextOdoOffset) {
    $meta.append(
      $("<span>").addClass("template-card-meta-item").text(`+${template.nextOdoOffset} ${getUnitShort()}`)
    );
  }
  if (template.nextDateOffsetDays) {
    $meta.append(
      $("<span>").addClass("template-card-meta-item").text(`+${template.nextDateOffsetDays} days`)
    );
  }
  $summary.append($meta);
  
  const $toggle = $("<div>").addClass("template-card-toggle").html('<i class="bi bi-chevron-down"></i>');
  
  $header.append($summary, $toggle);
  
  // Body (hidden by default)
  const $body = $("<div>").addClass("template-card-body");
  
  // Edit fields
  const $fields = $("<div>").addClass("template-card-fields");
  
  // Name field
  $fields.append(
    $("<div>").addClass("field full-width").append(
      $("<label>").text("Template Name"),
      $("<input>").attr("type", "text").addClass("template-edit-name").val(template.name)
    )
  );
  
  // Misc cost field
  $fields.append(
    $("<div>").addClass("field").append(
      $("<label>").text("Misc/Other Cost"),
      $("<input>").attr({ type: "number", min: "0", step: "0.01" }).addClass("template-edit-misc-cost")
        .val(template.miscCost != null ? template.miscCost : "")
    )
  );
  
  // Next due offsets
  $fields.append(
    $("<div>").addClass("field").append(
      $("<label>").text("Next Due Offset (days)"),
      $("<input>").attr({ type: "number", min: "0" }).addClass("template-edit-offset-days")
        .val(template.nextDateOffsetDays != null ? template.nextDateOffsetDays : "")
    )
  );
  
  $fields.append(
    $("<div>").addClass("field").append(
      $("<label>").html("Next Due Offset (<span class='unit-label'>" + getUnitShort() + "</span>)"),
      $("<input>").attr({ type: "number", min: "0" }).addClass("template-edit-offset-odo")
        .val(template.nextOdoOffset != null ? template.nextOdoOffset : "")
    )
  );
  
  // Notes field
  $fields.append(
    $("<div>").addClass("field full-width").append(
      $("<label>").text("Default Notes"),
      $("<textarea>").addClass("template-edit-notes").attr("rows", 2).val(template.notes || "")
    )
  );
  
  $body.append($fields);
  
  // Services preview with edit button
  const $servicesSection = $("<div>").addClass("template-services-section");
  
  const $servicesHeader = $("<div>").addClass("template-services-header");
  $servicesHeader.append(
    $("<div>").addClass("template-services-label").text(`Services (${services.length})`),
    $("<button>").attr("type", "button").addClass("btn-ghost btn-tiny template-btn-edit-services").text("Edit Services")
  );
  $servicesSection.append($servicesHeader);
  
  if (services.length > 0) {
    const $servicesList = $("<div>").addClass("template-services-list");
    services.forEach(svc => {
      const costText = svc.cost != null ? ` ($${Number(svc.cost).toFixed(2)})` : "";
      $servicesList.append(
        $("<span>").addClass("template-service-chip").attr("title", svc.note || "").append(
          $("<span>").text(svc.name + costText)
        )
      );
    });
    $servicesSection.append($servicesList);
  } else {
    $servicesSection.append(
      $("<div>").addClass("template-no-services").text("No services selected")
    );
  }
  
  $body.append($servicesSection);
  
  // Action buttons
  const $actions = $("<div>").addClass("template-card-actions");
  $actions.append(
    $("<button>").addClass("btn-danger btn-small template-btn-delete").attr("type", "button").text("Delete"),
    $("<button>").addClass("btn-primary btn-small template-btn-save").attr("type", "button").text("Save Changes")
  );
  
  $body.append($actions);
  
  $card.append($header, $body);
  
  // Toggle expand/collapse
  $header.on("click", function() {
    $card.toggleClass("expanded");
  });
  
  return $card;
}

/**
 * Show modal to edit services for an existing template
 */
function showEditServicesModal(templateId) {
  const template = getTemplateById(templateId);
  if (!template) {
    showToast("Template not found");
    return;
  }
  
  const currentServices = normalizeServices(template.services || []);
  const currentServiceMap = {};
  currentServices.forEach(svc => {
    currentServiceMap[svc.name.toLowerCase()] = svc;
  });
  
  // Create modal
  const $overlay = $("<div>").addClass("template-modal-overlay").attr("id", "edit-services-modal");
  
  const $modal = $("<div>").addClass("template-modal template-modal-large");
  
  const $header = $("<div>").addClass("template-modal-header").append(
    $("<div>").append(
      $("<h3>").text("Edit Services"),
      $("<small>").addClass("text-muted").text(template.name)
    ),
    $("<button>").addClass("template-modal-close").html("×").on("click", closeEditServicesModal)
  );
  
  const $body = $("<div>").addClass("template-modal-body");
  
  // Build service selector
  const types = data.serviceTypes || [];
  
  const $selector = $("<div>").addClass("template-services-selector edit-mode").attr("id", "edit-template-services");
  
  // Search row
  const $searchRow = $("<div>").addClass("template-services-search");
  const $searchInput = $("<input>").attr({
    type: "text",
    placeholder: "Search services...",
    id: "edit-template-service-search"
  }).addClass("template-services-search-input");
  
  const $selectedCount = $("<span>").addClass("template-services-count").text("0 selected");
  
  $searchRow.append($searchInput, $selectedCount);
  $selector.append($searchRow);
  
  // Services list
  const $listContainer = $("<div>").addClass("template-services-list-container");
  
  types.forEach((st, index) => {
    const name = st.name || "";
    const nameLower = name.toLowerCase();
    const id = "edit-tpl-svc-" + index;
    const isSelected = currentServiceMap.hasOwnProperty(nameLower);
    const svcData = currentServiceMap[nameLower] || { cost: null, note: "" };
    
    const $item = $("<div>").addClass("template-service-item").attr("data-service-name", nameLower);
    if (isSelected) $item.addClass("selected");
    
    // Main row
    const $mainRow = $("<div>").addClass("template-service-main");
    
    const $checkbox = $("<input>").attr({ 
      type: "checkbox", 
      id: id, 
      value: name 
    }).addClass("template-service-checkbox");
    if (isSelected) $checkbox.prop("checked", true);
    
    const $label = $("<label>").attr("for", id).addClass("template-service-label");
    const $nameSpan = $("<span>").addClass("template-service-name").text(name);
    
    let intervalText = "";
    if (st.intervalMiles && st.intervalMonths) {
      intervalText = `${st.intervalMiles.toLocaleString()} ${getUnitShort()} / ${st.intervalMonths} mo`;
    } else if (st.intervalMiles) {
      intervalText = `${st.intervalMiles.toLocaleString()} ${getUnitShort()}`;
    } else if (st.intervalMonths) {
      intervalText = `${st.intervalMonths} months`;
    }
    
    const $intervalSpan = $("<span>").addClass("template-service-interval").text(intervalText);
    
    $label.append($nameSpan, $intervalSpan);
    $mainRow.append($checkbox, $label);
    
    // Details row
    const $detailsRow = $("<div>").addClass("template-service-details-row");
    
    const $costGroup = $("<div>").addClass("template-service-field-group");
    $costGroup.append(
      $("<label>").text("Default Cost"),
      $("<div>").addClass("template-service-cost-wrapper").append(
        $("<span>").addClass("currency-symbol").text("$"),
        $("<input>").attr({ 
          type: "number", 
          min: "0", 
          step: "0.01", 
          placeholder: "0.00" 
        }).addClass("template-service-cost").val(svcData.cost != null ? svcData.cost : "")
      )
    );
    
    const $noteGroup = $("<div>").addClass("template-service-field-group template-service-note-group");
    $noteGroup.append(
      $("<label>").text("Default Note"),
      $("<input>").attr({ 
        type: "text", 
        placeholder: "Parts, brand, specifications..." 
      }).addClass("template-service-note").val(svcData.note || "")
    );
    
    $detailsRow.append($costGroup, $noteGroup);
    
    $item.append($mainRow, $detailsRow);
    $listContainer.append($item);
    
    // Toggle handler
    $checkbox.on("change", function() {
      const isChecked = $(this).is(":checked");
      $item.toggleClass("selected", isChecked);
      
      if (!isChecked) {
        $item.find(".template-service-cost, .template-service-note").val("");
      }
      
      updateEditSelectedCount();
    });
  });
  
  $selector.append($listContainer);
  
  // Quick actions
  const $actionsRow = $("<div>").addClass("template-services-actions");
  $actionsRow.append(
    $("<button>").attr("type", "button").addClass("btn-ghost btn-tiny").text("Select All").on("click", function() {
      $listContainer.find(".template-service-item:visible .template-service-checkbox").prop("checked", true).trigger("change");
    }),
    $("<button>").attr("type", "button").addClass("btn-ghost btn-tiny").text("Clear All").on("click", function() {
      $listContainer.find(".template-service-checkbox").prop("checked", false).trigger("change");
    })
  );
  $selector.append($actionsRow);
  
  // Search functionality
  $searchInput.on("input", function() {
    const query = $(this).val().toLowerCase().trim();
    
    $listContainer.find(".template-service-item").each(function() {
      const $item = $(this);
      const name = $item.attr("data-service-name") || "";
      
      if (!query || name.includes(query)) {
        $item.show();
      } else {
        $item.hide();
      }
    });
  });
  
  function updateEditSelectedCount() {
    const count = $listContainer.find(".template-service-checkbox:checked").length;
    $selectedCount.text(count + " selected");
    $selectedCount.toggleClass("has-selection", count > 0);
  }
  
  // Initialize count
  updateEditSelectedCount();
  
  $body.append($selector);
  
  const $footer = $("<div>").addClass("template-modal-footer").append(
    $("<button>").addClass("btn-ghost btn-small").text("Cancel").on("click", closeEditServicesModal),
    $("<button>").addClass("btn-primary btn-small").text("Save Services").attr("id", "save-edit-services-btn").on("click", function() {
      saveEditedServices(templateId);
    })
  );
  
  $modal.append($header, $body, $footer);
  $overlay.append($modal);
  
  // Close on overlay click
  $overlay.on("click", function(e) {
    if (e.target === this) {
      closeEditServicesModal();
    }
  });
  
  $("body").append($overlay);
  $searchInput.focus();
}

function closeEditServicesModal() {
  $("#edit-services-modal").remove();
}

/**
 * Save edited services to a template
 */
function saveEditedServices(templateId) {
  const template = getTemplateById(templateId);
  if (!template) {
    showToast("Template not found");
    closeEditServicesModal();
    return;
  }
  
  const services = [];
  
  $("#edit-template-services .template-service-item").each(function() {
    const $item = $(this);
    const $checkbox = $item.find(".template-service-checkbox");
    
    if ($checkbox.is(":checked")) {
      const name = $checkbox.val();
      const cost = $item.find(".template-service-cost").val();
      const note = $item.find(".template-service-note").val();
      
      services.push({
        name: name,
        cost: cost !== "" ? Number(cost) : null,
        note: note || ""
      });
    }
  });
  
  // Update template
  template.services = services;
  template.updatedAt = new Date().toISOString();
  saveData();
  
  closeEditServicesModal();
  renderSettingsTemplates();
  renderTemplateSelector();
  showToast("Services updated");
}

/**
 * Render the add template form in settings
 */
function renderAddTemplateForm() {
  const $container = $("#settings-template-add-form");
  if (!$container.length) return;
  
  $container.empty();
  
  const $form = $("<div>").addClass("template-add-section");
  
  $form.append($("<div>").addClass("template-add-title").text("+ Create New Template"));
  
  const $fields = $("<div>").addClass("template-add-fields");
  
  // Name field
  $fields.append(
    $("<div>").addClass("field full-width").append(
      $("<label>").text("Template Name"),
      $("<input>").attr({
        type: "text",
        id: "new-template-name",
        placeholder: "e.g., Full Synthetic Oil Change at Jiffy Lube"
      })
    )
  );
  
  // Services selector
  $fields.append(
    $("<div>").addClass("field full-width").append(
      $("<label>").text("Services (select and set default costs)"),
      renderTemplateServiceSelector()
    )
  );
  
  // Misc cost
  $fields.append(
    $("<div>").addClass("field").append(
      $("<label>").text("Misc/Other Cost"),
      $("<input>").attr({
        type: "number",
        id: "new-template-misc-cost",
        min: "0",
        step: "0.01",
        placeholder: "0.00"
      })
    )
  );
  
  // Notes
  $fields.append(
    $("<div>").addClass("field").append(
      $("<label>").text("Default Notes"),
      $("<textarea>").attr({
        id: "new-template-notes",
        rows: 2,
        placeholder: "Shop name, oil weight, part numbers..."
      })
    )
  );
  
  // Offset fields
  $fields.append(
    $("<div>").addClass("field").append(
      $("<label>").text("Next Due Offset (days)"),
      $("<input>").attr({
        type: "number",
        id: "new-template-offset-days",
        min: "0",
        placeholder: "e.g., 180"
      }),
      $("<small>").addClass("text-muted").text("Auto-fill next due date when loaded")
    )
  );
  
  $fields.append(
    $("<div>").addClass("field").append(
      $("<label>").html("Next Due Offset (<span class='unit-label'>" + getUnitShort() + "</span>)"),
      $("<input>").attr({
        type: "number",
        id: "new-template-offset-odo",
        min: "0",
        placeholder: "e.g., 5000"
      }),
      $("<small>").addClass("text-muted").text("Auto-fill next due mileage when loaded")
    )
  );
  
  $form.append($fields);
  
  // Add button
  const $btnRow = $("<div>").addClass("button-row").css("margin-top", "12px").append(
    $("<button>").attr({ type: "button", id: "new-template-add-btn" })
      .addClass("btn-primary btn-small").text("Create Template")
  );
  
  $form.append($btnRow);
  
  $container.append($form);
}

/**
 * Render service selector for template creation
 */
function renderTemplateServiceSelector() {
  const $container = $("<div>").addClass("template-services-selector").attr("id", "new-template-services");
  
  const types = data.serviceTypes || [];
  
  if (types.length === 0) {
    $container.append(
      $("<div>").addClass("template-services-empty").append(
        $("<span>").text("No service types configured."),
        $("<a>").attr("href", "#").text("Add some in Service Types tab").on("click", function(e) {
          e.preventDefault();
          $(".settings-tab-btn").removeClass("active");
          $(".settings-tab-btn[data-tab='services']").addClass("active");
          $(".settings-tab-view").removeClass("active");
          $("#settings-tab-services").addClass("active");
        })
      )
    );
    return $container;
  }
  
  // Search/filter input
  const $searchRow = $("<div>").addClass("template-services-search");
  const $searchInput = $("<input>").attr({
    type: "text",
    placeholder: "Search services...",
    id: "template-service-search"
  }).addClass("template-services-search-input");
  
  const $selectedCount = $("<span>").addClass("template-services-count").text("0 selected");
  
  $searchRow.append($searchInput, $selectedCount);
  $container.append($searchRow);
  
  // Services list container
  const $listContainer = $("<div>").addClass("template-services-list-container");
  
  types.forEach((st, index) => {
    const name = st.name || "";
    const id = "new-tpl-svc-" + index;
    
    const $item = $("<div>").addClass("template-service-item").attr("data-service-name", name.toLowerCase());
    
    // Main row with checkbox and name
    const $mainRow = $("<div>").addClass("template-service-main");
    
    const $checkbox = $("<input>").attr({ 
      type: "checkbox", 
      id: id, 
      value: name 
    }).addClass("template-service-checkbox");
    
    const $label = $("<label>").attr("for", id).addClass("template-service-label");
    const $nameSpan = $("<span>").addClass("template-service-name").text(name);
    
    // Show default interval if available
    let intervalText = "";
    if (st.intervalMiles && st.intervalMonths) {
      intervalText = `${st.intervalMiles.toLocaleString()} ${getUnitShort()} / ${st.intervalMonths} mo`;
    } else if (st.intervalMiles) {
      intervalText = `${st.intervalMiles.toLocaleString()} ${getUnitShort()}`;
    } else if (st.intervalMonths) {
      intervalText = `${st.intervalMonths} months`;
    }
    
    const $intervalSpan = $("<span>").addClass("template-service-interval").text(intervalText);
    
    $label.append($nameSpan, $intervalSpan);
    $mainRow.append($checkbox, $label);
    
    // Expandable details row
    const $detailsRow = $("<div>").addClass("template-service-details-row");
    
    const $costGroup = $("<div>").addClass("template-service-field-group");
    $costGroup.append(
      $("<label>").text("Default Cost"),
      $("<div>").addClass("template-service-cost-wrapper").append(
        $("<span>").addClass("currency-symbol").text("$"),
        $("<input>").attr({ 
          type: "number", 
          min: "0", 
          step: "0.01", 
          placeholder: "0.00" 
        }).addClass("template-service-cost")
      )
    );
    
    const $noteGroup = $("<div>").addClass("template-service-field-group template-service-note-group");
    $noteGroup.append(
      $("<label>").text("Default Note"),
      $("<input>").attr({ 
        type: "text", 
        placeholder: "Parts, brand, specifications..." 
      }).addClass("template-service-note")
    );
    
    $detailsRow.append($costGroup, $noteGroup);
    
    $item.append($mainRow, $detailsRow);
    $listContainer.append($item);
    
    // Toggle details visibility and update count
    $checkbox.on("change", function() {
      const isChecked = $(this).is(":checked");
      $item.toggleClass("selected", isChecked);
      
      if (!isChecked) {
        $item.find(".template-service-cost, .template-service-note").val("");
      }
      
      updateSelectedCount();
    });
  });
  
  $container.append($listContainer);
  
  // Quick actions row
  const $actionsRow = $("<div>").addClass("template-services-actions");
  $actionsRow.append(
    $("<button>").attr("type", "button").addClass("btn-ghost btn-tiny").text("Select All").on("click", function() {
      $listContainer.find(".template-service-item:visible .template-service-checkbox").prop("checked", true).trigger("change");
    }),
    $("<button>").attr("type", "button").addClass("btn-ghost btn-tiny").text("Clear All").on("click", function() {
      $listContainer.find(".template-service-checkbox").prop("checked", false).trigger("change");
    })
  );
  $container.append($actionsRow);
  
  // Search functionality
  $searchInput.on("input", function() {
    const query = $(this).val().toLowerCase().trim();
    
    $listContainer.find(".template-service-item").each(function() {
      const $item = $(this);
      const name = $item.attr("data-service-name") || "";
      
      if (!query || name.includes(query)) {
        $item.show();
      } else {
        $item.hide();
      }
    });
  });
  
  // Update selected count function
  function updateSelectedCount() {
    const count = $listContainer.find(".template-service-checkbox:checked").length;
    $selectedCount.text(count + " selected");
    $selectedCount.toggleClass("has-selection", count > 0);
  }
  
  return $container;
}

/**
 * Get services from the new template form
 */
function getServicesFromNewTemplateForm() {
  const services = [];
  
  $("#new-template-services .template-service-item").each(function() {
    const $item = $(this);
    const $checkbox = $item.find(".template-service-checkbox");
    
    if ($checkbox.is(":checked")) {
      const name = $checkbox.val();
      const cost = $item.find(".template-service-cost").val();
      const note = $item.find(".template-service-note").val();
      
      services.push({
        name: name,
        cost: cost !== "" ? Number(cost) : null,
        note: note || ""
      });
    }
  });
  
  return services;
}

/**
 * Handle creating a new template from the settings form
 */
function createTemplateFromSettingsForm() {
  const name = $("#new-template-name").val().trim();
  
  if (!name) {
    alert("Please enter a template name");
    return;
  }
  
  const services = getServicesFromNewTemplateForm();
  const miscCost = $("#new-template-misc-cost").val();
  const notes = $("#new-template-notes").val();
  const offsetDays = $("#new-template-offset-days").val();
  const offsetOdo = $("#new-template-offset-odo").val();
  
  addTemplate({
    name: name,
    services: services,
    miscCost: miscCost !== "" ? Number(miscCost) : null,
    notes: notes,
    nextDateOffsetDays: offsetDays !== "" ? Number(offsetDays) : null,
    nextOdoOffset: offsetOdo !== "" ? Number(offsetOdo) : null
  });
  
  // Clear form
  $("#new-template-name").val("");
  $("#new-template-misc-cost").val("");
  $("#new-template-notes").val("");
  $("#new-template-offset-days").val("");
  $("#new-template-offset-odo").val("");
  $("#new-template-services input[type='checkbox']").prop("checked", false);
  $("#new-template-services .template-service-details").removeClass("visible").find("input").val("");
  
  // Re-render
  renderSettingsTemplates();
  renderTemplateSelector();
  
  showToast(`Template "${name}" created!`);
}

// ============================================
// EVENT HANDLERS
// ============================================

/**
 * Initialize templates feature - called after data is loaded
 */
function initTemplatesFeature() {
  renderTemplateSelector();
}

$(function() {
  // Save as template button in entry form
  $(document).on("click", "#save-as-template-btn", function(e) {
    e.preventDefault();
    showSaveAsTemplateModal();
  });
  
  // Template settings tab events
  $(document).on("click", ".template-btn-save", function() {
    const $card = $(this).closest(".template-card");
    const id = $card.attr("data-id");
    
    const name = $card.find(".template-edit-name").val().trim();
    const miscCost = $card.find(".template-edit-misc-cost").val();
    const notes = $card.find(".template-edit-notes").val();
    const offsetDays = $card.find(".template-edit-offset-days").val();
    const offsetOdo = $card.find(".template-edit-offset-odo").val();
    
    if (!name) {
      alert("Template name is required");
      return;
    }
    
    updateTemplate(id, {
      name: name,
      miscCost: miscCost !== "" ? Number(miscCost) : null,
      notes: notes,
      nextDateOffsetDays: offsetDays !== "" ? Number(offsetDays) : null,
      nextOdoOffset: offsetOdo !== "" ? Number(offsetOdo) : null
    });
    
    renderSettingsTemplates();
    renderTemplateSelector();
    showToast("Template updated");
  });
  
  $(document).on("click", ".template-btn-delete", function() {
    const $card = $(this).closest(".template-card");
    const id = $card.attr("data-id");
    const template = getTemplateById(id);
    
    if (!template) return;
    
    if (!confirm(`Delete template "${template.name}"?\n\nThis cannot be undone.`)) {
      return;
    }
    
    deleteTemplate(id);
    renderSettingsTemplates();
    renderTemplateSelector();
    showToast("Template deleted");
  });
  
  // Edit services button in template card
  $(document).on("click", ".template-btn-edit-services", function(e) {
    e.stopPropagation(); // Prevent card toggle
    const $card = $(this).closest(".template-card");
    const id = $card.attr("data-id");
    showEditServicesModal(id);
  });
  
  // Create template from settings form
  $(document).on("click", "#new-template-add-btn", function() {
    createTemplateFromSettingsForm();
  });
  
  // Settings tab: templates
  $(document).on("click", ".settings-tab-btn[data-tab='templates']", function() {
    renderSettingsTemplates();
    renderAddTemplateForm();
  });
});