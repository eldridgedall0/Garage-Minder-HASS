/**
 * GarageMinder - Vehicle Report Export v3.0
 * Card-based service history layout, full text (no truncation),
 * per-service costs/notes, attachment filenames, next-service-due option.
 */

// ========================================
// EXPORT MODAL MANAGEMENT
// ========================================

function openVehicleReportExportModal() {
  if (!activeVehicleId || activeVehicleId === "all") {
    alert("Please select a specific vehicle first (not 'All Vehicles').");
    return;
  }

  const vehicle = data.vehicles.find(v => v.id === activeVehicleId);
  if (!vehicle) { alert("Vehicle not found."); return; }

  const entries = data.entries.filter(e => e.vehicleId === activeVehicleId);
  if (!entries.length) { alert('No service records to export for "' + vehicle.name + '".'); return; }

  const p = loadExportPreferences();

  function sel(val, match) { return val === match ? 'selected' : ''; }
  function chk(val) { return val !== false ? 'checked' : ''; }
  function chkTrue(val) { return val === true ? 'checked' : ''; }

  const modalHtml =
    '<div id="export-modal-overlay" class="export-modal-overlay">' +
    '<div class="export-modal">' +
    '<div class="export-modal-header">' +
    '<h2><i class="bi bi-file-earmark-text"></i> Vehicle Report Export</h2>' +
    '<button type="button" class="export-modal-close" onclick="closeVehicleReportExportModal()">&times;</button>' +
    '</div>' +
    '<div class="export-modal-body">' +

    // Vehicle info strip
    '<div class="export-vehicle-info"><strong>' + escapeHtml(vehicle.name) + '</strong>' +
    '<span>' + entries.length + ' service record' + (entries.length !== 1 ? 's' : '') + '</span></div>' +

    // Format selector
    '<div class="export-section"><label class="export-section-label">Export Format</label>' +
    '<div class="export-format-options">' +
    '<label class="export-format-option ' + (p.format === 'pdf' ? 'selected' : '') + '">' +
    '<input type="radio" name="export-format" value="pdf" ' + (p.format === 'pdf' ? 'checked' : '') + '>' +
    '<i class="bi bi-file-earmark-pdf"></i><span>PDF</span><small>Recommended</small></label>' +
    '<label class="export-format-option ' + (p.format === 'word' ? 'selected' : '') + '">' +
    '<input type="radio" name="export-format" value="word" ' + (p.format === 'word' ? 'checked' : '') + '>' +
    '<i class="bi bi-file-earmark-word"></i><span>Word</span><small>.doc file</small></label>' +
    '<label class="export-format-option ' + (p.format === 'xlsx' ? 'selected' : '') + '">' +
    '<input type="radio" name="export-format" value="xlsx" ' + (p.format === 'xlsx' ? 'checked' : '') + '>' +
    '<i class="bi bi-file-earmark-spreadsheet"></i><span>Excel</span><small>.xlsx file</small></label>' +
    '<label class="export-format-option ' + (p.format === 'csv' ? 'selected' : '') + '">' +
    '<input type="radio" name="export-format" value="csv" ' + (p.format === 'csv' ? 'checked' : '') + '>' +
    '<i class="bi bi-filetype-csv"></i><span>CSV</span><small>Simple data</small></label>' +
    '</div></div>' +

    // Date range
    '<div class="export-section"><label class="export-section-label">Date Range</label>' +
    '<div class="export-date-options">' +
    '<select id="export-date-range" class="export-select">' +
    '<option value="all" ' + sel(p.dateRange, 'all') + '>All Time</option>' +
    '<option value="year" ' + sel(p.dateRange, 'year') + '>Last 12 Months</option>' +
    '<option value="6months" ' + sel(p.dateRange, '6months') + '>Last 6 Months</option>' +
    '<option value="3months" ' + sel(p.dateRange, '3months') + '>Last 3 Months</option>' +
    '<option value="ytd" ' + sel(p.dateRange, 'ytd') + '>Year to Date</option>' +
    '<option value="custom" ' + sel(p.dateRange, 'custom') + '>Custom Range</option>' +
    '</select>' +
    '<div id="export-custom-dates" class="export-custom-dates" style="display:' + (p.dateRange === 'custom' ? 'flex' : 'none') + ';">' +
    '<input type="date" id="export-date-from" value="' + (p.dateFrom || '') + '">' +
    '<span>to</span>' +
    '<input type="date" id="export-date-to" value="' + (p.dateTo || '') + '">' +
    '</div></div></div>' +

    // Report sections
    '<div class="export-section export-sections-group"><label class="export-section-label">Report Sections <small>(PDF/Word)</small></label>' +
    '<div class="export-checkbox-group">' +
    '<label class="export-checkbox"><input type="checkbox" id="export-inc-vehicleinfo" ' + chk(p.includeVehicleInfo) + '><span>Vehicle Information</span></label>' +
    '<label class="export-checkbox"><input type="checkbox" id="export-inc-renewals" ' + chk(p.includeRenewals) + '><span>Renewal Dates</span></label>' +
    '<label class="export-checkbox"><input type="checkbox" id="export-inc-costsummary" ' + chkTrue(p.includeCostSummary) + '><span>Cost Summary</span></label>' +
    '<label class="export-checkbox"><input type="checkbox" id="export-inc-reminders" ' + chk(p.includeReminders) + '><span>Upcoming Maintenance</span></label>' +
    '<label class="export-checkbox"><input type="checkbox" id="export-inc-history" ' + chk(p.includeHistory) + '><span>Service History</span></label>' +
    '<label class="export-checkbox"><input type="checkbox" id="export-inc-showcosts" ' + chk(p.showCosts) + '><span>Show Costs</span></label>' +
    '<label class="export-checkbox"><input type="checkbox" id="export-inc-nextdue" ' + chk(p.includeNextDue) + '><span>Next Service Due</span></label>' +
    '<label class="export-checkbox"><input type="checkbox" id="export-inc-servicesummary" ' + chkTrue(p.includeServiceSummary) + '><span>Service Type Summary</span></label>' +
    '</div></div>' +

    // Vehicle details
    '<div class="export-section export-sections-group"><label class="export-section-label">Vehicle Details <small>(PDF/Word)</small></label>' +
    '<div class="export-checkbox-group">' +
    '<label class="export-checkbox"><input type="checkbox" id="export-vd-vin" ' + chk(p.showVin) + '><span>VIN</span></label>' +
    '<label class="export-checkbox"><input type="checkbox" id="export-vd-plate" ' + chk(p.showPlate) + '><span>License Plate</span></label>' +
    '<label class="export-checkbox"><input type="checkbox" id="export-vd-odometer" ' + chk(p.showOdometer) + '><span>Odometer</span></label>' +
    '<label class="export-checkbox"><input type="checkbox" id="export-vd-yearMakeModel" ' + chk(p.showYearMakeModel) + '><span>Year/Make/Model</span></label>' +
    '<label class="export-checkbox"><input type="checkbox" id="export-vd-engine" ' + chkTrue(p.showEngine) + '><span>Engine</span></label>' +
    '<label class="export-checkbox"><input type="checkbox" id="export-vd-stats" ' + chk(p.showStats) + '><span>History Stats</span></label>' +
    '</div></div>' +

    '</div>' + // end modal-body
    '<div class="export-modal-footer">' +
    '<button type="button" class="export-btn-secondary" onclick="closeVehicleReportExportModal()">Cancel</button>' +
    '<button type="button" class="export-btn-primary" onclick="executeVehicleReportExport()"><i class="bi bi-download"></i> Export Report</button>' +
    '</div>' +
    '</div></div>';

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  setupExportModalListeners();
}

