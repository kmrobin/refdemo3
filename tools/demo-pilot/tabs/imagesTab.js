/*
 * imagesTab — scrape + upload-to-DAM, then browse/copy via the embedded AEM
 * Assets Selector. Uploaded images land in the same DAM folder the Selector
 * browses, so — matching the original UE extension's design — the Selector
 * IS the single source of truth for "images available to use". We don't
 * keep a separate in-session thumbnail grid alongside it; that duplicated
 * what the Selector already shows and its bare-repo-path/CORS handling was
 * its own source of bugs.
 *
 * This tab builds its DOM shell once per container (see `dpBuilt` guard)
 * rather than on every render like the other tabs — re-creating the Asset
 * Selector's DOM on every upload-progress tick would tear down and reload
 * Adobe's widget repeatedly, which is expensive and visibly flickery.
 */

import { uploadAssetsInBatches } from '../lib/uploadAssets.js';
import { copyDamAssetToClipboard } from '../lib/clipboard.js';
import { openScrapeModal } from '../lib/scrapeModal.js';
import { mountAssetSelector, repositoryIdFromAuthorUrl } from '../lib/assetSelector.js';
import { track, EVENTS } from '../lib/analytics.js';
import { UPLOAD_TO_DAM_ACTION_URL } from '../config.js';

// Most SVGs a scrape turns up are decorative iconography/logos (nav icons,
// social badges, "AdChoices", etc.), not content an author wants to reuse.
// This is only a fast-path pre-filter on the URL's own extension — plenty of
// real-world image URLs carry no extension at all (dynamic/CDN-served, real
// format only known from the response), so this alone WILL miss some SVGs.
// The authoritative check is server-side in upload-to-dam (real Content-Type
// after download) — this just avoids uploading the obvious cases at all.
function isSvg(url) {
  try { return new URL(url).pathname.toLowerCase().endsWith('.svg'); } catch (_) { return /\.svg(\?|$)/i.test(url || ''); }
}

async function copyDamPath(damPath, ctx, toast) {
  try {
    await copyDamAssetToClipboard({ assetPath: damPath, authorUrl: ctx.authorUrl, orgId: ctx.orgId, token: ctx.token });
    track(EVENTS.IMAGE_COPIED);
    toast('Image copied — paste it into your document.');
  } catch (err) {
    toast((err && err.message) || 'Copy failed', true);
  }
}

export function renderImagesTab(container, ctx) {
  const { state, rerender, toast } = ctx;

  if (!container.dataset.dpBuilt) {
    container.dataset.dpBuilt = '1';
    container.innerHTML = `
      <div class="dp-row">
        <strong>Images</strong>
        <sl-button id="dp-images-import">Import from URL</sl-button>
      </div>
      <p class="dp-status" id="dp-images-status"></p>
      <p class="dp-error" id="dp-selector-error"></p>
      <div id="dp-asset-selector-mount" style="height:520px;"></div>
    `;

    container.querySelector('#dp-images-import').addEventListener('click', () => {
      if (!UPLOAD_TO_DAM_ACTION_URL) {
        toast('upload-to-dam action is not configured — cannot import images.', true);
        return;
      }
      openScrapeModal({
        token: ctx.token,
        mode: 'images',
        onComplete: async ({ images: scrapedImages, siteUrl }) => {
          track(EVENTS.IMPORT_STARTED);
          const allUrls = (scrapedImages || []).map((i) => i.src).filter(Boolean);
          const svgCount = allUrls.filter(isSvg).length;
          const urls = allUrls.filter((u) => !isSvg(u));
          if (svgCount) toast(`Skipped ${svgCount} SVG icon(s) \u2014 not imported.`);

          state.uploadStatus = `Uploading 0/${urls.length}\u2026`;
          rerender();
          let done = 0;
          let failed = 0;
          let skipped = 0;
          try {
            for await (const result of uploadAssetsInBatches(urls, {
              imsToken: ctx.token,
              authorUrl: ctx.authorUrl,
              orgId: ctx.orgId,
              targetFolderPath: ctx.damFolderPath,
              siteUrl,
            })) {
              done += 1;
              if (result.ok && result.path) {
                // Nothing to do here — the Selector below reads straight from
                // DAM and gets refreshed (see selectorRefresh) once this finishes.
              } else if (result.skipped) {
                skipped += 1;
              } else {
                failed += 1;
                // eslint-disable-next-line no-console -- surfaced count only in the status line; full reason belongs in devtools
                console.warn('[DemoPilot] upload failed:', result.sourceUrl, result.error);
              }
              state.uploadStatus = `Uploading ${done}/${urls.length}…${failed ? ` (${failed} failed)` : ''}${skipped ? ` (${skipped} SVG skipped)` : ''}`;
              rerender();
            }
            track(EVENTS.IMPORT_COMPLETED);
            // Bump the Selector's mount key so it remounts once, now, and
            // shows the freshly uploaded assets — not on every progress tick.
            state.selectorRefresh = (state.selectorRefresh || 0) + 1;
          } catch (err) {
            toast((err && err.message) || 'Upload failed', true);
          } finally {
            state.uploadStatus = '';
            rerender();
          }
        },
      });
    });
  }

  container.querySelector('#dp-images-status').textContent = state.uploadStatus || '';

  // Mount/refresh the Asset Selector only when its inputs (or selectorRefresh,
  // bumped after an import completes) actually change — not on every
  // rerender (see module doc).
  const selectorMount = container.querySelector('#dp-asset-selector-mount');
  const repositoryId = repositoryIdFromAuthorUrl(ctx.authorUrl);
  const mountKey = `${ctx.token}|${ctx.orgId}|${ctx.assetSelectorApiKey}|${repositoryId}|${ctx.damFolderPath}|${state.selectorRefresh || 0}`;
  if (selectorMount.dataset.mountKey !== mountKey && ctx.token && repositoryId && ctx.damFolderPath) {
    selectorMount.dataset.mountKey = mountKey;
    mountAssetSelector(selectorMount, {
      imsToken: ctx.token,
      imsOrg: ctx.orgId,
      apiKey: ctx.assetSelectorApiKey,
      repositoryId,
      path: ctx.damFolderPath,
      onAssetPick: (selection) => copyDamPath(selection.path, ctx, toast),
    }).catch((err) => {
      container.querySelector('#dp-selector-error').textContent = (err && err.message) || 'Could not load the AEM Asset Selector.';
    });
  }
}
