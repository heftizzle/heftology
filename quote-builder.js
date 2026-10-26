/* Quote builder. Pure helpers are exported for tests. DOM work runs only in the browser. */
var COVERED_CITIES = [
  "Tampa",
  "St. Pete",
  "Clearwater",
  "Dunedin",
  "Safety Harbor",
  "Brandon",
  "Riverview",
  "Valrico",
  "Wesley Chapel",
  "Zephyrhills",
  "Spring Hill",
  "Brooksville",
  "New Port Richey",
  "Tarpon Springs",
  "Sarasota",
  "Bradenton",
  "Ruskin",
  "Lakeland"
];

var PACKAGE_CAPS = {
  "The Craft Bar": { guests: 50, hours: 3 },
  "The Signature Pour": { guests: 100, hours: 6 },
  "The Full Experience": { guests: 150, hours: 8 }
};

var PACKAGE_RANK = {
  "The Craft Bar": 1,
  "The Signature Pour": 2,
  "The Full Experience": 3
};

var UNSURE_VALUE = "Not sure, recommend one for me";

var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function packageValue(recommended) {
  if (recommended === "custom") return UNSURE_VALUE;
  return recommended || "";
}

function recommendPackage(input) {
  var guests = Number(input && input.guests);
  var hoursUnsure = !!(input && input.hoursUnsure);
  var hours = hoursUnsure ? null : Number(input && input.hours);
  var eventType = input && input.eventType;
  if (eventType === "Cocktail Class") return "Cocktail Class";
  if (!Number.isFinite(guests) || guests <= 0) return "";
  var hoursKnown = Number.isFinite(hours);
  if (guests <= 50 && (!hoursKnown || hours <= 3)) return "The Craft Bar";
  if (guests <= 100 && (!hoursKnown || hours <= 6)) return "The Signature Pour";
  if (guests <= 150 && (!hoursKnown || hours <= 8)) return "The Full Experience";
  return "custom";
}

function stillCovers(current, recommended) {
  if (!current) return false;
  if (current === UNSURE_VALUE) return true;
  if (recommended === "custom") return false;
  if (recommended === "Cocktail Class") return current === "Cocktail Class";
  if (current === "Cocktail Class") return false;
  var currentRank = PACKAGE_RANK[current];
  var recommendedRank = PACKAGE_RANK[recommended];
  if (!currentRank || !recommendedRank) return current === recommended;
  return currentRank >= recommendedRank;
}

function mismatchNote(current, recommended, guests, hours) {
  var cap = PACKAGE_CAPS[current];
  var fit = recommended && recommended !== "custom" ? recommended + " fits best." : "we'll build a custom quote.";
  if (cap && Number(guests) > cap.guests) {
    return current + " covers up to " + cap.guests + " guests. For " + guests + " guests, " + fit;
  }
  if (cap && hours != null && hours !== "" && Number(hours) > cap.hours) {
    return current + " covers up to " + cap.hours + " hours. For " + hours + " hours, " + fit;
  }
  if (recommended === "Cocktail Class") {
    return current + " is a bar package. A Cocktail Class fits this event best.";
  }
  if (recommended && recommended !== "custom") return "For this event, " + recommended + " fits best.";
  return "This one needs a custom quote. We'll build it with you.";
}

function decideSelection(input) {
  var current = (input && input.current) || "";
  var source = input && input.source === "user" ? "user" : "auto";
  var recommended = (input && input.recommended) || "";
  if (!recommended) {
    return { selection: source === "user" ? current : "", source: source, note: "" };
  }
  if (source !== "user" || !current) {
    return { selection: packageValue(recommended), source: "auto", note: "" };
  }
  if (stillCovers(current, recommended)) {
    return { selection: current, source: "user", note: "" };
  }
  return {
    selection: current,
    source: "user",
    note: mismatchNote(current, recommended, input.guests, input.hours)
  };
}

