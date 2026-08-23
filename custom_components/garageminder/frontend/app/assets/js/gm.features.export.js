/**
 * Garage Maintenance - Export Functions
 * Version: 3.0 - CARFAX-Style Professional Reports
 * Updated: Multi-user support, comprehensive vehicle history reports
 */

// ========================================
// JSON DATA EXPORT/IMPORT
// ========================================

function exportDataJSON() {
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "garage-maintenance-data.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || typeof parsed !== "object") { alert("Invalid file format."); return; }
      if (!parsed.vehicles || !Array.isArray(parsed.vehicles)) { alert("Invalid data (missing vehicles)."); return; }
      if (!parsed.serviceTypes) parsed.serviceTypes = [];
      if (!parsed.entries) parsed.entries = [];
      if (!parsed.reminders) parsed.reminders = [];
      if (!parsed.vehicleIntervals) parsed.vehicleIntervals = {};
      if (!parsed.settings) parsed.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      parsed.vehicles.forEach(v => {
        if (!Object.prototype.hasOwnProperty.call(v, "currentOdo")) v.currentOdo = null;
        if (!Object.prototype.hasOwnProperty.call(v, "vin")) v.vin = null;
        if (!Object.prototype.hasOwnProperty.call(v, "plate")) v.plate = null;
      });
      if (Array.isArray(parsed.serviceTypes) && parsed.serviceTypes.length) {
        if (typeof parsed.serviceTypes[0] === "string") {
          parsed.serviceTypes = parsed.serviceTypes.map(n => ({ name: n, intervalMiles: null, intervalMonths: null }));
        } else {
          parsed.serviceTypes = parsed.serviceTypes.map(st => {
            if (typeof st === "string") return { name: st, intervalMiles: null, intervalMonths: null };
            return { name: st.name || "", intervalMiles: st.intervalMiles != null ? st.intervalMiles : null, intervalMonths: st.intervalMonths != null ? st.intervalMonths : null };
          });
        }
      }
      if (Array.isArray(parsed.entries)) {
        parsed.entries.forEach(entry => { if (Array.isArray(entry.services)) entry.services = normalizeServices(entry.services); });
      }
      data = parsed;
      saveData();
      setActiveVehicleFromStorageOrDefault();
      applyThemeFromSettings();
      applySiteTitle();
      updateUnitLabels();
      renderDashboard();
      renderSettings();
      renderReminderServiceSelect();
      renderRemindersPage();
      alert("Data imported successfully.");
    } catch (err) { console.error(err); alert("Failed to parse JSON."); }
  };
  reader.readAsText(file);
}

// ========================================
// CARFAX-STYLE REPORT DATA BUILDER
// ========================================

function buildVehicleHistoryReportData() {
  const unit = getUnitShort();
  const unitFull = unit === 'km' ? 'Kilometers' : 'Miles';
  const today = getTodayDateInSettingsTz();
  const todayIso = getTodayIsoInSettingsTz();
  if (!activeVehicleId || activeVehicleId === "all") return null;
  const vehicle = data.vehicles.find(v => v.id === activeVehicleId);
  if (!vehicle) return null;
  const entries = data.entries.filter(e => e.vehicleId === activeVehicleId).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const reminders = data.reminders.filter(r => r.vehicleId === activeVehicleId);
  const stats = calculateReportStats(vehicle, entries, reminders);
  const timeline = buildDetailedTimeline(entries, unit);
  const serviceSummary = buildServiceSummary(entries);
  const reminderStatus = buildReminderStatus(reminders, vehicle.currentOdo);
  return {
    reportDate: todayIso, reportDateFormatted: formatDateNice(todayIso), reportTime: new Date().toLocaleTimeString(),
    unit, unitFull,
    vehicle: { name: vehicle.name, vin: vehicle.vin || 'Not Recorded', plate: vehicle.plate || 'Not Recorded', currentOdo: vehicle.currentOdo,
      insuranceExpiry: vehicle.insuranceExpiry, insuranceExpiryFormatted: vehicle.insuranceExpiry ? formatDateNice(vehicle.insuranceExpiry) : null,
      registrationExpiry: vehicle.registrationExpiry, registrationExpiryFormatted: vehicle.registrationExpiry ? formatDateNice(vehicle.registrationExpiry) : null },
    stats, timeline, serviceSummary, reminderStatus, recordCount: entries.length
  };
}

function calculateReportStats(vehicle, entries, reminders) {
  const unit = getUnitShort();
  const today = getTodayDateInSettingsTz();
  const currentYear = today.getFullYear();
  let totalCost = 0, ytdCost = 0, firstDate = null, lastDate = null, firstOdo = null, lastOdo = null, serviceCount = 0;
  const odoReadings = [];
  entries.forEach(e => {
    serviceCount++;
    const cost = calculateEntryTotalCost(e);
    totalCost += cost;
    if (e.date) {
      if (!firstDate || e.date < firstDate) { firstDate = e.date; firstOdo = e.odo; }
      if (!lastDate || e.date > lastDate) { lastDate = e.date; lastOdo = e.odo; }
      const year = parseInt(e.date.substring(0, 4), 10);
      if (year === currentYear) ytdCost += cost;
    }
    if (e.odo != null) odoReadings.push({ date: e.date, odo: e.odo });
  });
  const distanceTracked = (lastOdo && firstOdo) ? lastOdo - firstOdo : 0;
  let yearsTracked = 0, monthsTracked = 0;
  if (firstDate && lastDate) {
    const first = new Date(firstDate), last = new Date(lastDate), diffMs = last - first;
    yearsTracked = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365));
    monthsTracked = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30));
  }
  const avgPerYear = yearsTracked > 0 ? Math.round(distanceTracked / yearsTracked) : distanceTracked;
  let odometerConsistent = true;
  for (let i = 1; i < odoReadings.length; i++) { if (odoReadings[i].odo < odoReadings[i-1].odo) { odometerConsistent = false; break; } }
  let overdueCount = 0, upcomingCount = 0;
  reminders.forEach(r => {
    const derived = computeReminderDerived(r, vehicle.currentOdo);
    if (derived.level === 'overdue') overdueCount++;
    else if (derived.level === 'upcoming') upcomingCount++;
  });
  const insuranceStatus = checkExpiryStatus(vehicle.insuranceExpiry);
  const registrationStatus = checkExpiryStatus(vehicle.registrationExpiry);
  return { totalCost, ytdCost, avgCostPerService: serviceCount > 0 ? totalCost / serviceCount : 0,
    firstDate, firstDateFormatted: firstDate ? formatDateNice(firstDate) : null,
    lastDate, lastDateFormatted: lastDate ? formatDateNice(lastDate) : null,
    firstOdo, lastOdo, distanceTracked, yearsTracked, monthsTracked, avgPerYear, serviceCount, odometerConsistent,
    overdueCount, upcomingCount, totalReminders: reminders.length, insuranceStatus, registrationStatus };
}

