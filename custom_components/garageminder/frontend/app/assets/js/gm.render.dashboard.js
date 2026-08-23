/**
 * Garage Maintenance - Dashboard Rendering
 * Includes "All Vehicles" overview with health cards, spending breakdown, etc.
 * Updated: Per-service cost and note fields
 */

// Pagination state for vehicle health cards in overview
let overviewVehiclePage = 1;

/**
 * Get vehicles per page based on screen size and user settings
 */
function getVehiclesPerPage() {
  // Check if user has set a custom value in settings
  const customPerPage = data.settings?.overviewVehiclesPerPage;
  if (customPerPage && customPerPage > 0) {
    return customPerPage;
  }
  
  // Responsive defaults based on screen width
  const width = window.innerWidth;
  if (width <= 480) return 4;      // Mobile
  if (width <= 768) return 6;      // Tablet
  if (width <= 1200) return 6;     // Small desktop
  return 9;                         // Large desktop
}

// ============================================
// VEHICLE PICKER
// ============================================
function renderVehiclePicker() {
  const $sel = $("#active-vehicle");
  $sel.empty();
  
  // Add "All Vehicles" option first
  $sel.append($("<option>").val("all").html('<i class="bi bi-car-front-fill"></i> All Vehicles'));
  
  // Add individual vehicles
  data.vehicles.forEach(v => {
    $sel.append($("<option>").val(v.id).text(v.name));
  });
  
  // Set default to "all" if no active vehicle or if activeVehicleId is "all"
  if (!activeVehicleId) {
    activeVehicleId = "all";
  }
  $sel.val(activeVehicleId);

  // Update UI based on selection
  updateDashboardForVehicleSelection();
}

function updateDashboardForVehicleSelection() {
  const isAllVehicles = activeVehicleId === "all";
  
  // Show/hide elements based on selection
  $(".dashboard-actions").toggle(!isAllVehicles);
  $("#dashboard-entry-form").toggle(false); // Always hide form initially
  $(".dashboard-sidebar").toggle(!isAllVehicles);
  $("#single-vehicle-view").toggle(!isAllVehicles);
  $("#all-vehicles-overview").toggle(isAllVehicles);
  
  // Update overview label
  if (isAllVehicles) {
    $("#overview-vehicle-label").html(`<div>Showing all ${data.vehicles.length} vehicle(s)</div>`);
    $("#vehicle-picker-odo").empty();
  } else {
    const v = data.vehicles.find(v => v.id === activeVehicleId);
    const unit = getUnitShort();
    
    if (v) {
      const line1 = v.name + (v.currentOdo != null ? ` • Current: ${v.currentOdo.toLocaleString()} ${unit}` : "");
      const metaParts = [];
      if (v.vin) metaParts.push(`VIN: ${v.vin}`);
      if (v.plate) metaParts.push(`Plate: ${v.plate}`);
      let html = `<div>${line1}</div>`;
      if (metaParts.length) {
        html += `<div style="font-size:0.75rem; color: var(--text-muted);">${metaParts.join(" • ")}</div>`;
      }
      $("#overview-vehicle-label").html(html);
    } else {
      $("#overview-vehicle-label").text("No vehicle selected");
    }
    
    renderVehiclePickerOdometer();
  }
}

function renderVehiclePickerOdometer() {
  const $container = $("#vehicle-picker-odo");
  $container.empty();
  
  if (!activeVehicleId || activeVehicleId === "all") {
    return;
  }
  
  const v = data.vehicles.find(v => v.id === activeVehicleId);
  if (!v) return;
  
  const unit = getUnitShort();
  const currentOdo = v.currentOdo != null ? v.currentOdo : "";
  
  const $odoRow = $("<div>").addClass("vehicle-picker-odo-row");
  
  const $label = $("<span>").addClass("vehicle-picker-odo-label").text("Current:");
  const $input = $("<input>")
    .attr({ type: "number", min: "0", step: "1", placeholder: "0" })
    .addClass("vehicle-picker-odo-input")
    .val(currentOdo)
    .attr("id", "quick-odo-input");
  const $unit = $("<span>").addClass("vehicle-picker-odo-unit").text(unit);
  const $updateBtn = $("<button>")
    .addClass("btn-primary btn-small vehicle-picker-odo-btn")
    .attr("type", "button")
    .text("Update")
    .on("click", updateVehicleOdometerQuick);
  
  $odoRow.append($label, $input, $unit, $updateBtn);
  $container.append($odoRow);
  
  $input.on("keypress", function(e) {
    if (e.which === 13) {
      e.preventDefault();
      updateVehicleOdometerQuick();
    }
  });
}

function updateVehicleOdometerQuick() {
  if (!activeVehicleId || activeVehicleId === "all") return;
  
  const v = data.vehicles.find(v => v.id === activeVehicleId);
  if (!v) return;
  
  const newOdo = $("#quick-odo-input").val();
  const odoValue = newOdo !== "" ? Number(newOdo) : null;
  
  if (odoValue !== null && odoValue < 0) {
    alert("Odometer cannot be negative.");
    return;
  }
  
  if (v.currentOdo === odoValue) {
    showToast("No change in odometer");
    return;
  }
  
  v.currentOdo = odoValue;
  saveData();
  
  renderVehiclePicker();
  renderDashboardRemindersSnippet();
  renderRemindersPage();
  
  showToast(`Odometer updated to ${odoValue !== null ? odoValue.toLocaleString() : "-"}`);
}

// ============================================
// ALL VEHICLES OVERVIEW
// ============================================
function renderAllVehiclesOverview() {
  const $container = $("#all-vehicles-overview");
  $container.empty();
  
  if (!data.vehicles.length) {
    $container.append(
      $("<div>").addClass("entry-empty")
        .html('<i class="bi bi-car-front-fill"></i> No vehicles yet.<br>Add your first vehicle in Settings to get started.')
    );
    return;
  }
  
  // Calculate overall stats
  const stats = calculateOverallStats();
  
  // Render overview stats cards
  $container.append(renderOverviewStats(stats));
  
  // Render vehicle health cards
  $container.append(renderVehicleHealthCards());
  
  // Render spending breakdown
  $container.append(renderSpendingBreakdown(stats));
  
  // Render recent activity
  $container.append(renderRecentActivity());
}

function calculateOverallStats() {
  const today = getTodayDateInSettingsTz();
  const currentYear = today.getFullYear();
  
  let totalOverdue = 0;
  let totalUpcoming = 0;
  let lastServiceDate = null;
  let ytdSpend = 0;
  let lifetimeSpend = 0;
  const spendByCategory = {};
  
  // Calculate reminder stats
  data.reminders.forEach(r => {
    const vehicle = data.vehicles.find(v => v.id === r.vehicleId);
    const currentOdo = vehicle?.currentOdo ?? null;
    const derived = computeReminderDerived(r, currentOdo);
    
    if (derived.level === "overdue") totalOverdue++;
    if (derived.level === "upcoming") totalUpcoming++;
  });
  
  // Calculate spending and last service
  data.entries.forEach(e => {
    // Track last service date
    if (e.date && (!lastServiceDate || e.date > lastServiceDate)) {
      lastServiceDate = e.date;
    }
    
    // Calculate total cost from services (new format) + legacy cost field
    const entryCost = calculateEntryTotalCost(e);
    
    if (entryCost > 0) {
      lifetimeSpend += entryCost;
      
      // YTD spending
      if (e.date) {
        const entryYear = parseInt(e.date.substring(0, 4), 10);
        if (entryYear === currentYear) {
          ytdSpend += entryCost;
        }
      }
      
      // Spending by category - use per-service costs when available
      const services = normalizeServices(e.services || []);
      services.forEach(svc => {
        const svcName = typeof svc === 'string' ? svc : svc.name;
        const svcCost = typeof svc === 'object' && svc.cost != null ? svc.cost : null;
        
        if (!spendByCategory[svcName]) spendByCategory[svcName] = 0;
        
        if (svcCost != null) {
          // Use actual per-service cost
          spendByCategory[svcName] += svcCost;
        } else if (e.cost != null && services.length > 0) {
          // Fallback: distribute legacy cost evenly
          spendByCategory[svcName] += e.cost / services.length;
        }
      });
    }
  });
  
  return {
    totalOverdue,
    totalUpcoming,
    lastServiceDate,
    ytdSpend,
    lifetimeSpend,
    spendByCategory
  };
}

