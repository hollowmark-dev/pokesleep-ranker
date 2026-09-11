// tesseract.js v6 のワーカーを1つだけ抱えて日本語OCRを回す薄いラッパ。
// v6 では data.words / data.lines のフラット配列が無くなったので blocks を辿ってトークンを組み立てる。
// 日本語は 1〜3文字で語が切れるため、rebuildLines() で座標から行を復元して返す。

// tesseract.esm.min.js は default export のみ（名前付き export は無い）
import Tesseract from '../../vendor/tesseract.esm.min.js';

const { createWorker, PSM, OEM } = Tesseract;
import { cropCanvas } from './image.js';

// vendor/ は必ず絶対URLで渡す。相対のままだと既定のCDNへ取りに行ってしまう。
const abs = (p) => new URL(p, import.meta.url).href;

let workerPromise = null;   // ワーカー生成の in-flight promise（多重生成を防ぐ）
let worker = null;
let queue = Promise.resolve(); // tesseract のワーカーは同時に1ジョブしか受けられない
let progressCb = null;
let currentPsm = null;

const STATUS_JA = {
  'loading tesseract core': 'OCRエンジンを読み込み中',
  'loading tesseract core (from cache)': 'OCRエンジンを読み込み中',
  'initializing tesseract': 'OCRエンジンを準備中',
  'initializing api': '認識の準備中',
  'loading language traineddata': '日本語データを読み込み中',
  'loading language traineddata (from cache)': '日本語データを読み込み中',
  'initialized api': '認識の準備中',
  'recognizing text': '文字を認識中',
  'done': '仕上げ中',
};

/** tesseract のログを日本語メッセージ＋パーセントに翻訳して呼び元へ渡す */
function emit(m) {
  if (!progressCb) return;
  const status = m && m.status ? String(m.status) : '';
  const progress = typeof m?.progress === 'number' ? m.progress : 0;
  const key = status.toLowerCase();
  const message = STATUS_JA[key] || STATUS_JA[key.replace(/\s*\(from cache\)\s*$/, '')] || '処理中';
  try {
    progressCb({ status, progress, message, pct: Math.round(Math.max(0, Math.min(1, progress)) * 100) });
  } catch (_) { /* 進捗表示の失敗で本体を止めない */ }
}

