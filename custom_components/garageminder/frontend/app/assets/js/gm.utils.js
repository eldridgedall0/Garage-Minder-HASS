/**
 * Garage Maintenance - Utility Functions
 * Updated: Support for per-service cost/note format
 */

function getUnitShort() {
  return (data.settings && data.settings.unit === "km") ? "km" : "mi";
}

function getSettingsTimezone() {
  const s = data.settings || DEFAULT_SETTINGS;
  if (s && typeof s.timezone === "string" && s.timezone.trim() !== "") {
    return s.timezone.trim();
  }
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions();
    return opts.timeZone || "UTC";
  } catch (e) {
    return "UTC";
  }
}

// Get reminder thresholds from settings
function getReminderThresholds() {
  const s = data.settings || DEFAULT_SETTINGS;
  return {
    upcomingDays: s.upcomingThresholdDays != null ? s.upcomingThresholdDays : DEFAULT_SETTINGS.upcomingThresholdDays,
    upcomingMiles: s.upcomingThresholdMiles != null ? s.upcomingThresholdMiles : DEFAULT_SETTINGS.upcomingThresholdMiles,
    overdueDays: s.overdueThresholdDays != null ? s.overdueThresholdDays : DEFAULT_SETTINGS.overdueThresholdDays,
    overdueMiles: s.overdueThresholdMiles != null ? s.overdueThresholdMiles : DEFAULT_SETTINGS.overdueThresholdMiles
  };
}

function getAttachmentLimits() {
  const maxCount = (data && typeof data.entryMaxAttachments === "number" && data.entryMaxAttachments > 0)
    ? data.entryMaxAttachments
    : 5;
  const maxSizeMB = (data && typeof data.entryMaxAttachmentSizeMB === "number" && data.entryMaxAttachmentSizeMB > 0)
    ? data.entryMaxAttachmentSizeMB
    : 10;
  const maxBytes = maxSizeMB > 0 ? maxSizeMB * 1024 * 1024 : Infinity;
  return { maxCount, maxSizeMB, maxBytes };
}

function getAttachmentHelpText() {
  const { maxCount, maxSizeMB } = getAttachmentLimits();
  return `Up to ${maxCount} attachments per entry, PDF/Word/images only, max ${maxSizeMB} MB each.`;
}

function getTodayIsoInSettingsTz() {
  const tz = getSettingsTimezone();
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const parts = fmt.formatToParts(now);
    const y = parts.find(p => p.type === "year").value;
    const m = parts.find(p => p.type === "month").value;
    const d = parts.find(p => p.type === "day").value;
    return `${y}-${m}-${d}`;
  } catch (e) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
}

function getTodayDateInSettingsTz() {
  const iso = getTodayIsoInSettingsTz();
  return new Date(iso + "T00:00:00");
}

function formatDateNice(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
}

function formatBytes(size) {
  if (size == null) return "";
  const kb = size / 1024;
  if (kb < 1024) return kb.toFixed(1) + " KB";
  const mb = kb / 1024;
  return mb.toFixed(2) + " MB";
}

function getServiceTypeByName(name) {
  return (data.serviceTypes || []).find(st => st && st.name === name) || null;
}