/**
 * Calculate total cost for an entry (services + misc cost)
 */
function calculateEntryTotalCost(entry) {
  let total = 0;
  
  // Sum per-service costs
  const services = normalizeServices(entry.services || []);
  services.forEach(svc => {
    if (typeof svc === 'object' && svc.cost != null) {
      total += Number(svc.cost) || 0;
    }
  });
  
  // Add misc/legacy cost
  if (entry.cost != null) {
    total += Number(entry.cost) || 0;
  }
  
  return total;
}

/**
 * Normalize services array to handle both old (string[]) and new (object[]) formats
 */
function normalizeServices(services) {
  if (!Array.isArray(services)) return [];
  return services.map(svc => {
    if (typeof svc === 'string') {
      return { name: svc, cost: null, note: '' };
    }
    return {
      name: svc.name || '',
      cost: svc.cost != null ? Number(svc.cost) : null,
      note: svc.note || ''
    };
  });
}

/**
 * Get service names from normalized services array
 */
function getServiceNames(services) {
  return normalizeServices(services).map(svc => svc.name);
}

function renderOverviewStats(stats) {
  const $section = $("<div>").addClass("overview-section");
  
  $section.append(
    $("<div>").addClass("overview-section-title").html('<span class="icon"><i class="bi bi-bar-chart-fill"></i></span> Overview')
  );
  
  const $grid = $("<div>").addClass("overview-stats-grid");
  
  // Overdue card
  $grid.append(
    $("<div>").addClass("overview-stat-card " + (stats.totalOverdue > 0 ? "stat-overdue" : "stat-ok"))
      .append(
        $("<div>").addClass("stat-icon").text(stats.totalOverdue > 0 ? "⚠" : "✓"),
        $("<div>").addClass("stat-value").text(stats.totalOverdue),
        $("<div>").addClass("stat-label").text("Overdue")
      )
  );
  
  // Upcoming card
  $grid.append(
    $("<div>").addClass("overview-stat-card " + (stats.totalUpcoming > 0 ? "stat-upcoming" : "stat-ok"))
      .append(
        $("<div>").addClass("stat-icon").text("⏰"),
        $("<div>").addClass("stat-value").text(stats.totalUpcoming),
        $("<div>").addClass("stat-label").text("Upcoming")
      )
  );
  
  // Last service card
  $grid.append(
    $("<div>").addClass("overview-stat-card")
      .append(
        $("<div>").addClass("stat-icon").html('<i class=\"bi bi-calendar-event\"></i>'),
        $("<div>").addClass("stat-value").text(stats.lastServiceDate ? formatDateNice(stats.lastServiceDate) : "-"),
        $("<div>").addClass("stat-label").text("Last Service")
      )
  );
  
  // YTD Spend card
  $grid.append(
    $("<div>").addClass("overview-stat-card")
      .append(
        $("<div>").addClass("stat-icon").html('<i class=\"bi bi-currency-dollar\"></i>'),
        $("<div>").addClass("stat-value").text("$" + stats.ytdSpend.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})),
        $("<div>").addClass("stat-label").text("YTD Spend")
      )
  );
  
  $section.append($grid);
  return $section;
}

function renderVehicleHealthCards() {
  const $section = $("<div>").addClass("overview-section");
  
  const totalVehicles = data.vehicles.length;
  const perPage = getVehiclesPerPage();
  const totalPages = Math.ceil(totalVehicles / perPage);
  
  // Ensure current page is valid
  if (overviewVehiclePage < 1) overviewVehiclePage = 1;
  if (overviewVehiclePage > totalPages) overviewVehiclePage = totalPages || 1;
  
  // Calculate which vehicles to show
  const startIdx = (overviewVehiclePage - 1) * perPage;
  const endIdx = Math.min(startIdx + perPage, totalVehicles);
  const pageVehicles = data.vehicles.slice(startIdx, endIdx);
  
  // Header with count
  const $header = $("<div>").addClass("overview-section-title");
  $header.html('<span class="icon"><i class="bi bi-car-front-fill"></i></span> Vehicle Health');
  if (totalPages > 1) {
    $header.append(
      $("<span>").addClass("section-page-info").text(
        ` (${startIdx + 1}-${endIdx} of ${totalVehicles})`
      )
    );
  }
  $section.append($header);
  
  // Grid with current page vehicles
  const $grid = $("<div>").addClass("health-cards-grid");
  
  pageVehicles.forEach(v => {
    $grid.append(createVehicleHealthCard(v));
  });
  
  $section.append($grid);
  
  // Pagination controls (if needed)
  if (totalPages > 1) {
    const $pager = $("<div>").addClass("overview-pager");
    
    const $prevBtn = $("<button>")
      .addClass("btn-ghost btn-small")
      .text("← Previous")
      .prop("disabled", overviewVehiclePage <= 1)
      .on("click", function(e) {
        e.stopPropagation();
        if (overviewVehiclePage > 1) {
          overviewVehiclePage--;
          renderAllVehiclesOverview();
        }
      });
    
    const $pageInfo = $("<span>").addClass("pager-info").text(
      `Page ${overviewVehiclePage} of ${totalPages}`
    );
    
    const $nextBtn = $("<button>")
      .addClass("btn-ghost btn-small")
      .text("Next →")
      .prop("disabled", overviewVehiclePage >= totalPages)
      .on("click", function(e) {
        e.stopPropagation();
        if (overviewVehiclePage < totalPages) {
          overviewVehiclePage++;
          renderAllVehiclesOverview();
        }
      });
    
    $pager.append($prevBtn, $pageInfo, $nextBtn);
    $section.append($pager);
  }
  
  return $section;
}

