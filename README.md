# Heftology

Marketing site for **Heftology — Hefta Crafted Cocktails**: mobile mixologists and private bartending in Tampa Bay (static HTML/CSS).

**Repository:** [github.com/heftizzle/heftology](https://github.com/heftizzle/heftology)

## Contents

| File | Purpose |
|------|---------|
| `index.html` | Page structure, copy, and meta/OG tags |
| `styles.css` | Layout, typography, and theme |
| `netlify.toml` | Netlify publish config (`publish = "."`) |

## Local preview

Open `index.html` in a browser, or from this folder run any static file server, for example:

```bash
npx serve .
```

## Deploy

Connect this repo to [Netlify](https://www.netlify.com/) or drag the project folder into Netlify. The site root is the repository root (see `netlify.toml`).

After the production domain is live, update absolute URLs in `index.html` (`canonical`, `og:url`, `og:image`, `twitter:image`) if they differ from [heftology.com](https://www.heftology.com/).