function addMonthsToDate(iso, months) {
  if (!iso || !months) return null;
  const [y,m,d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const newMonth = date.getMonth() + months;
  date.setMonth(newMonth);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function getIntervalForService(vehicleId, serviceName) {
  let intervalMiles = null;
  let intervalMonths = null;

  if (data.vehicleIntervals && vehicleId && serviceName) {
    const vMap = data.vehicleIntervals[vehicleId];
    if (vMap && vMap[serviceName]) {
      const vi = vMap[serviceName];
      if (vi.intervalMiles != null && vi.intervalMiles !== "") {
        intervalMiles = vi.intervalMiles;
      }
      if (vi.intervalMonths != null && vi.intervalMonths !== "") {
        intervalMonths = vi.intervalMonths;
      }
    }
  }

  const st = getServiceTypeByName(serviceName);
  if (intervalMiles == null && st && st.intervalMiles != null) {
    intervalMiles = st.intervalMiles;
  }
  if (intervalMonths == null && st && st.intervalMonths != null) {
    intervalMonths = st.intervalMonths;
  }

  return { intervalMiles, intervalMonths };
}

/**
 * Normalize services array to handle both old (string[]) and new (object[]) formats
 * @param {Array} services - Array of strings or objects
 * @returns {Array} - Array of {name, cost, note} objects
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
 * Get just the service names from a services array (handles both formats)
 * @param {Array} services - Array of strings or objects
 * @returns {Array} - Array of service name strings
 */
function getServiceNames(services) {
  return normalizeServices(services).map(svc => svc.name).filter(n => n);
}

/**
 * Calculate total cost for an entry (sum of per-service costs + misc cost)
 * @param {Object} entry - Entry object
 * @returns {Number} - Total cost
 */
function calculateEntryTotalCost(entry) {
  let total = 0;
  
  // Sum per-service costs
  const services = normalizeServices(entry.services || []);
  services.forEach(svc => {
    if (svc.cost != null) {
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
 * Get sum of just the per-service costs (excluding misc cost)
 * @param {Object} entry - Entry object
 * @returns {Number} - Services subtotal
 */
function calculateServicesSubtotal(entry) {
  let total = 0;
  const services = normalizeServices(entry.services || []);
  services.forEach(svc => {
    if (svc.cost != null) {
      total += Number(svc.cost) || 0;
    }
  });
  return total;
}

function computeReminderDerived(rem, currentOdo) {
  const unit = getUnitShort();
  const today = getTodayDateInSettingsTz();
  
  // Get configurable thresholds from settings
  const thresholds = getReminderThresholds();

  let nextOdo = rem.nextOdo != null ? rem.nextOdo : null;
  let nextDate = rem.nextDate || null;

  if (rem.intervalMiles && rem.intervalMiles > 0 && nextOdo == null) {
    if (rem.baseOdo != null) {
      nextOdo = rem.baseOdo + rem.intervalMiles;
    } else if (currentOdo != null) {
      nextOdo = currentOdo + rem.intervalMiles;
    }
  }
  if (rem.intervalMonths && rem.intervalMonths > 0 && !nextDate) {
    if (rem.baseDate) {
      nextDate = addMonthsToDate(rem.baseDate, rem.intervalMonths);
    } else {
      const todayIso = getTodayIsoInSettingsTz();
      nextDate = addMonthsToDate(todayIso, rem.intervalMonths);
    }
  }

  let milesDiff = null;
  if (nextOdo != null && currentOdo != null) {
    milesDiff = nextOdo - currentOdo;
  }

  let daysDiff = null;
  if (nextDate) {
    const due = new Date(nextDate + "T00:00:00");
    if (!isNaN(due.getTime())) {
      daysDiff = Math.round((due.getTime() - today.getTime()) / (1000*60*60*24));
    }
  }

  // Determine level based on configurable thresholds
  let level = "ok";
  
  // Check for overdue (past due by more than the grace period)
  const isOverdueMiles = milesDiff != null && milesDiff < -thresholds.overdueMiles;
  const isOverdueDays = daysDiff != null && daysDiff < -thresholds.overdueDays;
  
  // Check for upcoming (within threshold but not overdue)
  const isUpcomingMiles = milesDiff != null && milesDiff <= thresholds.upcomingMiles && milesDiff >= -thresholds.overdueMiles;
  const isUpcomingDays = daysDiff != null && daysDiff <= thresholds.upcomingDays && daysDiff >= -thresholds.overdueDays;
  
  if (isOverdueMiles || isOverdueDays) {
    level = "overdue";
  } else if (isUpcomingMiles || isUpcomingDays) {
    level = "upcoming";
  }

  let milesPart = "no mileage target";
  if (milesDiff != null) {
    if (milesDiff < 0) {
      milesPart = `overdue by ${Math.abs(milesDiff)} ${unit}`;
    } else {
      milesPart = `due in ${milesDiff} ${unit}`;
    }
  }

  let daysPart = "no date target";
  if (daysDiff != null) {
    if (daysDiff < 0) {
      const absDays = Math.abs(daysDiff);
      if (absDays >= 365) {
        const years = Math.floor(absDays / 365);
        daysPart = `overdue by ${years} year${years > 1 ? 's' : ''}`;
      } else if (absDays > 30) {
        const months = Math.floor(absDays / 30);
        daysPart = `overdue by ${months} month${months > 1 ? 's' : ''}`;
      } else {
        daysPart = `overdue by ${absDays} day${absDays !== 1 ? 's' : ''}`;
      }
    } else {
      if (daysDiff >= 365) {
        const years = Math.floor(daysDiff / 365);
        daysPart = `due in ${years} year${years > 1 ? 's' : ''}`;
      } else if (daysDiff > 30) {
        const months = Math.floor(daysDiff / 30);
        daysPart = `due in ${months} month${months > 1 ? 's' : ''}`;
      } else {
        daysPart = `due in ${daysDiff} day${daysDiff !== 1 ? 's' : ''}`;
      }
    }
  }

  let label = "";
  if (milesDiff == null && daysDiff == null) {
    label = "No mileage or date configured";
  } else if (milesDiff != null && daysDiff != null) {
    label = `${milesPart} or ${daysPart}, whichever comes first`;
  } else if (milesDiff != null) {
    label = milesPart;
  } else if (daysDiff != null) {
    label = daysPart;
  }

  // Calculate urgency score for sorting (lower = more urgent)
  // Convert mileage to "days equivalent" using average daily miles
  const avgDailyMiles = (data.settings && data.settings.avgDailyMiles) 
    ? data.settings.avgDailyMiles 
    : 40; // Default: ~14,600 miles/year

  let urgencyScore;
  const milesAsDays = milesDiff != null ? milesDiff / avgDailyMiles : null;

  if (daysDiff != null && milesAsDays != null) {
    // Both set: use whichever comes first (smaller value)
    urgencyScore = Math.min(daysDiff, milesAsDays);
  } else if (daysDiff != null) {
    urgencyScore = daysDiff;
  } else if (milesAsDays != null) {
    urgencyScore = milesAsDays;
  } else {
    // No threshold set: sort to bottom
    urgencyScore = Infinity;
  }

  return {
    level,
    label,
    milesDiff,
    daysDiff,
    nextOdo,
    nextDate,
    urgencyScore
  };
}

/**
 * Find the most recent entry for a given vehicle and service type
 * Used to ensure reminders are based on the latest service, not just any entry
 */
function findMostRecentEntryForService(vehicleId, serviceName) {
  // Filter entries for this vehicle and service type
  const candidates = data.entries.filter(e => {
    if (e.vehicleId !== vehicleId) return false;
    const serviceNames = getServiceNames(e.services || []);
    return serviceNames.includes(serviceName);
  });

  // If no entries found, return null
  if (!candidates.length) return null;

  // Sort by date (most recent first), with createdAt as tiebreaker
  candidates.sort((a, b) => {
    const dateCompare = (b.date || "").localeCompare(a.date || "");
    if (dateCompare !== 0) return dateCompare;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });

  // Return the most recent entry
  return candidates[0];
}

/**
 * Reset reminders when an entry is added/edited
 * Updated to handle new service format
 */
function resetRemindersForEntry(entry) {
  if (!entry || !entry.vehicleId) return;
  const vehicle = data.vehicles.find(v => v.id === entry.vehicleId) || null;
  const currentOdo = vehicle && vehicle.currentOdo != null ? vehicle.currentOdo : null;
  const nowIso = new Date().toISOString();

  // Get service names from the entry (handles both old and new format)
  const serviceNames = getServiceNames(entry.services || []);

  serviceNames.forEach(serviceName => {
    if (!serviceName) return;
    const rems = data.reminders.filter(
      r => r.vehicleId === entry.vehicleId && r.serviceName === serviceName
    );
    rems.forEach(r => {
      const intervalMiles = r.intervalMiles != null ? r.intervalMiles : null;
      const intervalMonths = r.intervalMonths != null ? r.intervalMonths : null;

      // Find the most recent entry for this service type
      const mostRecentEntry = findMostRecentEntryForService(entry.vehicleId, serviceName);
      
      // Use most recent entry as reference, fallback to current entry if none exist
      const referenceEntry = mostRecentEntry || entry;

      let baseOdo = referenceEntry.odo != null ? referenceEntry.odo
                   : (currentOdo != null ? currentOdo
                      : (r.baseOdo != null ? r.baseOdo : null));
      let baseDate = referenceEntry.date || r.baseDate || null;

      let nextOdo = r.nextOdo != null ? r.nextOdo : null;
      let nextDate = r.nextDate || null;

      if (intervalMiles && intervalMiles > 0 && baseOdo != null) {
        nextOdo = baseOdo + intervalMiles;
      }

      if (intervalMonths && intervalMonths > 0) {
        if (baseDate) {
          nextDate = addMonthsToDate(baseDate, intervalMonths);
        } else {
          const todayIso = getTodayIsoInSettingsTz();
          baseDate = todayIso;
          nextDate = addMonthsToDate(baseDate, intervalMonths);
        }
      }

      r.baseOdo = baseOdo;
      r.baseDate = baseDate;
      r.nextOdo = nextOdo;
      r.nextDate = nextDate;
      r.updatedAt = nowIso;
    });
  });
}