function createVehicleHealthCard(vehicle) {
  const currentOdo = vehicle.currentOdo ?? null;
  const unit = getUnitShort();
  
  // Calculate stats for this vehicle
  const vehicleReminders = data.reminders.filter(r => r.vehicleId === vehicle.id);
  const vehicleEntries = data.entries.filter(e => e.vehicleId === vehicle.id);
  
  let overdueCount = 0;
  let upcomingCount = 0;
  
  vehicleReminders.forEach(r => {
    const derived = computeReminderDerived(r, currentOdo);
    if (derived.level === "overdue") overdueCount++;
    if (derived.level === "upcoming") upcomingCount++;
  });
  
  // Get last service date
  let lastServiceDate = null;
  vehicleEntries.forEach(e => {
    if (e.date && (!lastServiceDate || e.date > lastServiceDate)) {
      lastServiceDate = e.date;
    }
  });
  
  // Calculate total spend for this vehicle
  const totalSpend = vehicleEntries.reduce((sum, e) => sum + calculateEntryTotalCost(e), 0);
  
  // Determine overall status
  let status = "ok";
  if (overdueCount > 0) status = "overdue";
  else if (upcomingCount > 0) status = "upcoming";
  
  // Get renewal info
  const renewalInfo = getVehicleRenewalInfo(vehicle.id);
  
  // Create card
  const $card = $("<div>")
    .addClass("vehicle-health-card status-" + status)
    .attr("data-vehicle-id", vehicle.id);
  
  // ========== VEHICLE PHOTO SECTION (NEW) ==========
  const $photoSection = $("<div>").addClass("health-card-photo");
  $photoSection.append(createVehicleThumbnail(vehicle, 'medium'));
  $card.append($photoSection);
  
  // Header
  const $header = $("<div>").addClass("health-card-header");
  
  const $titleBlock = $("<div>").addClass("health-card-title-block");
  $titleBlock.append(
    $("<h3>").addClass("health-card-title").text(vehicle.name)
  );
  
  // Add year/make/model if available
  const vehicleInfo = buildVehicleInfoString(vehicle);
  if (vehicleInfo && vehicleInfo !== vehicle.name) {
    $titleBlock.append(
      $("<div>").addClass("health-card-vehicle-info").text(vehicleInfo)
    );
  }
  
  $titleBlock.append(
    $("<div>").addClass("health-card-meta").text(
      currentOdo != null ? `${currentOdo.toLocaleString()} ${unit}` : "No mileage set"
    )
  );
  
  const statusLabels = { ok: "Healthy", upcoming: "Due Soon", overdue: "Overdue" };
  const $badge = $("<div>")
    .addClass("health-status-badge status-" + status)
    .append(
      $("<span>").addClass("status-dot"),
      $("<span>").text(statusLabels[status])
    );
  
  $header.append($titleBlock, $badge);
  $card.append($header);
  
  // Stats
  const $stats = $("<div>").addClass("health-card-stats");
  
  $stats.append(
    $("<div>").addClass("health-stat-item").append(
      $("<div>").addClass("health-stat-label").text("Overdue"),
      $("<div>").addClass("health-stat-value " + (overdueCount > 0 ? "overdue" : "")).text(overdueCount)
    ),
    $("<div>").addClass("health-stat-item").append(
      $("<div>").addClass("health-stat-label").text("Upcoming"),
      $("<div>").addClass("health-stat-value " + (upcomingCount > 0 ? "upcoming" : "")).text(upcomingCount)
    ),
    $("<div>").addClass("health-stat-item").append(
      $("<div>").addClass("health-stat-label").text("Last Service"),
      $("<div>").addClass("health-stat-value").text(lastServiceDate ? formatDateNice(lastServiceDate) : "-")
    ),
    $("<div>").addClass("health-stat-item").append(
      $("<div>").addClass("health-stat-label").text("Total Spend"),
      $("<div>").addClass("health-stat-value").text("$" + totalSpend.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}))
    )
  );
  
  $card.append($stats);
  
  // Renewals section
  const $renewals = $("<div>").addClass("health-renewals");
  
  // Insurance renewal
  const insuranceClass = renewalInfo.insurance.status ? "status-" + renewalInfo.insurance.status : "status-notset";
  $renewals.append(
    $("<div>").addClass("renewal-item " + insuranceClass).append(
      $("<span>").addClass("renewal-icon").html('<i class="bi bi-shield-check"></i>'),
      $("<span>").addClass("renewal-label").text("Insurance:"),
      $("<span>").addClass("renewal-value").text(renewalInfo.insurance.display)
    )
  );
  
  // Registration renewal
  const registrationClass = renewalInfo.registration.status ? "status-" + renewalInfo.registration.status : "status-notset";
  $renewals.append(
    $("<div>").addClass("renewal-item " + registrationClass).append(
      $("<span>").addClass("renewal-icon").html('<i class=\"bi bi-clipboard-check\"></i>'),
      $("<span>").addClass("renewal-label").text("Registration:"),
      $("<span>").addClass("renewal-value").text(renewalInfo.registration.display)
    )
  );
  
  $card.append($renewals);
  
  // Footer with action
  const $footer = $("<div>").addClass("health-card-footer");
  $footer.append(
    $("<button>").addClass("health-card-action").html("View Details →")
  );
  $card.append($footer);
  
  // Click handler for card
  $card.on("click", function() {
    setActiveVehicle(vehicle.id);
    renderDashboard();
  });
  
  return $card;
}

function getVehicleRenewalInfo(vehicleId) {
  const today = getTodayDateInSettingsTz();
  
  const result = {
    insurance: { display: "Not set", status: null, daysLeft: null },
    registration: { display: "Not set", status: null, daysLeft: null }
  };
  
  // Find insurance and registration reminders
  const reminders = data.reminders.filter(r => r.vehicleId === vehicleId);
  
  reminders.forEach(r => {
    const serviceName = (r.serviceName || "").toLowerCase();
    let type = null;
    
    if (serviceName.includes("insurance")) {
      type = "insurance";
    } else if (serviceName.includes("registration")) {
      type = "registration";
    }
    
    if (type && r.nextDate) {
      const dueDate = new Date(r.nextDate + "T00:00:00");
      const daysLeft = Math.round((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      result[type].daysLeft = daysLeft;
      result[type].display = formatTimeRemaining(daysLeft);
      
      if (daysLeft < 0) {
        result[type].status = "overdue";
      } else if (daysLeft <= 30) {
        result[type].status = "upcoming";
      } else {
        result[type].status = "ok";
      }
    }
  });
  
  return result;
}

function formatTimeRemaining(days) {
  if (days < 0) {
    const absDays = Math.abs(days);
    if (absDays >= 365) {
      const years = Math.floor(absDays / 365);
      return `Overdue ${years}y`;
    } else if (absDays >= 30) {
      const months = Math.floor(absDays / 30);
      return `Overdue ${months}mo`;
    } else {
      return `Overdue ${absDays}d`;
    }
  } else if (days === 0) {
    return "Due today";
  } else if (days >= 365) {
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    if (months > 0) {
      return `${years}y ${months}mo`;
    }
    return `${years} year${years > 1 ? 's' : ''}`;
  } else if (days >= 30) {
    const months = Math.floor(days / 30);
    return `${months} month${months > 1 ? 's' : ''}`;
  } else {
    return `${days} day${days !== 1 ? 's' : ''}`;
  }
}

function renderSpendingBreakdown(stats) {
  const $section = $("<div>").addClass("spending-breakdown");
  
  // Header with totals
  const $header = $("<div>").addClass("spending-header");
  $header.append($("<h3>").addClass("spending-title").html('<i class=\"bi bi-currency-dollar\"></i> Spending Breakdown'));
  
  const $totals = $("<div>").addClass("spending-totals");
  $totals.append(
    $("<div>").addClass("spending-total-item").append(
      $("<div>").addClass("spending-total-label").text("YTD"),
      $("<div>").addClass("spending-total-value highlight").text(
        "$" + stats.ytdSpend.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})
      )
    ),
    $("<div>").addClass("spending-total-item").append(
      $("<div>").addClass("spending-total-label").text("Lifetime"),
      $("<div>").addClass("spending-total-value").text(
        "$" + stats.lifetimeSpend.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})
      )
    )
  );
  $header.append($totals);
  $section.append($header);
  
  // Categories
  const categories = Object.entries(stats.spendByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10); // Top 10 categories
  
  if (categories.length === 0) {
    $section.append(
      $("<div>").addClass("text-muted").css({padding: "20px", textAlign: "center"})
        .text("No spending data yet. Add service entries with costs to see breakdown.")
    );
    return $section;
  }
  
  const maxSpend = categories[0][1];
  
  const $categories = $("<div>").addClass("spending-categories");
  
  categories.forEach(([name, amount]) => {
    const percentage = (amount / maxSpend) * 100;
    
    $categories.append(
      $("<div>").addClass("spending-category").append(
        $("<div>").addClass("spending-category-name").text(name),
        $("<div>").addClass("spending-category-bar").append(
          $("<div>").addClass("spending-category-bar-fill").css("width", percentage + "%")
        ),
        $("<div>").addClass("spending-category-value").text(
          "$" + amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})
        )
      )
    );
  });
  
  $section.append($categories);
  return $section;
}

function renderRecentActivity() {
  const $section = $("<div>").addClass("recent-activity");
  
  $section.append(
    $("<div>").addClass("recent-activity-header").append(
      $("<h3>").addClass("recent-activity-title").html('<i class=\"bi bi-clipboard-check\"></i> Recent Activity')
    )
  );
  
  // Get all entries sorted by date
  const recentEntries = data.entries
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 10);
  
  if (recentEntries.length === 0) {
    $section.append(
      $("<div>").addClass("recent-activity-empty")
        .text("No service entries yet. Start logging maintenance to see activity here.")
    );
    return $section;
  }
  
  const $list = $("<div>").addClass("recent-activity-list");
  
  recentEntries.forEach(entry => {
    const vehicle = data.vehicles.find(v => v.id === entry.vehicleId);
    const vehicleName = vehicle ? vehicle.name : "Unknown Vehicle";
    const serviceNames = getServiceNames(entry.services || []);
    const services = serviceNames.join(", ") || "Service";
    const totalCost = calculateEntryTotalCost(entry);
    
    const $item = $("<div>")
      .addClass("recent-activity-item")
      .attr("data-vehicle-id", entry.vehicleId)
      .append(
        $("<div>").addClass("activity-date").text(formatDateNice(entry.date) || "No date"),
        $("<div>").addClass("activity-vehicle").text(vehicleName),
        $("<div>").addClass("activity-services").text(services),
        $("<div>").addClass("activity-cost").text(
          totalCost > 0 ? "$" + totalCost.toFixed(2) : "-"
        )
      );
    
    // Click to switch to that vehicle
    $item.on("click", function() {
      setActiveVehicle(entry.vehicleId);
      renderDashboard();
    });
    
    $list.append($item);
  });
  
  $section.append($list);
  return $section;
}

