// 画面レイアウトを手がかりに、項目ごとの矩形だけをOCRする読み取り経路（主経路）。
// 画面全体をまとめて読むと白抜き文字・チップ・小さなタグを取りこぼすため、
// 色で3つのアンカー（緑の見出し帯2本・メインスキル枠の黄色い下辺）を見つけ、
// そこからの相対位置で各項目を切り出して1行ずつ読む。

import {
  SUBSKILLS, NATURES, MAIN_SKILLS, SUBSKILL_UNLOCK_LEVELS,
} from '../data/gamedata.js';
import { SPECIES } from '../data/species.js';
import { SPECIES_INGREDIENTS } from '../data/ingredients.js';
import { fileToCanvas, prepareCrop } from './image.js';
import { recognizePrepared, recognize, PSM } from './engine.js';
import {
  bestSubstring, levenRatio, digitsFix, normalize,
} from './fuzzy.js';
import { parseFields, resolveSize } from './parse.js';

const DEFAULT_UNLOCK = (Array.isArray(SUBSKILL_UNLOCK_LEVELS) && SUBSKILL_UNLOCK_LEVELS.length === 5)
  ? SUBSKILL_UNLOCK_LEVELS.slice()
  : [10, 25, 50, 70, 80];

// ── 調整つまみ ──────────────────────────────────────────
export const LAYOUT_TUNING = {
  speciesThreshold: 0.62,
  mainSkillThreshold: 0.6,
  subskillThreshold: 0.6,
  natureThreshold: 0.62,
  subPenalty: 0.9,       // 部分一致に掛ける減点（全体一致を優先させるため）
  cropScale: 2,          // 切り出しの拡大率
  ingCropScale: 4,       // 食材の個数バッジは文字高15px(1080換算)しかないので強めに拡大する
  // アンカー検出
  greenBarMinRatio: 0.6, // 緑と判定した x サンプルの割合
  greenBarMinHeight: 20, // 1080換算の最小の帯の高さ
  yellowMinRatio: 0.7,
  yellowMinHeight: 3,
};

const F = (value, conf) => ({
  value: value === undefined ? null : value,
  conf: Math.max(0, Math.min(1, conf || 0)),
});

/**
 * 領域OCR向けのマッチ。fuzzy.bestMatch と違い「全体一致」を「部分一致」より優先する。
 * 切り出した領域には1項目しか写っていないので、
 * 「いやしのはどう(げんきエールS)」が「げんきエールS」に吸われるのを防ぐ。
 * @returns {{item:object, ratio:number, name:string, matched:string}|null}
 */
function pickBest(text, candidates, threshold, { subPenalty = LAYOUT_TUNING.subPenalty } = {}) {
  const T = normalize(text);
  if (!T || !Array.isArray(candidates)) return null;
  let best = null;
  for (const item of candidates) {
    if (!item) continue;
    const names = [item.name];
    if (Array.isArray(item.aliases)) for (const a of item.aliases) names.push(a);
    for (const nm of names) {
      if (!nm) continue;
      const whole = levenRatio(T, nm);
      const N = normalize(nm);
      // 「パモ」が「バパモ」と読まれた類。bestSubstring は短い文字列だと
      // 窓を走査せず全体比較に落ちるので、1文字だけ増えた完全包含はここで拾う
      const sub = (N && T.length - N.length <= 1 && T.includes(N))
        ? { ratio: 1, sub: N }
        : bestSubstring(T, nm);
      const subScore = sub.ratio * subPenalty;
      const cand = whole >= subScore
        ? { ratio: whole, matched: T }
        : { ratio: subScore, matched: sub.sub };
      if (!best || cand.ratio > best.ratio) {
        best = { item, ratio: cand.ratio, name: nm, matched: cand.matched };
      }
    }
  }
  if (!best || best.ratio < threshold) return null;
  return best;
}

// ── アンカー検出 ────────────────────────────────────────

const isGreen = (r, g, b) => (g > 170 && r < 120 && b < 140 && (g - r) > 80);
const isYellow = (r, g, b) => (r > 225 && g > 150 && g < 215 && b < 110);

/** 条件を満たす行の連続区間を返す。[startY, endY) の配列 */
function rowRuns(flags, minLen) {
  const out = [];
  let st = -1;
  for (let y = 0; y < flags.length; y++) {
    if (flags[y]) { if (st < 0) st = y; } else {
      if (st >= 0 && y - st >= minLen) out.push([st, y]);
      st = -1;
    }
  }
  if (st >= 0 && flags.length - st >= minLen) out.push([st, flags.length]);
  return out;
}

