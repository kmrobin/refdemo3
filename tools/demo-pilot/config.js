/*
 * Extension-wide constants for the DA Demo Pilot library plugin.
 */

// Scraper backend — LiveDemos split into two hosts since the original UE
// extension was built: a scraper host (URL-scrape/import, used here) and a
// separate platform host for per-workspace asset storage (not used by this
// plugin — texts persistence goes through DA's own Source API instead, see
// lib/textStorage.js). Confirmed against a sibling team's working UE
// extension update — the `-stage` host was stale/misconfigured for
// cross-origin callers, which is what caused CORS+401 during local testing.
export const LIVEDEMOS_BASE_URL = 'https://livedemos-scraper.adobe.io';
export const LIVEDEMOS_ASSETS_PATH = '/api/assets';

// Deployed Adobe I/O Runtime action URLs — the only two backend actions kept
// from the UE extension (both operate on the AEM Assets HTTP API, not
// CRX/JCR, so they carry over unchanged). Fill these in after `aio app deploy`.
export const UPLOAD_TO_DAM_ACTION_URL = '';
export const ENSURE_IMPORT_FOLDER_ACTION_URL = '';

// DA Admin API origin (Source / List APIs).
export const DA_ADMIN_ORIGIN = 'https://admin.da.live';

// EDS admin API origin (preview/live publish) for the single shared theme.json.
export const EDS_ADMIN_ORIGIN = 'https://admin.hlx.page';

// Canonical site-wide theme file + saved-theme library folder — see
// lib/theme.js. Both are plain DA sheets, no Content Fragments involved.
export const THEME_PATH = '/theme.json';
export const THEMES_FOLDER = '/themes';

// Scraped-texts cache — a plain JSON doc under a hidden project folder
// (mirrors the old /var/text-storage/{slug} JCR node, minus JCR).
export const TEXTS_PATH = '/.da/demo-pilot/texts.json';