// ============================================
// SERVICE CHECKLIST WITH COST/NOTE FIELDS
// ============================================

/**
 * Render filterable service checklist with per-service cost and note fields
 * @param {jQuery} $container - Container element
 * @param {Array} selectedList - Array of selected services (strings or objects)
 * @param {string} filterId - Unique ID prefix for filter elements
 */
function renderFilterableServiceChecklist($container, selectedList, filterId) {
  // Normalize selected services to objects
  const selectedServices = normalizeServices(selectedList);
  const selectedMap = {};
  selectedServices.forEach(svc => {
    selectedMap[svc.name] = svc;
  });
  
  $container.empty();

  const types = data.serviceTypes || [];
  
  // Main wrapper with professional styling
  const $wrapper = $("<div>").addClass("service-selector-wrapper");
  
  // Search/filter header row
  const $headerRow = $("<div>").addClass("service-selector-header");
  
  const $searchInput = $("<input>")
    .attr({ type: "text", placeholder: "Search services...", id: filterId + "-filter" })
    .addClass("service-selector-search");
  
  const $selectedCount = $("<span>").addClass("service-selector-count").text("0 selected");
  
  $headerRow.append($searchInput, $selectedCount);
  $wrapper.append($headerRow);
  
  // Services list container
  const $listContainer = $("<div>").addClass("service-selector-list").attr("id", filterId + "-checklist");
  
  if (!types.length) {
    $listContainer.append(
      $("<div>").addClass("service-selector-empty").append(
        $("<span>").text("No service types configured."),
        $("<a>").attr("href", "#").text("Add some in Settings").on("click", function(e) {
          e.preventDefault();
          $(".nav-btn").removeClass("active");
          $(".nav-btn[data-view='settings']").addClass("active");
          $(".view").removeClass("active");
          $("#view-settings").addClass("active");
          $(".settings-tab-btn").removeClass("active");
          $(".settings-tab-btn[data-tab='services']").addClass("active");
          $(".settings-tab-view").removeClass("active");
          $("#settings-tab-services").addClass("active");
        })
      )
    );
    $wrapper.append($listContainer);
    $container.append($wrapper);
    return;
  }

  // Add service items
  types.forEach((st, index) => {
    const name = st.name || "";
    const nameLower = name.toLowerCase();
    const id = filterId + "_svc_" + index + "_" + name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-]/g, "").toLowerCase();
    const isSelected = selectedMap.hasOwnProperty(name);
    const svcData = selectedMap[name] || { cost: null, note: '' };
    
    // Service item container
    const $serviceItem = $("<div>").addClass("service-selector-item").attr("data-service-name", nameLower);
    if (isSelected) $serviceItem.addClass("selected");
    
    // Main row with checkbox and name
    const $mainRow = $("<div>").addClass("service-selector-main");
    
    const $checkbox = $("<input>").attr({ 
      type: "checkbox", 
      id: id, 
      value: name 
    }).addClass("service-selector-checkbox");
    if (isSelected) $checkbox.prop("checked", true);
    
    const $label = $("<label>").attr("for", id).addClass("service-selector-label");
    const $nameSpan = $("<span>").addClass("service-selector-name").text(name);
    
    // Show default interval if available
    let intervalText = "";
    if (st.intervalMiles && st.intervalMonths) {
      intervalText = st.intervalMiles.toLocaleString() + " " + getUnitShort() + " / " + st.intervalMonths + " mo";
    } else if (st.intervalMiles) {
      intervalText = st.intervalMiles.toLocaleString() + " " + getUnitShort();
    } else if (st.intervalMonths) {
      intervalText = st.intervalMonths + " months";
    }
    
    const $intervalSpan = $("<span>").addClass("service-selector-interval").text(intervalText);
    
    $label.append($nameSpan, $intervalSpan);
    $mainRow.append($checkbox, $label);
    
    // Expandable details row for cost/note
    const $detailsRow = $("<div>").addClass("service-selector-details");
    
    const $costGroup = $("<div>").addClass("service-selector-field-group");
    $costGroup.append(
      $("<label>").text("Cost"),
      $("<div>").addClass("service-selector-cost-wrapper").append(
        $("<span>").addClass("currency-symbol").text("$"),
        $("<input>").attr({ 
          type: "number", 
          min: "0", 
          step: "0.01", 
          placeholder: "0.00" 
        }).addClass("service-cost-input").val(svcData.cost != null ? svcData.cost : "")
      )
    );
    
    const $noteGroup = $("<div>").addClass("service-selector-field-group service-selector-note-group");
    $noteGroup.append(
      $("<label>").text("Note"),
      $("<input>").attr({ 
        type: "text", 
        placeholder: "Parts, brand, details..." 
      }).addClass("service-note-input").val(svcData.note || "")
    );
    
    $detailsRow.append($costGroup, $noteGroup);
    
    $serviceItem.append($mainRow, $detailsRow);
    $listContainer.append($serviceItem);
    
    // Toggle details visibility and update count
    $checkbox.on("change", function() {
      const isChecked = $(this).is(":checked");
      $serviceItem.toggleClass("selected", isChecked);
      
      if (!isChecked) {
        $serviceItem.find(".service-cost-input, .service-note-input").val("");
      }
      
      updateSelectedCount();
      updateServiceCostTotal($container);
    });
    
    // Update total when cost changes
    $costGroup.find("input").on("input change", function() {
      updateServiceCostTotal($container);
    });
  });
  
  // No matches message
  const $noMatches = $("<div>").addClass("service-selector-no-matches").text("No services match your search").hide();
  $listContainer.append($noMatches);
  
  $wrapper.append($listContainer);
  
  // Quick actions row
  const $actionsRow = $("<div>").addClass("service-selector-actions");
  $actionsRow.append(
    $("<button>").attr("type", "button").addClass("btn-ghost btn-tiny").text("Select All").on("click", function() {
      $listContainer.find(".service-selector-item:visible .service-selector-checkbox").prop("checked", true).trigger("change");
    }),
    $("<button>").attr("type", "button").addClass("btn-ghost btn-tiny").text("Clear All").on("click", function() {
      $listContainer.find(".service-selector-checkbox").prop("checked", false).trigger("change");
    })
  );
  
  // Cost summary
  const $costSummary = $("<div>").addClass("service-selector-summary").attr("id", filterId + "-cost-summary");
  $costSummary.append(
    $("<span>").addClass("cost-summary-label").text("Subtotal:"),
    $("<span>").addClass("cost-summary-value").text("$0.00")
  );
  $actionsRow.append($costSummary);
  
  $wrapper.append($actionsRow);
  $container.append($wrapper);
  
  // Update selected count function
  function updateSelectedCount() {
    const count = $listContainer.find(".service-selector-checkbox:checked").length;
    $selectedCount.text(count + " selected");
    $selectedCount.toggleClass("has-selection", count > 0);
  }
  
  // Search/filter functionality
  $searchInput.on("input", function() {
    const query = $(this).val().toLowerCase().trim();
    let visibleCount = 0;
    
    $listContainer.find(".service-selector-item").each(function() {
      const $item = $(this);
      const name = $item.attr("data-service-name") || "";
      const isChecked = $item.find(".service-selector-checkbox").is(":checked");
      const matches = !query || name.includes(query);
      
      // Always show checked items, plus matching items
      if (isChecked || matches) {
        $item.show();
        visibleCount++;
      } else {
        $item.hide();
      }
    });
    
    if (visibleCount === 0) {
      $noMatches.show();
    } else {
      $noMatches.hide();
    }
  });
  
  // Enter key to select first visible unchecked match
  $searchInput.on("keydown", function(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const $firstUnchecked = $listContainer.find(".service-selector-item:visible")
        .filter(function() {
          return !$(this).find(".service-selector-checkbox").is(":checked");
        }).first();
      
      if ($firstUnchecked.length) {
        $firstUnchecked.find(".service-selector-checkbox").prop("checked", true).trigger("change");
        $searchInput.val("");
        $searchInput.trigger("input");
      }
    } else if (e.key === "Escape") {
      $searchInput.val("");
      $searchInput.trigger("input");
    }
  });
  
  // Initial calculations
  updateSelectedCount();
  updateServiceCostTotal($container);
}