async function getWorker() {
  if (worker) return worker;
  if (!workerPromise) {
    workerPromise = createWorker('jpn', OEM.LSTM_ONLY, {
      workerPath: abs('../../vendor/worker.min.js'),
      corePath: abs('../../vendor/core'),
      langPath: abs('../../vendor/lang'),
      gzip: true,
      cachePath: 'psr',
      workerBlobURL: false,
      logger: (m) => emit(m),
    }).then(async (w) => {
      worker = w;
      await setPsm(PSM.SPARSE_TEXT);
      await w.setParameters({ preserve_interword_spaces: '1' });
      return w;
    }).catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

async function setPsm(psm) {
  if (!worker || currentPsm === psm) return;
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  currentPsm = psm;
}

/** ジョブを直列化する（ワーカーは1本しかないため） */
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function bboxOf(o) {
  const b = o && o.bbox ? o.bbox : null;
  if (!b) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0: b.x0 | 0, y0: b.y0 | 0, x1: b.x1 | 0, y1: b.y1 | 0 };
}

function shiftBox(b, dx, dy) {
  return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
}

/**
 * v6 の data.blocks[].paragraphs[].lines[].words[] を辿って単語トークンを取り出す。
 * @returns {Array<{text:string,bbox:object,conf:number}>}
 */
export function tokensFromData(data) {
  const out = [];
  const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
  for (const block of blocks) {
    const paras = Array.isArray(block?.paragraphs) ? block.paragraphs : [];
    for (const para of paras) {
      const lines = Array.isArray(para?.lines) ? para.lines : [];
      for (const line of lines) {
        const words = Array.isArray(line?.words) ? line.words : [];
        for (const w of words) {
          const text = (w?.text || '').trim();
          if (!text) continue;
          out.push({
            text,
            bbox: bboxOf(w),
            conf: Math.max(0, Math.min(1, (typeof w?.confidence === 'number' ? w.confidence : 0) / 100)),
          });
        }
      }
    }
  }
  return out;
}

/**
 * トークンを座標から行に組み直す。
 * 「y方向の範囲が重なる」かつ「x方向の隙間が文字高の1.5倍未満」のものを同じ行にする。
 * @param {Array<{text:string,bbox:object,conf:number}>} tokens
 * @returns {Array<{text:string,bbox:object,conf:number,tokens:Array}>}
 */
export function rebuildLines(tokens) {
  const src = (tokens || []).filter((t) => t && t.text);
  if (src.length === 0) return [];

  // まず y の重なりで行グループを作る
  const sorted = src.slice().sort((a, b) => (a.bbox.y0 - b.bbox.y0) || (a.bbox.x0 - b.bbox.x0));
  const rows = [];
  for (const t of sorted) {
    const h = Math.max(1, t.bbox.y1 - t.bbox.y0);
    let row = null;
    for (const r of rows) {
      const overlap = Math.min(r.y1, t.bbox.y1) - Math.max(r.y0, t.bbox.y0);
      if (overlap > 0.4 * Math.min(h, r.y1 - r.y0)) { row = r; break; }
    }
    if (!row) {
      row = { y0: t.bbox.y0, y1: t.bbox.y1, items: [] };
      rows.push(row);
    }
    row.items.push(t);
    row.y0 = Math.min(row.y0, t.bbox.y0);
    row.y1 = Math.max(row.y1, t.bbox.y1);
  }

  // 行グループの中で x の隙間が大きいところは別の行（別カラム）として切り離す
  const lines = [];
  for (const row of rows) {
    const items = row.items.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let group = [items[0]];
    for (let i = 1; i < items.length; i++) {
      const prev = group[group.length - 1];
      const gap = items[i].bbox.x0 - prev.bbox.x1;
      const h = Math.max(1, Math.max(prev.bbox.y1 - prev.bbox.y0, items[i].bbox.y1 - items[i].bbox.y0));
      if (gap > 1.5 * h) {
        lines.push(makeLine(group));
        group = [items[i]];
      } else {
        group.push(items[i]);
      }
    }
    lines.push(makeLine(group));
  }

  lines.sort((a, b) => (a.bbox.y0 - b.bbox.y0) || (a.bbox.x0 - b.bbox.x0));
  return lines;
}

function makeLine(items) {
  const bbox = {
    x0: Math.min(...items.map((t) => t.bbox.x0)),
    y0: Math.min(...items.map((t) => t.bbox.y0)),
    x1: Math.max(...items.map((t) => t.bbox.x1)),
    y1: Math.max(...items.map((t) => t.bbox.y1)),
  };
  // 日本語は語間スペースが意味を持たないので詰める。英数字どうしの境目だけ空白を残す。
  let text = '';
  for (let i = 0; i < items.length; i++) {
    const cur = items[i].text;
    if (i > 0) {
      const prev = items[i - 1].text;
      if (/[0-9A-Za-z]$/.test(prev) && /^[0-9A-Za-z]/.test(cur)) text += ' ';
    }
    text += cur;
  }
  const conf = items.reduce((s, t) => s + t.conf, 0) / items.length;
  return { text, bbox, conf, tokens: items };
}

/**
 * canvas 全体を認識する。
 * @param {HTMLCanvasElement} canvas
 * @param {(p:{status:string,progress:number,message:string,pct:number})=>void} [onProgress]
 * @returns {Promise<{rawText:string, tokens:Array, lines:Array}>}
 */
export async function recognize(canvas, onProgress) {
  return serial(async () => {
    progressCb = onProgress || null;
    try {
      const w = await getWorker();
      await setPsm(PSM.SPARSE_TEXT);
      const res = await w.recognize(canvas, {}, { text: true, blocks: true });
      const data = res && res.data ? res.data : {};
      const tokens = tokensFromData(data);
      const lines = rebuildLines(tokens);
      const rawText = (data.text || lines.map((l) => l.text).join('\n') || '').trim();
      return { rawText, tokens, lines };
    } finally {
      progressCb = null;
    }
  });
}

/**
 * 前処理済み（二値化済み）の小さな canvas を1行として読む。レイアウト方式の主経路。
 * ワーカーとジョブの直列化は recognize と共有する。
 * @param {HTMLCanvasElement} canvas prepareCrop() の出力
 * @param {number} [psm] 既定は1行読み（PSM.SINGLE_LINE）
 * @param {(p:object)=>void} [onProgress] 初回のデータ読み込みを知らせるため
 * @returns {Promise<{rawText:string, tokens:Array}>}
 */
export async function recognizePrepared(canvas, psm = PSM.SINGLE_LINE, onProgress) {
  return serial(async () => {
    progressCb = onProgress || null;
    try {
      const w = await getWorker();
      await setPsm(psm);
      const res = await w.recognize(canvas, {}, { text: true, blocks: true });
      const data = res && res.data ? res.data : {};
      const tokens = tokensFromData(data);
      const rawText = (data.text || tokens.map((t) => t.text).join('') || '').trim();
      return { rawText, tokens };
    } finally {
      progressCb = null;
    }
  });
}

/**
 * 特定の矩形だけを読み直す（読めなかった項目の追い読み用）。
 * bbox は元の canvas 座標系に戻して返す。
 * @param {HTMLCanvasElement} canvas
 * @param {{x0:number,y0:number,x1:number,y1:number}} rect
 * @param {number} [psm] 既定は1行読み
 */
export async function recognizeRect(canvas, rect, psm = PSM.SINGLE_LINE) {
  return serial(async () => {
    const w = await getWorker();
    const crop = cropCanvas(canvas, rect, { pad: 4 });
    const dx = Math.max(0, Math.floor(Math.min(rect.x0, rect.x1) - 4));
    const dy = Math.max(0, Math.floor(Math.min(rect.y0, rect.y1) - 4));
    await setPsm(psm);
    try {
      const res = await w.recognize(crop, {}, { text: true, blocks: true });
      const data = res && res.data ? res.data : {};
      const tokens = tokensFromData(data).map((t) => ({ ...t, bbox: shiftBox(t.bbox, dx, dy) }));
      const lines = rebuildLines(tokens);
      return { rawText: (data.text || '').trim(), tokens, lines };
    } finally {
      await setPsm(PSM.SPARSE_TEXT);
    }
  });
}

/** ワーカーを破棄する。ページ離脱時に呼ぶ */
export async function terminate() {
  const w = worker;
  worker = null;
  workerPromise = null;
  currentPsm = null;
  if (w) {
    try { await w.terminate(); } catch (_) { /* 破棄失敗は無視 */ }
  }
}

/** 初回呼び出しかどうか（「初回は約6MB読み込みます」の案内を出すため） */
export function isWarm() {
  return !!worker;
}

if (typeof addEventListener === 'function') {
  addEventListener('pagehide', () => { terminate(); });
}

export { PSM, OEM };
