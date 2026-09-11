// スコアの全パターン分布を Worker で作り、上位%・順位を引けるようにする。
// (とくいタイプ, 重み, 種族の食材構成) を正規化文字列にして FNV-1a でハッシュし、メモリキャッシュする。

import { SUBSKILLS, NATURES } from '../data/gamedata.js';
import { natureScore, ingredientPoints, ingredientCombos } from './score.js';

/** hash -> { canonical, dist }（食材構成まで畳み込んだ最終分布） */
const cache = new Map();
/** hash -> { canonical, promise } */
const pending = new Map();
/** baseHash -> { canonical, data }（サブスキル×せいかくまでの素の度数分布） */
const baseCache = new Map();
/** baseHash -> { canonical, promise } */
const basePending = new Map();

function toInt(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
}

/** FNV-1a 32bit。 */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619（32bit）
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

/**
 * その種族が取りうる食材構成の得点リスト（整数）。
 * 種族未指定・未登録、または そのとくいタイプで食材構成を見ない（重み0）なら null。
 */
function ingredientPointList(specialty, settings, speciesId) {
  if (!speciesId) return null;
  const w = Number((settings && settings.ingredientWeights && settings.ingredientWeights[specialty]) || 0);
  if (!Number.isFinite(w) || w <= 0) return null;
  const combos = ingredientCombos(speciesId);
  if (!combos || combos.length === 0) return null;
  return combos.map((c) => toInt(ingredientPoints({ specialty, ingredients: c }, settings)));
}

/** 重みを固定順の整数配列に落とし、正規化文字列とハッシュを作る。 */
function inputsFor(specialty, settings, speciesId) {
  const cfg = settings || {};
  const subTable = (cfg.subskillWeights && cfg.subskillWeights[specialty]) || {};
  const rawSlots = Array.isArray(cfg.slotWeights) ? cfg.slotWeights : [];
  const slotW = [];
  for (let i = 0; i < 5; i++) slotW.push(toInt(rawSlots[i]));
  const subW = SUBSKILLS.map((s) => toInt(subTable[s.id]));
  const natW = NATURES.map((n) => toInt(natureScore(specialty, n.id, settings)));
  const baseCanonical = JSON.stringify([String(specialty), slotW, subW, natW]);
  const ingPts = ingredientPointList(specialty, settings, speciesId);
  const canonical = JSON.stringify([baseCanonical, ingPts]);
  return {
    slotW,
    subW,
    natW,
    ingPts,
    baseCanonical,
    baseHash: fnv1a(baseCanonical),
    canonical,
    hash: fnv1a(canonical),
  };
}

function makeDist(data) {
  const counts = data.counts;
  const greater = data.greater;
  const offset = data.offset;
  const total = data.total;
  const len = counts.length;
  const minScore = offset;
  const maxScore = offset + len - 1;

  // 範囲外のスコアは両端に丸める
  const idx = (score) => {
    const s = Math.round(Number(score));
    if (!Number.isFinite(s)) return 0;
    const i = s - offset;
    if (i < 0) return 0;
    if (i > len - 1) return len - 1;
    return i;
  };

  return {
    total,
    minScore,
    maxScore,
    /** 同スコアのパターン数 */
    countAt(score) {
      return counts[idx(score)];
    },
    /** 1..total。同点は同順位（自分より厳密に高い数 + 1） */
    rank(score) {
      return greater[idx(score)] + 1;
    },
    /** 上位何%か。同点は中位（mid-rank）として扱う */
    topPct(score) {
      if (!(total > 0)) return 100;
      const i = idx(score);
      const pct = (100 * (greater[i] + 0.5 * counts[i])) / total;
      if (pct < 0) return 0;
      if (pct > 100) return 100;
      return pct;
    },
  };
}

/**
 * 度数分布に「1通りずつの得点リスト」を畳み込む（食材構成のパターンぶん）。
 * 元の分布は書き換えない。total は元 total × pts.length になる。
 */