function setupExportModalListeners() {
  document.querySelectorAll('input[name="export-format"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      document.querySelectorAll('.export-format-option').forEach(function(opt) { opt.classList.remove('selected'); });
      this.closest('.export-format-option').classList.add('selected');
      document.querySelectorAll('.export-sections-group').forEach(function(group) {
        group.style.display = (radio.value === 'csv' || radio.value === 'xlsx') ? 'none' : 'block';
      });
    });
  });
  document.getElementById('export-date-range').addEventListener('change', function() {
    document.getElementById('export-custom-dates').style.display = this.value === 'custom' ? 'flex' : 'none';
  });
  document.getElementById('export-modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeVehicleReportExportModal();
  });
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') { closeVehicleReportExportModal(); document.removeEventListener('keydown', escHandler); }
  });
}

function closeVehicleReportExportModal() {
  var modal = document.getElementById('export-modal-overlay');
  if (modal) modal.remove();
}

function loadExportPreferences() {
  try {
    var saved = localStorage.getItem('gm_export_prefs_v3');
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return {
    format: 'pdf',
    dateRange: 'all',
    includeVehicleInfo: true,
    includeRenewals: true,
    includeCostSummary: false,
    includeReminders: true,
    includeHistory: true,
    includeNextDue: true,
    showCosts: true,
    includeServiceSummary: false,
    showVin: true,
    showPlate: true,
    showOdometer: true,
    showYearMakeModel: true,
    showEngine: false,
    showStats: true
  };
}

function saveExportPreferences(prefs) {
  try { localStorage.setItem('gm_export_prefs_v3', JSON.stringify(prefs)); } catch (e) {}
}

function getExportOptions() {
  var formatEl = document.querySelector('input[name="export-format"]:checked');
  var format = formatEl ? formatEl.value : 'pdf';
  var dateRange = document.getElementById('export-date-range').value;

  function getChk(id, def) {
    var el = document.getElementById(id);
    return el ? el.checked : def;
  }

  return {
    format: format,
    dateRange: dateRange,
    dateFrom: document.getElementById('export-date-from') ? document.getElementById('export-date-from').value : null,
    dateTo: document.getElementById('export-date-to') ? document.getElementById('export-date-to').value : null,
    includeVehicleInfo:   getChk('export-inc-vehicleinfo', true),
    includeRenewals:      getChk('export-inc-renewals', true),
    includeCostSummary:   getChk('export-inc-costsummary', false),
    includeReminders:     getChk('export-inc-reminders', true),
    includeHistory:       getChk('export-inc-history', true),
    includeNextDue:       getChk('export-inc-nextdue', true),
    showCosts:            getChk('export-inc-showcosts', true),
    includeServiceSummary:getChk('export-inc-servicesummary', false),
    showVin:              getChk('export-vd-vin', true),
    showPlate:            getChk('export-vd-plate', true),
    showOdometer:         getChk('export-vd-odometer', true),
    showYearMakeModel:    getChk('export-vd-yearMakeModel', true),
    showEngine:           getChk('export-vd-engine', false),
    showStats:            getChk('export-vd-stats', true)
  };
}

function executeVehicleReportExport() {
  var options = getExportOptions();
  saveExportPreferences(options);
  closeVehicleReportExportModal();
  if (options.format === 'pdf')  exportVehicleReportPDF(options);
  else if (options.format === 'word')  exportVehicleReportWord(options);
  else if (options.format === 'xlsx') exportVehicleReportXLSX(options);
  else if (options.format === 'csv')  exportVehicleReportCSV(options);
}

// ========================================
// BRANDING & HELPERS
// ========================================

function getAppBranding() {
  var config = (typeof GM_CONFIG !== 'undefined' && GM_CONFIG) || (typeof APP_CONFIG !== 'undefined' && APP_CONFIG) || {};
  return {
    appName:      config.appName      || 'GarageMinder',
    appShortName: config.appShortName || 'GM',
    tagline:      config.appTagline   || 'Vehicle Maintenance Tracker',
    version:      config.appVersion   || '1.0',
    copyrightYear:config.copyrightYear || new Date().getFullYear(),
    logoUrl: 'assets/images/icon-64.png'
  };
}

function formatReminderDue(reminder, unit) {
  var parts = [];
  if (reminder.nextOdo != null) parts.push(reminder.nextOdo.toLocaleString() + ' ' + unit);
  if (reminder.nextDate) {
    var date = new Date(reminder.nextDate + 'T00:00:00');
    var today = new Date();
    var sameYear = date.getFullYear() === today.getFullYear();
    var opts = sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
    parts.push(date.toLocaleDateString('en-US', opts));
  }
  if (parts.length === 0) return '–';
  return parts.length === 2 ? parts.join(' or ') : parts[0];
}

function formatNextDue(entry, unit) {
  var parts = [];
  if (entry.nextOdo != null) parts.push(entry.nextOdo.toLocaleString() + ' ' + unit);
  if (entry.nextDate) {
    var date = new Date(entry.nextDate + 'T00:00:00');
    var today = new Date();
    var sameYear = date.getFullYear() === today.getFullYear();
    var opts = sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
    parts.push(date.toLocaleDateString('en-US', opts));
  }
  if (parts.length === 0) return null;
  return parts.join(' or ');
}

function filterEntriesByOptions(entries, options) {
  var filtered = entries.slice();
  if (options.dateRange !== 'all') {
    var today = getTodayDateInSettingsTz();
    var fromDate = null, toDate = null;
    if (options.dateRange === 'year')    { fromDate = new Date(today); fromDate.setFullYear(fromDate.getFullYear() - 1); }
    else if (options.dateRange === '6months') { fromDate = new Date(today); fromDate.setMonth(fromDate.getMonth() - 6); }
    else if (options.dateRange === '3months') { fromDate = new Date(today); fromDate.setMonth(fromDate.getMonth() - 3); }
    else if (options.dateRange === 'ytd')     { fromDate = new Date(today.getFullYear(), 0, 1); }
    else if (options.dateRange === 'custom') {
      if (options.dateFrom) fromDate = new Date(options.dateFrom);
      if (options.dateTo)   toDate   = new Date(options.dateTo);
    }
    filtered = filtered.filter(function(e) {
      if (!e.date) return true;
      var entryDate = new Date(e.date);
      if (fromDate && entryDate < fromDate) return false;
      if (toDate   && entryDate > toDate)   return false;
      return true;
    });
  }
  return filtered;
}

// ========================================
// REPORT DATA BUILDER
// ========================================

function buildVehicleReportData(options) {
  var branding = getAppBranding();
  var unit     = getUnitShort();
  var todayIso = getTodayIsoInSettingsTz();
  var vehicle  = data.vehicles.find(function(v) { return v.id === activeVehicleId; });
  if (!vehicle) return null;

  var entries = data.entries
    .filter(function(e) { return e.vehicleId === activeVehicleId; })
    .sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
  entries = filterEntriesByOptions(entries, options);

  var reminders = data.reminders.filter(function(r) { return r.vehicleId === activeVehicleId; });

  var costBreakdown = calculateCostBreakdown(entries);
  var stats         = calculateEnhancedStats(vehicle, entries, reminders);

  var timeline = entries.map(function(e, index) {
    var services  = normalizeServices(e.services || []);
    var totalCost = calculateEntryTotalCost(e);

    // Attachments: carry full objects so we can show filenames
    var attachments = Array.isArray(e.attachments) ? e.attachments : [];

    return {
      index:              index + 1,
      date:               e.date,
      dateFormatted:      e.date ? formatDateNice(e.date) : 'No date',
      odometer:           e.odo,
      odometerFormatted:  e.odo != null ? e.odo.toLocaleString() + ' ' + unit : '–',
      services:           services,
      serviceNames:       services.map(function(s) { return s.name; }),
      serviceCosts:       services
        .filter(function(s) { return s.cost != null; })
        .map(function(s) { return s.name + ': $' + s.cost.toFixed(2); })
        .join('; '),
      totalCost:          totalCost,
      totalCostFormatted: totalCost > 0 ? '$' + totalCost.toFixed(2) : '–',
      notes:              e.notes || '',
      nextDate:           e.nextDate || null,
      nextOdo:            e.nextOdo  != null ? e.nextOdo : null,
      attachments:        attachments
    };
  });

  var upcomingReminders = reminders.map(function(r) {
    var derived = computeReminderDerived(r, vehicle.currentOdo);
    return {
      serviceName:       r.serviceName || r.title || 'Reminder',
      status:            derived.level,
      statusLabel:       derived.label,
      nextOdo:           derived.nextOdo,
      nextDate:          derived.nextDate,
      nextDateFormatted: derived.nextDate ? formatDateNice(derived.nextDate) : null,
      intervalMiles:     r.intervalMiles,
      intervalMonths:    r.intervalMonths,
      urgency:           derived.level === 'overdue' ? 0 : (derived.level === 'upcoming' ? 1 : 2)
    };
  }).sort(function(a, b) { return a.urgency - b.urgency; });

  var serviceSummary = typeof buildServiceSummary === 'function' ? buildServiceSummary(entries) : [];

  return {
    branding:           branding,
    reportDate:         todayIso,
    reportDateFormatted:formatDateNice(todayIso),
    reportTime:         new Date().toLocaleTimeString(),
    unit:               unit,
    unitFull:           unit === 'km' ? 'Kilometers' : 'Miles',
    vehicle: {
      id:                       vehicle.id,
      name:                     vehicle.name,
      vin:                      vehicle.vin  || 'Not Recorded',
      plate:                    vehicle.plate || 'Not Recorded',
      currentOdo:               vehicle.currentOdo,
      year:                     vehicle.year   || null,
      make:                     vehicle.make   || null,
      model:                    vehicle.model  || null,
      engine:                   vehicle.engine || null,
      bodyClass:                vehicle.bodyClass || null,
      photo:                    vehicle.photo  || vehicle.photoPath || null,
      insuranceExpiry:          vehicle.insuranceExpiry,
      insuranceExpiryFormatted: vehicle.insuranceExpiry ? formatDateNice(vehicle.insuranceExpiry) : null,
      registrationExpiry:          vehicle.registrationExpiry,
      registrationExpiryFormatted: vehicle.registrationExpiry ? formatDateNice(vehicle.registrationExpiry) : null
    },
    costBreakdown:    costBreakdown,
    stats:            stats,
    timeline:         timeline,
    upcomingReminders:upcomingReminders,
    serviceSummary:   serviceSummary,
    recordCount:      timeline.length,
    options:          options
  };
}

function calculateCostBreakdown(entries) {
  var partsCost = 0, laborCost = 0, miscCost = 0;
  entries.forEach(function(entry) {
    if (Array.isArray(entry.services)) {
      entry.services.forEach(function(s) {
        if (typeof s === 'object' && s.cost != null) partsCost += Number(s.cost) || 0;
      });
    }
    if (entry.cost      != null) miscCost  += Number(entry.cost)      || 0;
    if (entry.laborCost != null) laborCost += Number(entry.laborCost) || 0;
  });
  var total = partsCost + laborCost + miscCost;
  function fmt(n) { return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  return {
    parts: partsCost, labor: laborCost, misc: miscCost, total: total,
    partsFormatted: fmt(partsCost), laborFormatted: fmt(laborCost),
    miscFormatted:  fmt(miscCost),  totalFormatted: fmt(total)
  };
}

function calculateEnhancedStats(vehicle, entries, reminders) {
  var unit        = getUnitShort();
  var today       = getTodayDateInSettingsTz();
  var currentYear = today.getFullYear();
  var totalCost = 0, ytdCost = 0, firstDate = null, lastDate = null,
      firstOdo = null, lastOdo = null, serviceCount = 0;
  var serviceTypeCounts = {};

  entries.forEach(function(e) {
    serviceCount++;
    var cost = calculateEntryTotalCost(e);
    totalCost += cost;
    if (e.date) {
      if (!firstDate || e.date < firstDate) { firstDate = e.date; firstOdo = e.odo; }
      if (!lastDate  || e.date > lastDate)  { lastDate  = e.date; lastOdo  = e.odo; }
      if (parseInt(e.date.substring(0, 4), 10) === currentYear) ytdCost += cost;
    }
    normalizeServices(e.services || []).forEach(function(s) {
      serviceTypeCounts[s.name] = (serviceTypeCounts[s.name] || 0) + 1;
    });
  });

  var distanceTracked = (lastOdo && firstOdo) ? lastOdo - firstOdo : 0;
  var yearsTracked = 0, monthsTracked = 0;
  if (firstDate && lastDate) {
    var diffMs = new Date(lastDate) - new Date(firstDate);
    yearsTracked  = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365));
    monthsTracked = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30));
  }

  var overdueCount = 0, upcomingCount = 0;
  reminders.forEach(function(r) {
    var derived = computeReminderDerived(r, vehicle.currentOdo);
    if (derived.level === 'overdue')  overdueCount++;
    else if (derived.level === 'upcoming') upcomingCount++;
  });

  return {
    totalCost:          totalCost,
    ytdCost:            ytdCost,
    avgCostPerService:  serviceCount > 0 ? totalCost / serviceCount : 0,
    costPerMile:        distanceTracked > 0 ? totalCost / distanceTracked : 0,
    firstDate:          firstDate,
    firstDateFormatted: firstDate ? formatDateNice(firstDate) : null,
    lastDate:           lastDate,
    lastDateFormatted:  lastDate  ? formatDateNice(lastDate)  : null,
    firstOdo:           firstOdo,
    lastOdo:            lastOdo,
    distanceTracked:    distanceTracked,
    yearsTracked:       yearsTracked,
    monthsTracked:      monthsTracked,
    avgPerYear:         yearsTracked > 0 ? Math.round(distanceTracked / yearsTracked) : distanceTracked,
    serviceCount:       serviceCount,
    overdueCount:       overdueCount,
    upcomingCount:      upcomingCount,
    totalReminders:     reminders.length,
    uniqueServiceTypes: Object.keys(serviceTypeCounts).length
  };
}

