/**
 * 端末内保存（IndexedDB）。DB名 pokesleep_ranker、
 * stores: individuals(keyPath id), settings(keyPath key)。
 *
 * - localStorage は 5MB 制限で足りないので使わない
 * - CDN からラッパーを import しない（オフラインで動かなくなる）ので素で書く
 * - 容量不足・プライベートモード等で書き込みが例外を投げることがある。
 *   黙って握りつぶさず onError で画面に出す
 */

const DB_NAME = 'pokesleep_ranker';
const DB_VERSION = 1;
const STORE_INDIVIDUALS = 'individuals';
const STORE_SETTINGS = 'settings';

let dbPromise = null;

/** 保存に失敗したことを画面へ知らせるためのフック（app.js が差し替える） */
export let onError = (msg) => console.error('[store]', msg);
export function setErrorHandler(fn) { onError = fn; }

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      return reject(e);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_INDIVIDUALS)) {
        db.createObjectStore(STORE_INDIVIDUALS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB を開けません'));
    req.onblocked = () => reject(new Error('別のタブが古いバージョンを開いています'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let req;
    try {
      req = fn(store);
    } catch (e) {
      return reject(e);
    }
    // IDBRequest なら必ず .result を返す。
    // 「見つからなかった」ときの result は undefined なので、
    // `result !== undefined ? … : req` のように書くとリクエスト自体を返してしまい、
    // 呼び出し側では「見つかった」ように見える
    t.oncomplete = () => resolve(req && typeof req === 'object' && 'result' in req ? req.result : req);
    t.onerror = () => reject(t.error || new Error('保存に失敗しました'));
    t.onabort = () => reject(t.error || new Error('保存が中断されました'));
  }));
}

/* ------------------------------------------------------------------ */
/* 個体                                                                */
/* ------------------------------------------------------------------ */

export async function putIndividual(obj) {
  try {
    await tx(STORE_INDIVIDUALS, 'readwrite', s => s.put(obj));
    return true;
  } catch (e) {
    onError('保存できません: ' + (e && e.message ? e.message : e));
    return false;
  }
}

export async function getIndividual(id) {
  try {
    return await tx(STORE_INDIVIDUALS, 'readonly', s => s.get(id));
  } catch (e) {
    onError('読み込めません: ' + (e && e.message ? e.message : e));
    return null;
  }
}

export async function listIndividuals() {
  try {
    const all = await tx(STORE_INDIVIDUALS, 'readonly', s => s.getAll());
    const list = all || [];
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return list;
  } catch (e) {
    onError('一覧を読み込めません: ' + (e && e.message ? e.message : e));
    return [];
  }
}

export async function deleteIndividual(id) {
  try {
    await tx(STORE_INDIVIDUALS, 'readwrite', s => s.delete(id));
    return true;
  } catch (e) {
    onError('削除できません: ' + (e && e.message ? e.message : e));
    return false;
  }
}

/** まとめて保存（インポート用）。1トランザクションで行う。 */
export async function putManyIndividuals(list) {
  try {
    await tx(STORE_INDIVIDUALS, 'readwrite', (store) => {
      for (const item of list) store.put(item);
      return null;
    });
    return true;
  } catch (e) {
    onError('一括保存できません: ' + (e && e.message ? e.message : e));
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 設定                                                                */
/* ------------------------------------------------------------------ */

export async function getSetting(key) {
  try {
    return await tx(STORE_SETTINGS, 'readonly', s => s.get(key));
  } catch (e) {
    onError('設定を読み込めません: ' + (e && e.message ? e.message : e));
    return null;
  }
}

export async function putSetting(obj) {
  try {
    await tx(STORE_SETTINGS, 'readwrite', s => s.put(obj));
    return true;
  } catch (e) {
    onError('設定を保存できません: ' + (e && e.message ? e.message : e));
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 永続化の要求                                                        */
/* ------------------------------------------------------------------ */

/**
 * ブラウザにデータを消さないよう頼む。
 * セキュアコンテキスト（HTTPS / localhost）でしか呼べず、iOS Safari は非対応。
 * 通らなくても動作に影響はないが、通らない端末ではバックアップ書き出しが唯一の保険になる。
 */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return { supported: false, granted: false };
    const granted = await navigator.storage.persist();
    return { supported: true, granted };
  } catch (e) {
    return { supported: false, granted: false, error: String(e) };
  }
}
