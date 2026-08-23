    function applyThemeFromSettings() {
      document.body.style.backgroundImage =
        "radial-gradient(circle at top, #1f2937, #020617 55%)";
    }

function applySiteTitle() {
  const title = data.settings?.siteTitle || "";
  const $customTitle = $("#site-title");
  
  // Get app name from config (injected by PHP) or use default
  const appName = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.appName) ? APP_CONFIG.appName : "Garage Maintenance";
  const appShortName = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.appShortName) ? APP_CONFIG.appShortName : appName;
  
  // Only show custom title if it's different from the app name
  if (title && title !== appName && title !== appShortName) {
    $customTitle.text(title);
  } else {
    $customTitle.text(""); // Empty hides it via CSS
  }
  
  // Browser tab title - use custom title if set, otherwise app name
  if (title && title !== appName && title !== appShortName) {
    document.title = `${title} | ${appShortName}`;
  } else {
    document.title = appName;
  }
}

    function updateUnitLabels() {
      const unit = getUnitShort();
      $(".unit-label").text(unit);
    }