function checkExpiryStatus(dateStr) {
  if (!dateStr) return { status: 'unknown', label: 'Not Recorded' };
  const today = getTodayDateInSettingsTz();
  const expiry = new Date(dateStr + 'T00:00:00');
  const diffDays = Math.round((expiry - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { status: 'expired', label: 'Expired ' + Math.abs(diffDays) + ' days ago', date: formatDateNice(dateStr) };
  else if (diffDays <= 30) return { status: 'warning', label: 'Expires in ' + diffDays + ' days', date: formatDateNice(dateStr) };
  else return { status: 'ok', label: 'Valid until ' + formatDateNice(dateStr), date: formatDateNice(dateStr) };
}

function buildDetailedTimeline(entries, unit) {
  return entries.map((e, index) => {
    const services = normalizeServices(e.services || []);
    const totalCost = calculateEntryTotalCost(e);
    return { index: index + 1, date: e.date, dateFormatted: e.date ? formatDateNice(e.date) : 'Date not recorded',
      odometer: e.odo, odometerFormatted: e.odo != null ? e.odo.toLocaleString() + ' ' + unit : 'Not recorded',
      services: services.map(s => ({ name: s.name, cost: s.cost, note: s.note })),
      serviceNames: services.map(s => s.name), miscCost: e.cost, totalCost,
      nextDate: e.nextDate, nextDateFormatted: e.nextDate ? formatDateNice(e.nextDate) : null, nextOdo: e.nextOdo, notes: e.notes || '' };
  });
}

function buildServiceSummary(entries) {
  const summary = {};
  entries.forEach(e => {
    const services = normalizeServices(e.services || []);
    services.forEach(s => {
      if (!summary[s.name]) summary[s.name] = { name: s.name, count: 0, totalCost: 0, lastPerformed: null, lastOdo: null };
      summary[s.name].count++;
      if (s.cost != null) summary[s.name].totalCost += s.cost;
      if (!summary[s.name].lastPerformed || e.date > summary[s.name].lastPerformed) { summary[s.name].lastPerformed = e.date; summary[s.name].lastOdo = e.odo; }
    });
  });
  return Object.values(summary).sort((a, b) => b.count - a.count).map(s => ({ ...s, lastPerformedFormatted: s.lastPerformed ? formatDateNice(s.lastPerformed) : null }));
}

function buildReminderStatus(reminders, currentOdo) {
  return reminders.map(r => {
    const derived = computeReminderDerived(r, currentOdo);
    return { serviceName: r.serviceName || r.title || 'Reminder', status: derived.level, statusLabel: derived.label,
      nextOdo: derived.nextOdo, nextDate: derived.nextDate, nextDateFormatted: derived.nextDate ? formatDateNice(derived.nextDate) : null,
      intervalMiles: r.intervalMiles, intervalMonths: r.intervalMonths, notes: r.notes };
  }).sort((a, b) => { const order = { overdue: 0, upcoming: 1, ok: 2 }; return order[a.status] - order[b.status]; });
}

// ========================================
// TABLE EXPORT HELPERS (Legacy support)
// ========================================

function buildTableRowsForActiveVehicle() {
  const unit = getUnitShort();
  const headers = ["Service date", "Odometer (" + unit + ")", "Services", "Service Costs", "Misc Cost", "Total Cost", "Next due date", "Next due mileage (" + unit + ")", "Notes"];
  if (!activeVehicleId || activeVehicleId === "all") return { headers, rows: [], vehicleName: null, vin: null, plate: null };
  const vehicle = data.vehicles.find(v => v.id === activeVehicleId) || null;
  const vehicleName = vehicle ? vehicle.name : "(Unknown vehicle)";
  const vehicleVin = vehicle && vehicle.vin != null ? vehicle.vin : null;
  const vehiclePlate = vehicle && vehicle.plate != null ? vehicle.plate : null;
  const rows = data.entries.filter(e => e.vehicleId === activeVehicleId).map(e => {
    const services = normalizeServices(e.services || []);
    const serviceNames = services.map(s => s.name).join("; ");
    const serviceCosts = services.filter(s => s.cost != null).map(s => s.name + ": $" + s.cost.toFixed(2)).join("; ");
    const miscCost = e.cost != null ? e.cost : "";
    const totalCost = calculateEntryTotalCost(e);
    return [e.date || "", e.odo != null ? e.odo : "", serviceNames, serviceCosts || "", miscCost !== "" ? miscCost : "", totalCost > 0 ? totalCost.toFixed(2) : "", e.nextDate || "", e.nextOdo != null ? e.nextOdo : "", e.notes || ""];
  });
  return { headers, rows, vehicleName, vin: vehicleVin, plate: vehiclePlate };
}

// ========================================
// CSV EXPORT
// ========================================

function exportTableCSV() {
  const { headers, rows, vehicleName, vin, plate } = buildTableRowsForActiveVehicle();
  if (!vehicleName) { alert("Select a vehicle first (not 'All Vehicles')."); return; }
  if (!rows.length) { alert('No entries to export for "' + vehicleName + '".'); return; }
  const safeName = vehicleName.replace(/[^\w]+/g, "_").toLowerCase();
  const lines = [];
  lines.push("Vehicle: " + vehicleName);
  if (vin) lines.push("VIN: " + vin);
  if (plate) lines.push("Plate: " + plate);
  lines.push("");
  lines.push(headers.join(","));
  rows.forEach(r => { lines.push(r.map(field => '"' + String(field).replace(/"/g, '""') + '"').join(",")); });
  const blob = new Blob([lines.join("\r\n")], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "garage-" + safeName + "-table.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("CSV exported");
}

// ========================================
// CARFAX-STYLE WORD EXPORT
// ========================================

function exportTableWord() {
  const reportData = buildVehicleHistoryReportData();
  if (!reportData) { alert("Select a vehicle first (not 'All Vehicles')."); return; }
  if (!reportData.timeline.length) { alert('No entries to export for "' + reportData.vehicle.name + '".'); return; }
  const safeName = reportData.vehicle.name.replace(/[^\w]+/g, "_").toLowerCase();
  const html = generateCarfaxStyleHTML(reportData);
  const blob = new Blob([html], {type:"application/msword"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "vehicle-history-report-" + safeName + ".doc";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Vehicle History Report exported");
}

// ========================================
// CARFAX-STYLE PDF EXPORT
// ========================================

function exportTablePDF() {
  const reportData = buildVehicleHistoryReportData();
  if (!reportData) { alert("Select a vehicle first (not 'All Vehicles')."); return; }
  if (!reportData.timeline.length) { alert('No entries to export for "' + reportData.vehicle.name + '".'); return; }
  if (!window.jspdf || !window.jspdf.jsPDF) { alert("jsPDF not available. Please check that the jsPDF library is loaded."); return; }
  const safeName = reportData.vehicle.name.replace(/[^\w]+/g, "_").toLowerCase();
  generateCarfaxStylePDF(reportData, safeName);
  showToast("Vehicle History Report exported");
}

// ========================================
// HTML ESCAPE HELPER
// ========================================

function escapeHtml(text) {
  if (text == null) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ========================================
// HTML GENERATION (CARFAX STYLE)
// ========================================

function generateCarfaxStyleHTML(rpt) {
  const unit = rpt.unit;
  const v = rpt.vehicle;
  const s = rpt.stats;
  
  const getStatusClass = (status) => status === 'ok' ? 'good' : (status === 'warning' ? 'warning' : (status === 'expired' ? 'danger' : ''));
  const getStatusIcon = (status) => status === 'ok' ? '✓' : (status === 'expired' ? '✗' : '!');

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Vehicle History Report - ${escapeHtml(v.name)}</title>
<style>
@page { margin: 0.5in; size: letter; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.3; color: #333; margin: 0; padding: 15px; background: #fff; }
.report-header { background: linear-gradient(135deg, #1a237e 0%, #283593 100%); color: white; padding: 20px; margin: -15px -15px 0 -15px; }
.report-title { font-size: 22pt; font-weight: bold; margin: 0 0 5px 0; }
.report-subtitle { font-size: 11pt; opacity: 0.9; }
.report-badge { background: #4caf50; color: white; padding: 8px 15px; border-radius: 20px; font-weight: bold; font-size: 9pt; float: right; margin-top: -35px; }
.vehicle-bar { background: #f5f5f5; border: 1px solid #ddd; padding: 15px 20px; margin: 15px 0; }
.vehicle-name { font-size: 16pt; font-weight: bold; color: #1a237e; margin-bottom: 8px; }
.vehicle-details { display: table; width: 100%; }
.vehicle-detail-item { display: table-cell; width: 25%; padding-right: 15px; }
.detail-label { font-size: 8pt; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
.detail-value { font-size: 10pt; font-weight: bold; color: #333; }
.status-grid { display: table; width: 100%; margin: 15px 0; border-collapse: separate; border-spacing: 8px 0; }
.status-card { display: table-cell; width: 20%; background: #fff; border: 2px solid #e0e0e0; border-radius: 8px; padding: 12px; text-align: center; }
.status-card.good { border-color: #4caf50; background: #e8f5e9; }
.status-card.warning { border-color: #ff9800; background: #fff3e0; }
.status-card.danger { border-color: #f44336; background: #ffebee; }
.status-icon { font-size: 18pt; margin-bottom: 5px; }
.status-title { font-size: 7pt; color: #666; text-transform: uppercase; margin-bottom: 3px; }
.status-value { font-size: 8pt; font-weight: bold; }
.status-card.good .status-value { color: #2e7d32; }
.status-card.warning .status-value { color: #e65100; }
.status-card.danger .status-value { color: #c62828; }
.section { margin: 20px 0; page-break-inside: avoid; }
.section-header { background: #1a237e; color: white; padding: 10px 15px; font-size: 12pt; font-weight: bold; }
.section-body { border: 1px solid #ddd; border-top: none; padding: 15px; }
.summary-grid { display: table; width: 100%; }
.summary-cell { display: table-cell; width: 50%; padding: 8px 15px 8px 0; vertical-align: top; }
.summary-item { margin-bottom: 12px; }
.summary-label { font-size: 8pt; color: #666; text-transform: uppercase; }
.summary-value { font-size: 14pt; font-weight: bold; color: #1a237e; }
.summary-note { font-size: 8pt; color: #999; }
.data-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
.data-table th { background: #f5f5f5; padding: 8px 10px; text-align: left; font-size: 8pt; text-transform: uppercase; color: #666; border-bottom: 2px solid #1a237e; }
.data-table td { padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
.data-table tr:nth-child(even) { background: #fafafa; }
.reminder-status { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 8pt; font-weight: bold; }
.reminder-status.overdue { background: #ffebee; color: #c62828; }
.reminder-status.upcoming { background: #fff3e0; color: #e65100; }
.reminder-status.ok { background: #e8f5e9; color: #2e7d32; }
.timeline-entry { border-left: 3px solid #1a237e; padding: 0 0 20px 20px; margin-left: 10px; position: relative; }
.timeline-entry:last-child { padding-bottom: 0; }
.timeline-dot { width: 12px; height: 12px; background: #1a237e; border-radius: 50%; position: absolute; left: -7px; top: 0; }
.timeline-date { font-size: 9pt; color: #666; margin-bottom: 5px; }
.timeline-odo { display: inline-block; background: #e3f2fd; color: #1565c0; padding: 2px 8px; border-radius: 10px; font-size: 8pt; font-weight: bold; margin-left: 10px; }
.timeline-services { background: #fafafa; border: 1px solid #eee; border-radius: 5px; padding: 10px; margin-top: 8px; }
.service-item { padding: 5px 0; border-bottom: 1px dotted #ddd; }
.service-item:last-child { border-bottom: none; }
.service-name { font-weight: bold; }
.service-cost { color: #2e7d32; float: right; font-weight: bold; }
.service-note { font-size: 8pt; color: #666; font-style: italic; margin-top: 3px; }
.timeline-total { text-align: right; font-weight: bold; margin-top: 8px; padding-top: 8px; border-top: 2px solid #1a237e; color: #2e7d32; }
.timeline-notes { font-size: 9pt; color: #666; margin-top: 8px; padding: 8px; background: #fffde7; border-left: 3px solid #ffc107; }
.report-footer { margin-top: 30px; padding-top: 15px; border-top: 2px solid #1a237e; font-size: 8pt; color: #666; }
.footer-disclaimer { background: #f5f5f5; padding: 10px; margin-top: 10px; font-size: 7pt; line-height: 1.4; }
.page-break { page-break-before: always; }
.cost { color: #2e7d32; font-weight: bold; }
</style></head><body>`;

  // Header
  html += `<div class="report-header"><div class="report-title"><i class="bi bi-car-front-fill"></i> Vehicle History Report</div><div class="report-subtitle">Comprehensive Service & Maintenance Record</div></div>`;
  html += `<div class="report-badge">${rpt.recordCount} RECORDS</div>`;

  // Vehicle Bar
  html += `<div class="vehicle-bar"><div class="vehicle-name">${escapeHtml(v.name)}</div><div class="vehicle-details">`;
  html += `<div class="vehicle-detail-item"><div class="detail-label">VIN</div><div class="detail-value">${escapeHtml(v.vin)}</div></div>`;
  html += `<div class="vehicle-detail-item"><div class="detail-label">LICENSE PLATE</div><div class="detail-value">${escapeHtml(v.plate)}</div></div>`;
  html += `<div class="vehicle-detail-item"><div class="detail-label">CURRENT ODOMETER</div><div class="detail-value">${v.currentOdo != null ? v.currentOdo.toLocaleString() + ' ' + unit : 'Not Recorded'}</div></div>`;
  html += `<div class="vehicle-detail-item"><div class="detail-label">REPORT DATE</div><div class="detail-value">${rpt.reportDateFormatted}</div></div>`;
  html += `</div></div>`;

  // Status Cards
  html += `<div class="status-grid">`;
  html += `<div class="status-card ${s.odometerConsistent ? 'good' : 'danger'}"><div class="status-icon">${s.odometerConsistent ? '✓' : '⚠'}</div><div class="status-title">ODOMETER CHECK</div><div class="status-value">${s.odometerConsistent ? 'No Issues Indicated' : 'Inconsistency Found'}</div></div>`;
  html += `<div class="status-card ${s.overdueCount === 0 ? 'good' : 'danger'}"><div class="status-icon">${s.overdueCount === 0 ? '✓' : '⚠'}</div><div class="status-title">MAINTENANCE</div><div class="status-value">${s.overdueCount === 0 ? 'Up to Date' : s.overdueCount + ' Overdue Item' + (s.overdueCount > 1 ? 's' : '')}</div></div>`;
  html += `<div class="status-card ${getStatusClass(s.insuranceStatus.status)}"><div class="status-icon">${getStatusIcon(s.insuranceStatus.status)}</div><div class="status-title">INSURANCE</div><div class="status-value">${s.insuranceStatus.label}</div></div>`;
  html += `<div class="status-card ${getStatusClass(s.registrationStatus.status)}"><div class="status-icon">${getStatusIcon(s.registrationStatus.status)}</div><div class="status-title">REGISTRATION</div><div class="status-value">${s.registrationStatus.label}</div></div>`;
  html += `<div class="status-card good"><div class="status-icon"><i class="bi bi-clipboard-check"></i></div><div class="status-title">SERVICE RECORDS</div><div class="status-value">${s.serviceCount} Total</div></div>`;
  html += `</div>`;

  // History Summary
  html += `<div class="section"><div class="section-header"><i class="bi bi-bar-chart-fill"></i> History Summary</div><div class="section-body"><div class="summary-grid">`;
  html += `<div class="summary-cell">`;
  html += `<div class="summary-item"><div class="summary-label">TOTAL SERVICES RECORDED</div><div class="summary-value">${s.serviceCount}</div></div>`;
  html += `<div class="summary-item"><div class="summary-label">HISTORY TIMESPAN</div><div class="summary-value">${s.yearsTracked > 0 ? s.yearsTracked + ' Year' + (s.yearsTracked > 1 ? 's' : '') : s.monthsTracked + ' Months'}</div><div class="summary-note">${s.firstDateFormatted || 'N/A'} to ${s.lastDateFormatted || 'N/A'}</div></div>`;
  html += `<div class="summary-item"><div class="summary-label">DISTANCE TRACKED</div><div class="summary-value">${s.distanceTracked.toLocaleString()} ${unit}</div><div class="summary-note">Est. ${s.avgPerYear.toLocaleString()} ${unit}/year</div></div>`;
  html += `</div><div class="summary-cell">`;
  html += `<div class="summary-item"><div class="summary-label">TOTAL MAINTENANCE COST</div><div class="summary-value">$${s.totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div></div>`;
  html += `<div class="summary-item"><div class="summary-label">YEAR-TO-DATE SPENDING</div><div class="summary-value">$${s.ytdCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div></div>`;
  html += `<div class="summary-item"><div class="summary-label">AVERAGE COST PER SERVICE</div><div class="summary-value">$${s.avgCostPerService.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div></div>`;
  html += `</div></div></div></div>`;

  // Service Summary Table
  if (rpt.serviceSummary.length > 0) {
    html += `<div class="section"><div class="section-header"><i class="bi bi-wrench"></i> Service Summary</div><div class="section-body"><table class="data-table"><thead><tr><th>Service Type</th><th>Times Performed</th><th>Total Cost</th><th>Last Performed</th><th>Last Odometer</th></tr></thead><tbody>`;
    rpt.serviceSummary.forEach(svc => {
      html += `<tr><td><strong>${escapeHtml(svc.name)}</strong></td><td>${svc.count}</td><td class="cost">$${svc.totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td><td>${svc.lastPerformedFormatted || '–'}</td><td>${svc.lastOdo != null ? svc.lastOdo.toLocaleString() + ' ' + unit : '–'}</td></tr>`;
    });
    html += `</tbody></table></div></div>`;
  }

  // Maintenance Reminders
  if (rpt.reminderStatus.length > 0) {
    html += `<div class="section"><div class="section-header">⏰ Maintenance Schedule & Reminders</div><div class="section-body"><table class="data-table"><thead><tr><th>Service</th><th>Status</th><th>Next Due (${unit})</th><th>Next Due Date</th><th>Interval</th></tr></thead><tbody>`;
    rpt.reminderStatus.forEach(r => {
      const interval = [r.intervalMiles ? 'Every ' + r.intervalMiles.toLocaleString() + ' ' + unit : null, r.intervalMonths ? 'Every ' + r.intervalMonths + ' mo' : null].filter(Boolean).join(' or ') || '–';
      html += `<tr><td><strong>${escapeHtml(r.serviceName)}</strong></td><td><span class="reminder-status ${r.status}">${r.status.toUpperCase()}</span></td><td>${r.nextOdo != null ? r.nextOdo.toLocaleString() : '–'}</td><td>${r.nextDateFormatted || '–'}</td><td>${interval}</td></tr>`;
    });
    html += `</tbody></table></div></div>`;
  }

  // Detailed Timeline (new page)
  html += `<div class="section page-break"><div class="section-header"><i class="bi bi-sticky"></i> Detailed Service History</div><div class="section-body">`;
  rpt.timeline.slice().reverse().forEach(entry => {
    html += `<div class="timeline-entry"><div class="timeline-dot"></div>`;
    html += `<div class="timeline-date"><strong>${entry.dateFormatted}</strong><span class="timeline-odo">${entry.odometerFormatted}</span></div>`;
    html += `<div class="timeline-services">`;
    entry.services.forEach(svc => {
      html += `<div class="service-item"><span class="service-name">${escapeHtml(svc.name)}</span>`;
      if (svc.cost != null) html += `<span class="service-cost">$${svc.cost.toFixed(2)}</span>`;
      if (svc.note) html += `<div class="service-note">${escapeHtml(svc.note)}</div>`;
      html += `</div>`;
    });
    if (entry.miscCost != null && entry.miscCost > 0) {
      html += `<div class="service-item"><span class="service-name" style="color:#666;">Miscellaneous / Fees</span><span class="service-cost">$${entry.miscCost.toFixed(2)}</span></div>`;
    }
    if (entry.totalCost > 0) html += `<div class="timeline-total">Total: $${entry.totalCost.toFixed(2)}</div>`;
    html += `</div>`;
    if (entry.notes) html += `<div class="timeline-notes"><i class="bi bi-sticky"></i> ${escapeHtml(entry.notes)}</div>`;
    if (entry.nextDateFormatted || entry.nextOdo) {
      const nextParts = [entry.nextDateFormatted, entry.nextOdo ? entry.nextOdo.toLocaleString() + ' ' + unit : null].filter(Boolean).join(' or ');
      html += `<div style="font-size:8pt;color:#666;margin-top:5px;">Next Due: ${nextParts}</div>`;
    }
    html += `</div>`;
  });
  html += `</div></div>`;

  // Footer
  html += `<div class="report-footer"><div style="display:table;width:100%;"><div style="display:table-cell;width:50%;"><strong>Vehicle:</strong> ${escapeHtml(v.name)}<br><strong>VIN:</strong> ${escapeHtml(v.vin)}</div><div style="display:table-cell;width:50%;text-align:right;"><strong>Report Date:</strong> ${rpt.reportDateFormatted}<br><strong>Total Records:</strong> ${rpt.recordCount}</div></div>`;
  html += `<div class="footer-disclaimer"><strong>DISCLAIMER:</strong> This Vehicle History Report is based only on information recorded in the Garage Maintenance system. Other information about this vehicle, including problems, may not have been recorded. Use this report as one important tool, along with a vehicle inspection and test drive, to make informed decisions about vehicle maintenance and ownership.</div></div>`;
  html += `</body></html>`;
  
  return html;
}

// ========================================
// PDF GENERATION (CARFAX STYLE)
// ========================================

function generateCarfaxStylePDF(rpt, safeName) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - (margin * 2);
  const unit = rpt.unit;
  const v = rpt.vehicle;
  const s = rpt.stats;
  
  const primaryColor = [26, 35, 126];
  const successColor = [76, 175, 80];
  const warningColor = [255, 152, 0];
  const dangerColor = [244, 67, 54];
  const grayText = [102, 102, 102];
  const darkText = [51, 51, 51];
  
  let y = 0;

  // Header
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageWidth, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Vehicle History Report', margin, 12);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Comprehensive Service & Maintenance Record', margin, 18);
  doc.setFillColor(...successColor);
  doc.roundedRect(pageWidth - margin - 28, 8, 28, 12, 3, 3, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text(rpt.recordCount + ' RECORDS', pageWidth - margin - 14, 15.5, { align: 'center' });
  y = 35;

  // Vehicle Info Bar
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y, contentWidth, 24, 'F');
  doc.setDrawColor(221, 221, 221);
  doc.rect(margin, y, contentWidth, 24, 'S');
  doc.setTextColor(...primaryColor);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(v.name, margin + 5, y + 7);
  
  const detailY = y + 14;
  const colWidth = contentWidth / 4;
  const vehicleDetails = [
    { label: 'VIN', value: v.vin },
    { label: 'LICENSE PLATE', value: v.plate },
    { label: 'CURRENT ODOMETER', value: v.currentOdo != null ? v.currentOdo.toLocaleString() + ' ' + unit : 'Not Recorded' },
    { label: 'REPORT DATE', value: rpt.reportDateFormatted }
  ];
  vehicleDetails.forEach((detail, i) => {
    const x = margin + 5 + (i * colWidth);
    doc.setTextColor(...grayText);
    doc.setFontSize(5);
    doc.setFont('helvetica', 'normal');
    doc.text(detail.label, x, detailY);
    doc.setTextColor(...darkText);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(String(detail.value).substring(0, 22), x, detailY + 4);
  });
  y += 30;

  // Status Cards
  const cardWidth = (contentWidth - 8) / 5;
  const cardHeight = 20;
  const statusCards = [
    { title: 'ODOMETER', value: s.odometerConsistent ? 'No Issues' : 'Check', status: s.odometerConsistent ? 'good' : 'danger' },
    { title: 'MAINTENANCE', value: s.overdueCount === 0 ? 'Up to Date' : s.overdueCount + ' Overdue', status: s.overdueCount === 0 ? 'good' : 'danger' },
    { title: 'INSURANCE', value: s.insuranceStatus.status === 'ok' ? 'Valid' : (s.insuranceStatus.status === 'expired' ? 'Expired' : 'Check'), status: s.insuranceStatus.status === 'ok' ? 'good' : (s.insuranceStatus.status === 'expired' ? 'danger' : 'warning') },
    { title: 'REGISTRATION', value: s.registrationStatus.status === 'ok' ? 'Valid' : (s.registrationStatus.status === 'expired' ? 'Expired' : 'Check'), status: s.registrationStatus.status === 'ok' ? 'good' : (s.registrationStatus.status === 'expired' ? 'danger' : 'warning') },
    { title: 'RECORDS', value: s.serviceCount + ' Total', status: 'good' }
  ];
  statusCards.forEach((card, i) => {
    const x = margin + (i * (cardWidth + 2));
    const bgColor = card.status === 'good' ? [232, 245, 233] : (card.status === 'warning' ? [255, 243, 224] : [255, 235, 238]);
    const borderColor = card.status === 'good' ? successColor : (card.status === 'warning' ? warningColor : dangerColor);
    const textColor = card.status === 'good' ? [46, 125, 50] : (card.status === 'warning' ? [230, 81, 0] : [198, 40, 40]);
    doc.setFillColor(...bgColor);
    doc.setDrawColor(...borderColor);
    doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');
    doc.setTextColor(...grayText);
    doc.setFontSize(5);
    doc.setFont('helvetica', 'normal');
    doc.text(card.title, x + cardWidth/2, y + 7, { align: 'center' });
    doc.setTextColor(...textColor);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(card.value, x + cardWidth/2, y + 14, { align: 'center' });
  });
  y += cardHeight + 6;

  // History Summary
  doc.setFillColor(...primaryColor);
  doc.rect(margin, y, contentWidth, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('History Summary', margin + 4, y + 4.5);
  y += 6;
  doc.setDrawColor(221, 221, 221);
  doc.rect(margin, y, contentWidth, 30, 'S');
  
  const summaryData = [
    [{ label: 'Total Services', value: s.serviceCount.toString() }, { label: 'History Span', value: s.yearsTracked > 0 ? s.yearsTracked + ' Year' + (s.yearsTracked > 1 ? 's' : '') : s.monthsTracked + ' Mo' }, { label: 'Distance Tracked', value: s.distanceTracked.toLocaleString() + ' ' + unit }],
    [{ label: 'Total Cost', value: '$' + s.totalCost.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}) }, { label: 'YTD Spending', value: '$' + s.ytdCost.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}) }, { label: 'Avg per Service', value: '$' + s.avgCostPerService.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}) }]
  ];
  summaryData.forEach((row, rowIdx) => {
    row.forEach((item, colIdx) => {
      const x = margin + 5 + (colIdx * (contentWidth / 3));
      const itemY = y + 5 + (rowIdx * 14);
      doc.setTextColor(...grayText);
      doc.setFontSize(5);
      doc.setFont('helvetica', 'normal');
      doc.text(item.label.toUpperCase(), x, itemY);
      doc.setTextColor(...primaryColor);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(item.value, x, itemY + 5);
    });
  });
  y += 35;

  // Service Summary Table
  if (rpt.serviceSummary.length > 0) {
    doc.setFillColor(...primaryColor);
    doc.rect(margin, y, contentWidth, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Service Summary', margin + 4, y + 4.5);
    y += 7;
    const serviceHeaders = ['Service Type', 'Count', 'Total Cost', 'Last Performed'];
    const serviceRows = rpt.serviceSummary.slice(0, 8).map(svc => [svc.name, svc.count.toString(), '$' + svc.totalCost.toFixed(2), svc.lastPerformedFormatted || '–']);
    doc.autoTable({
      startY: y, head: [serviceHeaders], body: serviceRows,
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [245, 245, 245], textColor: grayText, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 18, halign: 'center' }, 2: { cellWidth: 28, halign: 'right' }, 3: { cellWidth: 32 } },
      didParseCell: function(d) { if (d.section === 'body' && d.column.index === 2) { d.cell.styles.textColor = [46, 125, 50]; d.cell.styles.fontStyle = 'bold'; } },
      margin: { left: margin, right: margin }
    });
    y = doc.lastAutoTable.finalY + 4;
  }

  // Maintenance Reminders
  if (rpt.reminderStatus.length > 0 && y < pageHeight - 55) {
    doc.setFillColor(...primaryColor);
    doc.rect(margin, y, contentWidth, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Maintenance Schedule', margin + 4, y + 4.5);
    y += 7;
    const reminderHeaders = ['Service', 'Status', 'Next (' + unit + ')', 'Next Date', 'Interval'];
    const reminderRows = rpt.reminderStatus.map(r => [r.serviceName, r.status.toUpperCase(), r.nextOdo != null ? r.nextOdo.toLocaleString() : '–', r.nextDateFormatted || '–', [r.intervalMiles ? r.intervalMiles.toLocaleString() + ' ' + unit : null, r.intervalMonths ? r.intervalMonths + ' mo' : null].filter(Boolean).join(' / ') || '–']);
    doc.autoTable({
      startY: y, head: [reminderHeaders], body: reminderRows,
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [245, 245, 245], textColor: grayText, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 22, halign: 'center' }, 2: { cellWidth: 28, halign: 'right' }, 3: { cellWidth: 28 }, 4: { cellWidth: 32 } },
      didParseCell: function(d) {
        if (d.section === 'body' && d.column.index === 1) {
          const st = d.cell.raw.toLowerCase();
          if (st === 'overdue') { d.cell.styles.textColor = [198, 40, 40]; d.cell.styles.fontStyle = 'bold'; }
          else if (st === 'upcoming') { d.cell.styles.textColor = [230, 81, 0]; d.cell.styles.fontStyle = 'bold'; }
          else { d.cell.styles.textColor = [46, 125, 50]; }
        }
      },
      margin: { left: margin, right: margin }
    });
    y = doc.lastAutoTable.finalY + 4;
  }

  // Detailed History (new page)
  doc.addPage();
  y = 0;
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageWidth, 16, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Detailed Service History', margin, 10);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(v.name, pageWidth - margin, 10, { align: 'right' });
  y = 22;

  const historyHeaders = ['Date', 'Odometer', 'Services Performed', 'Cost', 'Notes'];
  const historyRows = rpt.timeline.slice().reverse().map(entry => [
    entry.dateFormatted,
    entry.odometerFormatted,
    entry.serviceNames.join(', ') || '–',
    entry.totalCost > 0 ? '$' + entry.totalCost.toFixed(2) : '–',
    entry.notes ? (entry.notes.length > 35 ? entry.notes.substring(0, 35) + '...' : entry.notes) : '–'
  ]);

  doc.autoTable({
    startY: y, head: [historyHeaders], body: historyRows,
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 26 }, 2: { cellWidth: 58 }, 3: { cellWidth: 22, halign: 'right' }, 4: { cellWidth: 42 } },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    didParseCell: function(d) { if (d.section === 'body' && d.column.index === 3) { d.cell.styles.textColor = [46, 125, 50]; d.cell.styles.fontStyle = 'bold'; } },
    margin: { left: margin, right: margin },
    didDrawPage: function() {
      doc.setFontSize(7);
      doc.setTextColor(...grayText);
      const pageNum = doc.internal.getCurrentPageInfo().pageNumber;
      doc.text('Page ' + pageNum, pageWidth / 2, pageHeight - 7, { align: 'center' });
      doc.text('Vehicle: ' + v.name + ' | VIN: ' + v.vin, margin, pageHeight - 7);
      doc.text(rpt.reportDateFormatted, pageWidth - margin, pageHeight - 7, { align: 'right' });
    }
  });

  // Disclaimer
  const finalY = doc.lastAutoTable.finalY + 8;
  if (finalY < pageHeight - 22) {
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, finalY, contentWidth, 15, 'F');
    doc.setTextColor(...darkText);
    doc.setFontSize(5);
    doc.setFont('helvetica', 'bold');
    doc.text('DISCLAIMER:', margin + 3, finalY + 4);
    doc.setFont('helvetica', 'normal');
    doc.text('This Vehicle History Report is based only on information recorded in the Garage Maintenance system. Other information about this vehicle,', margin + 3, finalY + 8);
    doc.text('including problems, may not have been recorded. Use this report as one important tool, along with a vehicle inspection and test drive.', margin + 3, finalY + 11);
  }

  doc.save('vehicle-history-report-' + safeName + '.pdf');
}

// ========================================
// FULL BACKUP WITH ATTACHMENTS (Server-side)
// ========================================

async function createFullBackup() {
  try {
    showToast("Preparing backup...");
    const infoResponse = await fetch('backup-create.php', { credentials: 'same-origin' });
    if (infoResponse.status === 401) { alert("Session expired. Please log in again."); window.location.reload(); return; }
    const info = await infoResponse.json();
    if (!info.success) throw new Error(info.message || "Backup preparation failed");
    const confirmMsg = "Backup Ready\n\nSize: " + info.size_formatted + "\nAttachments: " + info.attachment_count + " files (" + info.attachment_size_formatted + ")\nVehicles: " + (info.vehicle_count || 'N/A') + "\nEntries: " + (info.entry_count || 'N/A') + "\n\nDownload now?";
    if (!confirm(confirmMsg)) return;
    window.location.href = info.download_url;
    showToast("Backup download started");
  } catch (err) { console.error("Backup error:", err); alert("Backup failed: " + err.message); }
}

// ========================================
// FULL RESTORE WITH ATTACHMENTS (Server-side)
// ========================================

async function restoreFullBackup(file) {
  if (!file) return;
  const confirmMsg = "⚠ RESTORE FULL BACKUP\n\nThis will REPLACE all your current data:\n• All vehicles, entries, reminders\n• All settings\n• All attachments\n\nYour current data will be lost!\n\nContinue with restore?";
  if (!confirm(confirmMsg)) return;
  try {
    showToast("Restoring backup...");
    const formData = new FormData();
    formData.append('backup_file', file);
    const response = await fetch('restore-full.php', { method: 'POST', body: formData, credentials: 'same-origin' });
    if (response.status === 401) { alert("Session expired. Please log in again."); window.location.reload(); return; }
    const result = await response.json();
    if (!result.success) throw new Error(result.message || "Restore failed");
    loadData();
    setActiveVehicleFromStorageOrDefault();
    applyThemeFromSettings();
    applySiteTitle();
    updateUnitLabels();
    renderDashboard();
    renderSettings();
    renderReminderServiceSelect();
    renderRemindersPage();
    let msg = "✓ Backup restored successfully!";
    if (result.attachments_restored > 0) msg += "\n\n" + result.attachments_restored + " attachment(s) restored.";
    if (result.attachments_errors && result.attachments_errors.length > 0) msg += "\n\n⚠ " + result.attachments_errors.length + " attachment(s) had errors.";
    alert(msg);
    showToast("Restore complete");
  } catch (err) { console.error("Restore error:", err); alert("Restore failed: " + err.message); }
}

// ========================================
// CLEAR ALL DATA (with attachment cleanup)
// ========================================

async function resetAllData() {
  const confirmMsg = "⚠ CLEAR ALL DATA\n\nThis will permanently delete:\n• All vehicles, entries, reminders, and settings\n• All attachment files\n• Everything will be reset to defaults\n\nThis CANNOT be undone!\n\nType 'DELETE' to confirm:";
  const confirmation = prompt(confirmMsg);
  if (confirmation !== "DELETE") { if (confirmation !== null) alert("Clear cancelled. Must type 'DELETE' exactly."); return; }
  try {
    const response = await fetch(BACKEND_URL + '?action=clearUserData', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    if (response.status === 401) { alert("Session expired. Please log in again."); window.location.reload(); return; }
    const result = await response.json();
    if (!result.success) throw new Error(result.message || "Clear failed");
    data = cloneDefaultData();
    activeVehicleId = null;
    setActiveVehicleFromStorageOrDefault();
    applyThemeFromSettings();
    applySiteTitle();
    updateUnitLabels();
    renderDashboard();
    renderSettings();
    renderReminderServiceSelect();
    renderRemindersPage();
    alert("✓ All data cleared successfully, including attachment files.");
  } catch (err) {
    console.error("Clear data error:", err);
    data = cloneDefaultData();
    saveData();
    setActiveVehicleFromStorageOrDefault();
    applyThemeFromSettings();
    applySiteTitle();
    updateUnitLabels();
    renderDashboard();
    renderSettings();
    renderReminderServiceSelect();
    renderRemindersPage();
    alert("✓ All data cleared successfully.\n\n⚠ Note: Some attachment files on server may need manual cleanup.");
  }
}

// ========================================
// HELPER: Normalize services format
// ========================================

function normalizeServices(services) {
  if (!Array.isArray(services)) return [];
  return services.map(s => {
    if (typeof s === 'string') return { name: s, cost: null, note: null };
    return { name: s.name || '', cost: s.cost != null ? s.cost : null, note: s.note || null };
  });
}

// ========================================
// HELPER: Calculate entry total cost
// ========================================

function calculateEntryTotalCost(entry) {
  let total = 0;
  if (entry.cost != null) total += Number(entry.cost) || 0;
  if (Array.isArray(entry.services)) {
    entry.services.forEach(s => { if (typeof s === 'object' && s.cost != null) total += Number(s.cost) || 0; });
  }
  return total;
}