/**
 * Update the service cost subtotal display
 */
function updateServiceCostTotal($container) {
  let total = 0;
  $container.find(".service-selector-item, .service-item").each(function() {
    const $item = $(this);
    const $checkbox = $item.find(".service-selector-checkbox, input[type='checkbox']");
    if ($checkbox.is(":checked")) {
      const costVal = $item.find(".service-cost-input").val();
      if (costVal !== "") {
        total += Number(costVal) || 0;
      }
    }
  });
  
  $container.find(".cost-summary-value").text("$" + total.toFixed(2));
}

/**
 * Get services with cost/note from checklist
 * Returns array of objects: [{ name, cost, note }, ...]
 */
function getServicesFromChecklist($container, otherValue) {
  const services = [];
  
  // Get checked services with their cost/note (supports both old and new classes)
  $container.find(".service-selector-item, .service-item").each(function() {
    const $item = $(this);
    const $checkbox = $item.find(".service-selector-checkbox, input[type='checkbox']");
    
    if ($checkbox.is(":checked")) {
      const name = $checkbox.val();
      const costVal = $item.find(".service-cost-input").val();
      const noteVal = $item.find(".service-note-input").val();
      
      services.push({
        name: name,
        cost: costVal !== "" ? Number(costVal) : null,
        note: noteVal ? noteVal.trim() : ""
      });
    }
  });

  // Handle "other" custom services
  const otherText = (otherValue || "").trim();
  if (otherText) {
    otherText.split(/[;,]/).forEach(part => {
      const p = part.trim();
      if (p) {
        services.push({
          name: p,
          cost: null,
          note: ""
        });
      }
    });
  }
  
  return services;
}

function initDatePickers($scope) {
  const $ctx = $scope || $(document);
  $ctx.find("#entry-date, .entry-edit-date, " +
            ".rem-edit-base-date, .rem-edit-next-date, #rem-new-base-date, " +
            ".settings-vehicle-insurance, .settings-vehicle-registration")
    .datepicker({
      dateFormat: "yy-mm-dd",
      changeMonth: true,
      changeYear: true,
      yearRange: "c-20:c+10"
    });
}

// ============================================
// MAIN DASHBOARD RENDER
// ============================================
function renderDashboard() {
  renderVehiclePicker();
  
  if (activeVehicleId === "all") {
    renderAllVehiclesOverview();
  } else {
    renderNewEntryFormDefaults();
    renderDashboardHistory();
    renderDashboardRemindersSnippet();
    updateSafetyStatus();
  }
  
  initDatePickers($(document));
  
  // Restore form preference
  const keepOpen = getKeepFormOpenPreference();
  $("#keep-form-open-pref").prop("checked", keepOpen);
}

function renderNewEntryFormDefaults(editEntry) {
  const today = getTodayIsoInSettingsTz();
  
  // Clear any pending Google Drive files
  if (typeof GDrive !== 'undefined' && GDrive.clearPendingFiles) {
    GDrive.clearPendingFiles();
  }
  
  if (!editEntry) {
    $("#entry-id").val("");
    $("#entry-submit-label").text("Save entry");
    $("#entry-date").val(today);
    $("#entry-odo").val("");
    $("#entry-services-other").val("");
    $("#entry-cost").val("");
    $("#entry-notes").val("");
    // REMOVED: entry-next-date and entry-next-odo (use reminders instead)
    $("#entry-files").val(""); // Clear file input
    $("#selected-files-preview").empty(); // Clear selected files preview
    
    const $checklistContainer = $("#service-checklist-container");
    $checklistContainer.empty();
    renderFilterableServiceChecklist($checklistContainer, [], "entry-form");
  } else {
    $("#entry-id").val(editEntry.id);
    $("#entry-submit-label").text("Update entry");
    $("#entry-date").val(editEntry.date || today);
    $("#entry-odo").val(editEntry.odo != null ? editEntry.odo : "");
    $("#entry-cost").val(editEntry.cost != null ? editEntry.cost : "");
    $("#entry-notes").val(editEntry.notes || "");
    // REMOVED: entry-next-date and entry-next-odo (use reminders instead)
    $("#entry-files").val(""); // Clear file input
    $("#selected-files-preview").empty(); // Clear selected files preview

    // Normalize services and separate known from unknown
    const services = normalizeServices(editEntry.services || []);
    const stNames = new Set((data.serviceTypes || []).map(st => st.name));
    const known = services.filter(s => stNames.has(s.name));
    const other = services.filter(s => !stNames.has(s.name));
    
    const $checklistContainer = $("#service-checklist-container");
    $checklistContainer.empty();
    renderFilterableServiceChecklist($checklistContainer, known, "entry-form");
    
    // For "other" services, just list names (they don't have cost/note UI in the simple field)
    $("#entry-services-other").val(other.map(s => s.name).join("; "));
  }
}

