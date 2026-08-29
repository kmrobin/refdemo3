/*
 * clipboard — "copy" is the entire insertion mechanic for this plugin. DA's
 * plugin SDK only exposes sendHTML/sendText for a *known-good* replace-vs-insert
 * semantic that we haven't validated against an arbitrary selection, so instead
 * we copy the picked image/text to the system clipboard and let the author
 * paste it wherever they want in the open DA document — works identically
 * whether they want to insert fresh or replace a current selection, and needs
 * zero DA SDK selection assumptions.
 */

// Clipboard image writes are commonly restricted to image/png across browsers,
// so any other source mimetype (jpg/webp/svg) is re-encoded via a canvas
// before writing.
async function toPngBlob(sourceBlob) {
  if (sourceBlob.type === 'image/png') return sourceBlob;
  const bitmap = await createImageBitmap(sourceBlob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))), 'image/png');
  });
}

/**
 * Fetch an image (DAM delivery URL) and place it on the clipboard as PNG.
 * Throws if the fetch fails, the image can't be decoded, or the browser
 * denies clipboard access (must be called from a user-gesture handler).
 */
export async function copyImageToClipboard(imageUrl) {
  // Local-debug-only escape hatch (see dev/debug.html?proxy=1): scraped
  // images not yet uploaded to DAM live on arbitrary third-party origins that
  // don't send CORS headers for a fetch(), unlike real DAM delivery URLs
  // which do. Route through the local dev proxy's generic /img passthrough
  // in that case. Inert in production — the plugin never sets this global.
  const fetchUrl = (typeof window !== 'undefined' && window.__DEMO_PILOT_IMAGE_PROXY_BASE__)
    ? `${window.__DEMO_PILOT_IMAGE_PROXY_BASE__}/img?url=${encodeURIComponent(imageUrl)}`
    : imageUrl;
  const resp = await fetch(fetchUrl);
  if (!resp.ok) throw new Error(`image fetch failed: HTTP ${resp.status}`);
  const rawBlob = await resp.blob();
  const pngBlob = await toPngBlob(rawBlob);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
}

/** Place plain text on the clipboard. */
export async function copyTextToClipboard(text) {
  await navigator.clipboard.writeText(String(text ?? ''));
}
