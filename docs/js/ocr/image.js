// 画像ファイルを OCR 向けに前処理する。
// 縮小（targetWidth まで）→ グレースケール（輝度）→ 2〜98パーセンタイルでコントラスト伸長。
// 切り出し（cropCanvas）と反転（invertCanvas）は、色背景に淡色文字のチップを読み直すときの補助。
// レイアウト方式（layout.js）はアンカー検出に色情報が要るため、色のまま残した canvas も返せる。

/** file / Blob を HTMLImageElement または ImageBitmap にデコードする */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close && bmp.close() };
    } catch (_) {
      /* 一部ブラウザ・一部フォーマットで失敗するので下のフォールバックへ */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('画像を読み込めませんでした'));
      im.decoding = 'async';
      im.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    return { source: img, width: w, height: h, release: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function make2d(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return { canvas, ctx };
}

/**
 * 輝度グレースケール化 + パーセンタイルによるコントラスト伸長を ImageData に対して行う。
 * @param {ImageData} data
 * @param {number} loPct 下側パーセンタイル（0〜1）
 * @param {number} hiPct 上側パーセンタイル（0〜1）
 */
function grayscaleStretch(data, loPct = 0.02, hiPct = 0.98) {
  const px = data.data;
  const n = px.length / 4;
  const hist = new Uint32Array(256);
  const gray = new Uint8ClampedArray(n);

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    // ITU-R BT.601 の輝度
    const v = (px[p] * 299 + px[p + 1] * 587 + px[p + 2] * 114) / 1000;
    const g = v < 0 ? 0 : v > 255 ? 255 : v | 0;
    gray[i] = g;
    hist[g]++;
  }

  const loTarget = Math.floor(n * loPct);
  const hiTarget = Math.floor(n * hiPct);
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= loTarget) { lo = v; break; }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= hiTarget) { hi = v; break; }
  }
  if (hi - lo < 16) { lo = 0; hi = 255; } // ほぼ単色の画像で潰さない

  const span = hi - lo;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const t = ((v - lo) * 255) / span;
    lut[v] = t < 0 ? 0 : t > 255 ? 255 : t;
  }

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const g = lut[gray[i]];
    px[p] = g;
    px[p + 1] = g;
    px[p + 2] = g;
    px[p + 3] = 255;
  }
  return data;
}

/**
 * 画像ファイルを OCR 用の canvas に変換する。
 * @param {Blob|File} file
 * @param {{targetWidth?: number, color?: boolean}} [opts]
 *        color:true なら色を残した canvas（colorCanvas）も返す。レイアウトのアンカー検出用。
 * @returns {Promise<{canvas: HTMLCanvasElement, colorCanvas: HTMLCanvasElement|null,
 *                    scale: number, sourceWidth: number, sourceHeight: number}>}
 *          scale は「元画像 → canvas」の倍率。
 */
export async function fileToCanvas(file, { targetWidth = 1080, color = false } = {}) {
  if (!file) throw new Error('画像が指定されていません');
  const dec = await decode(file);
  try {
    const sw = dec.width;
    const sh = dec.height;
    if (!sw || !sh) throw new Error('画像サイズを取得できませんでした');

    // 縮小は自由。拡大は 2 倍まで（それ以上引き伸ばしても精度は上がらない）
    let scale = targetWidth / sw;
    if (scale > 2) scale = 2;

    const { canvas, ctx } = make2d(sw * scale, sh * scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(dec.source, 0, 0, canvas.width, canvas.height);

    let colorCanvas = null;
    if (color) {
      const c2 = make2d(canvas.width, canvas.height);
      c2.ctx.drawImage(canvas, 0, 0);
      colorCanvas = c2.canvas;
    }

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.putImageData(grayscaleStretch(data), 0, 0);

    return { canvas, colorCanvas, scale, sourceWidth: sw, sourceHeight: sh };
  } finally {
    try { dec.release(); } catch (_) { /* noop */ }
  }
}

/** 大津の二値化しきい値。gray は 0..255 の配列 */
export function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = v; }
  }
  return best;
}

