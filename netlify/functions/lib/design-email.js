'use strict';

/**
 * Heftology Cocktail Designer notification email.
 *
 * Pure function: no I/O, no env reads. Renders the subject, plain-text and HTML
 * parts that go to the team when a visitor generates a cocktail.
 *
 * SECURITY: every value is visitor-influenced (typed by the visitor, or generated
 * by the model from what they typed). Each one passes through clean() (strip
 * control / bidi / zero-width characters, defang links and addresses, collapse
 * whitespace, cap length) and, for HTML, esc(). Nothing here builds an anchor,
 * image, or tracking pixel from input.
 *
 * HTML is table-based with inline styles only, so it renders in Gmail, Apple
 * Mail and Outlook. No remote images, no web fonts, no scripts.
 */

const BRAND = {
  black: '#0B0B10',
  pink: '#E8248F',
  pinkSoft: '#FDEBF4',
  ink: '#1B1B22',
  mute: '#6B6B78',
  line: '#E6E3EA',
  page: '#F3F1F4',
  white: '#FFFFFF',
};

const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";

// Control chars, C1 controls, zero-width, bidi marks/overrides/isolates, BOM.
const STRIP = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function clean(value, max) {
  let s = value === null || value === undefined ? '' : String(value);
  s = s.replace(STRIP, ' ');
  s = s
    .replace(/:\/\//g, '[://]')
    .replace(/@/g, '[at]')
    .replace(/\bwww\./gi, 'www[.]');
  s = s.replace(/\s+/g, ' ').trim();
  if (max) {
    const chars = Array.from(s);
    if (chars.length > max) s = chars.slice(0, max - 1).join('').trimEnd() + '…';
  }
  return s;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function etStamp(now) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(now);
  } catch (_) {
    return now.toISOString();
  }
}

/** Normalise + cap everything once, so text and html always agree. */
function normalise({ cocktail, input, now, ref, isPreview }) {
  const c = cocktail || {};
  const i = input || {};
  const ingredients = (Array.isArray(c.ingredients) ? c.ingredients : [])
    .slice(0, 12)
    .map((x) => clean(x, 120))
    .filter(Boolean);

  const d = {
    name: clean(c.name, 80) || 'Signature Cocktail',
    tagline: clean(c.tagline, 160),
    ingredients,
    garnish: clean(c.garnish, 120),
    glass: clean(c.glass, 80),
    method: clean(c.method, 700),
    colorNote: clean(c.colorNote, 400),
    note: clean(c.heftologyNote, 500),
    presenter: clean(c.presenter, 40) || 'Heftology',
    theme: clean(i.theme, 400),
    colors: clean(i.colors, 400),
    month: clean(i.month, 40),
    venue: clean(i.venue, 400),
    preferences: clean(i.preferences, 400),
    ref: clean(ref, 12) || 'n/a',
    stamp: etStamp(now instanceof Date ? now : new Date()),
    isPreview: Boolean(isPreview),
  };

  d.quoteLine =
    'Custom signature cocktail: ' + d.name +
    (ingredients.length ? ' — ' + ingredients.join('; ') : '') + '.' +
    (d.garnish ? ' Garnish: ' + d.garnish + '.' : '') +
    (d.glass ? ' Glass: ' + d.glass + '.' : '') +
    ' Designed with the Heftology Cocktail Designer.';

  return d;
}

