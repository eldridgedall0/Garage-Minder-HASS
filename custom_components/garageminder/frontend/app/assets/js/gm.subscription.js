/**
 * GarageMinder — Subscription UI Helpers
 *
 * Provides:
 *  - showUpgradeModal(opts)  : branded upgrade prompt modal
 *  - gmSubUpdateUI()         : call once after loadData() to apply all UI gates
 *
 * Depends on: gmSub (gm.api.js), window.GM_SUBSCRIPTION (set in loadData)
 */

// ============================================================
// UPGRADE MODAL
// ============================================================

/**
 * Show an upgrade prompt modal.
 *
 * @param {Object} opts
 * @param {string} [opts.title]   - Modal heading text
 * @param {string} [opts.message] - Body paragraph text
 * @param {string} [opts.feature] - Feature key (for future analytics)
 */
function showUpgradeModal(opts) {
  opts = opts || {};
  const upgradeUrl = gmSub.upgradeUrl();

  // Remove any existing instance
  const existing = document.getElementById('gm-upgrade-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'gm-upgrade-modal';
  modal.className = 'modal-overlay gm-upgrade-modal-overlay';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'gm-upgrade-modal-title');

  modal.innerHTML = `
    <div class="modal-box gm-upgrade-modal-box">
      <div class="modal-header gm-upgrade-modal-header">
        <h3 id="gm-upgrade-modal-title" class="gm-upgrade-modal-title">
          ⭐ ${opts.title || 'Upgrade Required'}
        </h3>
        <button type="button" class="modal-close gm-upgrade-modal-close"
                id="gm-upgrade-modal-close" aria-label="Close">✕</button>
      </div>
      <div class="modal-body gm-upgrade-modal-body">
        <p>${opts.message || 'This feature is not available on your current plan.'}</p>
      </div>
      <div class="modal-footer gm-upgrade-modal-footer">
        <button type="button" class="btn btn-secondary" id="gm-upgrade-modal-cancel">
          Maybe Later
        </button>
        <a href="${upgradeUrl}" class="btn gm-upgrade-btn">
          View Plans ↗
        </a>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Animate in
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      modal.classList.add('visible');
    });
  });

  function closeModal() {
    modal.classList.remove('visible');
    setTimeout(function() { modal.remove(); }, 220);
  }

  document.getElementById('gm-upgrade-modal-close').addEventListener('click', closeModal);
  document.getElementById('gm-upgrade-modal-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeModal();
  });

  function onEsc(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onEsc); }
  }
  document.addEventListener('keydown', onEsc);

  setTimeout(function() {
    const cancelBtn = document.getElementById('gm-upgrade-modal-cancel');
    if (cancelBtn) cancelBtn.focus();
  }, 50);
}

window.showUpgradeModal = showUpgradeModal;


// ============================================================
// USAGE BADGE HELPERS
// ============================================================

/**
 * Return a short usage label like " (1/2)" or "" when unlimited.
 */
function gmSubUsageLabel(countType) {
  const sub = window.GM_SUBSCRIPTION;
  if (!sub || !sub.usage || !sub.usage[countType]) return '';
  const u = sub.usage[countType];
  if (u.unlimited) return '';
  return ` (${u.used}/${u.max})`;
}

window.gmSubUsageLabel = gmSubUsageLabel;


// ============================================================
// GLOBAL UI GATE — call after loadData() to wire up initial states
// ============================================================

/**
 * Apply all subscription UI gates.
 * Called from gm.handlers.js after data loads.
 */
function gmSubUpdateUI() {
  if (typeof gmSub === 'undefined') return;
  _gmSubUpdateVehicleButton();
  _gmSubUpdateRecallsButton();
  _gmSubUpdateExportButtons();
  _gmSubUpdateAttachmentHelp();
}

window.gmSubUpdateUI = gmSubUpdateUI;


function _gmSubUpdateVehicleButton() {
  const $btn = $('#settings-vehicle-add');
  if (!$btn.length) return;

  const sub = window.GM_SUBSCRIPTION;
  if (!sub || !sub.usage || !sub.usage.vehicles) return;
  const u = sub.usage.vehicles;
  if (u.unlimited) return;

  const atLimit = u.remaining <= 0;
  const label   = ` (${u.used}/${u.max})`;

  let $label = $btn.find('.gm-vehicle-count-label');
  if ($label.length) {
    $label.text(label);
  } else {
    $btn.append(`<span class="gm-vehicle-count-label">${label}</span>`);
  }

  if (atLimit) {
    $btn.prop('disabled', true)
        .attr('title', 'Vehicle limit reached. Upgrade to add more.')
        .addClass('gm-btn-at-limit');
  } else {
    $btn.prop('disabled', false)
        .removeAttr('title')
        .removeClass('gm-btn-at-limit');
  }
}

function _gmSubUpdateRecallsButton() {
  const $btn = $('#check-recalls-btn');
  if (!$btn.length) return;
  if (!gmSub.can('recalls')) {
    $btn.addClass('gm-feature-locked')
        .attr('title', 'Recall checking requires an upgraded plan');
  } else {
    $btn.removeClass('gm-feature-locked').removeAttr('title');
  }
}

function _gmSubUpdateExportButtons() {
  const canExport   = gmSub.can('export');
  const exportLevel = gmSub.exportLevel();

  ['#export-excel', '#export-word', '#export-pdf'].forEach(function(sel) {
    const $btn = $(sel);
    if (!$btn.length) return;
    if (!canExport) {
      $btn.addClass('gm-feature-locked')
          .attr('title', 'Export requires an upgraded plan');
    } else {
      $btn.removeClass('gm-feature-locked').removeAttr('title');
    }
  });

  // Full backup export — no tier restriction
  const $backup = $('#backup-export-full');
  if ($backup.length) {
    $backup.removeClass('gm-feature-locked').removeAttr('title');
  }
}

function _gmSubUpdateAttachmentHelp() {
  const $help = $('.attachment-help-text, .attach-help, #attach-help');
  if (!$help.length) return;
  const sub = window.GM_SUBSCRIPTION;
  if (!sub) return;
  const canAttach = gmSub.can('attachments');
  const perEntry  = gmSub.attachmentsPerEntry();
  const sizeMB    = (typeof GM_CONFIG !== 'undefined' && GM_CONFIG.maxAttachmentSizeMB)
                      ? GM_CONFIG.maxAttachmentSizeMB : 5;
  if (!canAttach) {
    $help.html(`Attachments not available on ${gmSub.tierName()} plan. <a href="${gmSub.upgradeUrl()}">Upgrade</a>`);
  } else {
    $help.text(`Up to ${perEntry} file(s) per entry, ${sizeMB}MB each`);
  }
}