/**
 * 色つき canvas から H1（メインスキル・サブスキルの緑帯の上端）、
 * H2（詳細ステータスの緑帯の上端）、CB（メインスキル枠の黄色い下辺の上端）を取る。
 * @param {HTMLCanvasElement} colorCanvas
 * @returns {{H1:number|null, H2:number|null, CB:number|null, scale:number}}
 */
export function findAnchors(colorCanvas) {
  const w = colorCanvas.width;
  const h = colorCanvas.height;
  const s = w / 1080;
  const out = { H1: null, H2: null, CB: null, scale: s };
  if (!w || !h) return out;

  const ctx = colorCanvas.getContext('2d', { willReadFrequently: true });
  const px = ctx.getImageData(0, 0, w, h).data;

  const gx0 = Math.max(0, Math.round(60 * s));
  const gx1 = Math.min(w, Math.round(860 * s));
  const yx0 = Math.max(0, Math.round(300 * s));
  const yx1 = Math.min(w, Math.round(800 * s));

  const greenFlag = new Array(h);
  const yellowFlag = new Array(h);
  for (let y = 0; y < h; y++) {
    let gc = 0;
    let gt = 0;
    for (let x = gx0; x < gx1; x += 4) {
      const p = (y * w + x) * 4;
      gt++;
      if (isGreen(px[p], px[p + 1], px[p + 2])) gc++;
    }
    let yc = 0;
    let yt = 0;
    for (let x = yx0; x < yx1; x += 2) {
      const p = (y * w + x) * 4;
      yt++;
      if (isYellow(px[p], px[p + 1], px[p + 2])) yc++;
    }
    greenFlag[y] = gt > 0 && (gc / gt) > LAYOUT_TUNING.greenBarMinRatio;
    yellowFlag[y] = yt > 0 && (yc / yt) > LAYOUT_TUNING.yellowMinRatio;
  }

  const bars = rowRuns(greenFlag, Math.max(4, Math.round(LAYOUT_TUNING.greenBarMinHeight * s)));
  if (bars.length >= 1) out.H1 = bars[0][0];
  if (bars.length >= 2) out.H2 = bars[1][0];

  const yellows = rowRuns(yellowFlag, Math.max(2, Math.round(LAYOUT_TUNING.yellowMinHeight * s)));
  if (out.H1 != null) {
    const hit = yellows.find((r) => r[0] > out.H1 + 20 * s);
    if (hit) out.CB = hit[0];
  }
  return out;
}

// ── 矩形（1080幅換算）──────────────────────────────────

/** 1080幅換算の矩形を実寸へ。anchor 相対の y は呼び元で解決済み */
const rect = (s, x0, x1, y0, y1) => ({
  x0: Math.round(x0 * s), x1: Math.round(x1 * s), y0: Math.round(y0), y1: Math.round(y1),
});

/** 食材個数バッジ pill の内側 x 範囲（1080幅換算、枠1..3） */
const ING_BADGE_X = [[558, 613], [739, 797], [916, 974]];

/**
 * アンカーから全項目の矩形を組み立てる。
 * @returns {Array<{field:string, rect:object, slot?:number, scale?:number}>}
 */