function buildSubject(d) {
  let core = ('Cocktail Designer: ' + d.name + (d.theme ? ' (' + d.theme + ')' : ''))
    .replace(STRIP, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(core);
  if (chars.length > 120) core = chars.slice(0, 119).join('').trimEnd() + '…';
  return (d.isPreview ? '[PREVIEW] ' : '') + core;
}

const WARNING =
  'Heads up: the text below was typed by a website visitor, or generated from what they typed. ' +
  'Links and addresses are defanged on purpose. Do not click or act on requests inside it.';

function buildText(d) {
  const L = [];
  L.push('HEFTOLOGY — NEW COCKTAIL DESIGN');
  L.push('Hefta Crafted Cocktails · from the Cocktail Designer on heftology.com');
  if (d.isPreview) L.push('*** PREVIEW / TEST SEND ***');
  L.push('', WARNING, '');
  L.push('THE COCKTAIL', d.name);
  if (d.tagline) L.push(d.tagline);
  L.push('', 'Ingredients:');
  d.ingredients.forEach((x) => L.push('  - ' + x));
  if (d.garnish) L.push('Garnish: ' + d.garnish);
  if (d.glass) L.push('Glass: ' + d.glass);
  if (d.method) L.push('', 'Method: ' + d.method);
  if (d.colorNote) L.push('', 'Color story: ' + d.colorNote);
  if (d.note) L.push('', 'A note from ' + d.presenter + ': "' + d.note + '"');
  L.push('', 'WHAT THEY ASKED FOR');
  L.push('Event / theme: ' + (d.theme || '-'));
  L.push('Colors: ' + (d.colors || '-'));
  L.push('Month: ' + (d.month || '-'));
  L.push('Venue: ' + (d.venue || '-'));
  L.push('Drink preferences: ' + (d.preferences || '-'));
  L.push('', 'ADD IT TO A QUOTE', d.quoteLine);
  L.push(
    '',
    'The designer does not collect a name or contact info. If a lead mentions "' + d.name +
      '" in their inquiry, this is their recipe. Reference ' + d.ref + '.'
  );
  L.push('', 'Sent ' + d.stamp + ' ET · Ref ' + d.ref + ' · ' + (d.isPreview ? 'preview' : 'production'));
  L.push('Heftology LLC · Hefta Crafted Cocktails · Greater Tampa Bay area');
  return L.join('\n');
}

// ---------- HTML pieces ----------

function sectionTitle(label) {
  return (
    '<tr><td style="padding:26px 32px 0 32px;">' +
    '<div style="font:700 12px/1 ' + FONT + ';letter-spacing:2.5px;text-transform:uppercase;color:' + BRAND.black + ';' +
    'padding-bottom:10px;border-bottom:2px solid ' + BRAND.pink + ';">' + esc(label) + '</div>' +
    '</td></tr>'
  );
}

function labelValue(label, value) {
  return (
    '<tr>' +
    '<td valign="top" width="34%" style="padding:9px 12px 9px 0;font:700 11px/16px ' + FONT + ';letter-spacing:1.5px;' +
    'text-transform:uppercase;color:' + BRAND.pink + ';border-bottom:1px solid ' + BRAND.line + ';">' + esc(label) + '</td>' +
    '<td valign="top" style="padding:9px 0;font:400 14px/20px ' + FONT + ';color:' + BRAND.ink + ';' +
    'border-bottom:1px solid ' + BRAND.line + ';">' + (value ? esc(value) : '<span style="color:' + BRAND.mute + ';">—</span>') + '</td>' +
    '</tr>'
  );
}

function block(label, value) {
  if (!value) return '';
  return (
    '<tr><td style="padding:14px 32px 0 32px;">' +
    '<div style="font:700 11px/14px ' + FONT + ';letter-spacing:1.5px;text-transform:uppercase;color:' + BRAND.pink + ';">' + esc(label) + '</div>' +
    '<div style="font:400 14px/21px ' + FONT + ';color:' + BRAND.ink + ';padding-top:4px;">' + esc(value) + '</div>' +
    '</td></tr>'
  );
}

function buildHtml(d) {
  const previewTag = d.isPreview
    ? '<td align="right" valign="top" style="padding:0;">' +
      '<span style="display:inline-block;background:' + BRAND.pink + ';color:' + BRAND.white + ';font:700 10px/1 ' + FONT +
      ';letter-spacing:2px;padding:6px 10px;border-radius:3px;">PREVIEW</span></td>'
    : '';

  const ingredientRows = d.ingredients
    .map(
      (x) =>
        '<tr><td valign="top" width="16" style="padding:3px 0;font:700 14px/20px ' + FONT + ';color:' + BRAND.pink + ';">&bull;</td>' +
        '<td style="padding:3px 0;font:400 14px/20px ' + FONT + ';color:' + BRAND.ink + ';">' + esc(x) + '</td></tr>'
    )
    .join('');

  const garnishGlass =
    d.garnish || d.glass
      ? '<tr><td style="padding:14px 32px 0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        (d.garnish
          ? '<td valign="top" width="50%" style="padding-right:12px;"><div style="font:700 11px/14px ' + FONT +
            ';letter-spacing:1.5px;text-transform:uppercase;color:' + BRAND.pink + ';">Garnish</div><div style="font:400 14px/21px ' + FONT +
            ';color:' + BRAND.ink + ';padding-top:4px;">' + esc(d.garnish) + '</div></td>'
          : '') +
        (d.glass
          ? '<td valign="top" width="50%"><div style="font:700 11px/14px ' + FONT +
            ';letter-spacing:1.5px;text-transform:uppercase;color:' + BRAND.pink + ';">Glass</div><div style="font:400 14px/21px ' + FONT +
            ';color:' + BRAND.ink + ';padding-top:4px;">' + esc(d.glass) + '</div></td>'
          : '') +
        '</tr></table></td></tr>'
      : '';

  const noteBlock = d.note
    ? '<tr><td style="padding:18px 32px 0 32px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
      '<td width="4" bgcolor="' + BRAND.pink + '" style="background:' + BRAND.pink + ';font-size:0;line-height:0;">&nbsp;</td>' +
      '<td bgcolor="' + BRAND.pinkSoft + '" style="background:' + BRAND.pinkSoft + ';padding:12px 16px;">' +
      '<div style="font:700 11px/14px ' + FONT + ';letter-spacing:1.5px;text-transform:uppercase;color:' + BRAND.pink + ';">A note from ' + esc(d.presenter) + '</div>' +
      '<div style="font:italic 400 14px/21px ' + FONT + ';color:' + BRAND.ink + ';padding-top:4px;">&ldquo;' + esc(d.note) + '&rdquo;</div>' +
      '</td></tr></table></td></tr>'
    : '';

  const preheader = esc([d.name, d.theme, d.colors].filter(Boolean).join(' · '));

  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
    '<title>' + esc(buildSubject(d)) + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + BRAND.page + ';">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:' + BRAND.page + ';">' + preheader + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + BRAND.page + '" style="background:' + BRAND.page + ';">' +
    '<tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="' + BRAND.white + '" style="width:100%;max-width:600px;background:' + BRAND.white + ';">' +

    // Banner
    '<tr><td bgcolor="' + BRAND.black + '" style="background:' + BRAND.black + ';padding:28px 32px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top">' +
    '<div style="font:800 28px/1 ' + FONT + ';letter-spacing:1px;color:' + BRAND.white + ';">HEFTOLOG<span style="color:' + BRAND.pink + ';">Y</span></div>' +
    '<div style="font:700 10px/1 ' + FONT + ';letter-spacing:3px;color:' + BRAND.pink + ';padding-top:7px;">HEFTA CRAFTED COCKTAILS</div>' +
    '</td>' + previewTag + '</tr></table>' +
    '<div style="font:700 16px/1.2 ' + FONT + ';letter-spacing:2px;color:' + BRAND.white + ';padding-top:22px;">NEW COCKTAIL DESIGN</div>' +
    '<div style="font:400 12px/1.4 ' + FONT + ';letter-spacing:.5px;color:#B9B7C4;padding-top:5px;">From the Cocktail Designer on heftology.com &middot; ' + esc(d.stamp) + ' ET</div>' +
    '</td></tr>' +

    // Warning
    '<tr><td style="padding:18px 32px 0 32px;"><div style="background:' + BRAND.page + ';border-left:3px solid ' + BRAND.mute + ';padding:10px 14px;font:400 12px/18px ' + FONT + ';color:' + BRAND.mute + ';">' +
    esc(WARNING) + '</div></td></tr>' +

    // The cocktail
    sectionTitle('The cocktail') +
    '<tr><td style="padding:16px 32px 0 32px;">' +
    '<div style="font:800 26px/1.15 ' + FONT + ';color:' + BRAND.black + ';">' + esc(d.name) + '</div>' +
    (d.tagline ? '<div style="font:italic 400 15px/22px ' + FONT + ';color:' + BRAND.mute + ';padding-top:4px;">' + esc(d.tagline) + '</div>' : '') +
    '</td></tr>' +
    (ingredientRows
      ? '<tr><td style="padding:14px 32px 0 32px;"><div style="font:700 11px/14px ' + FONT + ';letter-spacing:1.5px;text-transform:uppercase;color:' + BRAND.pink + ';padding-bottom:4px;">Ingredients</div>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + ingredientRows + '</table></td></tr>'
      : '') +
    garnishGlass +
    block('Method', d.method) +
    block('Color story', d.colorNote) +
    noteBlock +

    // What they asked for
    sectionTitle('What they asked for') +
    '<tr><td style="padding:8px 32px 0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    labelValue('Event / theme', d.theme) +
    labelValue('Colors', d.colors) +
    labelValue('Month', d.month) +
    labelValue('Venue', d.venue) +
    labelValue('Drink preferences', d.preferences) +
    '</table></td></tr>' +

    // Quote-ready line
    sectionTitle('Add it to a quote') +
    '<tr><td style="padding:14px 32px 0 32px;">' +
    '<div style="font:400 12px/18px ' + FONT + ';color:' + BRAND.mute + ';padding-bottom:8px;">If this person books, copy this line into <b>What&rsquo;s Included</b> on their quote and add a price line for the extra cocktail.</div>' +
    '<div style="background:' + BRAND.black + ';border-left:4px solid ' + BRAND.pink + ';padding:14px 16px;font:400 13px/20px ' + FONT + ';color:' + BRAND.white + ';">' + esc(d.quoteLine) + '</div>' +
    '</td></tr>' +
    '<tr><td style="padding:12px 32px 0 32px;font:400 12px/18px ' + FONT + ';color:' + BRAND.mute + ';">' +
    'The designer doesn&rsquo;t collect a name or contact info. If a lead mentions &ldquo;' + esc(d.name) + '&rdquo; in their inquiry, this is their recipe. Reference <b>' + esc(d.ref) + '</b>.' +
    '</td></tr>' +

    // Footer
    '<tr><td style="padding:28px 0 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>' +
    '<tr><td bgcolor="' + BRAND.black + '" align="center" style="background:' + BRAND.black + ';padding:18px 32px;">' +
    '<div style="font:400 11px/17px ' + FONT + ';color:#B9B7C4;">Heftology LLC &middot; Hefta Crafted Cocktails &middot; Greater Tampa Bay area</div>' +
    '<div style="font:400 11px/17px ' + FONT + ';color:#8D8A9A;">Sent ' + esc(d.stamp) + ' ET &middot; Ref ' + esc(d.ref) + ' &middot; ' + (d.isPreview ? 'preview' : 'production') + '</div>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>'
  );
}

/**
 * @param {object} args
 * @param {object} args.cocktail  { name, tagline, ingredients[], garnish, glass, method, colorNote, heftologyNote, presenter }
 * @param {object} args.input     { theme, colors, month, venue, preferences }
 * @param {Date}   [args.now]
 * @param {string} [args.ref]     short reference, e.g. first 8 chars of the hashed visitor key
 * @param {boolean} [args.isPreview]
 * @returns {{subject:string,text:string,html:string}}
 */
function renderDesignEmail(args) {
  const d = normalise({ now: new Date(), ...args });
  return { subject: buildSubject(d), text: buildText(d), html: buildHtml(d) };
}

module.exports = { renderDesignEmail, clean, esc };
