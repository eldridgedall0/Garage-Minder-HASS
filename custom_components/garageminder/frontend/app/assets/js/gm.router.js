/**
 * Garage Maintenance - Secure Hash-Based Router
 * Provides bookmarkable URLs, browser navigation, and safe fallbacks
 * 
 * Security Features:
 * - Input sanitization to prevent XSS
 * - Route validation with whitelist approach
 * - Length limits on all route segments
 * - Safe fallbacks for all invalid states
 */

// ============================================
// VIEW REGISTRY (Future-Proof Extension Point)
// ============================================

const VIEW_REGISTRY = {
  dashboard: {
    aliases: ['home', 'dash'],
    supportsVehicle: true,
    supportsSubviews: false,
    defaultRoute: '#dashboard',
    render: function() { renderDashboard(); }
  },
  
  reminders: {
    aliases: ['remind', 'alerts'],
    supportsVehicle: true,
    supportsSubviews: false,
    defaultRoute: '#reminders',
    render: function() { renderRemindersPage(); }
  },
  
  settings: {
    aliases: ['config', 'setup', 'preferences'],
    supportsVehicle: false,
    supportsSubviews: true,
    subviews: ['general', 'vehicles', 'services', 'templates', 'backup'],
    defaultSubview: 'general',
    defaultRoute: '#settings/general',
    render: function() { renderSettings(); },
    renderSubview: function(subview) {
      // Trigger tab click programmatically
      $(`.settings-tab-btn[data-tab="${subview}"]`).trigger('click');
    }
  }
};

// FUTURE: Add new views by extending this registry
// VIEW_REGISTRY.reports = { ... };

// ============================================
// SECURITY CONSTANTS
// ============================================

const ROUTE_SECURITY = {
  MAX_SEGMENT_LENGTH: 100,
  MAX_SEGMENTS: 5,
  ALLOWED_CHARS: /^[a-z0-9_\-]+$/i,
  VEHICLE_ID_PATTERN: /^v_\d{13}_[a-z0-9]+$/i
};

// ============================================
// ROUTE PARSING & VALIDATION
// ============================================

/**
 * Sanitize a route segment to prevent XSS
 * @param {string} segment - Raw route segment
 * @returns {string} Sanitized segment
 */
function sanitizeRouteSegment(segment) {
  if (!segment || typeof segment !== 'string') return '';
  
  // Remove any HTML/script tags
  segment = segment.replace(/<[^>]*>/g, '');
  
  // Limit length
  segment = segment.substring(0, ROUTE_SECURITY.MAX_SEGMENT_LENGTH);
  
  // Remove special characters (keep only alphanumeric, underscore, hyphen)
  segment = segment.replace(/[^a-z0-9_\-]/gi, '');
  
  return segment.toLowerCase().trim();
}

/**
 * Resolve view alias to canonical view name
 * @param {string} alias - Potential alias
 * @returns {string|null} Canonical view name or null
 */
function resolveViewAlias(alias) {
  if (!alias) return null;
  
  alias = sanitizeRouteSegment(alias);
  
  // Check if it's already a canonical view
  if (VIEW_REGISTRY[alias]) {
    return alias;
  }
  
  // Check aliases
  for (const [viewName, config] of Object.entries(VIEW_REGISTRY)) {
    if (config.aliases && config.aliases.includes(alias)) {
      return viewName;
    }
  }
  
  return null;
}

/**
 * Validate if a vehicle ID exists in data
 * @param {string} vehicleId - Vehicle ID to validate
 * @returns {boolean}
 */
function isValidVehicleId(vehicleId) {
  if (!vehicleId) return false;
  if (vehicleId === 'all') return true;
  
  // Check format
  if (!ROUTE_SECURITY.VEHICLE_ID_PATTERN.test(vehicleId)) {
    return false;
  }
  
  // Check if exists in data
  if (!data || !data.vehicles) return false;
  return data.vehicles.some(v => v.id === vehicleId);
}

/**
 * Parse URL hash into route object
 * @param {string} hash - URL hash (e.g., "#dashboard/v_123")
 * @returns {object} Route object
 */