function renderDashboardHistory() {
  // Get all entries for this vehicle (before filtering)
  const allEntries = data.entries.filter(e => e.vehicleId === activeVehicleId);
  
  // Use filtered entries if search is active
  const list = (typeof getFilteredHistoryEntries === 'function') 
    ? getFilteredHistoryEntries(activeVehicleId)
    : allEntries;
  
  const sorted = list.slice().sort((a,b) => 
    (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || "")
  );

  const $list = $("#entry-list");
  $list.empty();

  const vehicle = data.vehicles.find(v => v.id === activeVehicleId) || null;
  const unit = getUnitShort();

  // Check if search bar needs to be recreated (only when vehicle changes or doesn't exist)
  const existingSearchBar = $('.history-search-container');
  const needsNewSearchBar = !existingSearchBar.length || 
                            (typeof historySearchState !== 'undefined' && 
                             historySearchState.vehicleId !== activeVehicleId);

  // Only recreate search bar if needed (preserves focus during typing)
  if (needsNewSearchBar) {
    // Clean up old search elements
    existingSearchBar.remove();
    $('#history-search-count').remove();
    
    // Render search bar at the top (before entry list)
    if (typeof renderHistorySearchBar === 'function' && activeVehicleId && activeVehicleId !== "all" && data.vehicles.length) {
      const $searchBar = renderHistorySearchBar();
      $list.before($searchBar);
      
      // Add search count container
      $searchBar.after($('<div>').attr('id', 'history-search-count').addClass('history-search-count'));
    }
  }

  if (!activeVehicleId || activeVehicleId === "all" || !data.vehicles.length) {
    $list.append(
      $("<div>").addClass("entry-empty")
        .text("Add a vehicle in Settings to start logging maintenance.")
    );
    $("#history-total").text(0);
    return;
  }

  // Check if we have no entries at all vs filtered to zero
  if (allEntries.length === 0) {
    $list.append($("<div>").addClass("entry-empty").text("No entries yet."));
    $("#history-total").text(0);
    return;
  }

  // Show "no results" if filtering resulted in zero entries
  if (sorted.length === 0 && allEntries.length > 0) {
    const searchTerm = historySearchState?.searchText || '';
    $list.append(
      $("<div>").addClass("history-search-no-results").html(`
        <i class="bi bi-search"></i>
        <p>No entries found matching <span class="search-term">"${searchTerm}"</span></p>
        <p style="margin-top:4px; font-size:0.85rem; opacity:0.7;">Try a different search term</p>
      `)
    );
    $("#history-total").text(allEntries.length);
    
    // Update search count
    if (typeof updateHistorySearchCount === 'function') {
      updateHistorySearchCount(allEntries.length, 0);
    }
    return;
  }

  $("#history-total").text(allEntries.length);
  
  // Update search count display
  if (typeof updateHistorySearchCount === 'function') {
    updateHistorySearchCount(allEntries.length, sorted.length);
  }

  // Pagination
  const perPage = (data?.dashboardHistoryPerPage > 0) ? data.dashboardHistoryPerPage : 10;
  const totalPages = Math.ceil(sorted.length / perPage);
  
  if (dashboardHistoryPage < 1) dashboardHistoryPage = 1;
  if (dashboardHistoryPage > totalPages) dashboardHistoryPage = totalPages || 1;
  
  const startIdx = (dashboardHistoryPage - 1) * perPage;
  const pageEntries = sorted.slice(startIdx, startIdx + perPage);

  pageEntries.forEach(entry => {
    const services = normalizeServices(entry.services || []);
    const serviceNames = services.map(s => s.name);
    const mainService = serviceNames[0] || "Service";
    const otherServiceNames = serviceNames.slice(1);
    const totalCost = calculateEntryTotalCost(entry);

    const $card = $("<div>").addClass("entry-card").attr("data-id", entry.id);

    // Header
    const $header = $("<div>").addClass("entry-header");
    const $main = $("<div>").addClass("entry-main");
    const $titleRow = $("<div>").addClass("entry-title-row");
    $titleRow.append(
      $("<span>").addClass("entry-date").text(formatDateNice(entry.date) || "No date"),
      $("<span>").addClass("entry-mileage").text(
        entry.odo != null ? `• ${entry.odo.toLocaleString()} ${unit}` : ""
      )
    );

    $header.append(
      $main.append(
        $titleRow,
        // FIX Issues #6 & #7: Limit badges to 3, remove "main" class distinction
        (function() {
          const $badges = $("<div>").addClass("service-badges");
          const allNames = [mainService, ...otherServiceNames];
          const maxVisible = 3;
          
          // Add visible badges (all same styling - no "main" class)
          allNames.slice(0, maxVisible).forEach(s => {
            $badges.append($("<span>").addClass("service-badge").text(s));
          });
          
          // Add "+X more" if there are hidden badges
          if (allNames.length > maxVisible) {
            const hiddenCount = allNames.length - maxVisible;
            const hiddenNames = allNames.slice(maxVisible).join(", ");
            $badges.append(
              $("<span>")
                .addClass("service-badge-more")
                .text("+" + hiddenCount + " more")
                .attr("title", hiddenNames)
            );
          }
          
          return $badges;
        })()
      ),
      $("<div>").addClass("entry-toggle").html('Tap to expand <i class="bi bi-chevron-down"></i>')
    );

    // Body
    const $body = $("<div>").addClass("entry-body");
    
    // View Mode
    const $viewMode = $("<div>").addClass("entry-view-mode");
    const $viewInner = $("<div>").addClass("entry-body-inner");

    const tagline = [];
    if (entry.nextDate) tagline.push("Next date: " + formatDateNice(entry.nextDate));
    if (entry.nextOdo != null) tagline.push(`Next mileage: ${entry.nextOdo.toLocaleString()} ${unit}`);
    
    
    $viewInner.append($("<div>").addClass("entry-tagline").text(tagline.join(" • ")));

    const $viewGrid = $("<div>").addClass("entry-view-grid");
    
    $viewGrid.append(
      $("<div>").addClass("entry-view-field").append(
        $("<label>").text("Service date"),
        $("<div>").addClass("entry-view-value").text(formatDateNice(entry.date) || "-")
      ),
      $("<div>").addClass("entry-view-field").append(
        $("<label>").text(`Odometer (${unit})`),
        $("<div>").addClass("entry-view-value").text(entry.odo != null ? entry.odo.toLocaleString() + " " + unit : "-")
      )
    );

    // Services with cost/note breakdown
    const $servicesField = $("<div>").addClass("entry-view-field").css("grid-column", "1 / -1").append(
      $("<label>").text("Services performed")
    );
    
    if (services.length) {
      const $servicesList = $("<div>").addClass("entry-services-breakdown");
      services.forEach(svc => {
        const $svcRow = $("<div>").addClass("entry-service-row");
        $svcRow.append($("<span>").addClass("entry-service-name").text(svc.name));
        
        if (svc.cost != null) {
          $svcRow.append($("<span>").addClass("entry-service-cost").text("$" + svc.cost.toFixed(2)));
        }
        if (svc.note) {
          $svcRow.append($("<span>").addClass("entry-service-note").text(svc.note));
        }
        $servicesList.append($svcRow);
      });
      $servicesField.append($servicesList);
    } else {
      $servicesField.append($("<div>").addClass("entry-view-value").text("-"));
    }
    $viewGrid.append($servicesField);

    // Total cost
    $viewGrid.append(
      $("<div>").addClass("entry-view-field").append(
        $("<label>").text("Total Cost"),
        $("<div>").addClass("entry-view-value").text(totalCost > 0 ? "$" + totalCost.toFixed(2) : "-")
      )
    );
    
    // Misc cost (if any)
    if (entry.cost != null && entry.cost > 0) {
      $viewGrid.append(
        $("<div>").addClass("entry-view-field").append(
          $("<label>").text("Misc/Other Cost"),
          $("<div>").addClass("entry-view-value").text("$" + entry.cost.toFixed(2))
        )
      );
    }

    if (entry.nextDate) {
      $viewGrid.append(
        $("<div>").addClass("entry-view-field").append(
          $("<label>").text("Next due date"),
          $("<div>").addClass("entry-view-value").text(formatDateNice(entry.nextDate))
        )
      );
    }

    if (entry.nextOdo != null) {
      $viewGrid.append(
        $("<div>").addClass("entry-view-field").append(
          $("<label>").text(`Next due mileage (${unit})`),
          $("<div>").addClass("entry-view-value").text(entry.nextOdo.toLocaleString() + " " + unit)
        )
      );
    }

    $viewInner.append($viewGrid);

    if (entry.notes?.trim()) {
      $viewInner.append(
        $("<div>").addClass("entry-view-field").css("margin-top", "8px").append(
          $("<label>").text("Notes"),
          $("<div>").addClass("entry-view-value").text(entry.notes)
        )
      );
    }

    // Attachments - with Google Drive source indicators
    const attachments = entry.attachments || [];
    if (attachments.length) {
      const $attSection = $("<div>").addClass("entry-view-field").css("margin-top", "8px").append(
        $("<label>").text(`Attachments (${attachments.length})`)
      );
      const $alist = $("<div>").addClass("attachments-list");
      attachments.forEach(att => {
        const $item = $("<div>").addClass("attachment-item");
        
        // Source indicator for Google Drive vs Local
        const isGoogleDrive = att.source === 'google_drive';
        const sourceIcon = isGoogleDrive ? 'bi-google' : 'bi-file-earmark';
        const sourceClass = isGoogleDrive ? 'source-gdrive' : 'source-local';
        const sourceTitle = isGoogleDrive ? 'Google Drive' : 'Local file';
        
        const $meta = $("<div>").addClass("attachment-meta").append(
          $("<div>").addClass("attachment-name").append(
            $("<i>").addClass(`bi ${sourceIcon} source-icon ${sourceClass}`).attr("title", sourceTitle),
            $("<span>").text(att.name || "Attachment")
          ),
          att.size != null ? $("<div>").addClass("attachment-size text-muted").text(formatBytes(att.size)) : null
        );
        const $actions = $("<div>").addClass("attachment-actions");
        $actions.append(
          $("<button>").addClass("btn-ghost btn-small entry-attach-download")
            .attr("type","button")
            .attr("title", "Download")
            .attr("data-att-id", att.id)
            .attr("data-att-name", att.name)
            .attr("data-att-source", att.source || 'local')
            .html('<i class="bi bi-download"></i> Download')
        );
        $item.append($meta, $actions);
        $alist.append($item);
      });
      $attSection.append($alist);
      $viewInner.append($attSection);
    }

    const $viewButtons = $("<div>").addClass("entry-body-buttons").append(
      $("<button>").addClass("btn-primary btn-small entry-btn-edit").attr("type","button").text("Edit entry"),
      $("<button>").addClass("btn-danger btn-small entry-btn-delete").attr("type","button").text("Delete entry")
    );

    $viewInner.append($viewButtons);
    $viewMode.append($viewInner);

    // Edit Mode
    const $editMode = $("<div>").addClass("entry-edit-mode").hide();
    const $editInner = $("<div>").addClass("entry-body-inner");

    const today = getTodayIsoInSettingsTz();
    const $fieldsGrid = $("<div>").addClass("entry-body-fields");
    
    $fieldsGrid.append(
      $("<div>").addClass("field").append(
        $("<label>").text("Service date"),
        $("<input>").attr({type:"text", placeholder:"YYYY-MM-DD", autocomplete:"off"}).addClass("entry-edit-date").val(entry.date || today)
      ),
      $("<div>").addClass("field").append(
        $("<label>").html(`Odometer (<span class="unit-label">${unit}</span>)`),
        $("<input>").attr({type:"number",min:"0",step:"1"}).addClass("entry-edit-odo").val(entry.odo != null ? entry.odo : "")
      ),
      $("<div>").addClass("field").css("grid-column", "1 / -1").append(
        $("<label>").text("Services"),
        (function(){
          const $wrapper = $("<div>").addClass("entry-edit-services-wrapper");
          const stNames = new Set((data.serviceTypes || []).map(st => st.name));
          const known = services.filter(s => stNames.has(s.name));
          const filterId = "edit-" + entry.id.replace(/[^a-zA-Z0-9]/g, "");
          renderFilterableServiceChecklist($wrapper, known, filterId);
          return $wrapper;
        })(),
        $("<input>").attr({type:"text", placeholder:"Other/custom (comma or ; separated)"}).addClass("entry-edit-services-other")
          .val(services.filter(s => {
            const stNames = new Set((data.serviceTypes || []).map(st => st.name));
            return !stNames.has(s.name);
          }).map(s => s.name).join("; "))
      ),
      $("<div>").addClass("field").append(
        $("<label>").text("Misc/Other Cost"),
        $("<input>").attr({type:"number",min:"0",step:"0.01", placeholder:"Taxes, fees, etc."}).addClass("entry-edit-cost").val(entry.cost != null ? entry.cost : "")
      )
      // REMOVED: Next due date and next due mileage fields (use reminders instead)
    );

    const $notesField = $("<div>").addClass("entry-body-notes field").append(
      $("<label>").text("Notes"),
      $("<textarea>").addClass("entry-edit-notes").attr("rows",2).val(entry.notes || "")
    );

    const { maxCount } = getAttachmentLimits();
    const used = attachments.length;
    const labelText = maxCount > 0 ? `Attachments (${used} / ${maxCount} used)` : `Attachments (${used} attached)`;

    const $attSection = $("<div>").addClass("entry-body-attachments field").css("margin-top","4px").append($("<label>").text(labelText));

    // Render existing attachments with source indicators
    if (attachments.length) {
      const $alist = $("<div>").addClass("attachments-list");
      attachments.forEach(att => {
        const $item = $("<div>").addClass("attachment-item");
        
        // Source indicator for Google Drive vs Local
        const isGoogleDrive = att.source === 'google_drive';
        const sourceIcon = isGoogleDrive ? 'bi-google' : 'bi-file-earmark';
        const sourceClass = isGoogleDrive ? 'source-gdrive' : 'source-local';
        const sourceTitle = isGoogleDrive ? 'Google Drive' : 'Local file';
        
        const $meta = $("<div>").addClass("attachment-meta").append(
          $("<div>").addClass("attachment-name").append(
            $("<i>").addClass(`bi ${sourceIcon} source-icon ${sourceClass}`).attr("title", sourceTitle),
            $("<span>").text(att.name || "Attachment")
          ),
          att.size != null ? $("<div>").addClass("attachment-size text-muted").text(formatBytes(att.size)) : null
        );
        const $actions = $("<div>").addClass("attachment-actions");
        $actions.append(
          $("<button>").addClass("btn-ghost btn-small entry-attach-download")
            .attr("type","button")
            .attr("title", "Download")
            .attr("data-att-id", att.id)
            .attr("data-att-name", att.name)
            .attr("data-att-source", att.source || 'local')
            .html('<i class="bi bi-download"></i> Download'),
          $("<button>").addClass("btn-danger btn-small entry-attach-delete")
            .attr("type","button")
            .attr("title", "Delete")
            .attr("data-att-id", att.id)
            .attr("data-entry-id", entry.id)
            .html('<i class="bi bi-trash"></i> Delete')
        );
        $item.append($meta, $actions);
        $alist.append($item);
      });
      $attSection.append($alist);
    } else {
      $attSection.append($("<div>").addClass("text-muted").css("font-size","0.75rem").text("No attachments."));
    }

    // Add new attachment area with Google Drive / Local upload buttons (static HTML approach)
    const $addAttachArea = $("<div>").addClass("field entry-add-attach-area attachment-upload-area").css("margin-top","8px");
    
    // Check if Google Drive is enabled
    const canDrive = (typeof GM_CONFIG !== 'undefined' && GM_CONFIG.googleDriveEnabled === true);
    
    // Google Drive button
    if (canDrive) {
      const $driveBtn = $("<button>")
        .addClass("btn-ghost btn-attachment-gdrive")
        .attr("type", "button")
        .html('<i class="bi bi-google"></i> Add from Google Drive')
        .data("entry-id", entry.id)
        .on("click", function(e) {
          e.preventDefault();
          const entryId = $(this).data("entry-id");
          if (typeof GDrive !== 'undefined' && GDrive.openPicker) {
            GDrive.openPicker(entryId, function(files, eId) {
              if (typeof window.attachGoogleDriveFiles === 'function') {
                window.attachGoogleDriveFiles(files, eId);
              } else {
                showToast('Google Drive attachment handler not available');
              }
            });
          } else {
            showToast('Google Drive is not configured');
          }
        });
      $addAttachArea.append($driveBtn);
    }
    
    // Container for showing selected files
    const $selectedFiles = $("<div>").addClass("selected-files-list").css({
      "margin-top": "8px",
      "font-size": "0.8rem"
    });
    
    // Local upload button and hidden file input
    const $fileInput = $("<input>")
      .attr({
        type: "file",
        multiple: true,
        accept: ".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp"
      })
      .addClass("entry-attach-files")
      .css("display", "none")
      .data("entry-id", entry.id)
      .on("change", function() {
        // Show selected files as feedback
        const files = this.files;
        $selectedFiles.empty();
        if (files && files.length > 0) {
          const $list = $("<div>").css({"padding": "8px", "background": "var(--gm-bg-subtle)", "border-radius": "4px"});
          $list.append($("<div>").css({"font-weight": "500", "margin-bottom": "4px"}).text(`${files.length} file(s) selected (will upload on save):`));
          for (let i = 0; i < files.length; i++) {
            const size = (files[i].size / 1024).toFixed(1);
            $list.append(
              $("<div>").css({"color": "var(--gm-text-secondary)"}).html(
                `<i class="bi bi-file-earmark"></i> ${files[i].name} <span class="text-muted">(${size} KB)</span>`
              )
            );
          }
          $selectedFiles.append($list);
        }
      });
    
    const $localBtn = $("<button>")
      .addClass("btn-ghost btn-attachment-local")
      .attr("type", "button")
      .html('<i class="bi bi-upload"></i> Upload File')
      .on("click", function(e) {
        e.preventDefault();
        $(this).siblings(".entry-attach-files").click();
      });
    
    $addAttachArea.append($localBtn, $fileInput, $selectedFiles);
    
    // File hint
    const maxSizeMB = (typeof GM_CONFIG !== 'undefined' && GM_CONFIG.maxAttachmentSizeMB) ? GM_CONFIG.maxAttachmentSizeMB : 5;
    $addAttachArea.append(
      $("<div>").addClass("text-muted").css("font-size", "0.7rem").text(`PDF, Word, images (max ${maxSizeMB}MB)`)
    );
    
    $attSection.append($addAttachArea);

    const $editButtons = $("<div>").addClass("entry-body-buttons").append(
      $("<button>").addClass("btn-ghost btn-small entry-btn-cancel").attr("type","button").text("Cancel"),
      $("<button>").addClass("btn-primary btn-small entry-btn-save").attr("type","button").text("Save changes")
    );

    $editInner.append($fieldsGrid, $notesField, $attSection, $editButtons);
    $editMode.append($editInner);

    $body.append($viewMode, $editMode);
    $card.append($header, $body);
    $list.append($card);
  });

  // Pagination controls
  if (totalPages > 1) {
    const $pager = $("<div>").addClass("dashboard-history-pager");
    
    $pager.append(
      $("<button>").text("← Prev").prop("disabled", dashboardHistoryPage <= 1)
        .on("click", () => { if (dashboardHistoryPage > 1) { dashboardHistoryPage--; renderDashboardHistory(); } }),
      $("<span>").addClass("pager-info").text(`Page ${dashboardHistoryPage} of ${totalPages}`),
      $("<button>").text("Next →").prop("disabled", dashboardHistoryPage >= totalPages)
        .on("click", () => { if (dashboardHistoryPage < totalPages) { dashboardHistoryPage++; renderDashboardHistory(); } })
    );
    
    $list.append($pager);
  }

  initDatePickers($list);
  updateUnitLabels();
}

