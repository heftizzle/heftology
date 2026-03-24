# Heftology

Public marketing site for **Heftology — Hefta Crafted Cocktails**: mobile mixologists and private bartending in the Tampa Bay area. The site is intentionally **static** (HTML, CSS, and a small amount of inline JavaScript) so it stays fast, cheap to host, and easy to edit without a build step for the front end.

**Live repository:** [github.com/heftizzle/heftology](https://github.com/heftizzle/heftology)

**Production domain:** [heftology.com](https://www.heftology.com/) (canonical and social meta tags in `index.html` assume `https://www.heftology.com/`).

### Service area (copy alignment)

Heftology serves the **greater Tampa Bay area**. Marketing copy in `index.html` and the chat assistant system prompt in `netlify/functions/chat.js` should stay aligned. Covered locations include Tampa, St. Pete, Clearwater, Dunedin, Safety Harbor, Brandon, Riverview, Valrico, Wesley Chapel, Zephyrhills, Spring Hill, Brooksville, New Port Richey, Tarpon Springs, Sarasota, Bradenton, Lakeland, and surrounding communities.

**Always outside service area** (impractical real-world drive times, regardless of map distance): Orlando, Ocala, Port Charlotte, and anywhere further — politely decline and wish them well finding a local bartender.

**City not on either list:** hand off to **carissa@heftology.com** — Carissa decides edge cases.

---

## What this project includes

- **Landing page** (`index.html`) — hero, service tiers, team photos, cocktail menu, about, and a **Netlify Forms** booking form that POSTs to Netlify and redirects to a thank-you page.
- **Thank-you page** (`thank-you.html`) — confirmation after a form submission, `noindex` for search engines, and a GA4 **booking_form_submit** event (swap in your real Measurement ID).
- **Styles** (`styles.css`) — layout, typography, responsive nav, chat widget, and section styling.
- **Chat assistant** — browser UI talks to **`/.netlify/functions/chat`**, a Netlify Function that calls the **Anthropic** API. The API key never ships to the client; it lives only in Netlify environment variables.
- **SEO basics** — `robots.txt` (including `Disallow` for the thank-you URL) and `sitemap.xml` (homepage only). Submit the sitemap URL in Google Search Console when the site is verified.

---

## Repository layout

| Path | Role |
|------|------|
| `index.html` | Main page: content, meta/OG/Twitter tags, GA4 snippet (placeholder ID), form, chat UI + client script |
| `thank-you.html` | Post-form confirmation; GA4 conversion event |
| `styles.css` | All visual styling |
| `images/` | Photo assets (PNG/JPG referenced from `index.html`) |
| `netlify.toml` | Publish root, functions directory, security headers |
| `netlify/functions/chat.js` | Serverless chat handler (Anthropic Messages API) |
| `netlify/functions/package.json` | Function dependencies (`@anthropic-ai/sdk`) for Netlify’s bundler |
| `package.json` | Root metadata / optional tooling; Netlify installs function deps from `netlify/functions/package.json` |
| `robots.txt` | Crawl rules + sitemap URL |
| `sitemap.xml` | URL list for search engines |
| `LICENSE` | Legal terms: proprietary, all rights reserved (Heftology LLC) |
| `README.md` | This file — setup, deploy, and project overview |

---

## Local preview

You can open `index.html` directly in a browser. Some features behave differently offline:

- **Netlify Forms** only process submissions on Netlify (or with Netlify CLI).
- **Chat** only works where **`/.netlify/functions/chat`** is deployed and `ANTHROPIC_API_KEY` is set.

For a simple local server (static files only):

```bash
npx serve .
```

---

## Deploying on Netlify

1. Connect this Git repository to a Netlify site (or link the repo in the Netlify UI).
2. Build settings are driven by **`netlify.toml`**: publish directory is **`.`**, functions live in **`netlify/functions`**.
3. Under **Site settings → Environment variables**, add:
   - **`ANTHROPIC_API_KEY`** — required for the chat function.
   - **`CLAUDE_MODEL`** (optional) — overrides the default model string in `chat.js` if you want a different Claude model later.
4. After the first deploy, open **Forms** in the Netlify UI and confirm the **booking** form is detected (it must appear in the deployed HTML with the `netlify` attribute and `form-name` hidden field).
5. Configure **form notifications** (email, Slack, etc.) under Netlify Forms so inquiries reach the team.

Redeploys track `main` (or whichever branch you connect). You can trigger a rebuild from the Netlify dashboard or with an empty commit if needed.

---

## Google Analytics 4

Replace every **`G-XXXXXXXXXX`** placeholder in `index.html` and `thank-you.html` with your real **Measurement ID**. The thank-you page fires **`booking_form_submit`** on load so conversions are attributed after a successful form redirect.

---

## Images

`index.html` loads photos with plain **`<img>`** tags pointing at `images/*.png` and `images/*.jpg`. Keep paths and filenames in sync with the files in `images/`. You can switch to **`<picture>`** + WebP later if you add `.webp` variants.

---

## Maintenance notes

- Keep **chat** system prompt facts in `netlify/functions/chat.js` aligned with **pricing and packages** on `index.html` so the assistant does not contradict the page.
- If you change the primary domain, update **canonical**, **Open Graph**, and **Twitter** image URLs in `index.html` to absolute URLs on that host.

---

## License

This repository is **not open source**. Terms are defined in the dedicated license file:

- **File:** [`LICENSE`](LICENSE) (repository root)
- **Holder:** **Heftology LLC**, copyright © 2026
- **Summary:** All rights reserved. No copying, distribution, or use without written permission from Heftology LLC, except as allowed by law.

The [`LICENSE`](LICENSE) file is the authoritative text. Site copy, images, and branding are part of the same proprietary work. For permission or partnership questions, use the contact options on [heftology.com](https://www.heftology.com/) (e.g. [inquiries@heftology.com](mailto:inquiries@heftology.com)).
