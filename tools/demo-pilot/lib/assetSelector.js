/*
 * assetSelector — mounts Adobe's official AEM Assets Selector widget (loaded
 * from Adobe's CDN, no npm equivalent) so authors can browse the whole
 * imported-assets DAM folder, not just this session's scraped images. Ported
 * from the UE extension's ImagesTab.js — same widget, same options.
 *
 * We reuse the Selector MFE directly rather than DA's own built-in "Library →
 * AEM Assets" picker: DA's plugin SDK (sendText/sendHTML/closeLibrary) has no
 * documented API for a plugin to open that native picker and receive its
 * selection back, so there's no supported reuse path found — embedding the
 * Selector ourselves is the documented fallback for that case.
 */

const ASSET_SELECTOR_SRC =
  'https://experience.adobe.com/solutions/CQ-assets-selectors/static-assets/resources/assets-selectors.js';

// Cache the load promise at module scope — mounting/remounting the selector
// (e.g. when its inputs change) must not re-inject the script tag or race
// multiple concurrent loads.
let scriptPromise = null;

function loadAssetSelectorScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.PureJSSelectors) return Promise.resolve(window.PureJSSelectors);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${ASSET_SELECTOR_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.PureJSSelectors));
      existing.addEventListener('error', () => reject(new Error('Failed to load the AEM Asset Selector script.')));
      if (window.PureJSSelectors) resolve(window.PureJSSelectors);
      return;
    }
    const script = document.createElement('script');
    script.src = ASSET_SELECTOR_SRC;
    script.async = true;
    script.onload = () => resolve(window.PureJSSelectors);
    script.onerror = () => reject(new Error('Failed to load the AEM Asset Selector script.'));
    document.head.appendChild(script);
  }).catch((err) => { scriptPromise = null; throw err; }); // let a failed load be retried later

  return scriptPromise;
}

function isDirectoryAsset(asset) {
  if (!asset) return true;
  if (asset['repo:assetClass'] === 'directory') return true;
  if (asset['dc:format'] === 'application/vnd.adobecloud.directory+json') return true;
  return false;
}

/**
 * Normalize a selector asset object into a stable shape, preserving the full
 * raw response — selector versions/repositories vary in which field names
 * they use (repo:* vs plain), and callers may need fields beyond path later
 * (Dynamic Media, renditions, delivery URLs) that we don't use today.
 */
export function normalizeSelectedAsset(asset) {
  return {
    id: asset?.['repo:assetId'] ?? asset?.['repo:id'] ?? asset?.id ?? null,
    name: asset?.['repo:name'] ?? asset?.name ?? null,
    path: asset?.['repo:path'] ?? asset?.path ?? null,
    repositoryId: asset?.['repo:repositoryId'] ?? asset?.repositoryId ?? null,
    mimeType: asset?.['dc:format'] ?? asset?.mimetype ?? asset?.format ?? null,
    url: asset?.url ?? asset?.['repo:url'] ?? null,
    thumbnailUrl: asset?.thumbnailUrl ?? asset?.['thumbnail-url'] ?? null,
    raw: asset,
  };
}

/** `https://author-p123-e456.adobeaemcloud.com` -> `author-p123-e456.adobeaemcloud.com`. */
export function repositoryIdFromAuthorUrl(authorUrl) {
  if (!authorUrl) return '';
  try { return new URL(authorUrl).host; } catch (_) { return authorUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, ''); }
}

/**
 * @param {HTMLElement} mount
 * @param {object} opts
 * @param {string} opts.imsToken
 * @param {string} opts.imsOrg
 * @param {string} opts.repositoryId
 * @param {string} [opts.apiKey]        IMS Client ID for the Asset Selector's
 *                                      own API calls — separate from the DA
 *                                      plugin's own IMS token/audience. See
 *                                      config.js AEM_ASSET_SELECTOR_API_KEY.
 *                                      NOT confirmed to actually be required
 *                                      when using a DA-issued imsToken (DA's
 *                                      own native AEM Assets picker needs no
 *                                      such config from site admins) — passed
 *                                      through if set, but not required.
 * @param {string} opts.path            DAM folder to browse
 * @param {(selection: ReturnType<typeof normalizeSelectedAsset>) => void} opts.onAssetPick
 */
export async function mountAssetSelector(mount, { imsToken, imsOrg, repositoryId, apiKey, path, onAssetPick }) {
  // Pre-flight config check — only the two values we know for certain the
  // widget needs. apiKey is passed through when present but NOT required
  // here: whether it's actually needed alongside a DA-issued imsToken is
  // unconfirmed, so we let the real widget/Adobe API be the judge of that
  // instead of guessing and blocking before ever trying.
  const missing = [];
  if (!repositoryId) missing.push('aem.repositoryId (DA site config)');
  if (!imsToken) missing.push('IMS token');
  if (missing.length) {
    throw new Error(`AEM Assets is not configured for this DA site \u2014 missing: ${missing.join(', ')}.`);
  }

  const PJS = await loadAssetSelectorScript();
  if (!PJS || typeof PJS.renderAssetSelector !== 'function') {
    throw new Error('The AEM Assets picker could not be loaded. Check your network connection or contact your administrator.');
  }
  mount.innerHTML = '';
  const pick = (asset) => {
    if (isDirectoryAsset(asset)) return; // not an error — browsing into a folder, not a selection
    const selection = normalizeSelectedAsset(asset);
    if (selection.path && typeof onAssetPick === 'function') onAssetPick(selection);
  };
  PJS.renderAssetSelector(mount, {
    imsToken,
    imsOrg,
    ...(apiKey ? { apiKey } : {}),
    repositoryId,
    path,
    rail: true,
    noWrap: true,
    aemTierType: 'author',
    colorScheme: 'light',
    hideTreeNav: true,
    hideFiltersButton: true,
    selectionType: 'single',
    // Explicit featureSet replaces the defaults rather than adding to them —
    // omitting any of these disables that capability outright rather than
    // just leaving it at some default.
    featureSet: ['upload', 'collections', 'detail-panel'],
    acvConfig: { selectionType: 'single' },
    // handleAssetSelection tracks selection changes and is the documented
    // callback for an inline/rail (noWrap: true) experience like ours —
    // handleSelection is for modal "confirm" flows we don't use here.
    handleAssetSelection: (assets) => pick(assets && assets[0]),
    handleNavigateToAsset: (asset) => pick(asset),
  });

  // The widget's iframe can size itself off an early, pre-final-layout
  // measurement of the mount (e.g. mid tab-switch/flex reflow), leaving it
  // shorter than the space it's actually given. Nudge it to remeasure once
  // our own layout has settled, without looping.
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
}
