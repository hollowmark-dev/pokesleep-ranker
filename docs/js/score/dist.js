// スコアの全パターン分布を Worker で作り、上位%・順位を引けるようにする。
// (とくいタイプ, 重み) を正規化文字列にして FNV-1a でハッシュし、メモリキャッシュする。

import { SUBSKILLS, NATURES } from '../data/gamedata.js';
import { natureScore } from './score.js';

/** hash -> { canonical, dist } */
const cache = new Map();
/** hash -> { canonical, promise } */
const pending = new Map();

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

/** 重みを固定順の整数配列に落とし、正規化文字列とハッシュを作る。 */
function inputsFor(specialty, settings) {
  const cfg = settings || {};
  const subTable = (cfg.subskillWeights && cfg.subskillWeights[specialty]) || {};
  const rawSlots = Array.isArray(cfg.slotWeights) ? cfg.slotWeights : [];
  const slotW = [];
  for (let i = 0; i < 5; i++) slotW.push(toInt(rawSlots[i]));
  const subW = SUBSKILLS.map((s) => toInt(subTable[s.id]));
  const natW = NATURES.map((n) => toInt(natureScore(specialty, n.id, settings)));
  const canonical = JSON.stringify([String(specialty), slotW, subW, natW]);
  return { slotW, subW, natW, canonical, hash: fnv1a(canonical) };
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
      try {
        finish(resolve, makeDist(d));
      } catch (e) {
        finish(reject, e instanceof Error ? e : new Error(String(e)));
      }
    };
    worker.onerror = (ev) => {
      finish(reject, new Error((ev && ev.message) || 'スコア分布の計算に失敗しました'));
    };
    worker.postMessage({ slotW, subW, natW });
  });
}

/**
 * とくいタイプと重みから、スコアの全パターン分布を得る。
 * → { total, minScore, maxScore, topPct(score), rank(score), countAt(score) }
 * 同じ重みに対する同時呼び出しは1本の計算にまとめる。
 */
export async function getDistribution(specialty, settings) {
  const { slotW, subW, natW, canonical, hash } = inputsFor(specialty, settings);

  const hit = cache.get(hash);
  if (hit && hit.canonical === canonical) return hit.dist;

  const inflight = pending.get(hash);
  if (inflight && inflight.canonical === canonical) return inflight.promise;

  const promise = compute(slotW, subW, natW).then(
    (dist) => {
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
