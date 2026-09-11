/**
 * Service Worker の登録と更新検知。
 *
 * - ローカル開発（localhost / LAN の IP）では登録しない。cache-first のまま
 *   デバッグすると変更が反映されず地獄になるため、GitHub Pages 上でのみ登録する。
 * - このモジュールは登録と状態検知だけを行う。「更新があります」の見た目（バナー等）は
 *   呼び出し側（app.js）が onUpdateReady コールバックの中で作る。
 */

let currentRegistration = null;
let reloadedOnce = false;

/**
 * Service Worker を登録する。
 * @param {{ onUpdateReady?: () => void }} [opts]
 * @returns {Promise<{ registered: boolean, reason?: string, registration?: ServiceWorkerRegistration }>}
 */
export async function registerServiceWorker(opts = {}) {
  const { onUpdateReady } = opts;

  if (!('serviceWorker' in navigator)) {
    return { registered: false, reason: 'このブラウザは Service Worker に対応していません' };
  }

  if (!location.hostname.endsWith('github.io')) {
    return { registered: false, reason: 'ローカル開発のため登録しない' };
  }

  // 現在のページ（index.html）から見た相対パスで解決する。
  // サブパス配信（例: /pokesleep-ranker/）でも常に同じディレクトリの sw.js を指す。
  const swUrl = new URL('sw.js', location.href);

  try {
    const registration = await navigator.serviceWorker.register(swUrl);
    currentRegistration = registration;

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;

      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') {
          // すでにコントローラーがいる = 初回インストールではなく更新。
          // 初回インストール時は controller がまだ null なので、ここでは出さない。
          if (navigator.serviceWorker.controller && typeof onUpdateReady === 'function') {
            onUpdateReady();
          }
        }
      });
    });

    // 新しい SW が activate してページの制御を握ったら、1回だけリロードする。
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadedOnce) return;
      reloadedOnce = true;
      location.reload();
    });

    return { registered: true, registration };
  } catch (e) {
    return { registered: false, reason: String((e && e.message) || e) };
  }
}

/**
 * waiting 状態の新しい Service Worker に SKIP_WAITING を送って更新を適用する。
 * 実際のリロードは controllerchange イベント（registerServiceWorker 内で登録済み）で行われる。
 * @returns {boolean} 送信できたか（waiting な SW がなければ false）
 */
export function applyUpdate() {
  const waiting = currentRegistration && currentRegistration.waiting;
  if (!waiting) return false;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}
