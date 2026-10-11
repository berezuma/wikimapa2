# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Static single-page map of geolocated Basque Wikipedia (eu.wikipedia.org) articles. UI text and code comments are in Basque (euskara) — keep it that way. No bundler and no tests. Deployed as plain static files (GitHub repo `berezuma/wikimapa2`); the generated `css/tailwind.css` is committed so the site needs no build on deploy.

## Commands

```
python3 -m http.server 8000   # serve locally: http://localhost:8000/?lat=43.26&lon=-2.93&zoom=14
npm install                   # once, only needed for the CSS build
npm run build:css             # regenerate css/tailwind.css (Tailwind 3.4.17)
```

ES modules and the `ehmuga.json` fetch require HTTP, so opening via `file://` does not work. URL params `lat`, `lon`, `zoom` set the initial view (the share button generates them).

**Rebuild the CSS whenever you add or change a Tailwind class** in `index.html` or `js/*.js`. Tailwind only emits classes it finds there, so a new class without a rebuild silently has no style. Classes built in JS strings must stay literal (no string concatenation) so the scanner sees them.

## Architecture

- `index.html` holds the markup plus a small custom `<style>` block (ids, Leaflet popup tweaks, filter-panel slide). Leaflet 1.9.4 is loaded from unpkg (SRI-pinned) as a global `L`, then `js/app.js` is loaded as an ES module.
- `js/api.js` covers all Wikipedia/Wikidata access and has no DOM or Leaflet dependencies; bounds are passed as plain `{north, south, east, west}`. `js/app.js` covers the map, markers and UI state.
- `ehmuga.json` is the Basque Country border: an array of `[lat, lon]` pairs drawn as one `L.polygon`.
- Data sources (in `js/api.js`), all called directly from the browser with `origin=*`:
  - Wikipedia API: `geosearch` (map markers), `opensearch` (search box), `extracts|pageimages` (popup summary, cached in `summaryCache`), `coordinates`.
  - Wikidata SPARQL (`query.wikidata.org`): category filters, using the `data-category` Q-ids on the checkboxes, `P31/P279*` inside a `wikibase:box`. Only runs at zoom ≥ `MIN_FILTER_ZOOM` (12). The article title is taken from the sitelink URL, not the item label (labels often differ from titles). Titles are then resolved to `pageid`s in batches of 50.
  - Wikidata API (`wbgetclaims`/`wbgetentities`): fallback location (P19 → P740 → P276 → P131) for searched articles without coordinates. These are drawn in the separate `indirectLayer`.
- Main flow: `moveend` → 500 ms debounce → `updateMapData()`. It aborts the previous in-flight request (`AbortController`), fetches geosearch or SPARQL results, then calls `renderArticles()`. That diffs markers by `pageid` (`markersById`) instead of clearing them, and never removes a marker whose popup is open (popup autoPan triggers `moveend`).
- Geosearch limits: a bbox larger than ~400 km² returns `toobig`, and the maximum radius is 10 km. When the view is too large, `fetchGeosearchData` falls back to a 10 km circle around the center and shows a hint.
- All requests go through `fetchJson`, which throws on HTTP errors and on MediaWiki `{error}` bodies (`error.code` is preserved). Popups are built as DOM nodes with `textContent`, never HTML strings. User feedback uses `showMapMessage(text, timeout)` rather than `alert()`.
- Accessibility: the search box is an ARIA combobox (arrow keys, Enter, Escape via `handleSearchKeydown`). The filter panel is `inert` while closed; open and close it only through `openFilterPanel`/`closeFilterPanel`, which handle focus and `aria-expanded`. URL params are range-checked by `numberParam`.
- Geosearch runs on CirrusSearch, which limits concurrent searches per user. Aborted requests keep running server-side, so a quick follow-up request can get `cirrussearch-too-busy-error`. `geosearch()` retries that error with a backoff.
