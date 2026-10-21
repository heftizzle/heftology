/*
 * Heftology theme loader — resolves the single active theme (rules in themes/date-rules.js)
 * and renders it into the seasonal spotlight and the Craft Menu's Rotating Seasonal card.
 * Both consumers read the same memoized getActiveTheme() promise, so they always agree.
 */
(function () {
  'use strict';

  const Rules = window.HeftDateRules;
  const THEME_DIR = 'themes/';
  const TIME_ZONE = 'America/New_York';
  let activeThemePromise = null;

  // "Today" is the Tampa calendar date; ?themeDate=YYYY-MM-DD previews any other day.
  function themeToday() {
    const override = Rules.parseISODate(new URLSearchParams(window.location.search).get('themeDate'));
    if (override) return override;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric',
    }).formatToParts(new Date());
    const part = (type) => Number(parts.find((p) => p.type === type).value);
    return Rules.makeDate(part('year'), part('month'), part('day'));
  }

  function fetchJSON(path) {
    return fetch(THEME_DIR + path).then((res) => {
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return res.json();
    });
  }

  function getActiveTheme() {
    if (!activeThemePromise) {
      activeThemePromise = fetchJSON('bundle.json')
        .then((bundle) => Rules.pickActiveTheme(bundle.themes || [], themeToday()))
        .catch((err) => {
          console.warn('[themes] Theme engine unavailable:', err.message);
          return null;
        });
    }
    return activeThemePromise;
  }

  function applyAccent(el, theme) {
    if (theme.accentColor) el.style.setProperty('--theme-accent', theme.accentColor);
  }

  function variantsText(theme) {
    return (theme.variants || []).map((v) => `${v.label}: ${v.description}`).join(' · ');
  }

  function renderSpotlight() {
    return getActiveTheme().then((theme) => {
      const section = document.getElementById('seasonal-spotlight');
      if (!section || !theme) return;
      section.querySelector('[data-theme-label]').textContent = theme.label;
      section.querySelector('[data-theme-name]').textContent = theme.drinkName;

      const desc = section.querySelector('[data-theme-desc]');
      desc.textContent = theme.drinkDescription || '';
      desc.hidden = !theme.drinkDescription;

      const list = section.querySelector('[data-theme-variants]');
      const variants = theme.variants || [];
      list.replaceChildren(
        ...variants.map((v) => {
          const row = document.createElement('div');
          const term = document.createElement('dt');
          const detail = document.createElement('dd');
          term.textContent = v.label;
          detail.textContent = v.description;
          row.append(term, detail);
          return row;
        })
      );
      list.hidden = variants.length === 0;

      applyAccent(section, theme);
      section.hidden = false;
    });
  }

  function renderMenuCard() {
    return getActiveTheme().then((theme) => {
      const card = document.getElementById('seasonal-menu-card');
      if (!card || !theme) return;
      card.querySelector('[data-theme-name]').textContent = theme.drinkName;
      card.querySelector('[data-theme-desc]').textContent = theme.drinkDescription || variantsText(theme);
      card.querySelector('[data-theme-label]').textContent = theme.label;
      applyAccent(card, theme);
      card.hidden = false;
    });
  }

  window.HeftThemes = { getActiveTheme };

  if (Rules) {
    renderSpotlight();
    renderMenuCard();
  }
})();
