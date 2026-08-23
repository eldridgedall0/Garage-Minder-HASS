/**
 * Garage Maintenance - State Management
 * Defaults to "All Vehicles" overview unless user previously selected a specific vehicle
 */

function setActiveVehicleFromStorageOrDefault() {
  const stored = (data && data.activeVehicleId) ? data.activeVehicleId : null;
  
  console.log("Loading activeVehicleId from storage:", stored); // Debug
  
  // If "all" was explicitly stored, use it
  if (stored === "all") {
    activeVehicleId = "all";
    return;
  }
  
  // If a specific vehicle ID was stored and exists, use it
  if (stored && stored !== "" && stored !== null) {
    const exists = data.vehicles.some(v => v.id === stored);
    if (exists) {
      activeVehicleId = stored;
      return;
    }
  }
  
  // Default to "all" (All Vehicles overview)
  activeVehicleId = "all";
}

function setActiveVehicle(id) {
  console.log("Setting activeVehicleId to:", id); // Debug
  
  // Allow "all" or valid vehicle IDs
  if (id === "all" || id === "" || id === null || id === undefined) {
    activeVehicleId = "all";
  } else {
    activeVehicleId = id;
  }
  
  if (data && typeof data === "object") {
    data.activeVehicleId = activeVehicleId;
  }
  
  dashboardHistoryPage = 1; // Reset to page 1 when changing vehicles
  saveData();
}