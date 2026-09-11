// 個体のスコア計算。とくいタイプ別の重みでサブスキル5枠とせいかくを点数化する。
// 重みの正本は data/defaults.js（settings.js 経由で渡される）。この層は計算だけを行う。

import { SUBSKILLS, NATURES, byId } from '../data/gamedata.js';

const NATURE_BY_ID = byId(NATURES);
const SUBSKILL_BY_ID = byId(SUBSKILLS);

/** 枠数。slotWeights の既定長でもある。 */
const SLOT_COUNT = 5;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * せいかくの補正点。
 * natureEffectWeights[specialty].up[上昇ステータス] + .down[下降ステータス]。
 * 無補正（まじめ等）や未知のせいかく・未設定は 0。
 */
export function natureScore(specialty, natureId, settings) {
  if (!specialty || !natureId || !settings) return 0;
  const table = settings.natureEffectWeights && settings.natureEffectWeights[specialty];
  if (!table) return 0;
  const nature = NATURE_BY_ID[natureId];
  if (!nature) return 0;
  const up = nature.up && table.up ? num(table.up[nature.up]) : 0;
  const down = nature.down && table.down ? num(table.down[nature.down]) : 0;
  return up + down;
}

/**
 * スコアの内訳。
 * → { slots: [{ slot, subskillId, subskillName, weight, subWeight, points }], naturePoints, subtotal, total }
 * 未開放・読み取り失敗（null）や未知のサブスキルIDは 0 点。
 */
export function scoreBreakdown(ind, settings) {
  const specialty = (ind && ind.specialty) || null;
  const cfg = settings || {};
  const slotWeights = Array.isArray(cfg.slotWeights) ? cfg.slotWeights : [];
  const subTable = (specialty && cfg.subskillWeights && cfg.subskillWeights[specialty]) || {};
  const subs = (ind && Array.isArray(ind.subskills)) ? ind.subskills : [];

  const count = Math.max(SLOT_COUNT, slotWeights.length);
  const slots = [];
  let subtotal = 0;
  for (let i = 0; i < count; i++) {
    const id = subs[i] != null ? subs[i] : null;
    const weight = num(slotWeights[i]);
    const subWeight = id ? num(subTable[id]) : 0;
    const points = weight * subWeight;
    subtotal += points;
    slots.push({
      slot: i + 1,
      subskillId: id,
      subskillName: (id && SUBSKILL_BY_ID[id] && SUBSKILL_BY_ID[id].name) || null,
      weight,
      subWeight,
      points,
    });
  }

  const naturePoints = natureScore(specialty, (ind && ind.nature) || null, settings);
  return { slots, naturePoints, subtotal, total: subtotal + naturePoints };
}

/** 個体の総合スコア。Σ slotWeights[i] * subskillWeights[spec][sub_i] + せいかく補正。 */
export function individualScore(ind, settings) {
  return scoreBreakdown(ind, settings).total;
}

/**
 * 上位%からランクを決める。gradeThresholds は「その値以下なら該当ランク」の上限（%）。
 * 例 { S:1, A:5, B:20, C:50 } → 上位1%以内なら S、それ以外は D。
 */
export function grade(topPct, settings) {
  const t = (settings && settings.gradeThresholds) || {};
  const pct = Number(topPct);
  if (!Number.isFinite(pct)) return 'D';
  if (pct <= num(t.S, 1)) return 'S';
  if (pct <= num(t.A, 5)) return 'A';
  if (pct <= num(t.B, 20)) return 'B';
  if (pct <= num(t.C, 50)) return 'C';
  return 'D';
}

/**
 * 手持ちの中での順位。rank = 自分より厳密にスコアが高い個体数 + 1（同点は同順位）。
 * total は list の件数。
 */
export function rankAmong(list, ind, settings) {
  const items = Array.isArray(list) ? list : [];
  const total = items.length;
  const mine = individualScore(ind, settings);
  let higher = 0;
  for (let i = 0; i < items.length; i++) {
    if (individualScore(items[i], settings) > mine) higher++;
  }
  return { rank: higher + 1, total };
}
