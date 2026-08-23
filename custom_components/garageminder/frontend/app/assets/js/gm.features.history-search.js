/**
 * GarageMinder - Service History Search Filter
 * Simple but powerful search filtering for service entries
 */

// State for search filter
let historySearchState = {
  searchText: '',
  vehicleId: null,
  debounceTimer: null
};

/**
 * Initialize history search functionality
 */
function initHistorySearch() {
  // Event handler for search input
  $(document).on('input', '#history-search-input', function() {
    const searchText = $(this).val().trim();
    
    // Debounce search to avoid excessive re-renders
    clearTimeout(historySearchState.debounceTimer);
    historySearchState.debounceTimer = setTimeout(() => {
      historySearchState.searchText = searchText;
      historySearchState.vehicleId = activeVehicleId;
      
      // Reset pagination to page 1 when search changes
      if (typeof dashboardHistoryPage !== 'undefined') {
        dashboardHistoryPage = 1;
      }
      
      // Update the display
      renderDashboardHistory();
      
      // Show/hide clear button
      if (searchText) {
        $('#history-search-clear').show();
      } else {
        $('#history-search-clear').hide();
      }
    }, 300); // 300ms debounce
  });
  
  // Event handler for clear button
  $(document).on('click', '#history-search-clear', function() {
    $('#history-search-input').val('');
    historySearchState.searchText = '';
    $('#history-search-clear').hide();
    
    // Reset pagination to page 1 when clearing search
    if (typeof dashboardHistoryPage !== 'undefined') {
      dashboardHistoryPage = 1;
    }
    
    renderDashboardHistory();
    $('#history-search-input').focus();
  });
  
  // Clear search when vehicle changes
  $(document).on('vehicle-changed', function() {
    if (activeVehicleId !== historySearchState.vehicleId) {
      $('#history-search-input').val('');
      historySearchState.searchText = '';
      historySearchState.vehicleId = activeVehicleId;
      $('#history-search-clear').hide();
    }
  });
}

/**
 * Get filtered entries based on search text
 * Returns entries that match search criteria
 */
function getFilteredHistoryEntries(vehicleId) {
  // Start with entries for this vehicle
  let filtered = data.entries.filter(e => e.vehicleId === vehicleId);
  
  // Apply search filter if active
  if (historySearchState.searchText && historySearchState.searchText.length > 0) {
    const search = historySearchState.searchText.toLowerCase();
    
    filtered = filtered.filter(entry => {
      // Search in service names
      const services = (entry.services || [])
        .map(s => (s.name || '').toLowerCase())
        .join(' ');
      
      // Search in notes
      const notes = (entry.notes || '').toLowerCase();
      
      // Search in formatted date
      const date = formatDateNice(entry.date).toLowerCase();
      
      // Search in odometer
      const odo = entry.odo != null ? entry.odo.toString() : '';
      
      // Search in cost
      const cost = entry.cost != null ? entry.cost.toString() : '';
      const totalCost = calculateEntryTotalCost(entry).toString();
      
      // Match if any field contains search text
      return services.includes(search) || 
             notes.includes(search) || 
             date.includes(search) ||
             odo.includes(search) ||
             cost.includes(search) ||
             totalCost.includes(search);
    });
  }
  
  return filtered;
}

/**
 * Render search bar UI
 * Returns jQuery element for search container
 */
function renderHistorySearchBar() {
  const $container = $('<div>').addClass('history-search-container');
  
  const $wrapper = $('<div>').addClass('history-search-wrapper');
  
  // Search icon
  const $icon = $('<i>').addClass('bi bi-search history-search-icon');
  
  // Search input
  const $input = $('<input>')
    .attr({
      type: 'text',
      id: 'history-search-input',
      placeholder: 'Search service history...',
      autocomplete: 'off'
    })
    .addClass('history-search-input')
    .val(historySearchState.searchText || '');
  
  // Clear button (hidden by default)
  const $clearBtn = $('<button>')
    .attr({
      type: 'button',
      id: 'history-search-clear',
      title: 'Clear search'
    })
    .addClass('history-search-clear')
    .html('<i class="bi bi-x-circle-fill"></i>')
    .css('display', historySearchState.searchText ? 'flex' : 'none');
  
  $wrapper.append($icon, $input, $clearBtn);
  $container.append($wrapper);
  
  return $container;
}

/**
 * Update search results count display
 */
function updateHistorySearchCount(totalEntries, filteredCount) {
  const $countContainer = $('#history-search-count');
  
  if (historySearchState.searchText && filteredCount < totalEntries) {
    // Show "X of Y entries" when filtering
    $countContainer
      .html(`Showing <strong>${filteredCount}</strong> of <strong>${totalEntries}</strong> entries`)
      .show();
  } else {
    // Hide when not filtering or showing all
    $countContainer.hide();
  }
}

// Initialize on document ready
$(document).ready(function() {
  initHistorySearch();
});