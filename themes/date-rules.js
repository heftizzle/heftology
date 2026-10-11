/*
 * Heftology theme engine — date rules
 * ===================================
 *
 * Every theme is a JSON file listed in themes/manifest.json. Its date window is
 * computed from a rule at page load for the current year, so nothing needs a
 * yearly update except the one "manual" rule (Super Bowl).
 *
 * THEME FILE FIELDS
 *   id                 unique slug, e.g. "halloween"
 *   label              short display name, e.g. "Halloween" (used as the menu tag)
 *   priority           1 = season tier, 10 = holiday tier; higher wins
 *   placeholder        true = never selected (see PLACEHOLDERS below)
 *   rule               one of the rule objects below
 *   drinkName          display name of the drink
 *   drinkDescription   one-line ingredient list / description
 *   accentColor        CSS color used only as an accent on the spotlight and menu tag
 *   variants           optional [{ "label", "description" }] for multi-version drinks
 *   _comment           optional maintainer note (JSON has no comments)
 *
 * RULES (months are 1-12, weekdays 0=Sunday ... 6=Saturday; all windows inclusive)
 *   { "rule": "fixedDate", "month": 2, "day": 14, "daysBefore": 10, "windowEndOffsetDays": 0 }
 *       Window: (date - daysBefore) through (date - windowEndOffsetDays).
 *       windowEndOffsetDays is optional (default 0 = ends on the date itself).
 *   { "rule": "nthWeekday", "month": 5, "weekday": 0, "n": 2, "daysBefore": 7 }
 *       nth weekday of the month; n = -1 means the last one. Window ends on that date.
 *   { "rule": "easterOffset", "offsetDays": -47, "daysBefore": 14 }
 *       Easter Sunday + offsetDays (-47 = Mardi Gras). Window ends on that date.
 *   { "rule": "manual", "date": "2027-02-14", "daysBefore": 7 }
 *       Hardcoded date for events with no fixed pattern (Super Bowl only). Must be
 *       updated every year; if the date is more than a year in the past the theme
 *       is skipped and a console warning is logged.
 *   { "rule": "dateRange", "startMonth": 3, "startDay": 1, "endMonth": 5, "endDay": 31 }
 *       Fixed range. endDay may be "last" for the last day of the month (leap-year safe).
 *       If the end falls before the start, the range wraps into the next year (Dec -> Jan).
 *
 * SELECTION
 *   1. Placeholder themes are removed first, so they can never be shown.
 *   2. Of the remaining themes whose window contains today, the highest priority wins.
 *   3. Ties go to whichever file is listed first in manifest.json.
 *   A console warning is logged when two selectable themes of the same priority have
 *   overlapping windows this year, so a collision never resolves silently.
 *
 * PLACEHOLDERS
 *   Holidays without a real recipe carry "placeholder": true and "drinkName": "Coming Soon".
 *   Real recipes must come from Carissa before placeholder: true is removed. Once removed,
 *   the holiday automatically overrides its season on its own dates — no code change needed.
 *
 * ADDING A THEME
 *   1. Create themes/holidays/<id>.json or themes/seasons/<id>.json with the fields above.
 *   2. Add its path to the "themes" array in themes/manifest.json (order = tie-break order).
 *   3. Preview any date with ?themeDate=YYYY-MM-DD on the homepage URL.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HeftDateRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;

  // All dates are UTC midnight so arithmetic never shifts across DST or time zones.
  function makeDate(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day));
  }

  function addDays(date, days) {
    return new Date(date.getTime() + days * DAY_MS);
  }

  function lastDayOfMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function parseISODate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m) return null;
    const d = makeDate(+m[1], +m[2], +m[3]);
    return d.getUTCMonth() + 1 === +m[2] && d.getUTCDate() === +m[3] ? d : null;
  }

  function nthWeekdayOfMonth(year, month, weekday, n) {
    if (n > 0) {
      const firstDow = makeDate(year, month, 1).getUTCDay();
      const day = 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
      return day <= lastDayOfMonth(year, month) ? makeDate(year, month, day) : null;
    }
    if (n < 0) {
      const last = lastDayOfMonth(year, month);
      const lastDow = makeDate(year, month, last).getUTCDay();
      const day = last - ((lastDow - weekday + 7) % 7) - (-n - 1) * 7;
      return day >= 1 ? makeDate(year, month, day) : null;
    }
    return null;
  }

  // Anonymous Gregorian algorithm (Meeus/Jones/Butcher), Gregorian calendar years.
  function computeEaster(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return makeDate(year, month, day);
  }

  function windowEndingOn(anchor, rule) {
    if (!anchor) return null;
    return { start: addDays(anchor, -(rule.daysBefore || 0)), end: anchor };
  }

  // The window "anchored" in a given year; for wrapping ranges the end lands in year + 1.
  function resolveWindow(rule, year) {
    if (!rule || typeof rule !== 'object') return null;
    let win = null;
    switch (rule.rule) {
      case 'fixedDate': {
        const anchor = makeDate(year, rule.month, rule.day);
        win = {
          start: addDays(anchor, -(rule.daysBefore || 0)),
          end: addDays(anchor, -(rule.windowEndOffsetDays || 0)),
        };
        break;
      }
      case 'nthWeekday':
        win = windowEndingOn(nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.n), rule);
        break;
      case 'easterOffset':
        win = windowEndingOn(addDays(computeEaster(year), rule.offsetDays || 0), rule);
        break;
      case 'manual': {
        const date = parseISODate(rule.date);
        if (date && date.getUTCFullYear() === year) win = windowEndingOn(date, rule);
        break;
      }
      case 'dateRange': {
        const wraps =
          rule.endMonth < rule.startMonth ||
          (rule.endMonth === rule.startMonth && rule.endDay !== 'last' && rule.endDay < rule.startDay);
        const endYear = wraps ? year + 1 : year;
        const endDay = rule.endDay === 'last' ? lastDayOfMonth(endYear, rule.endMonth) : rule.endDay;
        win = { start: makeDate(year, rule.startMonth, rule.startDay), end: makeDate(endYear, rule.endMonth, endDay) };
        break;
      }
      default:
        return null;
    }
    return win && win.start <= win.end ? win : null;
  }

  function inWindow(win, today) {
    return !!win && today >= win.start && today <= win.end;
  }

  // Checks windows anchored in the previous, current and next year so ranges that
  // cross Jan 1 (New Year's, Winter Early, long daysBefore) are matched either side.
  function activeWindow(rule, today) {
    const y = today.getUTCFullYear();
    for (const year of [y - 1, y, y + 1]) {
      const win = resolveWindow(rule, year);
      if (inWindow(win, today)) return win;
    }
    return null;
  }

  function isActive(rule, today) {
    return activeWindow(rule, today) !== null;
  }

  function isStaleManual(rule, today) {
    if (!rule || rule.rule !== 'manual') return false;
    const date = parseISODate(rule.date);
    return !date || today.getTime() - date.getTime() > 365 * DAY_MS;
  }

  function windowsOverlap(a, b) {
    return !!a && !!b && a.start <= b.end && b.start <= a.end;
  }

  function formatDate(d) {
    return d.toISOString().slice(0, 10);
  }

  // themes: array in manifest order (null entries allowed for files that failed to load).
  function pickActiveTheme(themes, today, warn) {
    const log = warn || ((msg) => console.warn(msg));
    const selectable = [];
    (themes || []).forEach((theme, index) => {
      if (!theme || theme.placeholder === true || !theme.rule) return;
      if (isStaleManual(theme.rule, today)) {
        log(`[themes] Skipping "${theme.id}": manual date ${theme.rule.date} is missing or more than a year old — update it.`);
        return;
      }
      selectable.push({ theme, index });
    });

    const year = today.getUTCFullYear();
    for (let i = 0; i < selectable.length; i++) {
      for (let j = i + 1; j < selectable.length; j++) {
        const a = selectable[i].theme;
        const b = selectable[j].theme;
        if (a.priority !== b.priority) continue;
        const wa = resolveWindow(a.rule, year);
        const wb = resolveWindow(b.rule, year);
        if (windowsOverlap(wa, wb)) {
          log(
            `[themes] "${a.id}" (${formatDate(wa.start)}–${formatDate(wa.end)}) and "${b.id}" ` +
              `(${formatDate(wb.start)}–${formatDate(wb.end)}) overlap at priority ${a.priority}; ` +
              `"${a.id}" wins by manifest order.`
          );
        }
      }
    }

    let best = null;
    for (const entry of selectable) {
      if (!isActive(entry.theme.rule, today)) continue;
      if (!best || (entry.theme.priority || 0) > (best.theme.priority || 0)) best = entry;
    }
    return best ? best.theme : null;
  }

  return {
    makeDate,
    addDays,
    lastDayOfMonth,
    parseISODate,
    nthWeekdayOfMonth,
    computeEaster,
    resolveWindow,
    activeWindow,
    isActive,
    isStaleManual,
    pickActiveTheme,
  };
});
