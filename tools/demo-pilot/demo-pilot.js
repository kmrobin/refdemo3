/*
 * demo-pilot — DA library plugin shell. Boots via the DA App SDK, resolves
 * IMS user email + analytics context, then renders the Images / Texts / Theme
 * tabs. Ported from the UE extension's DemoPilotRail.js — the biggest
 * differences: no `@adobe/uix-guest` polling loop (DA gives context once),
 * and no `editorActions` replace call (see lib/clipboard.js for why).
 */

import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { fetchUserEmail } from './lib/userProfile.js';
import { setAnalyticsContext } from './lib/analytics.js';
import { readTexts } from './lib/textStorage.js';
import { fetchAemConfig } from './lib/aemConfig.js';
import { AEM_ORG_ID, AEM_ASSET_SELECTOR_API_KEY } from './config.js';

// Bump on every change, ever. Logged on load so it's possible to confirm from
// a screenshot/console alone whether a given browser session is actually
// running the latest build — stale browser/CDN caching has repeatedly made
// "did the fix apply?" ambiguous otherwise.
const PLUGIN_BUILD = 'v13-2026-09-01-selector-shim-iframe-flex-fix';
// eslint-disable-next-line no-console
console.log(`[DemoPilot] build: ${PLUGIN_BUILD}`);
import { renderImagesTab } from './tabs/imagesTab.js';
import { renderTextsTab } from './tabs/textsTab.js';
import { renderThemeTab } from './tabs/themeTab.js';

const TABS = [
  { id: 'images', label: 'Images', render: renderImagesTab },
  { id: 'texts', label: 'Texts', render: renderTextsTab },
  { id: 'theme', label: 'Theme', render: renderThemeTab },
];

const root = document.getElementById('demo-pilot-root');

const state = {
  activeTab: 'images',
  texts: {},
  themes: [],
  themesLoaded: false,
  uploadStatus: '',
  themeStatus: '',
  selectorRefresh: 0,
};

function showToast(message, isError = false) {
  const el = document.createElement('div');
  el.className = isError ? 'dp-error' : 'dp-status';
  el.style.position = 'fixed';
  el.style.bottom = '12px';
  el.style.left = '12px';
  el.style.right = '12px';
  el.style.background = isError ? '#fdecea' : '#eaf6ea';
  el.style.padding = '8px';
  el.style.borderRadius = '4px';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// Built once; subsequent render() calls reuse this DOM rather than
// recreating it — see render() below for why that matters.
let tabBarBuilt = false;
let panelEl = null;

function render(ctx) {
  if (!tabBarBuilt) {
    tabBarBuilt = true;
    root.innerHTML = `
      <div class="dp-tabs">
        ${TABS.map((t) => `<button class="dp-tab" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div class="dp-panel" id="dp-panel"></div>
    `;
    panelEl = root.querySelector('#dp-panel');
    root.querySelector('.dp-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.dp-tab');
      if (!btn) return;
      const nextTab = btn.getAttribute('data-tab');
      if (nextTab === state.activeTab) return;
      state.activeTab = nextTab;
      render(ctx);
    });
  }

  root.querySelectorAll('.dp-tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-tab') === state.activeTab);
  });

  // rerender() is called on every state change, including every single
  // upload-progress tick during a large import — NOT just on a tab switch.
  // Recreating #dp-panel's contents on every one of those calls (the old
  // behavior here) meant imagesTab.js's own "build once" guard could never
  // hold (it was always looking at a brand-new element), so the embedded
  // AEM Asset Selector widget got torn down and remounted on every tick
  // instead of once. Only wipe the panel when the ACTIVE TAB itself changes;
  // same-tab rerenders reuse the existing DOM so each tab's own "build once"
  // logic (imagesTab.js's `dpBuilt` flag) actually works as intended.
  if (panelEl.dataset.lastTab !== state.activeTab) {
    panelEl.dataset.lastTab = state.activeTab;
    delete panelEl.dataset.dpBuilt;
    panelEl.innerHTML = '';
  }

  const panel = panelEl;
  const active = TABS.find((t) => t.id === state.activeTab);
  active.render(panel, ctx);
}

(async function init() {
  const { context, token } = await DA_SDK;
  const { org, repo, path, ref } = context;

  // aem.repositoryId / imsorg / aem.assetSelectorApiKey live in the DA
  // site's own config (the same aem.repositoryId key DA's native AEM Assets
  // picker relies on) — read them instead of hardcoding per deployment.
  // AEM_ORG_ID / AEM_ASSET_SELECTOR_API_KEY are manual fallbacks for sites
  // that haven't added those config rows yet.
  const aemConfig = await fetchAemConfig({ org, repo, token }).catch(() => ({ authorUrl: '', imsOrgId: '', assetSelectorApiKey: '' }));
  const authorUrl = aemConfig.authorUrl;
  const orgId = aemConfig.imsOrgId || AEM_ORG_ID;
  const assetSelectorApiKey = aemConfig.assetSelectorApiKey || AEM_ASSET_SELECTOR_API_KEY;

  setAnalyticsContext({ orgId: org, siteName: repo, aemHost: authorUrl });
  fetchUserEmail(token).then((email) => {
    if (email) setAnalyticsContext({ userId: email });
  }).catch(() => { /* analytics must not surface errors */ });

  state.texts = await readTexts({ org, repo, token }).catch(() => ({}));

  const ctx = {
    state,
    rerender: () => render(ctx),
    toast: showToast,
    token,
    org,
    repo,
    ref: ref || 'main',
    path,
    // Reachable only via the kept upload-to-dam action.
    authorUrl,
    orgId,
    assetSelectorApiKey,
    damFolderPath: '/content/dam/imported-assets/en',
  };

  render(ctx);
}());