export function buildRegions({ H1, H2, CB, scale: s }) {
  const regions = [];
  if (H1 != null) {
    regions.push({ field: 'sp', rect: rect(s, 320, 640, H1 - 578 * s, H1 - 512 * s) });
    regions.push({ field: 'level', rect: rect(s, 218, 320, H1 - 512 * s, H1 - 458 * s) });
    regions.push({ field: 'species', rect: rect(s, 320, 660, H1 - 512 * s, H1 - 458 * s) });
    regions.push({ field: 'help', rect: rect(s, 450, 852, H1 - 327 * s, H1 - 252 * s) });
    regions.push({ field: 'carry', rect: rect(s, 455, 760, H1 - 187 * s, H1 - 127 * s) });
    regions.push({ field: 'mainSkill', rect: rect(s, 265, 885, H1 + 172 * s, H1 + 224 * s) });
    regions.push({ field: 'mainSkillLv', rect: rect(s, 898, 988, H1 + 172 * s, H1 + 222 * s) });
    // 食材3枠の個数バッジ（白い丸pill・こげ茶の「x1」）。アイコンは画像なので読まない。
    // pill の外形は 1080換算で x 552..618 / 735..802 / 912..977、y = H1-417..H1-386。
    // 金色の縁を二値化で拾わないよう、内側だけを切る。
    for (let i = 0; i < 3; i++) {
      const [x0, x1] = ING_BADGE_X[i];
      regions.push({
        field: 'ing',
        slot: i,
        rect: rect(s, x0, x1, H1 - 414 * s, H1 - 389 * s),
        scale: LAYOUT_TUNING.ingCropScale,
      });
    }
  }
  if (CB != null) {
    // 5枠のチップ。2列・行優先。文字は枠の内側だけを切る（上端は茶色の解放レベルタグが被る）
    const cols = [[80, 511], [570, 1000]];
    for (let slot = 0; slot < 5; slot++) {
      const r = Math.floor(slot / 2);
      const c = slot % 2;
      const top = CB + (82 + 170 * r) * s;
      regions.push({
        field: 'chip',
        slot,
        rect: rect(s, cols[c][0] + 15, cols[c][1] - 15, top + 14 * s, top + 88 * s),
      });
    }
  }
  if (H2 != null) {
    regions.push({ field: 'nature', rect: rect(s, 95, 500, H2 + 174 * s, H2 + 232 * s) });
  }
  return regions;
}

// ── 各項目の読み取り ────────────────────────────────────

/** 数字だけを期待する欄。記号が多すぎるものは読み違いとして捨てる */
function readNumber(text, { min, max, noisyLimit = 4 }) {
  const t = String(text || '').replace(/[\s　]/g, '');
  const digits = digitsFix(t).replace(/[,.,]/g, '');
  const m = digits.match(/\d+/g);
  if (!m) return null;
  const noise = digits.replace(/\d/g, '').length;
  if (noise > noisyLimit) return null;
  let best = null;
  for (const run of m) {
    const v = parseInt(run, 10);
    if (!Number.isFinite(v) || v < min || v > max) continue;
    if (best == null || run.length > String(best).length) best = v;
  }
  return best;
}