// ========================================
// CSV EXPORT (unchanged — tabular by nature)
// ========================================

function exportVehicleReportCSV(options) {
  var rpt = buildVehicleReportData(options);
  if (!rpt) return;
  var branding = rpt.branding, unit = rpt.unit, v = rpt.vehicle, cost = rpt.costBreakdown;
  var safeName = v.name.replace(/[^\w]+/g, '_').toLowerCase();
  var lines = [];

  lines.push(branding.appName + ' - Vehicle Maintenance Report');
  lines.push('Generated: ' + rpt.reportDateFormatted);
  lines.push('');
  lines.push('Vehicle Information');
  lines.push('Vehicle Name,' + v.name);
  if (v.vin   !== 'Not Recorded') lines.push('VIN,' + v.vin);
  if (v.plate !== 'Not Recorded') lines.push('License Plate,' + v.plate);
  if (v.currentOdo != null) lines.push('Current Odometer,' + v.currentOdo.toLocaleString() + ' ' + unit);
  if (v.year && v.make && v.model) lines.push('Year/Make/Model,' + v.year + ' ' + v.make + ' ' + v.model);
  if (v.insuranceExpiryFormatted)    lines.push('Insurance Expiry,'    + v.insuranceExpiryFormatted);
  if (v.registrationExpiryFormatted) lines.push('Registration Expiry,' + v.registrationExpiryFormatted);
  lines.push('');
  if (cost.total > 0) {
    lines.push('Cost Summary');
    lines.push('Total Cost,' + cost.totalFormatted);
    lines.push('');
  }

  lines.push('Service History');
  lines.push('Date,Odometer (' + unit + '),Services,Service Costs,Total Cost,Notes,Next Due,Attachments');
  rpt.timeline.slice().reverse().forEach(function(entry) {
    var nextDue    = formatNextDue(entry, unit) || '';
    var attachList = entry.attachments.map(function(a) { return a.name || ''; }).filter(Boolean).join('; ');
    lines.push(
      entry.dateFormatted + ',' +
      (entry.odometer != null ? entry.odometer : '') + ',' +
      '"' + entry.serviceNames.join('; ').replace(/"/g, '""') + '",' +
      '"' + entry.serviceCosts.replace(/"/g, '""') + '",' +
      (entry.totalCost > 0 ? entry.totalCost.toFixed(2) : '') + ',' +
      '"' + (entry.notes || '').replace(/"/g, '""') + '",' +
      '"' + nextDue.replace(/"/g, '""') + '",' +
      '"' + attachList.replace(/"/g, '""') + '"'
    );
  });
  lines.push('');
  lines.push('Report generated by ' + branding.appName);

  var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = branding.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + safeName + '-report.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV report exported');
}

// ========================================
// XLSX EXPORT (unchanged — tabular by nature)
// ========================================

function exportVehicleReportXLSX(options) {
  var rpt = buildVehicleReportData(options);
  if (!rpt) return;
  if (!window.XLSX) { alert('Excel export requires SheetJS library. Falling back to CSV.'); exportVehicleReportCSV(options); return; }

  var branding = rpt.branding, unit = rpt.unit, v = rpt.vehicle;
  var safeName = v.name.replace(/[^\w]+/g, '_').toLowerCase();
  var wb     = XLSX.utils.book_new();
  var wsData = [];

  wsData.push([branding.appName + ' - Vehicle Maintenance Report']);
  wsData.push(['Generated: ' + rpt.reportDateFormatted]);
  wsData.push([]);
  wsData.push(['Vehicle Information']);
  wsData.push(['Vehicle Name', v.name]);
  if (v.vin   !== 'Not Recorded') wsData.push(['VIN', v.vin]);
  if (v.plate !== 'Not Recorded') wsData.push(['License Plate', v.plate]);
  if (v.currentOdo != null) wsData.push(['Current Odometer', v.currentOdo.toLocaleString() + ' ' + unit]);
  if (v.year && v.make && v.model) wsData.push(['Year/Make/Model', v.year + ' ' + v.make + ' ' + v.model]);
  wsData.push([]);
  wsData.push(['Service History']);
  wsData.push(['Date', 'Odometer (' + unit + ')', 'Services', 'Service Costs', 'Total Cost', 'Notes', 'Next Due', 'Attachments']);
  rpt.timeline.slice().reverse().forEach(function(entry) {
    var nextDue    = formatNextDue(entry, unit) || '';
    var attachList = entry.attachments.map(function(a) { return a.name || ''; }).filter(Boolean).join('; ');
    wsData.push([
      entry.dateFormatted,
      entry.odometer,
      entry.serviceNames.join('; '),
      entry.serviceCosts,
      entry.totalCost > 0 ? entry.totalCost : '',
      entry.notes || '',
      nextDue,
      attachList
    ]);
  });

  var ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [
    { wch: 14 }, { wch: 14 }, { wch: 40 }, { wch: 35 },
    { wch: 12 }, { wch: 45 }, { wch: 22 }, { wch: 35 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Vehicle Report');
  XLSX.writeFile(wb, branding.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + safeName + '-report.xlsx');
  showToast('Excel report exported');
}

// ========================================
// PDF EXPORT
// ========================================

async function exportVehicleReportPDF(options) {
  var rpt = buildVehicleReportData(options);
  if (!rpt) return;
  if (!window.jspdf || !window.jspdf.jsPDF) { alert('PDF export requires jsPDF library.'); return; }

  var branding = rpt.branding;
  var safeName = rpt.vehicle.name.replace(/[^\w]+/g, '_').toLowerCase();

  var logoData = null;
  try { logoData = await loadImageAsDataUrl(branding.logoUrl); } catch (e) { /* logo optional */ }

  generateCleanPDF(rpt, safeName, logoData);
}

async function loadImageAsDataUrl(url) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width  = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function generateCleanPDF(rpt, safeName, logoData) {
  var jsPDF     = window.jspdf.jsPDF;
  var doc       = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  var pageWidth  = doc.internal.pageSize.getWidth();
  var pageHeight = doc.internal.pageSize.getHeight();
  var margin       = 15;
  var contentWidth = pageWidth - (margin * 2);

  var branding = rpt.branding, unit = rpt.unit, v = rpt.vehicle,
      s = rpt.stats, cost = rpt.costBreakdown, opts = rpt.options;

  // Colour palette (greyscale-safe)
  var black        = [0,   0,   0];
  var darkGray     = [51,  51,  51];
  var mediumGray   = [102, 102, 102];
  var lightGray    = [153, 153, 153];
  var veryLightGray= [220, 220, 220];
  var tableBg      = [245, 245, 245];
  var white        = [255, 255, 255];
  var accentBg     = [240, 240, 240]; // card service area bg

  // ---- helper: check page, add new if needed ----
  function checkPage(neededHeight) {
    if (y + neededHeight > pageHeight - 18) {
      doc.addPage();
      y = 15;
      // running footer on new page
      drawPageFooter();
    }
  }

  function drawPageFooter() {
    var pageNum = doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFontSize(7);
    doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
    doc.setFont('helvetica', 'normal');
    doc.text(v.name + (v.vin !== 'Not Recorded' ? ' | VIN: ' + v.vin : ''), margin, pageHeight - 8);
    doc.text('Page ' + pageNum, pageWidth / 2, pageHeight - 8, { align: 'center' });
    doc.text(branding.appName, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  // ---- helper: section header bar ----
  function sectionHeader(label) {
    checkPage(12);
    doc.setFillColor(darkGray[0], darkGray[1], darkGray[2]);
    doc.rect(margin, y, contentWidth, 7, 'F');
    doc.setTextColor(white[0], white[1], white[2]);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(label, margin + 4, y + 5);
    y += 7;
  }

  var y = 12;

  // ---- DOCUMENT HEADER ----
  if (logoData) {
    try { doc.addImage(logoData, 'PNG', margin, y - 3, 9, 9); } catch (e) {}
  }
  var logoOffset = logoData ? 12 : 0;
  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.setTextColor(black[0], black[1], black[2]);
  doc.text(branding.appName, margin + logoOffset, y + 2);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
  doc.text('Vehicle Maintenance Report', margin + logoOffset, y + 7);
  doc.setFontSize(8);
  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.text('Report Date: ' + rpt.reportDateFormatted, pageWidth - margin, y, { align: 'right' });
  doc.text(rpt.recordCount + ' Service Record' + (rpt.recordCount !== 1 ? 's' : ''), pageWidth - margin, y + 5, { align: 'right' });

  y = 24;
  doc.setDrawColor(veryLightGray[0], veryLightGray[1], veryLightGray[2]);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y = 30;

  // ---- VEHICLE INFORMATION ----
  if (opts.includeVehicleInfo) {
    sectionHeader('Vehicle Information');

    var boxStartY = y;
    y += 6;

    doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    doc.setTextColor(black[0], black[1], black[2]);
    doc.text(v.name, margin + 5, y);
    y += 8;

    var detailItems = [];
    if (opts.showVin          && v.vin   !== 'Not Recorded') detailItems.push({ label: 'VIN',              value: v.vin });
    if (opts.showPlate        && v.plate !== 'Not Recorded') detailItems.push({ label: 'LICENSE PLATE',     value: v.plate });
    if (opts.showOdometer     && v.currentOdo != null)       detailItems.push({ label: 'CURRENT ODOMETER',  value: v.currentOdo.toLocaleString() + ' ' + unit });
    if (opts.showYearMakeModel && v.year && v.make && v.model) detailItems.push({ label: 'YEAR/MAKE/MODEL', value: v.year + ' ' + v.make + ' ' + v.model });
    if (opts.showEngine       && v.engine)                   detailItems.push({ label: 'ENGINE',            value: v.engine });
    if (opts.showStats) {
      if (s.monthsTracked > 0) {
        var span = s.yearsTracked > 0
          ? s.yearsTracked + ' year' + (s.yearsTracked > 1 ? 's' : '')
          : s.monthsTracked + ' month' + (s.monthsTracked > 1 ? 's' : '');
        detailItems.push({ label: 'HISTORY SPAN', value: span });
      }
      if (s.distanceTracked > 0) detailItems.push({ label: 'DISTANCE TRACKED', value: s.distanceTracked.toLocaleString() + ' ' + unit });
      if (s.avgPerYear      > 0) detailItems.push({ label: 'AVG. ANNUAL',       value: s.avgPerYear.toLocaleString() + ' ' + unit + '/yr' });
    }

    var colWidth = (contentWidth - 10) / 3;
    var col = 0, rowY = y;
    detailItems.forEach(function(item) {
      checkPage(14);
      var x = margin + 5 + (col * colWidth);
      doc.setFontSize(6); doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]); doc.setFont('helvetica', 'normal');
      doc.text(item.label, x, rowY);
      doc.setFontSize(9); doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]); doc.setFont('helvetica', 'bold');
      // Use splitTextToSize instead of hard truncation
      var maxW = colWidth - 4;
      var valueLines = doc.splitTextToSize(item.value, maxW);
      doc.text(valueLines, x, rowY + 4);
      col++;
      if (col >= 3) {
        col = 0;
        rowY += (valueLines.length > 1 ? 8 + (valueLines.length - 1) * 4 : 11);
      }
    });
    if (col > 0) rowY += 11;
    y = rowY + 2;

    doc.setDrawColor(veryLightGray[0], veryLightGray[1], veryLightGray[2]);
    doc.setLineWidth(0.3);
    doc.rect(margin, boxStartY, contentWidth, y - boxStartY, 'S');
    y += 6;
  }

  // ---- RENEWAL DATES ----
  if (opts.includeRenewals && (v.insuranceExpiry || v.registrationExpiry)) {
    sectionHeader('Renewal Dates');
    var boxStartY2 = y;
    y += 5;
    var renewals = [];
    if (v.insuranceExpiryFormatted)    renewals.push({ label: 'Insurance Expiry',    value: v.insuranceExpiryFormatted });
    if (v.registrationExpiryFormatted) renewals.push({ label: 'Registration Expiry', value: v.registrationExpiryFormatted });
    renewals.forEach(function(item, i) {
      var x = margin + 5 + (i * (contentWidth / 2));
      doc.setFontSize(7);  doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]); doc.setFont('helvetica', 'normal');
      doc.text(item.label, x, y);
      doc.setFontSize(10); doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);      doc.setFont('helvetica', 'bold');
      doc.text(item.value, x, y + 5);
    });
    y += 10;
    doc.setDrawColor(veryLightGray[0], veryLightGray[1], veryLightGray[2]);
    doc.rect(margin, boxStartY2, contentWidth, y - boxStartY2, 'S');
    y += 6;
  }

  // ---- COST SUMMARY ----
  if (opts.includeCostSummary && cost.total > 0) {
    sectionHeader('Cost Summary');
    var boxStartY3 = y;
    y += 4;
    var cardWidth = (contentWidth - 15) / 4;
    var costItems = [
      { label: 'Parts/Services', value: cost.partsFormatted },
      { label: 'Labor',          value: cost.laborFormatted },
      { label: 'Misc/Fees',      value: cost.miscFormatted  },
      { label: 'TOTAL',          value: cost.totalFormatted, bold: true }
    ];
    costItems.forEach(function(item, i) {
      var x = margin + 3 + (i * (cardWidth + 3));
      doc.setDrawColor(veryLightGray[0], veryLightGray[1], veryLightGray[2]);
      if (item.bold) {
        doc.setFillColor(tableBg[0], tableBg[1], tableBg[2]);
        doc.rect(x, y, cardWidth, 14, 'FD');
      } else {
        doc.rect(x, y, cardWidth, 14, 'S');
      }
      doc.setFontSize(6); doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]); doc.setFont('helvetica', 'normal');
      doc.text(item.label.toUpperCase(), x + cardWidth / 2, y + 4, { align: 'center' });
      doc.setFontSize(item.bold ? 11 : 9);
      doc.setTextColor(item.bold ? black[0] : darkGray[0], item.bold ? black[1] : darkGray[1], item.bold ? black[2] : darkGray[2]);
      doc.setFont('helvetica', item.bold ? 'bold' : 'normal');
      doc.text(item.value, x + cardWidth / 2, y + 10, { align: 'center' });
    });
    y += 18;
    doc.setDrawColor(veryLightGray[0], veryLightGray[1], veryLightGray[2]);
    doc.rect(margin, boxStartY3, contentWidth, y - boxStartY3 + 2, 'S');
    y += 8;
  }

  // ---- UPCOMING MAINTENANCE ----
  if (opts.includeReminders && rpt.upcomingReminders.length > 0) {
    sectionHeader('Upcoming Maintenance');
    var statusText  = s.overdueCount > 0 ? s.overdueCount + ' Overdue' : 'All OK';
    var badgeWidth  = doc.getTextWidth(statusText) + 8;
    doc.setFontSize(7);
    doc.setFillColor(s.overdueCount > 0 ? mediumGray[0] : lightGray[0],
                     s.overdueCount > 0 ? mediumGray[1] : lightGray[1],
                     s.overdueCount > 0 ? mediumGray[2] : lightGray[2]);
    doc.rect(pageWidth - margin - badgeWidth - 3, y - 6.5, badgeWidth, 4, 'F');
    doc.setTextColor(white[0], white[1], white[2]);
    doc.text(statusText, pageWidth - margin - badgeWidth / 2 - 3, y - 3.3, { align: 'center' });

    var boxStartY4 = y;
    y += 4;

    rpt.upcomingReminders.forEach(function(reminder) {
      checkPage(8);
      var dotFill = reminder.status === 'overdue' ? black : (reminder.status === 'upcoming' ? mediumGray : lightGray);
      doc.setFillColor(dotFill[0], dotFill[1], dotFill[2]);
      doc.circle(margin + 5, y + 1.5, 1.5, 'F');
      doc.setFontSize(9); doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]); doc.setFont('helvetica', 'normal');
      doc.text(reminder.serviceName, margin + 10, y + 2.5);
      doc.setFontSize(8); doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
      doc.text(formatReminderDue(reminder, unit), pageWidth - margin - 3, y + 2.5, { align: 'right' });
      y += 6;
    });

    y += 2;
    doc.setDrawColor(veryLightGray[0], veryLightGray[1], veryLightGray[2]);
    doc.rect(margin, boxStartY4, contentWidth, y - boxStartY4, 'S');
    y += 6;
  }

  // ---- SERVICE HISTORY (card layout) ----
  if (opts.includeHistory && rpt.timeline.length > 0) {
    sectionHeader('Service History');
    y += 2;

    // Pre-calculate card height so the whole card can be placed on a fresh page
    // if it won't fit. Each measure call is dry-run (no drawing).
    function measureCard(entry) {
      var h = 0;
      var innerW = contentWidth - 8;

      // Header row: date + odo + cost — single line
      h += 10;

      // Separator line after header
      h += 2;

      // Services
      entry.services.forEach(function(svc) {
        var nameMaxW = opts.showCosts ? innerW - 30 : innerW - 6;
        var nameLines = doc.splitTextToSize(svc.name, nameMaxW);
        h += nameLines.length > 1 ? (nameLines.length * 4.5) : 5.5;
        if (svc.note && svc.note.trim()) {
          var noteLines = doc.splitTextToSize(svc.note.trim(), innerW - 10);
          h += noteLines.length * 4 + 1;
        }
        h += 1;
      });
      h += 2;

      // Entry notes
      if (entry.notes && entry.notes.trim()) {
        h += 7; // label + separator
        var noteLines = doc.splitTextToSize(entry.notes.trim(), innerW - 2);
        h += noteLines.length * 4.5 + 2;
      }

      // Footer: next due
      var hasNextDue = opts.includeNextDue && formatNextDue(entry, unit);
      if (hasNextDue) h += 7;

      // Footer: attachments
      if (entry.attachments && entry.attachments.length > 0) {
        h += 6; // label
        entry.attachments.forEach(function(att) {
          if (!att.name) return;
          var attLines = doc.splitTextToSize('\u00BB ' + att.name, innerW - 4);
          h += attLines.length * 4;
        });
      }

      h += 6; // bottom gap between cards
      return h;
    }

    rpt.timeline.slice().reverse().forEach(function(entry) {
      var cardH   = measureCard(entry);
      var innerX  = margin + 4;
      var innerW  = contentWidth - 8;
      var hasNotes   = entry.notes && entry.notes.trim();
      var hasNextDue = opts.includeNextDue && formatNextDue(entry, unit);
      var hasAttach  = entry.attachments && entry.attachments.length > 0;

      // If entire card fits on remaining space, keep it together.
      // If it's taller than a full page, let it flow naturally (can't avoid splits).
      var fullPageH = pageHeight - 33; // usable area
      if (cardH <= fullPageH) {
        checkPage(cardH);
      }
      // else: card is bigger than a page, just let it flow line by line below

      // — Card header: plain, no background —
      doc.setFontSize(10); doc.setFont('helvetica', 'bold');
      doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
      doc.text(entry.dateFormatted, innerX, y + 4);

      if (entry.odometerFormatted !== '–') {
        doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');
        doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
        doc.text(entry.odometerFormatted, pageWidth / 2, y + 4, { align: 'center' });
      }

      if (opts.showCosts && entry.totalCostFormatted !== '–') {
        doc.setFontSize(10); doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
        doc.text(entry.totalCostFormatted, pageWidth - margin - 4, y + 4, { align: 'right' });
      }
      y += 7;

      // Thin separator line under header
      doc.setDrawColor(veryLightGray[0], veryLightGray[1], veryLightGray[2]);
      doc.setLineWidth(0.3);
      doc.line(margin, y, pageWidth - margin, y);
      y += 3;

      // — Services —
      entry.services.forEach(function(svc) {
        // Bullet dot
        doc.setFillColor(mediumGray[0], mediumGray[1], mediumGray[2]);
        doc.circle(innerX + 1.5, y + 1.5, 1.2, 'F');

        // Service name
        doc.setFontSize(9); doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
        var nameMaxW  = opts.showCosts ? innerW - 30 : innerW - 6;
        var nameLines = doc.splitTextToSize(svc.name, nameMaxW);
        doc.text(nameLines, innerX + 5, y + 2.5);

        // Per-service cost (right-aligned, conditional)
        if (opts.showCosts && svc.cost != null) {
          doc.setFontSize(9); doc.setFont('helvetica', 'normal');
          doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
          doc.text('$' + Number(svc.cost).toFixed(2), margin + contentWidth - 4, y + 2.5, { align: 'right' });
        }
        y += nameLines.length > 1 ? (nameLines.length * 4.5) : 5.5;

        // Per-service note
        if (svc.note && svc.note.trim()) {
          doc.setFontSize(7.5); doc.setFont('helvetica', 'italic');
          doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
          var noteLines = doc.splitTextToSize(svc.note.trim(), innerW - 10);
          doc.text(noteLines, innerX + 8, y + 1.5);
          y += noteLines.length * 4 + 1;
        }
        y += 1;
      });

      y += 2;

      // — Entry notes block —
      if (hasNotes) {
        doc.setDrawColor(veryLightGray[0], veryLightGray[1], veryLightGray[2]);
        doc.setLineWidth(0.2);
        doc.line(innerX, y, margin + contentWidth - 4, y);
        y += 3;
        doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
        doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]);
        doc.text('NOTES', innerX, y + 1);
        y += 4;
        doc.setFontSize(8); doc.setFont('helvetica', 'normal');
        doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
        var entryNoteLines = doc.splitTextToSize(entry.notes.trim(), innerW - 2);
        doc.text(entryNoteLines, innerX, y);
        y += entryNoteLines.length * 4.5 + 2;
      }

      // — Footer: next due + attachments —
      if (hasNextDue || hasAttach) {
        y += 1;
        doc.setDrawColor(veryLightGray[0], veryLightGray[1], veryLightGray[2]);
        doc.setLineWidth(0.2);
        doc.line(innerX, y, margin + contentWidth - 4, y);
        y += 3;

        if (hasNextDue) {
          doc.setFontSize(7); doc.setFont('helvetica', 'bold');
          doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
          doc.text('NEXT DUE', innerX, y + 1);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
          doc.text(hasNextDue, innerX + 20, y + 1);
          y += 5;
        }

        if (hasAttach) {
          doc.setFontSize(7); doc.setFont('helvetica', 'bold');
          doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
          doc.text('ATTACHMENTS', innerX, y + 1);
          y += 4;
          entry.attachments.forEach(function(att) {
            if (!att.name) return;
            doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
            doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
            var attLines = doc.splitTextToSize('\u00BB ' + att.name, innerW - 4);
            doc.text(attLines, innerX + 2, y + 1);
            y += attLines.length * 4;
          });
        }
      }

      // Bottom separator between cards (replaces card border)
      y += 3;
      doc.setDrawColor(veryLightGray[0], veryLightGray[1], veryLightGray[2]);
      doc.setLineWidth(0.3);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6;
    });
  }

  // ---- DISCLAIMER FOOTER ----
  if (y < pageHeight - 28) {
    doc.setDrawColor(veryLightGray[0], veryLightGray[1], veryLightGray[2]);
    doc.setLineWidth(0.3);
    doc.rect(margin, y, contentWidth, 16, 'S');
    doc.setFontSize(7); doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]); doc.setFont('helvetica', 'normal');
    doc.text('This report is generated from records in ' + branding.appName + '. It may not include all maintenance performed.', margin + 4, y + 5);
    doc.text('For vehicle purchase decisions, always verify records and perform an independent inspection.', margin + 4, y + 9);
    doc.text('Report generated: ' + rpt.reportDateFormatted + ' at ' + rpt.reportTime, margin + 4, y + 13);
  }

  // Draw footer on first page (subsequent pages get it via checkPage/addPage)
  drawPageFooter();

  doc.save(branding.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + safeName + '-report.pdf');
  showToast('PDF report exported');
}

