// 個体のスコア計算。とくいタイプ別の重みでサブスキル5枠・せいかく・食材構成3枠を点数化する。
// 重みの正本は data/defaults.js（settings.js 経由で渡される）。この層は計算だけを行う。

import { SUBSKILLS, NATURES, byId } from '../data/gamedata.js';
import { INGREDIENTS, SPECIES_INGREDIENTS } from '../data/ingredients.js';

const NATURE_BY_ID = byId(NATURES);
const SUBSKILL_BY_ID = byId(SUBSKILLS);
const INGREDIENT_BY_ID = byId(INGREDIENTS);

/** 枠数。slotWeights の既定長でもある。 */
const SLOT_COUNT = 5;

/** 食材の枠数（枠1固定・枠2/3が個体ごとに決まる）。 */
export const INGREDIENT_SLOT_COUNT = 3;

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
  // せいかくの重みはサブスキルと同じ 0..100 尺度。枠1のサブスキル1つ分と同じ倍率で加算する
  // （枠の重みの最大値を掛ける）。こうしないと性格が 1000 点級のサブスキルに埋もれてしまう。
  return (up + down) * natureScale(settings);
}

/** せいかく重みに掛ける倍率＝枠の重みの最大値（枠1相当）。枠の重みが無ければ 1 */
export function natureScale(settings) {
  const slots = settings && Array.isArray(settings.slotWeights) ? settings.slotWeights.map(num) : [];
  const m = slots.length ? Math.max(...slots) : 1;
  return Number.isFinite(m) && m > 0 ? m : 1;
}

/* ------------------------------------------------------------------ */
/* 食材構成                                                            */
/* ------------------------------------------------------------------ */

/** ind.ingredients を [{ing,count}|null, ...×3] に正規化する。未知IDもそのまま残す（価値0になる）。 */
function ingredientSlots(ind) {
  const list = ind && Array.isArray(ind.ingredients) ? ind.ingredients : [];
  const out = [];
  for (let i = 0; i < INGREDIENT_SLOT_COUNT; i++) {
    const e = list[i];
    if (e && e.ing) out.push({ ing: String(e.ing), count: num(e.count) });
    else out.push(null);
  }
  return out;
}

/**
 * 揃いボーナス（0..100 尺度の素点）。
 * 3枠すべて同じ食材なら same3、そうでなく2枠が同じなら same2。null枠は数えない。
 */
export function uniformityBonus(ind, settings) {
  const cfg = (settings && settings.ingredientUniformityBonus) || {};
  const ids = ingredientSlots(ind).filter(Boolean).map((s) => s.ing);
  if (ids.length === INGREDIENT_SLOT_COUNT && ids[0] === ids[1] && ids[1] === ids[2]) {
    return num(cfg.same3);
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (ids[i] === ids[j]) return num(cfg.same2);
    }
  }
  return 0;
}

/**
 * 食材構成の素点（0..100 尺度）。
 * Σ[枠] 個数 × ingredientValues[食材] / 100 × 10 ＋ 揃いボーナス。
 * 価値100の食材1個 = 10点。null枠・未知の食材IDは 0 点。
 */
export function ingredientScore(ind, settings) {
  const values = (settings && settings.ingredientValues) || {};
  let raw = 0;
  for (const s of ingredientSlots(ind)) {
    if (!s) continue;
    raw += (s.count * num(values[s.ing])) / 100 * 10;
  }
  return raw + uniformityBonus(ind, settings);
}

/** 素点に掛ける倍率 ＝ ingredientWeights[とくいタイプ]/100 × natureScale。 */
function ingredientFactor(specialty, settings) {
  if (!specialty || !settings || !settings.ingredientWeights) return 0;
  const w = num(settings.ingredientWeights[specialty]);
  if (!w) return 0;
  return (w / 100) * natureScale(settings);
}

/**
 * 食材構成の得点（サブスキル・せいかくと同じ尺度）。
 * 素点 × ingredientWeights[とくいタイプ]/100 × natureScale(settings)。
 */
export function ingredientPoints(ind, settings) {
  const factor = ingredientFactor((ind && ind.specialty) || null, settings);
  if (!factor) return 0;
  return ingredientScore(ind, settings) * factor;
}

/**
 * その種族が取りうる食材構成の全パターン（枠1候補 × 枠2候補 × 枠3候補）。
 * → [[{ing,count},{ing,count},{ing,count}], ...] / 未登録の種族なら null。
 * 候補が空の枠は null 枠として1通りだけ数える。
 */
export function ingredientCombos(speciesId) {
  const entry = speciesId ? SPECIES_INGREDIENTS[speciesId] : null;
  if (!entry) return null;
  const pick = (list) => {
    const a = Array.isArray(list) ? list.filter((x) => x && x.ing) : [];
    if (!a.length) return [null];
    return a.map((x) => ({ ing: String(x.ing), count: num(x.count) }));
  };
  const s1 = pick(entry.slot1);
  const s2 = pick(entry.slot2);
  const s3 = pick(entry.slot3);
  const out = [];
  for (const a of s1) for (const b of s2) for (const c of s3) out.push([a, b, c]);
  return out;
}

/**
 * スコアの内訳。
 * → { slots: [{ slot, subskillId, subskillName, weight, subWeight, points }], naturePoints,
 *     ingredients: [{ slot, ing, ingName, count, points }], ingredientScore, ingredientBonus,
 *     ingredientPoints, subtotal, total }
 * 未開放・読み取り失敗（null）や未知のサブスキルID・食材IDは 0 点。
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

  // 食材構成。素点を「得点」の尺度に直した内訳も返す（表にそのまま並べられるように）。
  const ingValues = cfg.ingredientValues || {};
  const factor = ingredientFactor(specialty, settings);
  const ingredients = ingredientSlots(ind).map((s, i) => ({
    slot: i + 1,
    ing: s ? s.ing : null,
    ingName: (s && INGREDIENT_BY_ID[s.ing] && INGREDIENT_BY_ID[s.ing].name) || null,
    count: s ? s.count : 0,
    points: s ? (s.count * num(ingValues[s.ing])) / 100 * 10 * factor : 0,
  }));
  const ingredientBonus = uniformityBonus(ind, settings) * factor;
  const ingPoints = ingredientPoints(ind, settings);

  return {
    slots,
    naturePoints,
    ingredients,
    ingredientScore: ingredientScore(ind, settings),
    ingredientBonus,
    ingredientPoints: ingPoints,
    subtotal,
    total: subtotal + naturePoints + ingPoints,
  };
}

/** 個体の総合スコア。サブスキル ＋ せいかく ＋ 食材構成。 */
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