function recommendationSentence(input) {
  var recommended = input && input.recommended;
  var guests = input && input.guests;
  var hours = input && input.hours;
  if (!recommended) return "";
  if (recommended === "custom") return "Over 150 guests or a longer bar is a custom quote. We'll build it with you.";
  if (recommended === "Cocktail Class") return "A Cocktail Class fits this celebration best.";
  if (input.hoursUnsure || hours == null || hours === "") {
    return "For about " + guests + " guests, " + recommended + " fits best.";
  }
  return "For about " + guests + " guests over " + hours + " hours, " + recommended + " fits best.";
}

function formatClock(totalMinutes) {
  var day = 24 * 60;
  var mins = ((totalMinutes % day) + day) % day;
  var hour = Math.floor(mins / 60);
  var minute = mins % 60;
  var suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return hour + ":" + String(minute).padStart(2, "0") + " " + suffix;
}

function endTimeLabel(start, hours) {
  var length = Number(hours);
  if (!start) {
    if (!Number.isFinite(length)) return "";
    return length + (length === 1 ? " hour" : " hours");
  }
  var parts = String(start).split(":");
  var hour = Number(parts[0]);
  var minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(length)) return "";
  var startMins = hour * 60 + minute;
  var endMins = startMins + length * 60;
  var text = "Bar open " + formatClock(startMins) + " to " + formatClock(endMins);
  if (endMins >= 24 * 60) text += " (next day)";
  return text;
}

function matchCoveredCity(value, cities) {
  var list = cities || COVERED_CITIES;
  var trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) return "";
  for (var i = 0; i < list.length; i++) {
    if (list[i].toLowerCase() === trimmed) return list[i];
  }
  return "";
}

function cityMessage(value, cities) {
  if (!String(value || "").trim()) return "";
  var city = matchCoveredCity(value, cities);
  if (city) return "Great, " + city + " is in our service area. No travel fee.";
  return "Thanks! We'll confirm travel for that location. Most places within about 90 minutes of Tampa Bay are possible.";
}

function formatDateLabel(iso, style) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  var parts = iso.split("-");
  var year = Number(parts[0]);
  var month = Number(parts[1]);
  var day = Number(parts[2]);
  var date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  if (style === "short") return WEEKDAYS_SHORT[date.getDay()] + ", " + MONTHS_SHORT[month - 1] + " " + day;
  return WEEKDAYS[date.getDay()] + ", " + MONTHS[month - 1] + " " + day + ", " + year;
}