/**
 * 領域を切り出して「黒文字・白背景の二値画像」に整える。1行OCR（PSM 7）用。
 * 拡大 → グレースケール＋コントラスト伸長 → 大津で二値化 → 黒が過半なら反転 → 白の余白を足す。
 * @param {HTMLCanvasElement} source 色つきでもグレースケールでも可
 * @param {{x0:number,y0:number,x1:number,y1:number}|{x:number,y:number,w:number,h:number}} rect
 * @param {{scale?:number, margin?:number}} [opts]
 * @returns {HTMLCanvasElement}
 */
export function prepareCrop(source, rect, { scale = 2, margin = 12 } = {}) {
  const r = normalizeRect(rect);
  const x = Math.max(0, Math.floor(r.x0));
  const y = Math.max(0, Math.floor(r.y0));
  const w = Math.max(1, Math.min(source.width, Math.ceil(r.x1)) - x);
  const h = Math.max(1, Math.min(source.height, Math.ceil(r.y1)) - y);

  const { canvas: big, ctx } = make2d(w * scale, h * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, x, y, w, h, 0, 0, big.width, big.height);

  const data = ctx.getImageData(0, 0, big.width, big.height);
  grayscaleStretch(data, 0.02, 0.98);
  const px = data.data;
  const n = px.length / 4;
  const gray = new Uint8ClampedArray(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) gray[i] = px[p];

  const thr = otsuThreshold(gray);
  let black = 0;
  for (let i = 0; i < n; i++) if (gray[i] <= thr) black++;
  const invert = black > n * 0.5; // 淡色文字・濃色背景だったら反転して黒文字にそろえる

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let on = gray[i] <= thr; // on = 文字（黒）
    if (invert) on = !on;
    const v = on ? 0 : 255;
    px[p] = v; px[p + 1] = v; px[p + 2] = v; px[p + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);

  if (margin <= 0) return big;
  const out = make2d(big.width + margin * 2, big.height + margin * 2);
  out.ctx.fillStyle = '#fff';
  out.ctx.fillRect(0, 0, out.canvas.width, out.canvas.height);
  out.ctx.drawImage(big, margin, margin);
  return out.canvas;
}

/**
 * canvas の矩形を切り出して新しい canvas を返す。rect は canvas 座標。
 * @param {HTMLCanvasElement} canvas
 * @param {{x0:number,y0:number,x1:number,y1:number}|{x:number,y:number,w:number,h:number}} rect
 * @param {{pad?: number}} [opts] pad は余白ピクセル（文字が枠に接すると精度が落ちるため）
 */
export function cropCanvas(canvas, rect, { pad = 0 } = {}) {
  const r = normalizeRect(rect);
  const x = Math.max(0, Math.floor(r.x0 - pad));
  const y = Math.max(0, Math.floor(r.y0 - pad));
  const x1 = Math.min(canvas.width, Math.ceil(r.x1 + pad));
  const y1 = Math.min(canvas.height, Math.ceil(r.y1 + pad));
  const w = Math.max(1, x1 - x);
  const h = Math.max(1, y1 - y);
  const { canvas: out, ctx } = make2d(w, h);
  ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

/** 白黒反転した新しい canvas を返す（色背景に淡色文字のチップ向けフォールバック） */
export function invertCanvas(canvas) {
  const { canvas: out, ctx } = make2d(canvas.width, canvas.height);
  ctx.drawImage(canvas, 0, 0);
  const data = ctx.getImageData(0, 0, out.width, out.height);
  const px = data.data;
  for (let p = 0; p < px.length; p += 4) {
    px[p] = 255 - px[p];
    px[p + 1] = 255 - px[p + 1];
    px[p + 2] = 255 - px[p + 2];
    px[p + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return out;
}

/** {x,y,w,h} と {x0,y0,x1,y1} の両方を受ける */
export function normalizeRect(rect) {
  if (!rect) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  if ('x1' in rect && 'y1' in rect) {
    return {
      x0: Math.min(rect.x0, rect.x1),
      y0: Math.min(rect.y0, rect.y1),
      x1: Math.max(rect.x0, rect.x1),
      y1: Math.max(rect.y0, rect.y1),
    };
  }
  return { x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h };
}

/** 表示用の小さなサムネイル canvas（確認画面のプレビュー用） */
export function thumbnailCanvas(canvas, width = 160) {
  const scale = Math.min(1, width / canvas.width);
  const { canvas: out, ctx } = make2d(canvas.width * scale, canvas.height * scale);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}
