/**
 * 重み設定の読み書き。正本は data/defaults.js（リポジトリ・全員共通）。
 * 管理者だけが端末内オーバーライドを保存でき、一般ユーザーは常に公式値を見る。
 */

import { DEFAULT_SETTINGS, ADMIN_PASS_HASH } from './data/defaults.js';
import { getSetting, putSetting } from './store.js';

const OVERRIDE_KEY = 'override';
const ADMIN_SESSION_KEY = 'psr_admin_unlocked';

let cache = null; // deep-merge 済みの現在の設定（メモリキャッシュ）
let cachedOverride = undefined; // undefined=未取得, null=なし, object=あり
const listeners = new Set();

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** b の値で a を上書きしつつ、深いオブジェクトはマージする（配列は置き換え）。 */
function deepMerge(a, b) {
  if (!isPlainObject(a) || !isPlainObject(b)) return b !== undefined ? b : a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (isPlainObject(v) && isPlainObject(a[k])) {
      out[k] = deepMerge(a[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function loadOverride() {
  if (cachedOverride !== undefined) return cachedOverride;
  const row = await getSetting(OVERRIDE_KEY);
  cachedOverride = row || null;
  return cachedOverride;
}

/** 現在有効な設定（オーバーライドがあればそれをマージ、なければ公式値）。 */
export async function getSettings() {
  if (cache) return cache;
  const override = await loadOverride();
  cache = override && !override.cleared ? deepMerge(DEFAULT_SETTINGS, override) : DEFAULT_SETTINGS;
  return cache;
}

/** 管理者モードのみが呼ぶ想定。端末内オーバーライドとして保存する。 */
export async function saveOverride(s) {
  const record = { key: OVERRIDE_KEY, ...s };
  const ok = await putSetting(record);
  if (ok) {
    cachedOverride = record;
    cache = deepMerge(DEFAULT_SETTINGS, record);
    notify();
  }
  return ok;
}

/** 公式値（DEFAULT_SETTINGS）に戻す。 */
export async function clearOverride() {
  const ok = await putSetting({ key: OVERRIDE_KEY, cleared: true, clearedAt: Date.now() });
  // 「消す」操作を明示的に記録しつつ、実際の判定は hasOverride() 側で無効化フラグを見る。
  cachedOverride = null;
  cache = DEFAULT_SETTINGS;
  notify();
  return ok;
}

export async function hasOverride() {
  const override = await loadOverride();
  return !!(override && !override.cleared);
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try { fn(cache); } catch (e) { console.error('[settings] listener error', e); }
  }
}

/* ------------------------------------------------------------------ */
/* 管理者モード                                                        */
/* ------------------------------------------------------------------ */

export async function isAdmin() {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
  } catch (e) {
    return false;
  }
}

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function unlockAdmin(passphrase) {
  const hash = await sha256Hex(passphrase || '');
  const ok = hash === ADMIN_PASS_HASH;
  if (ok) {
    try { sessionStorage.setItem(ADMIN_SESSION_KEY, '1'); } catch (e) { /* ignore */ }
  }
  return ok;
}

export function lockAdmin() {
  try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch (e) { /* ignore */ }
}
