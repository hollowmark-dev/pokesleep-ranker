/**
 * ハッシュルータ・Service Worker登録・管理者バナー表示。
 * SPEC.md のルート定義に従う: #/ 一覧, #/new 判定, #/mon/:id 詳細, #/settings 設定。
 */

import { $, el, toast } from './ui.js';
import { registerServiceWorker, applyUpdate } from './update.js';
import { hasOverride, onSettingsChange } from './settings.js';
import { setErrorHandler as setStoreErrorHandler } from './store.js';

const ROUTES = [
  { pattern: /^#\/$/, view: './views/view-list.js', params: () => ({}) },
  { pattern: /^#\/new$/, view: './views/view-capture.js', params: () => ({}) },
  { pattern: /^#\/mon\/([^/]+)$/, view: './views/view-detail.js', params: (m) => ({ id: decodeURIComponent(m[1]) }) },
  { pattern: /^#\/edit\/([^/]+)$/, view: './views/view-capture.js', params: (m) => ({ id: decodeURIComponent(m[1]) }) },
  { pattern: /^#\/settings$/, view: './views/view-settings.js', params: () => ({}) },
];

const NAV_LINKS = [
  { hash: '#/', label: '一覧' },
  { hash: '#/new', label: '判定' },
  { hash: '#/settings', label: '設定' },
];

const viewEl = $('#view');
const bannerEl = $('#banner');

setStoreErrorHandler((msg) => toast(msg, 'error'));

/** 指定ハッシュへ移動する。 */
export function navigate(hash) {
  if (!hash.startsWith('#')) hash = '#' + hash;
  if (location.hash === hash) {
    render();
  } else {
    location.hash = hash;
  }
}

function normalizeHash() {
  const h = location.hash || '#/';
  return h === '#' ? '#/' : h;
}

function matchRoute(hash) {
  for (const route of ROUTES) {
    const m = hash.match(route.pattern);
    if (m) return { route, params: route.params(m) };
  }
  return null;
}

function renderTopbar() {
  const hash = normalizeHash();
  const nav = el(
    'nav',
    {},
    ...NAV_LINKS.map((l) =>
      el('a', { href: l.hash, class: hash === l.hash ? 'active' : '' }, l.label)
    )
  );
  return el('div', { class: 'topbar' }, el('h1', {}, 'ポケスリ個体評価'), nav);
}

async function render() {
  const hash = normalizeHash();
  const matched = matchRoute(hash);

  viewEl.innerHTML = '';
  viewEl.append(renderTopbar());

  const container = el('div', { class: 'route-container' });
  viewEl.append(container);

  if (!matched) {
    container.append(el('p', { class: 'empty-state' }, 'ページが見つかりません'));
    return;
  }

  try {
    const mod = await import(matched.route.view);
    if (!mod || typeof mod.render !== 'function') {
      throw new Error('render() が見つかりません: ' + matched.route.view);
    }
    await mod.render(container, matched.params);
  } catch (e) {
    console.error('[app] view load/render failed', matched.route.view, e);
    toast('画面の読み込みに失敗しました: ' + (e && e.message ? e.message : e), 'error');
    container.append(el('p', { class: 'empty-state' }, '表示できませんでした'));
  }
}

async function renderBanner() {
  const override = await hasOverride().catch(() => false);
  bannerEl.innerHTML = '';
  if (override) {
    bannerEl.append(el('div', { class: 'banner' }, '管理者調整中（未公開の重みで表示）'));
  }
}

function setupServiceWorker() {
  registerServiceWorker({
    onUpdateReady: () => {
      toast('新しいバージョンがあります。タップで更新します。', 'info');
      const banner = el(
        'div',
        { class: 'banner', style: 'cursor:pointer', onclick: () => applyUpdate() },
        '更新があります（タップして反映）'
      );
      bannerEl.prepend(banner);
    },
  }).catch((e) => console.error('[app] service worker registration failed', e));
}

window.addEventListener('hashchange', render);
onSettingsChange(() => { renderBanner(); });

render();
renderBanner();
setupServiceWorker();
