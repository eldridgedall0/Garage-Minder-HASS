function renderRemindersPage() {
      const $list = $("#reminders-list");
      $list.empty();
      const unit = getUnitShort();

      // Check if no vehicle selected OR "All Vehicles" is selected
      if (!activeVehicleId || activeVehicleId === "all") {
        $list.append(
          $("<div>").addClass("entry-empty")
            .html('<i class="bi bi-car-front" style="font-size:1.5rem;"></i><br>Select a specific vehicle to view and manage reminders.')
        );
        $("#rem-total").text("-");
        $("#rem-upcoming").text("-");
        $("#rem-overdue").text("-");
        
        // Hide the add reminder form when no specific vehicle is selected
        $("#reminder-form").closest(".settings-section").hide();
        return;
      }
      
      // Show the add reminder form when a specific vehicle is selected
      $("#reminder-form").closest(".settings-section").show();

      // Keep the "Service name" template dropdown in sync with the service
      // types defined in Settings. renderRemindersPage() runs on every
      // router navigation to this page and on every vehicle switch, so this
      // is the one place that guarantees the list is never stale/empty.
      if (typeof renderReminderServiceSelect === "function") {
        renderReminderServiceSelect();
      }

      const vehicle = data.vehicles.find(v => v.id === activeVehicleId) || null;
      const currentOdo = vehicle && vehicle.currentOdo != null ? vehicle.currentOdo : null;

      const reminders = data.reminders.filter(r => r.vehicleId === activeVehicleId);
      if (!reminders.length) {
        $list.append(
          $("<div>").addClass("entry-empty")
            .text("No reminders yet. Use the form below to add one.")
        );
        $("#rem-total").text(0);
        $("#rem-upcoming").text(0);
        $("#rem-overdue").text(0);
        return;
      }

      $("#rem-total").text(reminders.length);
      let upcoming = 0;
      let overdue = 0;

      reminders
        .slice()
        .sort((a, b) => {
          // Sort by urgency score (lower = more urgent = appears first)
          const derivedA = computeReminderDerived(a, currentOdo);
          const derivedB = computeReminderDerived(b, currentOdo);
          return derivedA.urgencyScore - derivedB.urgencyScore;
        })
        .forEach(rem => {
          const derived = computeReminderDerived(rem, currentOdo);
          if (derived.level === "upcoming") upcoming++;
          if (derived.level === "overdue") overdue++;

          const serviceName = rem.serviceName || rem.title || "Reminder";
          const $card = $("<div>").addClass("reminder-card").attr("data-id", rem.id);

          const $header = $("<div>").addClass("reminder-header");
          const $main = $("<div>").addClass("reminder-main");

          $main.append(
            $("<div>").addClass("reminder-title").text(serviceName),
            $("<div>").addClass("reminder-meta").text(
              [
                derived.nextOdo != null
                  ? `Next: ${derived.nextOdo.toLocaleString()} ${unit}`
                  : null,
                derived.nextDate
                  ? `Date: ${formatDateNice(derived.nextDate)}`
                  : null
              ].filter(Boolean).join(" \u2022 ") || "No next mileage/date set"
            )
          );

          const $status = $("<div>")
            .addClass("reminder-status-pill " + derived.level)
            .append(
              $("<span>").addClass("dot"),
              $("<span>").text(derived.label)
            );

          $header.append($main, $status);

          const $body = $("<div>").addClass("reminder-body");
          const $inner = $("<div>").addClass("reminder-body-inner");

          const $fieldsGrid = $("<div>").addClass("reminder-body-fields");
          $fieldsGrid.append(
            $("<div>").addClass("field").append(
              $("<label>").text("Service name"),
              $("<input>")
                .attr("type","text")
                .addClass("rem-edit-service")
                .val(rem.serviceName || "")
            ),
            $("<div>").addClass("field").append(
              $("<label>").html(`Interval (<span class="unit-label">${unit}</span>, optional)`),
              $("<input>")
                .attr({type:"number",min:"0",step:"100"})
                .addClass("rem-edit-interval-miles")
                .val(rem.intervalMiles != null ? rem.intervalMiles : "")
            ),
            $("<div>").addClass("field").append(
              $("<label>").text("Interval (months, optional)"),
              $("<input>")
                .attr({type:"number",min:"0",step:"1"})
                .addClass("rem-edit-interval-months")
                .val(rem.intervalMonths != null ? rem.intervalMonths : "")
            ),
            $("<div>").addClass("field").append(
              $("<label>").html(`Last service mileage (<span class="unit-label">${unit}</span>, optional)`),
              $("<input>")
                .attr({type:"number",min:"0",step:"1"})
                .addClass("rem-edit-base-odo")
                .val(rem.baseOdo != null ? rem.baseOdo : "")
            ),
            $("<div>").addClass("field").append(
              $("<label>").text("Last service date (optional)"),
              $("<input>")
                .attr({type:"text",placeholder:"YYYY-MM-DD",autocomplete:"off"})
                .addClass("rem-edit-base-date")
                .val(rem.baseDate || "")
            ),
            $("<div>").addClass("field").append(
              $("<label>").html(`Next due mileage (<span class="unit-label">${unit}</span>, optional)`),
              $("<input>")
                .attr({type:"number",min:"0",step:"1"})
                .addClass("rem-edit-next-odo")
                .val(rem.nextOdo != null ? rem.nextOdo : "")
            ),
            $("<div>").addClass("field").append(
              $("<label>").text("Next due date (optional)"),
              $("<input>")
                .attr({type:"text",placeholder:"YYYY-MM-DD",autocomplete:"off"})
                .addClass("rem-edit-next-date")
                .val(rem.nextDate || "")
            )
          );

          const $notesField = $("<div>").addClass("reminder-body-notes field").append(
            $("<label>").text("Notes"),
            $("<textarea>")
              .addClass("rem-edit-notes")
              .attr("rows",2)
              .val(rem.notes || "")
          );

          const $buttons = $("<div>").addClass("reminder-body-buttons").append(
            $("<button>")
              .addClass("btn-ghost btn-small rem-btn-google")
              .attr("type","button")
              .text("Google reminder (time-based)"),
            $("<button>")
              .addClass("btn-danger btn-small rem-btn-delete")
              .attr("type","button")
              .text("Delete"),
            $("<button>")
              .addClass("btn-secondary btn-small rem-btn-copy")
              .attr("type","button")
              .text("Copy to vehicle"),
            $("<button>")
              .addClass("btn-primary btn-small rem-btn-save")
              .attr("type","button")
              .text("Save changes")
          );

          $inner.append($fieldsGrid, $notesField, $buttons);
          $body.append($inner);
          $card.append($header, $body);
          $list.append($card);
        });

      $("#rem-upcoming").text(upcoming);
      $("#rem-overdue").text(overdue);

      initDatePickers($list);
      updateUnitLabels();
    }

    function autoFillNextOdoFromIntervals() {
      const vehicle = data.vehicles.find(v => v.id === activeVehicleId);
      if (!vehicle) return;

      const $nextOdo = $("#entry-next-odo");
      if ($nextOdo.val()) return;

      const services = getServicesFromChecklist(
  $("#service-checklist-container"),
  $("#entry-services-other").val()
);
      if (!services.length) return;

      const intervals = [];
      services.forEach(name => {
        const iv = getIntervalForService(vehicle.id, name);
        if (iv.intervalMiles && iv.intervalMiles > 0) {
          intervals.push(iv.intervalMiles);
        }
      });

      if (!intervals.length) return;

      const odoVal = $("#entry-odo").val();
      let baseOdo = null;
      if (odoVal !== "") {
        baseOdo = Number(odoVal);
      } else if (vehicle.currentOdo != null) {
        baseOdo = vehicle.currentOdo;
      }

      if (baseOdo == null || isNaN(baseOdo)) return;

      const interval = Math.min.apply(null, intervals);
      const nextOdo = Math.round(baseOdo + interval);
      $nextOdo.val(nextOdo);
    }

function getAttachmentLimits() {

    const maxCount = (data && typeof data.entryMaxAttachments === "number" && data.entryMaxAttachments > 0)

        ?
        data.entryMaxAttachments

        :
        5;

    const maxSizeMB = (data && typeof data.entryMaxAttachmentSizeMB === "number" && data.entryMaxAttachmentSizeMB > 0)

        ?
        data.entryMaxAttachmentSizeMB

        :
        10;

    const maxBytes = maxSizeMB > 0 ? maxSizeMB * 1024 * 1024 : Infinity;

    return {
        maxCount,
        maxSizeMB,
        maxBytes
    };

}



function getAttachmentHelpText() {

    const {
        maxCount,
        maxSizeMB
    } = getAttachmentLimits();

    return `Up to ${maxCount} attachments per entry, PDF/Word/images only, max ${maxSizeMB} MB each.`;

}