// ============================================
// FORM PREFERENCES
// ============================================
function getKeepFormOpenPreference() {
  return data.settings?.keepFormOpen === true;
}

function setKeepFormOpenPreference(value) {
  if (!data.settings) {
    data.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }
  data.settings.keepFormOpen = value === true;
  saveData();
}

function toggleEntryForm(forceOpen) {
  const $form = $("#dashboard-entry-form");
  const $btn = $("#toggle-entry-form");
  const isOpen = $form.is(":visible");
  
  if (forceOpen === true || !isOpen) {
    $form.slideDown(300);
    $btn.addClass("form-open");
    // FIX Issue #4 & #5: Use HTML for the X to avoid encoding issues
    $btn.html('<i class="bi bi-x-circle"></i> Hide Form');
  } else {
    $form.slideUp(300);
    $btn.removeClass("form-open");
    $btn.html('<i class="bi bi-plus-circle"></i> Add New Service Entry');
  }
}

/**
 * Reset the entry form button to its default "closed" state
 * Used when form is hidden by renderDashboard() without going through toggleEntryForm()
 */
function resetEntryFormButton() {
  const $btn = $("#toggle-entry-form");
  $btn.removeClass("form-open");
  // FIX Issue #4 & #5: Use HTML for consistent icon display
  $btn.html('<i class="bi bi-plus-circle"></i> Add New Service Entry');
}