// ========================================
// WORD EXPORT
// ========================================

function exportVehicleReportWord(options) {
  var rpt = buildVehicleReportData(options);
  if (!rpt) return;

  var branding = rpt.branding, unit = rpt.unit, v = rpt.vehicle,
      s = rpt.stats, cost = rpt.costBreakdown, opts = rpt.options;
  var safeName = v.name.replace(/[^\w]+/g, '_').toLowerCase();

  var css = [
    '@page { margin: 0.75in; size: letter }',
    '* { box-sizing: border-box }',
    'body { font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: #333; margin: 0; padding: 0 }',

    // Document header
    '.doc-header { border-bottom: 1px solid #ccc; padding-bottom: 12px; margin-bottom: 20px; display: table; width: 100% }',
    '.doc-header-left  { display: table-cell; vertical-align: top }',
    '.doc-header-right { display: table-cell; vertical-align: top; text-align: right }',
    '.app-name    { font-size: 18pt; font-weight: bold; color: #000 }',
    '.app-tagline { font-size: 9pt; color: #666; margin-top: 2px }',
    '.report-meta { font-size: 8pt; color: #333 }',

    // Sections
    '.section { margin: 15px 0; page-break-inside: avoid }',
    '.section-header { background: #333; color: #fff; padding: 6px 12px; font-size: 10pt; font-weight: bold }',
    '.section-body { border: 1px solid #dcdcdc; border-top: none; padding: 15px }',

    // Vehicle info grid
    '.vehicle-name { font-size: 14pt; font-weight: bold; color: #000; margin-bottom: 12px }',
    '.info-grid  { display: table; width: 100% }',
    '.info-row   { display: table-row }',
    '.info-cell  { display: table-cell; width: 33%; padding: 5px 10px 5px 0; vertical-align: top }',
    '.info-label { font-size: 7pt; color: #999; text-transform: uppercase }',
    '.info-value { font-size: 9pt; color: #333; font-weight: bold; word-break: break-word }',

    // Reminder rows
    '.reminder-row          { padding: 4px 0; border-bottom: 1px solid #eee; display: table; width: 100% }',
    '.reminder-row:last-child { border-bottom: none }',
    '.reminder-dot          { display: table-cell; width: 20px; vertical-align: middle }',
    '.reminder-dot-inner    { width: 8px; height: 8px; border-radius: 50%; display: inline-block }',
    '.reminder-dot-inner.overdue  { background: #000 }',
    '.reminder-dot-inner.upcoming { background: #666 }',
    '.reminder-dot-inner.ok       { background: #ccc }',
    '.reminder-name { display: table-cell; font-size: 9pt; color: #333; vertical-align: middle }',
    '.reminder-due  { display: table-cell; text-align: right; font-size: 8pt; color: #666; vertical-align: middle }',

    // Cost summary cards
    '.cost-cards { display: table; width: 100%; border-collapse: separate; border-spacing: 6px }',
    '.cost-card  { display: table-cell; border: 1px solid #ddd; padding: 8px 10px; vertical-align: top; width: 25% }',
    '.cost-card.total { background: #f5f5f5 }',
    '.cost-card-label { font-size: 7pt; color: #999; text-transform: uppercase }',
    '.cost-card-value { font-size: 11pt; font-weight: bold; color: #333; margin-top: 4px }',

    // Entry cards
    '.entry-card { margin-bottom: 16px; page-break-inside: avoid }',
    '.entry-header { padding: 6px 0 5px; display: table; width: 100%; border-bottom: 1px solid #dcdcdc }',
    '.entry-header-date { display: table-cell; font-size: 10pt; font-weight: bold; color: #333; vertical-align: middle }',
    '.entry-header-odo  { display: table-cell; font-size: 9pt; text-align: center; vertical-align: middle; color: #888 }',
    '.entry-header-cost { display: table-cell; font-size: 10pt; font-weight: bold; color: #333; text-align: right; vertical-align: middle }',
    '.entry-services { padding: 8px 0 4px }',
    '.service-item { padding: 4px 0; border-bottom: 1px solid #f0f0f0 }',
    '.service-item:last-child { border-bottom: none }',
    '.service-row { display: table; width: 100% }',
    '.service-name-cell { display: table-cell; font-size: 9pt; font-weight: bold; color: #333; vertical-align: top }',
    '.service-cost-cell { display: table-cell; font-size: 9pt; color: #555; text-align: right; vertical-align: top; white-space: nowrap; padding-left: 10px }',
    '.service-note { font-size: 8pt; color: #777; font-style: italic; padding: 2px 0 0 6px }',
    '.service-bullet { color: #999; margin-right: 5px }',

    // Entry notes
    '.entry-notes-block { padding: 8px 0; border-top: 1px solid #eee }',
    '.entry-notes-label { font-size: 7pt; color: #aaa; text-transform: uppercase; margin-bottom: 3px }',
    '.entry-notes-text  { font-size: 9pt; color: #333; line-height: 1.5; white-space: pre-wrap; word-break: break-word }',

    // Entry footer (next due + attachments)
    '.entry-footer { padding: 7px 0; border-top: 1px solid #eee }',
    '.entry-footer-row { display: table; width: 100%; margin-bottom: 4px }',
    '.entry-footer-row:last-child { margin-bottom: 0 }',
    '.entry-footer-label { display: table-cell; font-size: 7pt; font-weight: bold; color: #aaa; text-transform: uppercase; width: 90px; vertical-align: top; padding-top: 1px }',
    '.entry-footer-value { display: table-cell; font-size: 8.5pt; color: #333; vertical-align: top }',
    '.attachment-name { font-size: 8pt; color: #555; display: inline-block; margin-right: 10px }',

    // Disclaimer
    '.footer { margin-top: 20px; padding: 12px; border: 1px solid #dcdcdc; font-size: 8pt; color: #666; line-height: 1.5 }'
  ].join('\n');

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
    escapeHtml(branding.appName) + ' - Vehicle Report</title><style>' + css + '</style></head><body>';

  // Document header
  html += '<div class="doc-header">' +
    '<div class="doc-header-left">' +
    '<div class="app-name">' + escapeHtml(branding.appName) + '</div>' +
    '<div class="app-tagline">Vehicle Maintenance Report</div>' +
    '</div>' +
    '<div class="doc-header-right">' +
    '<div class="report-meta">Report Date: ' + rpt.reportDateFormatted + '<br>' +
    rpt.recordCount + ' Service Record' + (rpt.recordCount !== 1 ? 's' : '') + '</div>' +
    '</div></div>';

  // Vehicle Information
  if (opts.includeVehicleInfo) {
    var detailItems = [];
    if (opts.showVin          && v.vin   !== 'Not Recorded') detailItems.push({ label: 'VIN',             value: v.vin });
    if (opts.showPlate        && v.plate !== 'Not Recorded') detailItems.push({ label: 'License Plate',    value: v.plate });
    if (opts.showOdometer     && v.currentOdo != null)       detailItems.push({ label: 'Current Odometer', value: v.currentOdo.toLocaleString() + ' ' + unit });
    if (opts.showYearMakeModel && v.year && v.make && v.model) detailItems.push({ label: 'Year/Make/Model', value: v.year + ' ' + v.make + ' ' + v.model });
    if (opts.showEngine       && v.engine)                   detailItems.push({ label: 'Engine',           value: v.engine });
    if (opts.showStats) {
      if (s.monthsTracked > 0) detailItems.push({ label: 'History Span', value: s.yearsTracked > 0 ? s.yearsTracked + ' year' + (s.yearsTracked > 1 ? 's' : '') : s.monthsTracked + ' month' + (s.monthsTracked > 1 ? 's' : '') });
      if (s.distanceTracked > 0) detailItems.push({ label: 'Distance Tracked', value: s.distanceTracked.toLocaleString() + ' ' + unit });
    }
    html += '<div class="section"><div class="section-header">Vehicle Information</div><div class="section-body">';
    html += '<div class="vehicle-name">' + escapeHtml(v.name) + '</div>';
    html += '<div class="info-grid">';
    for (var i = 0; i < detailItems.length; i += 3) {
      html += '<div class="info-row">';
      for (var j = i; j < i + 3 && j < detailItems.length; j++) {
        html += '<div class="info-cell"><div class="info-label">' + escapeHtml(detailItems[j].label).toUpperCase() +
          '</div><div class="info-value">' + escapeHtml(detailItems[j].value) + '</div></div>';
      }
      html += '</div>';
    }
    html += '</div></div></div>';
  }

  // Renewal Dates
  if (opts.includeRenewals && (v.insuranceExpiry || v.registrationExpiry)) {
    html += '<div class="section"><div class="section-header">Renewal Dates</div><div class="section-body"><div class="info-grid"><div class="info-row">';
    if (v.insuranceExpiryFormatted)    html += '<div class="info-cell"><div class="info-label">INSURANCE EXPIRY</div><div class="info-value">' + v.insuranceExpiryFormatted + '</div></div>';
    if (v.registrationExpiryFormatted) html += '<div class="info-cell"><div class="info-label">REGISTRATION EXPIRY</div><div class="info-value">' + v.registrationExpiryFormatted + '</div></div>';
    html += '</div></div></div></div>';
  }

  // Cost Summary
  if (opts.includeCostSummary && cost.total > 0) {
    html += '<div class="section"><div class="section-header">Cost Summary</div><div class="section-body">';
    html += '<div class="cost-cards">';
    html += '<div class="cost-card"><div class="cost-card-label">Parts / Services</div><div class="cost-card-value">' + cost.partsFormatted + '</div></div>';
    html += '<div class="cost-card"><div class="cost-card-label">Labor</div><div class="cost-card-value">' + cost.laborFormatted + '</div></div>';
    html += '<div class="cost-card"><div class="cost-card-label">Misc / Fees</div><div class="cost-card-value">' + cost.miscFormatted + '</div></div>';
    html += '<div class="cost-card total"><div class="cost-card-label">Total</div><div class="cost-card-value">' + cost.totalFormatted + '</div></div>';
    html += '</div></div></div>';
  }

  // Upcoming Maintenance
  if (opts.includeReminders && rpt.upcomingReminders.length > 0) {
    html += '<div class="section"><div class="section-header">Upcoming Maintenance</div><div class="section-body">';
    rpt.upcomingReminders.forEach(function(reminder) {
      html += '<div class="reminder-row">' +
        '<div class="reminder-dot"><span class="reminder-dot-inner ' + reminder.status + '"></span></div>' +
        '<div class="reminder-name">' + escapeHtml(reminder.serviceName) + '</div>' +
        '<div class="reminder-due">' + formatReminderDue(reminder, unit) + '</div>' +
        '</div>';
    });
    html += '</div></div>';
  }

  // Service History — card layout
  if (opts.includeHistory && rpt.timeline.length > 0) {
    html += '<div class="section"><div class="section-header">Service History</div><div class="section-body">';

    rpt.timeline.slice().reverse().forEach(function(entry) {
      // Card
      html += '<div class="entry-card">';

      // Header bar
      html += '<div class="entry-header">' +
        '<div class="entry-header-date">' + escapeHtml(entry.dateFormatted) + '</div>' +
        '<div class="entry-header-odo">'  + (entry.odometerFormatted !== '–' ? escapeHtml(entry.odometerFormatted) : '') + '</div>' +
        '<div class="entry-header-cost">' + (opts.showCosts && entry.totalCostFormatted !== '–' ? escapeHtml(entry.totalCostFormatted) : '') + '</div>' +
        '</div>';

      // Services
      if (entry.services.length > 0) {
        html += '<div class="entry-services">';
        entry.services.forEach(function(svc) {
          html += '<div class="service-item">';
          html += '<div class="service-row">';
          html += '<div class="service-name-cell"><span class="service-bullet">&#9679;</span>' + escapeHtml(svc.name) + '</div>';
          html += '<div class="service-cost-cell">' + (opts.showCosts && svc.cost != null ? '$' + Number(svc.cost).toFixed(2) : '') + '</div>';
          html += '</div>';
          if (svc.note && svc.note.trim()) {
            html += '<div class="service-note">' + escapeHtml(svc.note.trim()) + '</div>';
          }
          html += '</div>';
        });
        html += '</div>';
      }

      // Entry-level notes
      if (entry.notes && entry.notes.trim()) {
        html += '<div class="entry-notes-block">' +
          '<div class="entry-notes-label">Notes</div>' +
          '<div class="entry-notes-text">' + escapeHtml(entry.notes.trim()) + '</div>' +
          '</div>';
      }

      // Footer: next due + attachments
      var nextDueStr  = opts.includeNextDue ? formatNextDue(entry, unit) : null;
      var hasAttach   = entry.attachments && entry.attachments.length > 0;
      if (nextDueStr || hasAttach) {
        html += '<div class="entry-footer">';
        if (nextDueStr) {
          html += '<div class="entry-footer-row">' +
            '<div class="entry-footer-label">Next Due</div>' +
            '<div class="entry-footer-value">' + escapeHtml(nextDueStr) + '</div>' +
            '</div>';
        }
        if (hasAttach) {
          html += '<div class="entry-footer-row">' +
            '<div class="entry-footer-label">Attachments</div>' +
            '<div class="entry-footer-value">';
          entry.attachments.forEach(function(att) {
            if (att.name) {
              html += '<span class="attachment-name">&#128206; ' + escapeHtml(att.name) + '</span>';
            }
          });
          html += '</div></div>';
        }
        html += '</div>';
      }

      html += '</div>'; // end entry-card
    });

    html += '</div></div>'; // end section-body + section
  }

  // Disclaimer footer
  html += '<div class="footer">This report is generated from records in ' + escapeHtml(branding.appName) +
    '. It may not include all maintenance performed on this vehicle. ' +
    'For vehicle purchase decisions, always verify records and perform an independent inspection.<br>' +
    '<em>Report generated: ' + rpt.reportDateFormatted + ' at ' + rpt.reportTime + '</em></div>';

  html += '</body></html>';

  var blob = new Blob([html], { type: 'application/msword' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = branding.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + safeName + '-report.doc';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Word report exported');
}

// ========================================
// GLOBAL EXPORTS
// ========================================

window.openVehicleReportExportModal    = openVehicleReportExportModal;
window.closeVehicleReportExportModal   = closeVehicleReportExportModal;
window.executeVehicleReportExport      = executeVehicleReportExport;
window.exportVehicleReportPDF          = exportVehicleReportPDF;
window.exportVehicleReportWord         = exportVehicleReportWord;
window.exportVehicleReportCSV          = exportVehicleReportCSV;
window.exportVehicleReportXLSX         = exportVehicleReportXLSX;
