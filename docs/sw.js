/**
 * Service Worker — アプリシェルのオフラインキャッシュ。
 *
 * - このオリジン（GitHub Pages）には他のアプリも同居しうるので、
 *   キャッシュ名は必ず "psr-" 接頭辞を付け、削除もその接頭辞のものだけに限定する。
 * - 更新時はここの VERSION だけを書き換えれば、install で新しいキャッシュが作られ、
 *   activate で古い "psr-*" キャッシュだけが掃除される（他アプリのキャッシュには触れない）。
 *   ただし vendor 用キャッシュ（VENDOR_CACHE）はサイズが大きく、バージョンを跨いで
 *   壊れないため掃除対象から除外する（下の cleanup 参照）。
 * - すべてのURLは sw.js 自身からの相対パス（サブパス配信 = 相対パス解決に対応するため）。
 */

const VERSION = 'v20260912-0057';
const CACHE_PREFIX = 'psr-';
const CACHE_NAME = CACHE_PREFIX + VERSION;

// tesseract.js のコア(wasm)・言語データは数MB単位で重く、頻繁に更新しないため
// バージョン管理の外側に置く。update.js の SKIP_WAITING でアプリ本体を更新しても
// 再ダウンロードされない。
const VENDOR_CACHE = 'psr-vendor-1';

// アプリシェル一式（docs/js 以下・SPEC.md のディレクトリ構成どおり）。
// vendor/core, vendor/lang はここに含めない（VENDOR_CACHE 側で別扱い）。
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/update.js',
  './js/store.js',
  './js/ui.js',
  './js/settings.js',
  './js/io.js',
  './js/data/gamedata.js',
  './js/data/species.js',
  './js/data/ingredients.js',
  './js/data/defaults.js',
  './js/ocr/image.js',
  './js/ocr/engine.js',
  './js/ocr/fuzzy.js',
  './js/ocr/parse.js',
  './js/ocr/layout.js',
  './js/score/score.js',
  './js/score/dist.js',
  './js/score/enum-worker.js',
  './js/views/view-list.js',
  './js/views/view-capture.js',
  './js/views/view-detail.js',
  './js/views/view-settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './vendor/tesseract.esm.min.js',
  './vendor/worker.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // 1つのURLが404でも install 全体を失敗させない（新規ファイルの反映漏れより
      // 起動不能の方が致命的なため）。失敗したURLはコンソールにだけ残す。
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((e) => console.warn('[sw] precache failed:', url, e))
        )
      )
    )
  );
  // ここでは skipWaiting() を呼ばない。既存タブが動いている間は新しい SW を
  // waiting のまま留め、js/update.js 経由でユーザーが「更新」を押したときだけ
  // SKIP_WAITING メッセージで進める（強制切り替えで作業中の判定を壊さないため）。
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME && key !== VENDOR_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // 書き込み系はそのまま素通し

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 他オリジンは素通し

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigate(req));
    return;
  }

  if (url.pathname.includes('/vendor/core/') || url.pathname.includes('/vendor/lang/')) {
    event.respondWith(handleVendorAsset(req));
    return;
  }

  event.respondWith(handleAsset(req));
});

// ページ遷移（画面の再読み込み・直リンク）は network-first。
// オフライン時だけキャッシュ済み index.html を返す（アプリはハッシュルータで
// 画面を切り替えるので、どのURLで開いても index.html を返せばよい）。
async function handleNavigate(req) {
  try {
    return await fetch(req);
  } catch (e) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match('./index.html');
    if (cached) return cached;
    return new Response('オフラインのため表示できません', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

// CSS/JS/アイコン等は cache-first。裏で最新版を取りに行ってキャッシュを更新しておく
// （次回起動時に反映される。表示中のタブを即差し替えたりはしない）。
async function handleAsset(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const revalidate = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) return cached;

  const fresh = await revalidate;
  if (fresh) return fresh;

  return new Response('', { status: 504, statusText: 'オフラインでキャッシュもありません' });
}

// tesseract のコア(wasm)・言語データ(gz)は数MBあり、裏で毎回再取得すると
// モバイル回線・容量の無駄になる。純粋な cache-first（バックグラウンド再検証なし）。
// バージョンは URL に含まれる（tesseract.js のファイル名にハッシュを含む想定）ため、
// 一度キャッシュしたら中身が変わることはない。
async function handleVendorAsset(req) {
  const cache = await caches.open(VENDOR_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'オフラインでキャッシュもありません' });
  }
}
