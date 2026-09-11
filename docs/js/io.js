// バックアップの書き出し・読み込み。設定（重み）は取り込まない —— 重みの正本は data/defaults.js のみ。
// iOS Safari では <a download> が信頼できないため、共有できる環境では navigator.share を優先する。

import { getSettings } from './settings.js';
import { listIndividuals, putManyIndividuals } from './store.js';

const APP_ID = 'pokesleep-ranker';
const FORMAT_VERSION = 1;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function canShareFile(file) {
  if (!navigator.canShare || !navigator.share) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch (e) {
    return false;
  }
}

/**
 * 設定と個体データをまとめて JSON として書き出す。
 * 共有APIが使える端末（主にiOS Safari）では navigator.share、それ以外は <a download>。
 * 戻り値は呼び出し側が任意で使ってよい参考情報（{ method, count }）。
 */
export async function exportAll() {
  const settings = await getSettings();
  const individuals = await listIndividuals();
  const payload = {
    app: APP_ID,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    individuals,
  };
  const filename = `pokesleep-ranker-${todayStamp()}.json`;
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  let file = null;
  try {
    file = new File([blob], filename, { type: 'application/json' });
  } catch (e) {
    file = null; // File コンストラクタ非対応環境向けフォールバック
  }

  if (file && canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: filename });
      return { method: 'share', count: individuals.length };
    } catch (e) {
      if (e && e.name === 'AbortError') {
        // ユーザーが共有をキャンセルしただけなのでエラー扱いしない
        return { method: 'cancelled', count: individuals.length };
      }
      // 共有に失敗した場合はダウンロードにフォールバック
      downloadBlob(blob, filename);
      return { method: 'download', count: individuals.length };
    }
  }

  downloadBlob(blob, filename);
  return { method: 'download', count: individuals.length };
}

/**
 * バックアップ JSON を取り込む。id が重複する個体は updatedAt が新しい方を残す。
 * 設定（重み）はあえて取り込まない（重みは公式値のみを正とする運用のため）。
 * 戻り値: { imported, skipped }
 */
export async function importFile(file) {
  if (!file) {
    throw new Error('ファイルが指定されていません');
  }

  let text;
  try {
    text = await file.text();
  } catch (e) {
    throw new Error('ファイルを読み込めませんでした');
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('JSON として解析できませんでした');
  }

  if (!data || typeof data !== 'object' || data.app !== APP_ID) {
    throw new Error('このアプリのバックアップファイルではありません');
  }

  const incoming = Array.isArray(data.individuals) ? data.individuals : [];
  if (incoming.length === 0) {
    return { imported: 0, skipped: 0 };
  }

  const existing = await listIndividuals();
  const existingById = new Map(existing.map((ind) => [ind.id, ind]));

  const toImport = [];
  let skipped = 0;
  for (const ind of incoming) {
    if (!ind || !ind.id) {
      skipped++;
      continue;
    }
    const current = existingById.get(ind.id);
    if (!current || (ind.updatedAt || 0) > (current.updatedAt || 0)) {
      toImport.push(ind);
    } else {
      skipped++;
    }
  }

  if (toImport.length > 0) {
    await putManyIndividuals(toImport);
  }

  return { imported: toImport.length, skipped };
}