function formatTimeLabel(value) {
  if (!value) return "";
  var parts = String(value).split(":");
  var hour = Number(parts[0]);
  var minute = Number(parts[1]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "";
  return formatClock(hour * 60 + minute);
}

function applyDesignerVenue(input) {
  var current = (input && input.current) || "";
  var source = (input && input.source) || "";
  var incoming = (input && input.incoming) || "";
  if (source === "user" && current) return { selection: current, source: "user" };
  if (!incoming) return { selection: current, source: source };
  return { selection: incoming, source: "designer" };
}

function clearDesignerVenue(input) {
  var current = (input && input.current) || "";
  var source = (input && input.source) || "";
  if (source !== "designer") return { selection: current, source: source };
  return { selection: "", source: "" };
}

function formatDollars(amount) {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

if (typeof document !== "undefined") {
  var startQuoteBuilder = function () {
    var form = document.getElementById("booking-form");
    if (!form) return;

    var steps = Array.prototype.slice.call(form.querySelectorAll(".wz-step"));
    var progressFill = document.getElementById("qb-progress-fill");
    var progressCurrent = document.getElementById("qb-progress-current");
    var announce = document.getElementById("qb-announce");
    var alertBox = document.getElementById("qb-alert");
    var alertText = document.getElementById("qb-alert-text");
    var backBtn = document.getElementById("qb-back");
    var nextBtn = document.getElementById("qb-next");
    var shell = form.querySelector(".qb-shell");
    var dateInput = document.getElementById("field-date");
    var dateReadout = document.getElementById("date-readout");
    var cityInput = document.getElementById("cityZip");
    var cityNote = document.getElementById("city-message");
    var startInput = document.getElementById("startTime");
    var hoursInput = document.getElementById("serviceHours");
    var hoursReadout = document.getElementById("hours-readout");
    var hoursUnsure = form.querySelector('input[name="serviceHoursUnsure"]');
    var endTime = document.getElementById("end-time");
    var guestsInput = document.getElementById("field-guests");
    var guestNote = document.getElementById("guest-note");
    var guestEstimateNote = document.getElementById("guest-estimate");
    var hoursBubble = document.getElementById("hours-bubble");
    var packageNote = document.getElementById("package-note");
    var headlineInput = document.getElementById("headlineCocktail");
    var headlineText = document.getElementById("qb-headline-text");
    var headlineLink = document.getElementById("qb-headline-link");
    var receipt = document.getElementById("qb-receipt");
    var packageSource = "auto";
    var locationSource = "";
    var guestEstimate = false;
    var currentStep = 1;

    var missingCopy = {
      eventType: "Choose what you're celebrating.",
      eventDate: "Add the event date.",
      cityZip: "Add your city or ZIP.",
      startTime: "Choose when the bar opens.",
      guests: "Add the guest count.",
      packageInterest: "Choose a package.",
      name: "Add your name.",
      email: "Add a valid email.",
      phone: "Add your phone number.",
      contactPreference: "Choose how we should reach you."
    };

    function selected(name) {
      var el = form.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : "";
    }

    function quotedValue(value) {
      return String(value).replace(/"/g, '\\"');
    }

    function setPct(input) {
      if (!input) return;
      var min = Number(input.min);
      var max = Number(input.max);
      var value = Number(input.value);
      var pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
      input.style.setProperty("--pct", pct + "%");
      if (input.parentElement && input.parentElement.classList.contains("qb-range")) {
        input.parentElement.style.setProperty("--pct", pct + "%");
      }
    }

    function showAlert(message) {
      if (!alertBox || !alertText) return;
      alertText.textContent = message || "";
      alertBox.hidden = !message;
    }

    function firstInvalid(stepEl) {
      var fields = stepEl.querySelectorAll("input, select, textarea");
      var seen = {};
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        if (!field.name || field.disabled || field.type === "hidden") continue;
        if (seen[field.name]) continue;
        seen[field.name] = true;
        if (!field.checkValidity()) return field;
      }
      return null;
    }

    function showStep(number, opts) {
      opts = opts || {};
      var nextIndex = Math.max(1, Math.min(steps.length, number));
      var incoming = steps[nextIndex - 1];
      steps.forEach(function (step) {
        if (step === incoming) return;
        if (step.classList.contains("is-current")) {
          step.classList.remove("is-current");
          step.classList.add("is-leaving");
          window.setTimeout(function () { step.classList.remove("is-leaving"); }, 240);
        }
      });
      incoming.classList.remove("is-leaving");
      if (opts.user) {
        incoming.classList.add("is-incoming");
        window.requestAnimationFrame(function () {
          incoming.classList.remove("is-incoming");
          incoming.classList.add("is-current");
        });
      } else {
        incoming.classList.add("is-current");
      }
      currentStep = nextIndex;
      form.classList.toggle("is-first", nextIndex === 1);
      form.classList.toggle("is-last", nextIndex === steps.length);
      if (progressFill) progressFill.style.transform = "scaleX(" + (nextIndex / steps.length) + ")";
      var stepEl = steps[nextIndex - 1];
      var label = stepEl.getAttribute("data-label") || "";
      var name = stepEl.getAttribute("data-name") || "";
      if (progressCurrent) progressCurrent.textContent = "Step " + nextIndex + " of " + steps.length;
      if (announce) announce.textContent = "Step " + nextIndex + " of " + steps.length + ": " + label;
      if (opts.user) {
        var legend = stepEl.querySelector(".wz-legend");
        if (legend) legend.focus();
        if (shell && shell.scrollIntoView) shell.scrollIntoView({ block: "start" });
      }
      if (!opts.silent && typeof gtag === "function") gtag("event", "quote_step", { step: nextIndex, name: name });
      if (nextIndex === steps.length) renderReceipt();
    }

    function validateThrough(index) {
      for (var i = 0; i <= index; i++) {
        var invalid = firstInvalid(steps[i]);
        if (!invalid) continue;
        if (i !== currentStep - 1) showStep(i + 1, { user: true, silent: true });
        if (invalid.focus) invalid.focus();
        showAlert(missingCopy[invalid.name] || "Check that field and try again.");
        return false;
      }
      showAlert("");
      return true;
    }

    function markTimeChips() {
      var value = startInput ? startInput.value : "";
      Array.prototype.forEach.call(form.querySelectorAll("[data-time]"), function (chip) {
        var on = chip.getAttribute("data-time") === value;
        chip.classList.toggle("is-selected", on);
        chip.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    function setGuests(value, keepEstimate) {
      if (!keepEstimate) guestEstimate = false;
      guestsInput.value = String(Math.min(500, Math.max(1, value)));
      refresh();
    }

    function markGuestChips() {
      var value = guestsInput ? guestsInput.value : "";
      Array.prototype.forEach.call(form.querySelectorAll("[data-guests]"), function (chip) {
        var key = chip.getAttribute("data-guests");
        var on = key === "150+" ? guestEstimate && value === "151" : key === value;
        chip.classList.toggle("is-selected", on);
        chip.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    function chooseLocation(decision) {
      locationSource = decision.source || "";
      Array.prototype.forEach.call(form.querySelectorAll('input[name="location"]'), function (radio) {
        radio.checked = !!decision.selection && radio.value === decision.selection;
      });
    }

    function priceLine(value) {
      if (!value) return "";
      var card = form.querySelector('input[name="packageInterest"][value="' + quotedValue(value) + '"]');
      if (!card) return "";
      var amount = card.getAttribute("data-price");
      if (!amount) return "";
      if (value === "Cocktail Class") return "Starting at $" + amount + "/person";
      return "Starting at $" + formatDollars(amount);
    }

    function setHeadline(name) {
      var clean = String(name || "");
      if (headlineInput) headlineInput.value = clean;
      if (!headlineText || !headlineLink) return;
      if (clean) {
        headlineText.replaceChildren();
        headlineText.append("Your Headline Cocktail: ");
        var title = document.createElement("span");
        title.textContent = clean;
        headlineText.append(title);
        headlineText.append(". Included in every package.");
        headlineLink.textContent = "Change it";
      } else {
        headlineText.textContent = "Want to design your own Headline Cocktail first?";
        headlineLink.textContent = "Design your Headline Cocktail";
      }
    }

    function applyPackage(decision) {
      var radios = form.querySelectorAll('input[name="packageInterest"]');
      if (decision.source !== "auto") return;
      Array.prototype.forEach.call(radios, function (radio) {
        radio.checked = !!decision.selection && radio.value === decision.selection;
      });
    }

    function refresh() {
      if (dateReadout) dateReadout.textContent = dateInput && dateInput.value ? formatDateLabel(dateInput.value, "long") : "";
      if (cityNote) cityNote.textContent = cityMessage(cityInput ? cityInput.value : "");
      markTimeChips();
      var unsure = !!(hoursUnsure && hoursUnsure.checked);
      if (hoursInput) {
        hoursInput.disabled = unsure;
        setPct(hoursInput);
      }
      if (hoursReadout) hoursReadout.textContent = unsure ? "Not sure yet" : (hoursInput ? hoursInput.value + " hours" : "");
      if (hoursBubble) {
        hoursBubble.hidden = unsure;
        hoursBubble.textContent = (hoursInput ? hoursInput.value : "4") + " hrs";
      }
      if (endTime) {
        var endLabel = !unsure && hoursInput ? endTimeLabel(startInput ? startInput.value : "", hoursInput.value) : "";
        endTime.hidden = unsure || !endLabel;
        endTime.textContent = unsure ? "" : endLabel;
      }
      var guestCount = guestsInput && guestsInput.value !== "" ? Number(guestsInput.value) : NaN;
      if (guestNote) {
        guestNote.textContent = Number.isFinite(guestCount) && guestCount > 150
          ? "Over 150 guests is a custom quote. We'll build it with you."
          : "";
      }
      if (guestEstimateNote) guestEstimateNote.textContent = guestEstimate ? "Enter your best estimate." : "";
      markGuestChips();
      var hoursValue = hoursInput ? Number(hoursInput.value) : NaN;
      var recommended = recommendPackage({
        guests: guestCount,
        hours: hoursValue,
        eventType: selected("eventType"),
        hoursUnsure: unsure
      });
      var decision = decideSelection({
        current: selected("packageInterest"),
        source: packageSource,
        recommended: recommended,
        guests: guestCount,
        hours: unsure ? null : hoursValue
      });
      packageSource = decision.source;
      applyPackage(decision);
      var badgeValue = packageValue(recommended);
      Array.prototype.forEach.call(form.querySelectorAll(".wz-badge"), function (badge) {
        badge.hidden = badge.getAttribute("data-for") !== badgeValue;
      });
      if (packageNote) {
        packageNote.textContent = decision.note || recommendationSentence({
          guests: guestCount,
          hours: hoursValue,
          hoursUnsure: unsure,
          recommended: recommended
        });
      }
    }

    function receiptRow(label, value) {
      var row = document.createElement("p");
      row.className = "wz-receipt-row";
      var name = document.createElement("span");
      name.textContent = label;
      var detail = document.createElement("span");
      detail.textContent = value || "—";
      row.append(name, detail);
      return row;
    }

    function receiptGroup(title, step, rows) {
      var group = document.createElement("section");
      group.className = "wz-receipt-group";
      var head = document.createElement("div");
      head.className = "wz-receipt-head";
      var heading = document.createElement("h3");
      heading.textContent = title;
      var edit = document.createElement("button");
      edit.type = "button";
      edit.className = "qb-edit";
      edit.textContent = "Edit";
      edit.addEventListener("click", function () { showStep(step, { user: true }); });
      head.append(heading, edit);
      group.append(head);
      rows.forEach(function (row) { group.append(receiptRow(row[0], row[1])); });
      return group;
    }

    function fieldValue(id) {
      var el = document.getElementById(id);
      return el ? el.value : "";
    }

    function renderReceipt() {
      if (!receipt) return;
      var unsure = !!(hoursUnsure && hoursUnsure.checked);
      var packageName = selected("packageInterest");
      var service = unsure ? "Not sure yet" : (hoursInput ? endTimeLabel(startInput ? startInput.value : "", hoursInput.value) : "");
      receipt.replaceChildren(
        receiptGroup("Event", 1, [
          ["Celebration", selected("eventType")],
          ["Date", dateInput && dateInput.value ? formatDateLabel(dateInput.value, "long") : ""],
          ["Venue", selected("location")],
          ["City", cityInput ? cityInput.value.trim() : ""]
        ]),
        receiptGroup("Details", 2, [
          ["Bar opens", formatTimeLabel(fieldValue("startTime"))],
          ["Service", service],
          ["Guests", fieldValue("field-guests")]
        ]),
        receiptGroup("Package", 3, [
          ["Bar", packageName],
          ["Starting at", priceLine(packageName).replace(/^Starting at /, "")],
          ["Headline Cocktail", headlineInput ? headlineInput.value : ""]
        ]),
        receiptGroup("Contact", 4, [
          ["Name", fieldValue("field-name")],
          ["Email", fieldValue("field-email")],
          ["Phone", fieldValue("field-phone")],
          ["Reach you by", selected("contactPreference")],
          ["Heard about us", fieldValue("heardAbout")],
          ["Notes", fieldValue("field-notes")]
        ])
      );
    }

    function onEdit(event) {
      var target = event.target;
      if (target && target.name === "packageInterest") packageSource = "user";
      if (target && target.name === "location") locationSource = "user";
      if (target && target === guestsInput && guestsInput.value !== "151") guestEstimate = false;
      refresh();
    }

    form.classList.add("is-enhanced");
    if (dateInput) {
      var today = new Date();
      dateInput.min = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    }
    setPct(hoursInput);
    showStep(1);
    refresh();

    form.addEventListener("input", onEdit);
    form.addEventListener("change", onEdit);
    if (backBtn) backBtn.addEventListener("click", function () { showAlert(""); showStep(currentStep - 1, { user: true }); });
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        if (!validateThrough(currentStep - 1)) return;
        showStep(currentStep + 1, { user: true });
      });
    }
    var minus = document.getElementById("guests-minus");
    var plus = document.getElementById("guests-plus");
    if (minus) {
      minus.addEventListener("click", function () {
        if (!guestsInput || guestsInput.value === "") return;
        setGuests(Number(guestsInput.value) - 1);
      });
    }
    if (plus) {
      plus.addEventListener("click", function () {
        var current = !guestsInput || guestsInput.value === "" ? 9 : Number(guestsInput.value);
        setGuests((Number.isFinite(current) ? current : 9) + 1);
      });
    }
    Array.prototype.forEach.call(form.querySelectorAll("[data-time]"), function (chip) {
      chip.addEventListener("click", function () {
        if (startInput) startInput.value = chip.getAttribute("data-time");
        markTimeChips();
        refresh();
      });
    });
    Array.prototype.forEach.call(form.querySelectorAll("[data-guests]"), function (chip) {
      chip.addEventListener("click", function () {
        var key = chip.getAttribute("data-guests");
        if (key === "150+") {
          guestEstimate = true;
          setGuests(151, true);
          if (guestsInput) {
            guestsInput.focus();
            if (guestsInput.select) guestsInput.select();
          }
          return;
        }
        setGuests(Number(key));
      });
    });
    form.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || !form.classList.contains("is-enhanced")) return;
      var target = event.target;
      if (!target || target.tagName === "TEXTAREA" || form.classList.contains("is-last")) return;
      var type = target.type || "";
      var advances = target.tagName === "INPUT" && ["text", "number", "date", "email", "tel", "time"].indexOf(type) !== -1;
      if (!advances) return;
      event.preventDefault();
      if (!validateThrough(currentStep - 1)) return;
      showStep(currentStep + 1, { user: true });
    });
    window.addEventListener("designer:result", function (event) {
      var detail = event.detail || {};
      setHeadline(detail.name || "");
      chooseLocation(applyDesignerVenue({
        current: selected("location"),
        source: locationSource,
        incoming: detail.venue || ""
      }));
      refresh();
    });
    window.addEventListener("designer:reset", function () {
      setHeadline("");
      chooseLocation(clearDesignerVenue({
        current: selected("location"),
        source: locationSource
      }));
      refresh();
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startQuoteBuilder);
  else startQuoteBuilder();
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    recommendPackage: recommendPackage,
    endTimeLabel: endTimeLabel,
    matchCoveredCity: matchCoveredCity,
    cityMessage: cityMessage,
    formatDateLabel: formatDateLabel,
    formatTimeLabel: formatTimeLabel,
    decideSelection: decideSelection,
    applyDesignerVenue: applyDesignerVenue,
    clearDesignerVenue: clearDesignerVenue,
    recommendationSentence: recommendationSentence,
    coveredCities: COVERED_CITIES
  };
}