function parseRoute(hash) {
  // Clean hash
  hash = (hash || '').replace(/^#/, '').trim();
  
  // Default route
  if (!hash) {
    return {
      view: 'dashboard',
      vehicle: null,
      subview: null,
      raw: '#dashboard',
      valid: true
    };
  }
  
  // Split into segments and sanitize
  const segments = hash.split('/').filter(s => s).map(sanitizeRouteSegment);
  
  // Security: Limit number of segments
  if (segments.length > ROUTE_SECURITY.MAX_SEGMENTS) {
    console.warn('Route has too many segments, truncating');
    segments.length = ROUTE_SECURITY.MAX_SEGMENTS;
  }
  
  // Parse view (first segment)
  const viewName = resolveViewAlias(segments[0]);
  if (!viewName) {
    return {
      view: 'dashboard',
      vehicle: null,
      subview: null,
      raw: hash,
      valid: false,
      error: 'invalid_view'
    };
  }
  
  const viewConfig = VIEW_REGISTRY[viewName];
  let vehicle = null;
  let subview = null;
  
  // Parse second segment (depends on view capabilities)
  if (segments.length > 1) {
    const secondSegment = segments[1];
    
    // Check if it's a vehicle ID
    if (viewConfig.supportsVehicle && (secondSegment === 'all' || secondSegment.startsWith('v_'))) {
      vehicle = secondSegment;
    }
    // Check if it's a subview
    else if (viewConfig.supportsSubviews && viewConfig.subviews.includes(secondSegment)) {
      subview = secondSegment;
    }
  }
  
  // Parse third segment (for views that support both)
  if (segments.length > 2 && viewConfig.supportsVehicle && viewConfig.supportsSubviews) {
    const thirdSegment = segments[2];
    if (thirdSegment === 'all' || thirdSegment.startsWith('v_')) {
      vehicle = thirdSegment;
    }
  }
  
  return {
    view: viewName,
    vehicle: vehicle,
    subview: subview || (viewConfig.defaultSubview || null),
    raw: hash,
    valid: true
  };
}

/**
 * Validate parsed route and provide fallback if invalid
 * @param {object} route - Parsed route object
 * @returns {object} Validation result with fallback
 */
function validateRoute(route) {
  if (!route.valid) {
    return {
      valid: false,
      fallback: {
        view: 'dashboard',
        vehicle: null,
        subview: null
      },
      message: 'Page not found'
    };
  }
  
  const viewConfig = VIEW_REGISTRY[route.view];
  
  // Validate vehicle if specified
  if (route.vehicle && route.vehicle !== 'all') {
    if (!isValidVehicleId(route.vehicle)) {
      return {
        valid: false,
        fallback: {
          view: route.view,
          vehicle: 'all',
          subview: route.subview
        },
        message: 'Vehicle not found, showing all vehicles'
      };
    }
  }
  
  // Validate subview if specified
  if (route.subview && viewConfig.subviews) {
    if (!viewConfig.subviews.includes(route.subview)) {
      return {
        valid: false,
        fallback: {
          view: route.view,
          vehicle: route.vehicle,
          subview: viewConfig.defaultSubview
        },
        message: 'Tab not found, showing default'
      };
    }
  }
  
  return { valid: true };
}

/**
 * Build hash string from route components
 * @param {string} view - View name
 * @param {string|null} vehicle - Vehicle ID or null
 * @param {string|null} subview - Subview name or null
 * @returns {string} Hash string (e.g., "#dashboard/v_123")
 */
function buildRoute(view, vehicle, subview) {
  // Sanitize inputs
  view = sanitizeRouteSegment(view);
  if (vehicle) vehicle = sanitizeRouteSegment(vehicle);
  if (subview) subview = sanitizeRouteSegment(subview);
  
  // Resolve alias
  view = resolveViewAlias(view) || 'dashboard';
  
  const viewConfig = VIEW_REGISTRY[view];
  if (!viewConfig) {
    return '#dashboard';
  }
  
  let parts = [view];
  
  // For settings: subview comes before vehicle (settings/vehicles)
  if (view === 'settings' && subview) {
    parts.push(subview);
  }
  // For other views: vehicle comes first
  else {
    if (vehicle) parts.push(vehicle);
    if (subview) parts.push(subview);
  }
  
  return '#' + parts.join('/');
}

/**
 * Get current parsed route
 * @returns {object} Current route object
 */
function getCurrentRoute() {
  return parseRoute(window.location.hash);
}

// ============================================
// NAVIGATION
// ============================================

/**
 * Navigate to a route
 * @param {string} view - View name
 * @param {string|null} vehicle - Vehicle ID (optional)
 * @param {string|null} subview - Subview name (optional)
 */
function navigateTo(view, vehicle, subview) {
  // If vehicle not specified, inherit from current state
  if (vehicle === undefined || vehicle === null) {
    vehicle = activeVehicleId;
  }
  
  const route = buildRoute(view, vehicle, subview);
  
  // Update URL (will trigger hashchange event)
  window.location.hash = route;
}

/**
 * Handle route changes (from hashchange event)
 */
function handleRouteChange() {
  const route = parseRoute(window.location.hash);
  
  // Validate route
  const validation = validateRoute(route);
  
  if (!validation.valid) {
    // Show user-friendly message
    if (validation.message && typeof showToast === 'function') {
      showToast('⚠️ ' + validation.message, 'warning', 3000);
    }
    
    // Redirect to fallback
    const fallbackRoute = buildRoute(
      validation.fallback.view,
      validation.fallback.vehicle,
      validation.fallback.subview
    );
    
    // Use replaceState to avoid back button issues
    window.location.replace(fallbackRoute);
    return;
  }
  
  // Update application state
  updateStateFromRoute(route);
  
  // Update UI to reflect route
  updateUIFromRoute(route);
  
  // Render the view
  renderRoute(route);
}

/**
 * Update application state based on route
 * @param {object} route - Route object
 */
function updateStateFromRoute(route) {
  // Update active vehicle if specified in route
  if (route.vehicle) {
    if (route.vehicle !== activeVehicleId) {
      // Update without triggering navigation (avoid loop)
      activeVehicleId = route.vehicle;
      if (data && typeof data === 'object') {
        data.activeVehicleId = activeVehicleId;
      }
      // Don't call saveData() here - will be called by render functions if needed
    }
  }
}

/**
 * Update UI elements to reflect route
 * @param {object} route - Route object
 */
function updateUIFromRoute(route) {
  // Update navigation buttons
  $('.nav-btn').removeClass('active');
  $(`.nav-btn[data-view="${route.view}"]`).addClass('active');
  
  // Update views
  $('.view').removeClass('active');
  $(`#view-${route.view}`).addClass('active');
  
  // Update vehicle picker
  if (route.vehicle && $('#active-vehicle').length) {
    $('#active-vehicle').val(route.vehicle);
  }
  
  // Update settings tabs if in settings
  if (route.view === 'settings' && route.subview) {
    $('.settings-tab-btn').removeClass('active');
    $(`.settings-tab-btn[data-tab="${route.subview}"]`).addClass('active');
    
    $('.settings-tab-view').removeClass('active');
    $(`#settings-tab-${route.subview}`).addClass('active');
  }
}

/**
 * Render the view based on route
 * @param {object} route - Route object
 */
function renderRoute(route) {
  const viewConfig = VIEW_REGISTRY[route.view];
  
  if (!viewConfig) {
    console.error('View config not found:', route.view);
    return;
  }
  
  // Call main render function
  if (typeof viewConfig.render === 'function') {
    viewConfig.render();
  }
  
  // Call subview render if applicable
  if (route.subview && typeof viewConfig.renderSubview === 'function') {
    viewConfig.renderSubview(route.subview);
  }
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize router system
 */
function initRouter() {
  console.log('🧭 Initializing router...');
  
  // Listen for hash changes (back/forward buttons, manual edits)
  window.addEventListener('hashchange', handleRouteChange);
  
  // Handle initial route on page load
  const initialHash = window.location.hash;
  
  if (!initialHash || initialHash === '#') {
    // No hash - set default
    const defaultRoute = buildRoute('dashboard', activeVehicleId, null);
    window.location.hash = defaultRoute;
  } else {
    // Has hash - validate and handle
    handleRouteChange();
  }
  
  console.log('✓ Router initialized');
}

// ============================================
// PUBLIC API
// ============================================

// Expose functions for external use
window.GarageRouter = {
  navigateTo: navigateTo,
  getCurrentRoute: getCurrentRoute,
  parseRoute: parseRoute,
  buildRoute: buildRoute,
  initRouter: initRouter,
  VIEW_REGISTRY: VIEW_REGISTRY // Allow extension
};