function readSp(text) {
  let t = String(text || '');
  try { t = t.normalize('NFKC'); } catch (_) { /* noop */ }
  t = t.replace(/[\s　]/g, '');
  // 「SP」のラベルは切り取りの外。まず素の数字列を見る（枠の縦線を "|"→1 と直さないため）
  let runs = t.replace(/[,.'`·・、。]/g, '').match(/\d{2,6}/g);
  if (!runs) {
    // 数字がまったく取れなかったときだけ誤認識の補正を試す
    const fixed = digitsFix(t).replace(/[,.、。]/g, '');
    if (fixed.replace(/\d/g, '').length > 2) return null;
    runs = fixed.match(/\d{2,6}/g);
  }
  if (!runs) return null;
  const v = parseInt(runs.slice().sort((a, b) => b.length - a.length)[0], 10);
  return (Number.isFinite(v) && v >= 1 && v <= 99999) ? v : null;
}

function readLevel(text) {
  const t = digitsFix(String(text || ''));
  const m = t.match(/[lv1i|]{1,2}\s*[v.,:：]?\s*(\d{1,3})/i);
  if (m) {
    const v = parseInt(m[1], 10);
    if (v >= 1 && v <= 100) return v;
  }
  return readNumber(text, { min: 1, max: 100, noisyLimit: 6 });
}

function readMainSkillLevel(text) {
  const t = digitsFix(String(text || ''));
  const m = t.match(/[lv1i|]{1,2}\s*[v.,:：]?\s*(\d{1,2})/i);
  if (m) {
    const v = parseInt(m[1], 10);
    if (v >= 1 && v <= 10) return v;
  }
  return readNumber(text, { min: 1, max: 10, noisyLimit: 6 });
}

/** 「1時間22分47秒ごと」「57分57秒ごと」→ 秒 */
function readHelpSeconds(text) {
  let t = String(text || '');
  try { t = t.normalize('NFKC'); } catch (_) { /* noop */ }
  t = t.replace(/[\s　]/g, '');
  // 「秒」は 秘/抄/砂/杪 と、「分」は 今/兮 と読み違えられることがある
  const mh = t.match(/(\d{1,2})\s*[時畤]間?/);
  const mm = t.match(/(\d{1,3})\s*[分今兮]/);
  const ms = t.match(/(\d{1,2})\s*[秒秘抄砂杪彬]/);
  if (!mm && !ms) return null;
  const sec = (mh ? parseInt(mh[1], 10) * 3600 : 0)
    + (mm ? parseInt(mm[1], 10) * 60 : 0)
    + (ms ? parseInt(ms[1], 10) : 0);
  if (sec < 30 || sec > 36000) return null;
  return { sec, full: !!(mm && ms) };
}

function readCarry(text) {
  const t = digitsFix(String(text || '').replace(/[\s　]/g, ''));
  const m = t.match(/(\d{1,3})\s*個/);
  if (m) {
    const v = parseInt(m[1], 10);
    if (v >= 1 && v <= 300) return { value: v, conf: 0.92 };
  }
  const v = readNumber(text, { min: 1, max: 300, noisyLimit: 3 });
  return v == null ? null : { value: v, conf: 0.7 };
}

// ── 食材の個数と、種族候補との突き合わせ ──────────────────

// 「x」として許す文字。OCRは ×(全角) や X、ときに 乂/メ と読む
const X_CHARS = /[xX×✕✖╳ｘＸχхΧメ乂]/g;

/**
 * 「x1」「×2」「x4」のバッジ1枚から個数を取り出す。
 * @param {string} text
 * @returns {{value:number, conf:number}|null}
 */
export function readIngredientCount(text) {
  let t = String(text || '');
  try { t = t.normalize('NFKC'); } catch (_) { /* 古い環境 */ }
  t = t.replace(/[\s　]/g, '').replace(X_CHARS, 'x');
  if (!t) return null;

  const take = (s) => {
    const v = parseInt(s, 10);
    return (Number.isFinite(v) && v >= 1 && v <= 20) ? v : null;
  };

  // 1) 素直に「x のあとの数字」
  let m = t.match(/x(\d{1,2})/);
  if (m) {
    const v = take(m[1]);
    if (v != null) return { value: v, conf: 0.93 };
  }
  // 2) x のあとが英字に化けた（xl→x1, xS→x5, xZ→x2 …）
  m = t.match(/x(.{1,2})/);
  if (m) {
    const v = take(digitsFix(m[1]).replace(/\D/g, ''));
    if (v != null) return { value: v, conf: 0.8 };
  }
  // 3) x そのものが落ちた。数字だけでも拾う（バッジには個数しか書かれていない）
  const only = t.match(/\d{1,2}/);
  if (only) {
    const v = take(only[0]);
    if (v != null) return { value: v, conf: 0.6 };
  }
  const fixed = digitsFix(t).match(/\d{1,2}/);
  if (fixed) {
    const v = take(fixed[0]);
    if (v != null) return { value: v, conf: 0.45 };
  }
  return null;
}

/**
 * 読み取った個数と種族の候補表から、枠1..3の食材を決める。
 * 候補が1つに絞れなければ `ing:null` にして、フォームで選ばせる。
 * 枠1は候補が常に1つなので、個数が読めなくても種族さえ分かれば決まる。
 * @param {string|null} speciesId
 * @param {Array<number|null>} counts 枠1..3の個数（読めなければ null）
 * @returns {Array<{ing:string|null, count:number|null}|null>} 3要素。両方 null の枠は null
 */
export function resolveIngredients(speciesId, counts) {
  const table = (speciesId && SPECIES_INGREDIENTS) ? SPECIES_INGREDIENTS[speciesId] : null;
  const out = [];
  for (let i = 0; i < 3; i++) {
    const count = (counts && counts[i] != null) ? counts[i] : null;
    const pool = table ? table['slot' + (i + 1)] : null;
    if (!Array.isArray(pool) || pool.length === 0) {
      out.push(count == null ? null : { ing: null, count });
      continue;
    }
    if (pool.length === 1) {
      // 候補が1つしかない枠（枠1）は個数が読めなくても決まる
      out.push({ ing: pool[0].ing, count: count == null ? pool[0].count : count });
      continue;
    }
    const hits = count == null ? [] : pool.filter((c) => c && c.count === count);
    if (hits.length === 1) out.push({ ing: hits[0].ing, count });
    else out.push(count == null ? null : { ing: null, count });
  }
  return out;
}

/** チップ1枚のテキストからサブスキルを決める */
function readChip(text) {
  const n = normalize(text);
  if (n.length < 3) return null;
  const m = pickBest(text, SUBSKILLS, LAYOUT_TUNING.subskillThreshold);
  if (!m) return null;
  const sized = resolveSize(m);
  return { id: sized.item.id, conf: Math.min(1, m.ratio * sized.factor) };
}

// ── 本体 ────────────────────────────────────────────────

function emptyResult() {
  return {
    specialty: F(null, 0),
    species: { value: null, conf: 0, rawName: '' },
    level: F(null, 0),
    sp: F(null, 0),
    helpIntervalSec: F(null, 0),
    carryLimit: F(null, 0),
    mainSkill: F(null, 0),
    mainSkillLevel: F(null, 0),
    subskills: { value: [null, null, null, null, null], conf: [0, 0, 0, 0, 0] },
    // 食材3枠。個数はバッジから読み、食材そのものは種族の候補表と突き合わせて決める
    ingredientCounts: { value: [null, null, null], conf: [0, 0, 0] },
    ingredients: { value: [null, null, null], conf: [0, 0, 0] },
    // 解放レベルはゲームのルールで枠ごとに固定。読み取らず既定値を入れる
    subskillUnlockLevels: { value: DEFAULT_UNLOCK.slice(), conf: [1, 1, 1, 1, 1] },
    nature: F(null, 0),
    rawText: '',
    debug: { anchors: {}, regions: [], lines: [] },
  };
}

const emit = (cb, status, progress) => {
  if (!cb) return;
  try {
    cb({
      status,
      message: status,
      progress,
      pct: Math.round(Math.max(0, Math.min(1, progress)) * 100),
    });
  } catch (_) { /* 進捗表示の失敗で本体を止めない */ }
};

/**
 * スクショ1枚から個体の各項目を読み取る。
 * @param {Blob|File} file
 * @param {(p:{status:string,message:string,progress:number,pct:number})=>void} [onProgress]
 * @returns {Promise<object>} parseFields と同じ形（各項目 {value, conf}）
 */
export async function parseScreenshot(file, onProgress) {
  const out = emptyResult();

  emit(onProgress, '画像を準備中', 0.02);
  const prepared = await fileToCanvas(file, { targetWidth: 1080, color: true });
  const { canvas, colorCanvas } = prepared;

  const anchors = findAnchors(colorCanvas || canvas);
  out.debug.anchors = {
    H1: anchors.H1, H2: anchors.H2, CB: anchors.CB, scale: anchors.scale,
  };

  const regions = buildRegions(anchors);
  const complete = anchors.H1 != null && anchors.H2 != null && anchors.CB != null;

  // 領域ごとに1行ずつ読む
  const texts = {};
  const chipTexts = [null, null, null, null, null];
  const ingTexts = [null, null, null];
  const total = regions.length || 1;
  for (let i = 0; i < regions.length; i++) {
    const reg = regions[i];
    emit(onProgress, `読み取り中 (${i + 1}/${total})`, 0.05 + 0.9 * (i / total));
    let raw = '';
    try {
      const crop = prepareCrop(colorCanvas || canvas, reg.rect, {
        scale: reg.scale || LAYOUT_TUNING.cropScale,
      });
      const res = await recognizePrepared(crop, PSM.SINGLE_LINE, onProgress ? (p) => {
        if (p && /loading|initializ/i.test(String(p.status || ''))) {
          emit(onProgress, p.message || '準備中', 0.05);
        }
      } : null);
      raw = String(res.rawText || '').replace(/\s+/g, ' ').trim();
    } catch (_) {
      raw = '';
    }
    if (reg.field === 'chip') chipTexts[reg.slot] = raw;
    else if (reg.field === 'ing') ingTexts[reg.slot] = raw;
    else texts[reg.field] = raw;
    out.debug.regions.push({
      field: reg.field + (reg.slot != null ? String(reg.slot + 1) : ''),
      rect: reg.rect,
      rawText: raw,
    });
  }

  // ── 組み立て ──
  const sp = readSp(texts.sp);
  if (sp != null) out.sp = F(sp, 0.9);

  const lv = readLevel(texts.level);
  if (lv != null) out.level = F(lv, 0.9);

  let speciesItem = null;
  if (texts.species) {
    const m = pickBest(texts.species, SPECIES, LAYOUT_TUNING.speciesThreshold);
    out.species = {
      value: m ? m.item.id : null,
      conf: m ? m.ratio : 0,
      rawName: texts.species,
    };
    if (m) speciesItem = m.item;
  }
  // とくいタイプは種族表から引くのが正（画面左上の「きのみ」ピルはきのみ欄のラベル）
  out.specialty = speciesItem && speciesItem.specialty ? F(speciesItem.specialty, 1) : F(null, 0);

  const hi = readHelpSeconds(texts.help);
  if (hi) out.helpIntervalSec = F(hi.sec, hi.full ? 0.92 : 0.7);

  const carry = readCarry(texts.carry);
  if (carry) out.carryLimit = F(carry.value, carry.conf);

  if (texts.mainSkill) {
    const m = pickBest(texts.mainSkill, MAIN_SKILLS, LAYOUT_TUNING.mainSkillThreshold);
    if (m) out.mainSkill = F(m.item.id, m.ratio);
  }
  const msLv = readMainSkillLevel(texts.mainSkillLv);
  if (msLv != null) out.mainSkillLevel = F(msLv, 0.9);
  else if (out.mainSkill.value) out.mainSkillLevel = F(1, 0.4);

  for (let i = 0; i < 5; i++) {
    const c = readChip(chipTexts[i]);
    if (c) {
      out.subskills.value[i] = c.id;
      out.subskills.conf[i] = c.conf;
    }
  }

  for (let i = 0; i < 3; i++) {
    const c = readIngredientCount(ingTexts[i]);
    if (c) {
      out.ingredientCounts.value[i] = c.value;
      out.ingredientCounts.conf[i] = c.conf;
    }
  }
  applyIngredients(out);

  if (texts.nature) {
    const m = pickBest(texts.nature, NATURES, LAYOUT_TUNING.natureThreshold);
    if (m) out.nature = F(m.item.id, m.ratio);
  }

  out.rawText = out.debug.regions.map((r) => `[${r.field}] ${r.rawText}`).join('\n');
  out.debug.canvas = canvas; // 確認画面のサムネイル用（保存はしない）

  // アンカーが欠けていた分だけ、従来の全面OCRで埋める
  if (!complete) {
    emit(onProgress, '全体をもう一度読み取り中', 0.95);
    try {
      const ocr = await recognize(canvas, onProgress);
      const fb = parseFields(ocr);
      fillFromFallback(out, fb);
      applyIngredients(out); // 種族が後から決まることがあるので候補表を引き直す
      out.rawText += '\n\n[全体]\n' + (ocr.rawText || '');
      out.debug.lines = fb.debug ? fb.debug.lines : [];
    } catch (_) { /* フォールバックが失敗しても主経路の結果は返す */ }
  }

  emit(onProgress, '仕上げ中', 1);
  return out;
}

/**
 * 読めた個数と種族から食材3枠を決め直す。種族が変わったときも呼べるように切り出してある。
 * @param {object} out parseScreenshot の戻り値と同じ形
 */
function applyIngredients(out) {
  const resolved = resolveIngredients(out.species.value, out.ingredientCounts.value);
  out.ingredients.value = resolved;
  out.ingredients.conf = resolved.map((r, i) => {
    if (!r || !r.ing) return 0;                       // 候補が絞れていない＝フォームで選ばせる
    return r.count == null ? 0.85 : Math.max(0.85, out.ingredientCounts.conf[i] || 0);
  });
}

/** 主経路が null のままの項目だけを従来方式の結果で埋める */
function fillFromFallback(out, fb) {
  if (!fb) return;
  for (const key of ['level', 'sp', 'helpIntervalSec', 'carryLimit', 'mainSkill', 'mainSkillLevel', 'nature', 'specialty']) {
    if (out[key].value == null && fb[key] && fb[key].value != null) out[key] = fb[key];
  }
  if (out.species.value == null && fb.species && fb.species.value != null) out.species = fb.species;
  else if (!out.species.rawName && fb.species && fb.species.rawName) out.species.rawName = fb.species.rawName;
  for (let i = 0; i < 5; i++) {
    if (out.subskills.value[i] == null && fb.subskills && fb.subskills.value[i] != null) {
      out.subskills.value[i] = fb.subskills.value[i];
      out.subskills.conf[i] = fb.subskills.conf[i];
    }
  }
}

export default parseScreenshot;
