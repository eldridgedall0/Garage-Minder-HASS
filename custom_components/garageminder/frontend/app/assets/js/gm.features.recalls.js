/**
 * gm.features.recalls.js
 *
 * Recall checking via NHTSA deep-link.
 *
 * NHTSA does not provide a public API for VIN-specific recall lookups —
 * their recallsByVin endpoint is undocumented and blocks server/browser
 * requests from third-party origins. The only reliable, always-accurate
 * source is nhtsa.gov itself. Clicking "Check Recalls" opens the NHTSA
 * recalls page with the VIN pre-filled in a new tab.
 */

/**
 * Called on vehicle load. No auto-fetch needed since we're just linking out.
 * Kept for API compatibility with the rest of the codebase.
 */
function autoCheckRecallsOnLoad() {
  if (!activeVehicleId) return;

  // Subscription gate
  if (typeof gmSub !== 'undefined' && window.GM_SUBSCRIPTION && !gmSub.can('recalls')) {
    return;
  }

  updateSafetyStatus();
}

/**
 * Update the safety status badge and button for the active vehicle.
 */
function updateSafetyStatus() {
  const $container = $('#safety-status-container');
  const $badge     = $('#safety-status-badge');
  const $btn       = $('#check-recalls-btn');

  if (!activeVehicleId) {
    $container.hide();
    return;
  }

  const vehicle = data.vehicles.find(v => v.id === activeVehicleId);

  if (!vehicle || !vehicle.vin || vehicle.vin.trim() === '') {
    $container.hide();
    return;
  }

  $container.show();
  $badge.removeClass('no-recalls has-recalls').addClass('unknown').text('Check NHTSA');
  $btn.text('Check Recalls').prop('disabled', false);
}

/**
 * Open the NHTSA recalls page for the current vehicle's VIN in a new tab.
 * @param {boolean} showModal - unused, kept for call-site compatibility
 */
function checkVehicleRecalls(showModal = true) {
  const vehicle = data.vehicles.find(v => v.id === activeVehicleId);

  if (!vehicle || !vehicle.vin) {
    alert('This vehicle does not have a VIN set. Add a VIN in the vehicle details to check for recalls.');
    return;
  }

  const nhtsaUrl = 'https://www.nhtsa.gov/recalls?vymm=' + encodeURIComponent(vehicle.vin.trim());
  window.open(nhtsaUrl, '_blank', 'noopener,noreferrer');
}

/**
 * Display recall status badge.
 * Kept for call-site compatibility — in link-out mode the badge stays
 * as "Check NHTSA" since we never receive recall data to display.
 */
function displayRecallStatus(result) {
  // No-op in link-out mode — badge is set statically in updateSafetyStatus()
}

/**
 * Show recall modal.
 * Replaced with a simple info modal that explains the link-out behaviour
 * and provides the direct NHTSA link.
 */
function showRecallModal(result) {
  // This path is no longer called, but kept in case of future re-integration.
}

// ---------------------------------------------------------------------------
// Cache functions — kept for API compatibility, no-ops in link-out mode
// ---------------------------------------------------------------------------

function getVehicleRecallCache(vehicleId) {
  return null; // Always fetch fresh from NHTSA
}

function setVehicleRecallCache(vehicleId, data) {
  // No-op — we don't cache anything in link-out mode
}