function convolvePoints(data, pts) {
  const counts = data.counts;
  const len = counts.length;
  let min = pts[0];
  let max = pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i] < min) min = pts[i];
    if (pts[i] > max) max = pts[i];
  }
  const outLen = len + (max - min);
  const out = new Float64Array(outLen);
  for (let i = 0; i < len; i++) {
    const c = counts[i];
    if (c === 0) continue;
    for (let k = 0; k < pts.length; k++) out[i + (pts[k] - min)] += c;
  }
  const greater = new Float64Array(outLen);
  let acc = 0;
  for (let s = outLen - 1; s >= 0; s--) {
    greater[s] = acc;
    acc += out[s];
  }
  return { offset: data.offset + min, counts: out, greater, total: acc };
}

function compute(slotW, subW, natW) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./enum-worker.js', import.meta.url));
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      try { worker.terminate(); } catch (_) { /* noop */ }
      fn(arg);
    };
    worker.onmessage = (ev) => {
      const d = (ev && ev.data) || {};
      if (d.error) {
        finish(reject, new Error(d.error));
        return;
      }
      if (!d.counts || !d.greater) {
        finish(reject, new Error('スコア分布の計算に失敗しました'));
        return;
      }
      finish(resolve, d);
    };
    worker.onerror = (ev) => {
      finish(reject, new Error((ev && ev.message) || 'スコア分布の計算に失敗しました'));
    };
    worker.postMessage({ slotW, subW, natW });
  });
}

/** サブスキル×せいかくまでの素の度数分布。種族が違っても使い回せるのでここでキャッシュする。 */
function getBase(slotW, subW, natW, canonical, hash) {
  const hit = baseCache.get(hash);
  if (hit && hit.canonical === canonical) return Promise.resolve(hit.data);

  const inflight = basePending.get(hash);
  if (inflight && inflight.canonical === canonical) return inflight.promise;

  const promise = compute(slotW, subW, natW).then(
    (data) => {
      baseCache.set(hash, { canonical, data });
      const cur = basePending.get(hash);
      if (cur && cur.canonical === canonical) basePending.delete(hash);
      return data;
    },
    (err) => {
      const cur = basePending.get(hash);
      if (cur && cur.canonical === canonical) basePending.delete(hash);
      throw err;
    }
  );

  basePending.set(hash, { canonical, promise });
  return promise;
}

/**
 * とくいタイプと重みから、スコアの全パターン分布を得る。
 * `speciesId` を渡し、その種族が `SPECIES_INGREDIENTS` にあって
 * `ingredientWeights[specialty] > 0` なら、食材構成の全パターンも母集団に含める。
 * → { total, minScore, maxScore, topPct(score), rank(score), countAt(score) }
 * 同じ入力に対する同時呼び出しは1本の計算にまとめる。
 */
export async function getDistribution(specialty, settings, speciesId = null) {
  const { slotW, subW, natW, ingPts, baseCanonical, baseHash, canonical, hash } =
    inputsFor(specialty, settings, speciesId);

  const hit = cache.get(hash);
  if (hit && hit.canonical === canonical) return hit.dist;

  const inflight = pending.get(hash);
  if (inflight && inflight.canonical === canonical) return inflight.promise;

  const promise = getBase(slotW, subW, natW, baseCanonical, baseHash).then(
    (base) => {
      // 食材構成はほとんどの種族で4〜6通り（最多でもダークライの512通り）なので
      // メインスレッドで畳み込む。度数配列の幅 × パターン数 の1回のループで済む。
      const dist = makeDist(ingPts ? convolvePoints(base, ingPts) : base);
      cache.set(hash, { canonical, dist });
      const cur = pending.get(hash);
      if (cur && cur.canonical === canonical) pending.delete(hash);
      return dist;
    },
    (err) => {
      const cur = pending.get(hash);
      if (cur && cur.canonical === canonical) pending.delete(hash);
      throw err;
    }
  );

  pending.set(hash, { canonical, promise });
  return promise;
}
