/**
 * GarageMinder - Dynamic Reminders Integration
 * 
 * This script wires up the dynamic reminder auto-fill functionality
 * Add this code to gm.handlers.js or create as a separate file
 * and load AFTER gm.features.dynamic-reminders.js
 */

// Initialize auto-fill for new reminder form when page loads
$(document).ready(function() {
  // Wait a bit to ensure everything is loaded
  setTimeout(function() {
    initNewReminderAutoFill();
  }, 100);
});

// Re-initialize when reminders page is rendered
const originalRenderRemindersPage = renderRemindersPage;
renderRemindersPage = function() {
  originalRenderRemindersPage();
  
  // Initialize auto-fill for all reminder edit cards
  $("#reminders-list .reminder-card").each(function() {
    initReminderEditAutoFill($(this));
  });
};

// Hook into service select change to trigger auto-fill
$(document).on("change", "#rem-new-service", function() {
  // Let the existing interval population happen first
  setTimeout(function() {
    autoFillReminderFields($("#reminder-form"), false);
  }, 50);
});

// Hook into custom service input blur to trigger auto-fill
$(document).on("blur", "#rem-new-service-custom", function() {
  autoFillReminderFields($("#reminder-form"), false);
});
