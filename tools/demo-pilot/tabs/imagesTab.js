/*
 * imagesTab — scrape + upload-to-DAM + copy-to-clipboard for images.
 * Replaces the UE extension's ImagesTab.js + replaceImage.js: instead of an
 * embedded UE-selection "replace" call, picking an image just copies it to
 * the clipboard so the author can paste it into the open DA document.
 */

import { uploadAssetsInBatches } from '../lib/uploadAssets.js';
import { copyImageToClipboard } from '../lib/clipboard.js';
import { openScrapeModal } from '../lib/scrapeModal.js';
import { track, EVENTS } from '../lib/analytics.js';
import { UPLOAD_TO_DAM_ACTION_URL } from '../config.js';

export function renderImagesTab(container, ctx) {
  const { state, rerender, toast } = ctx;
  const images = state.images || [];

  container.innerHTML = `
    <div class="dp-row">
      <strong>Images</strong>
      <sl-button id="dp-images-import">Import from URL</sl-button>
    </div>
    <p class="dp-status" id="dp-images-status">${state.uploadStatus || ''}</p>
    <div class="dp-grid" id="dp-images-grid"></div>
    ${images.length === 0 ? '<p class="dp-status">No images yet. Import from a live URL to get started.</p>' : ''}
  `;

  const grid = container.querySelector('#dp-images-grid');
  for (const img of images) {
    const card = document.createElement('div');
    card.className = 'dp-card';
    card.innerHTML = `
      <img src="${img.path || img.src}" alt="" loading="lazy" />
      <sl-button class="dp-copy-btn" data-src="${img.path || img.src}">Copy</sl-button>
    `;
    grid.appendChild(card);
  }

  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.dp-copy-btn');
    if (!btn) return;
    const src = btn.getAttribute('data-src');
    btn.setAttribute('disabled', 'true');
    try {
      await copyImageToClipboard(src);
      track(EVENTS.IMAGE_COPIED);
      toast('Image copied — paste it into your document.');
    } catch (err) {
      toast((err && err.message) || 'Copy failed', true);
    } finally {
      btn.removeAttribute('disabled');
    }
  });

  container.querySelector('#dp-images-import').addEventListener('click', () => {
    openScrapeModal({
      token: ctx.token,
      mode: 'images',
      onComplete: async ({ images: scrapedImages, siteUrl }) => {
        track(EVENTS.IMPORT_STARTED);
        const urls = (scrapedImages || []).map((i) => i.src).filter(Boolean);

        // Local-dev fallback: without a deployed upload-to-dam action there's
        // nothing to upload to, so show the scraped (hot-linked) URLs
        // directly — good enough to exercise the copy-to-clipboard flow.
        // Real usage always goes through the DAM upload below.
        if (!UPLOAD_TO_DAM_ACTION_URL) {
          state.images.push(...urls.map((src) => ({ path: src })));
          toast('upload-to-dam not configured \u2014 showing scraped URLs directly (not uploaded to DAM).', true);
          track(EVENTS.IMPORT_COMPLETED);
          rerender();
          return;
        }

        state.uploadStatus = `Uploading 0/${urls.length}\u2026`;
        rerender();
        let done = 0;
        try {
          for await (const result of uploadAssetsInBatches(urls, {
            imsToken: ctx.token,
            authorUrl: ctx.authorUrl,
            orgId: ctx.orgId,
            targetFolderPath: ctx.damFolderPath,
            siteUrl,
          })) {
            done += 1;
            if (result.ok && result.path) state.images.push({ path: result.path });
            state.uploadStatus = `Uploading ${done}/${urls.length}\u2026`;
            rerender();
          }
          track(EVENTS.IMPORT_COMPLETED);
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