// ============================================
// REMINDERS SNIPPET (Sidebar)
// ============================================
function renderDashboardRemindersSnippet() {
  const $list = $("#reminder-snippet-list");
  $list.empty();

  if (!activeVehicleId || activeVehicleId === "all") {
    $list.append(
      $("<div>").addClass("reminder-snippet-empty")
        .text("Select a vehicle to see reminders.")
    );
    $("#rem-snippet-upcoming").text(0);
    $("#rem-snippet-overdue").text(0);
    return;
  }

  const vehicle = data.vehicles.find(v => v.id === activeVehicleId) || null;
  const currentOdo = vehicle?.currentOdo ?? null;
  const unit = getUnitShort();

  const reminders = data.reminders.filter(r => r.vehicleId === activeVehicleId);
  if (!reminders.length) {
    $list.append(
      $("<div>").addClass("reminder-snippet-empty")
        .text("No reminders yet. Add them on the Reminders page.")
    );
    $("#rem-snippet-upcoming").text(0);
    $("#rem-snippet-overdue").text(0);
    return;
  }

  let upcoming = 0;
  let overdue = 0;

  const enriched = reminders.map(r => {
    const derived = computeReminderDerived(r, currentOdo);
    if (derived.level === "upcoming") upcoming++;
    if (derived.level === "overdue") overdue++;
    return {r, derived};
  });

  const filteredReminders = enriched.filter(item => 
    item.derived.level === "upcoming" || item.derived.level === "overdue"
  );

  filteredReminders.sort((a,b) => {
    const order = {overdue:0, upcoming:1, ok:2};
    return order[a.derived.level] - order[b.derived.level];
  });

  if (!filteredReminders.length) {
    $list.append(
      $("<div>").addClass("reminder-snippet-empty")
        .text("✓ All maintenance is up to date! No upcoming or overdue items.")
    );
    $("#rem-snippet-upcoming").text(upcoming);
    $("#rem-snippet-overdue").text(overdue);
    return;
  }

  filteredReminders.forEach(item => {
    const {r, derived} = item;
    const serviceName = r.serviceName || r.title || "Reminder";
    const $row = $("<div>").addClass("reminder-snippet-item");
    const $left = $("<div>").css({minWidth:0});
    $left.append(
      $("<div>").addClass("reminder-title").text(serviceName),
      $("<div>").addClass("reminder-meta").text(
        [
          derived.nextOdo != null ? `Next: ${derived.nextOdo.toLocaleString()} ${unit}` : null,
          derived.nextDate ? `Date: ${formatDateNice(derived.nextDate)}` : null
        ].filter(Boolean).join(" • ")
      )
    );

    const $status = $("<div>")
      .addClass("reminder-status-pill " + derived.level)
      .append(
        $("<span>").addClass("dot"),
        $("<span>").text(derived.label)
      );

    $row.append($left, $status);
    $list.append($row);
  });

  $("#rem-snippet-upcoming").text(upcoming);
  $("#rem-snippet-overdue").text(overdue);
}

/**
 * Render attachment upload area with Google Drive and Local options
 * Used by both new entry form and edit entry form
 */
function renderAttachmentUploadArea(entryId, currentCount, maxCount, $container) {
  // Safety check - if container doesn't exist, exit
  if (!$container || !$container.length) {
    console.warn('renderAttachmentUploadArea: container not found');
    return;
  }
  
  // Fallback for maxCount if not provided
  if (typeof maxCount !== 'number' || maxCount <= 0) {
    maxCount = 2; // Default
  }
  
  // Upload allowed for all users — no subscription gating
  const canDrive = (typeof GM_CONFIG !== 'undefined' && GM_CONFIG.googleDriveEnabled === true);
  const canLocal = true;
  
  const remainingSlots = Math.max(0, maxCount - (currentCount || 0));
  
  // Clear container
  $container.empty();
  
  // Check if limit reached
  if (remainingSlots <= 0) {
    $container.append(
      $('<div>').addClass('attachment-limit-reached text-muted')
        .text(`Maximum ${maxCount} attachments reached`)
    );
    return;
  }
  
  const $uploadArea = $('<div>').addClass('attachment-upload-container');
  
  // Google Drive button (available to all users if enabled)
  if (canDrive) {
    const $driveBtn = $('<button>')
      .addClass('btn-ghost btn-attachment-drive')
      .attr('type', 'button')
      .html('<i class="bi bi-google"></i> Add from Google Drive')
      .on('click', function(e) {
        e.preventDefault();
        if (typeof GDrive !== 'undefined' && GDrive.openPicker) {
          GDrive.openPicker(entryId, function(files, eId) {
            if (typeof window.attachGoogleDriveFiles === 'function') {
              window.attachGoogleDriveFiles(files, eId);
            } else {
              showToast('Google Drive attachment not available');
            }
          });
        } else {
          showToast('Google Drive is loading... Please try again.');
        }
      });
    
    $uploadArea.append($driveBtn);
  }
  
  // Local upload button - always show if user can use local uploads
  if (canLocal) {
    const $localInput = $('<input>')
      .attr({
        type: 'file',
        multiple: true,
        accept: '.pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp'
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
  
  // If neither Google Drive nor Local is available, show a basic file input
  if (!canDrive && !canLocal) {
    // Fallback - shouldn't normally happen
    $uploadArea.append(
      $('<input>').attr({type:'file', multiple:true}).addClass('entry-attach-files'),
      $('<div>').addClass('text-muted').css('font-size','0.7rem').text('Add files')
    );
  }
  
  // File type hint
  const maxSizeMB = (typeof GM_CONFIG !== 'undefined' && GM_CONFIG.maxAttachmentSizeMB) ? GM_CONFIG.maxAttachmentSizeMB : 5;
  const $hint = $('<div>')
    .addClass('attachment-hint text-muted')
    .text(`PDF, Word, images (max ${maxSizeMB}MB)`);
  
  $uploadArea.append($hint);
  $container.append($uploadArea);
}