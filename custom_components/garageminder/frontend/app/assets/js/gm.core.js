const STORAGE_KEY = "garage_maintenance_data_v2";
    const BACKEND_URL = "api.php";

// Use APP_CONFIG from PHP if available, otherwise use defaults
const DEFAULT_SETTINGS = {
  siteTitle: (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.appName) ? APP_CONFIG.appName : "Garage Maintenance",
  unit: "mi",
  timezone: null,
  keepFormOpen: false,
  upcomingThresholdDays: 14,
  upcomingThresholdMiles: 500,
  overdueThresholdDays: 0,
  overdueThresholdMiles: 0,
  avgDailyMiles: 40
};

    const DEFAULT_DATA = {
      vehicles: [],
      serviceTypes: [
  // Engine & powertrain (core)
  { name: "Oil change",                          intervalMiles: 5000,  intervalMonths: 6 },
  { name: "Oil filter change",                   intervalMiles: 5000,  intervalMonths: 6 },
  { name: "Engine air filter replacement",       intervalMiles: null,  intervalMonths: 24 },
  { name: "Cabin air filter replacement",        intervalMiles: null,  intervalMonths: 12 },
  { name: "Spark plug replacement",              intervalMiles: 60000, intervalMonths: null },
  { name: "Serpentine / drive belt replacement", intervalMiles: 60000, intervalMonths: null },

  // Transmission & drivetrain
  { name: "Transmission fluid change",           intervalMiles: 60000, intervalMonths: 60 },
  { name: "Differential fluid change",           intervalMiles: 60000, intervalMonths: null },
  { name: "Transfer case fluid change",          intervalMiles: 60000, intervalMonths: null },
  { name: "Power steering fluid change",         intervalMiles: 60000, intervalMonths: null },

  // Brakes
  { name: "Brake fluid change",                  intervalMiles: null,  intervalMonths: 24 },
  { name: "Brake pad replacement",               intervalMiles: 40000, intervalMonths: null },
  { name: "Brake rotor replacement",             intervalMiles: 80000, intervalMonths: null },

  // Cooling system
  { name: "Coolant change",                      intervalMiles: 60000, intervalMonths: 60 },
  { name: "Radiator / cooling system service",   intervalMiles: null,  intervalMonths: null },

  // Tires & wheels
  { name: "Tire rotation",                       intervalMiles: 5000,  intervalMonths: 6 },
  { name: "Wheel alignment",                     intervalMiles: null,  intervalMonths: 12 },
  { name: "Wheel balance",                       intervalMiles: null,  intervalMonths: null },

  // Electrical & battery
  { name: "12V battery replacement",             intervalMiles: null,  intervalMonths: 48 },
  { name: "Charging system service",             intervalMiles: null,  intervalMonths: null },

  // Suspension & steering
  { name: "Suspension inspection",               intervalMiles: null,  intervalMonths: 12 },
  { name: "Steering inspection",                 intervalMiles: null,  intervalMonths: 12 },

  // Safety / legal / ownership
  { name: "Vehicle inspection (state / safety)", intervalMiles: null,  intervalMonths: 12 },
  { name: "Emissions test",                      intervalMiles: null,  intervalMonths: 24 },
  { name: "Registration renewal",                intervalMiles: null,  intervalMonths: 12 },
  { name: "Insurance renewal",                   intervalMiles: null,  intervalMonths: 12 },
  { name: "Recall service completed",            intervalMiles: null,  intervalMonths: null }
],
      entries: [],
      reminders: [],
      vehicleIntervals: {},
      entryTemplates: [],
      settings: DEFAULT_SETTINGS
    };

    let data = null;
    let activeVehicleId = null;
    let dashboardHistoryPage = 1;


    function cloneDefaultData() {
      return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
