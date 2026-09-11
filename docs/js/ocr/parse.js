// OCR結果（行＋座標）から個体の各項目を取り出す。
// 画面の見出し（「おてつだい時間」「最大所持数」「せいかく」など）をアンカーにして
// その周辺だけを読むアンカー方式。見出しが読めなかった項目は null を返し、例外は投げない。

import {
  SPECIALTIES, SUBSKILLS, NATURES, MAIN_SKILLS, STATS, SUBSKILL_UNLOCK_LEVELS,
} from '../data/gamedata.js';
import { SPECIES } from '../data/species.js';
import {
  normalize, bestSubstring, bestMatch, parseIntLoose, sizeLetter,
} from './fuzzy.js';

const DEFAULT_UNLOCK = (Array.isArray(SUBSKILL_UNLOCK_LEVELS) && SUBSKILL_UNLOCK_LEVELS.length === 5)
  ? SUBSKILL_UNLOCK_LEVELS.slice()
  : [10, 25, 50, 75, 100];

// ── 調整つまみ ──────────────────────────────────────────
export const TUNING = {
  speciesThreshold: 0.7,      // 種族名
  specialtyThreshold: 0.7,    // とくいタイプ
  mainSkillThreshold: 0.62,   // メインスキル名（説明文と紛れないよう少し緩め）
  subskillThreshold: 0.75,    // サブスキルのチップ
  natureThreshold: 0.67,      // せいかく
  statThreshold: 0.75,        // せいかく効果のステータス名
  labelThreshold: 0.7,        // 見出しラベルの検出
  chipMaxLen: 24,             // チップ候補として許す正規化後の最大文字数
  rowGapFactor: 0.6,          // チップの行分割（Δy > この係数 × 行高の中央値 で改行）
};

const F = (value, conf) => ({ value: value === undefined ? null : value, conf: Math.max(0, Math.min(1, conf || 0)) });

const cy = (b) => (b.y0 + b.y1) / 2;
const cx = (b) => (b.x0 + b.x1) / 2;
const hOf = (b) => Math.max(1, b.y1 - b.y0);

function stripLv(s) {
  return String(s || '').replace(/[li1|!]\s*[vy]\s*[.:：。、]?\s*[0-9OoIlSs]{1,3}/gi, ' ').trim();
}

function firstLv(s, min = 1, max = 100) {
  const re = /[li1|!]\s*[vy]\s*[.:：。、]?\s*([0-9OoIlSs]{1,3})/gi;
  let m;
  while ((m = re.exec(String(s || '')))) {
    const v = parseIntLoose(m[1]);
    if (v != null && v >= min && v <= max) return v;
  }
  return null;
}

/** 「Lv. 50」だけの行（サブスキル解放レベルのタグ）か */
function isLvTagOnly(norm) {
  const v = firstLv(norm, 1, 100);
  if (v == null) return false;
  return stripLv(norm).replace(/[^0-9a-z　-￿]/g, '').length <= 2;
}

function median(nums) {
  if (!nums.length) return 0;
  const a = nums.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** ocrResult を {raw, norm, bbox, conf} の配列に整える。lines が無い場合は rawText から作る */
function toLines(ocrResult) {
  const src = Array.isArray(ocrResult?.lines) && ocrResult.lines.length
    ? ocrResult.lines
    : String(ocrResult?.rawText || '').split(/\r?\n/).map((t, i) => ({
      text: t,
      bbox: { x0: 0, y0: i * 40, x1: Math.max(1, t.length * 20), y1: i * 40 + 32 },
      conf: 0.5,
    }));
  return src
    .map((l) => ({
      raw: String(l.text || '').trim(),
      norm: normalize(l.text),
      bbox: l.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
      conf: typeof l.conf === 'number' ? l.conf : 0.5,
      tokens: l.tokens || [],
    }))
    .filter((l) => l.raw.length > 0)
    .sort((a, b) => (a.bbox.y0 - b.bbox.y0) || (a.bbox.x0 - b.bbox.x0));
}

/**
 * 見出しラベルを含む行を探す。pick で複数候補から選ぶ（既定は最初＝いちばん上）。
 * @returns {{idx:number, line:object, rest:string, ratio:number}|null}
 */
function findLabel(lines, label, { threshold = TUNING.labelThreshold, from = 0, to = Infinity, all = false } = {}) {
  const hits = [];
  for (let i = Math.max(0, from); i < Math.min(lines.length, to); i++) {
    const l = lines[i];
    const s = bestSubstring(l.norm, label);
    if (s.ratio >= threshold) {
      const rest = (l.norm.slice(0, s.start) + l.norm.slice(s.end)).trim();
      hits.push({ idx: i, line: l, rest, ratio: s.ratio });
    }
  }
  if (!hits.length) return null;
  return all ? hits : hits[0];
}

/**
 * ラベルの値を探す範囲を、狭い順に広げて返す。
 * 値はラベルの右隣にあることが多く、その場合ピルより数px上にあるため
 * 「次の行」だけを見ると取り逃す（y でソートすると値の方が先に来る）。
 * ① ラベル行の残り → ② 同じ段の別カラム → ③ 前後の行
 */
function searchTexts(lines, idx, rest) {
  const label = lines[idx];
  const peers = rowPeers(lines, label).filter((l) => l !== label).map((l) => l.norm);
  const around = [];
  for (const k of [1, -1, 2, -2]) {
    const l = lines[idx + k];
    if (l && l !== label && !peers.includes(l.norm)) around.push(l.norm);
  }
  const a = rest || '';
  const b = [a, ...peers].join(' ');
  const c = [b, ...around].join(' ');
  return [a, b, c];
}

// ── 個別の項目 ──────────────────────────────────────────

function readSp(lines) {
  for (const l of lines) {
    const m = l.norm.match(/[s5$][pr]\s*[:：.]?\s*([0-9oilsb,]{1,8})/i);
    if (!m) continue;
    const v = parseIntLoose(m[1]);
    if (v != null && v > 0 && v < 100000) return { line: l, value: v, conf: Math.max(0.6, l.conf) };
  }
  return null;
}

/** レベル＋種族名の行を選ぶ。きのみアイコンの「Lv. 30」タグと取り違えないよう位置も見る */
function readSpeciesLine(lines, spLine, W, H) {
  let best = null;
  for (const l of lines) {
    const lv = firstLv(l.norm, 1, 100);
    if (lv == null) continue;
    const restRaw = stripLv(l.raw);
    const sm = restRaw ? bestMatch(restRaw, SPECIES, { threshold: 0 }) : null;
    let score = sm ? sm.ratio : 0;
    if (spLine) {
      const dy = Math.abs(cy(l.bbox) - cy(spLine.bbox)) / Math.max(1, H);
      const dx = Math.abs(l.bbox.x0 - spLine.bbox.x0) / Math.max(1, W);
      score += 0.5 * (1 - Math.min(1, dy * 8));
      score += 0.3 * (1 - Math.min(1, dx * 3));
    }
    if (normalize(restRaw).length >= 2) score += 0.15;
    if (!best || score > best.score) best = { line: l, lv, restRaw, sm, score };
  }
  return best;
}

function readSpecialty(lines, speciesLine, speciesItem) {
  let ocrHit = null;
  const limit = speciesLine ? speciesLine.bbox.y0 + hOf(speciesLine.bbox) * 0.5 : Infinity;
  for (const l of lines) {
    if (l.bbox.y1 > limit) continue;
    const m = bestMatch(l.norm, SPECIALTIES, { threshold: TUNING.specialtyThreshold });
    if (m && (!ocrHit || m.ratio > ocrHit.ratio)) ocrHit = m;
  }
  const fromTable = speciesItem && speciesItem.specialty ? speciesItem.specialty : null;
  if (fromTable && ocrHit) {
    if (ocrHit.item.id === fromTable) return F(fromTable, Math.max(0.9, ocrHit.ratio));
    return F(fromTable, 0.55); // 食い違ったら種族テーブルを優先し、確度は下げる
  }
  if (fromTable) return F(fromTable, 0.75);
  if (ocrHit) return F(ocrHit.item.id, ocrHit.ratio);
  return F(null, 0);
}

function readHelpInterval(lines) {
  const hits = findLabel(lines, 'おてつだい時間', { all: true }) || [];
  for (const h of hits) {
    for (const text of searchTexts(lines, h.idx, h.rest)) {
      if (!/[時分秒]/.test(text)) continue;
      const mh = text.match(/(\d{1,2})\s*時間/);
      const mm = text.match(/(\d{1,3})\s*分/);
      const ms = text.match(/(\d{1,2})\s*秒/);
      if (!mh && !mm && !ms) continue;
      const sec = (mh ? parseInt(mh[1], 10) * 3600 : 0)
        + (mm ? parseInt(mm[1], 10) * 60 : 0)
        + (ms ? parseInt(ms[1], 10) : 0);
      if (sec >= 30 && sec <= 36000) {
        const conf = (mm && ms) ? Math.max(0.85, h.line.conf) : 0.6;
        return { value: sec, conf, line: h.line };
      }
    }
  }
  return null;
}

function readCarryLimit(lines) {
  const hits = findLabel(lines, '最大所持数', { all: true }) || [];
  for (const h of hits) {
    for (const text of searchTexts(lines, h.idx, h.rest)) {
      const m = text.match(/(\d{1,3})\s*個/);
      if (!m) continue;
      const v = parseInt(m[1], 10);
      if (v >= 1 && v <= 300) {
        return { value: v, conf: Math.max(0.85, h.line.conf), line: h.line };
      }
    }
  }
  return null;
}

/** 同じ行（y範囲が重なる別カラム）を集める */
function rowPeers(lines, line) {
  return lines.filter((l) => {
    const ov = Math.min(l.bbox.y1, line.bbox.y1) - Math.max(l.bbox.y0, line.bbox.y0);
    return ov > 0.4 * Math.min(hOf(l.bbox), hOf(line.bbox));
  });
}

const HEADER_MAIN = 'メインスキル・サブスキル';
const HEADER_DETAIL = '詳細ステータス';

function isHeader(norm) {
  return bestSubstring(norm, HEADER_MAIN).ratio >= 0.8 || bestSubstring(norm, HEADER_DETAIL).ratio >= 0.8;
}

function readMainSkill(lines, fromY, toY) {
  let best = null;
  for (const l of lines) {
    if (l.bbox.y0 < fromY || l.bbox.y1 > toY) continue;
    if (isHeader(l.norm)) continue;
    const text = stripLv(l.norm);
    if (normalize(text).length < 2) continue;
    const m = bestMatch(text, MAIN_SKILLS, { threshold: TUNING.mainSkillThreshold });
    if (m && (!best || m.ratio > best.ratio)) best = { ...m, line: l };
  }
  if (!best) return null;
  let lv = firstLv(best.line.norm, 1, 10);
  if (lv == null) {
    for (const p of rowPeers(lines, best.line)) {
      lv = firstLv(p.norm, 1, 10);
      if (lv != null) break;
    }
  }
  return { item: best.item, ratio: best.ratio, line: best.line, level: lv };
}

// サブスキルの S / M / L を切り分けるための下準備
function baseKey(name) {
  return normalize(name).replace(/[sml]$/, '');
}
function suffixOf(name) {
  const n = normalize(name);
  const ch = n[n.length - 1];
  return (ch === 's' || ch === 'm' || ch === 'l') ? ch.toUpperCase() : null;
}
const SIZE_GROUPS = (() => {
  const g = new Map();
  for (const s of (SUBSKILLS || [])) {
    const k = baseKey(s.name);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(s);
  }
  return g;
})();

/**
 * 一文字違いの S/M/L を、マッチした部分文字列の末尾英数字から決め直す。
 * レイアウト方式（layout.js）からも使うので export する。
 * @param {{item:object, matched:string}} match bestMatch の戻り値
 * @returns {{item:object, factor:number}} factor は確度に掛ける係数
 */
export function resolveSize(match) {
  const sibs = SIZE_GROUPS.get(baseKey(match.item.name)) || [match.item];
  if (sibs.length <= 1) return { item: match.item, factor: 1 };
  const letter = sizeLetter(match.matched);
  if (!letter) return { item: match.item, factor: 0.75 };
  const hit = sibs.find((x) => suffixOf(x.name) === letter);
  if (!hit) return { item: match.item, factor: 0.8 };
  return { item: hit, factor: hit.id === match.item.id ? 1 : 0.95 };
}

/**
 * サブスキルのチップ（5枠）と解放レベルのタグを読む。
 * @returns {{chips:Array, unlocks:Array<{value:number, line:object}>}}
 */
function readSubskills(lines, fromY, toY, W) {
  const tags = [];
  const cands = [];
  for (const l of lines) {
    if (l.bbox.y0 < fromY || l.bbox.y1 > toY) continue;
    if (isHeader(l.norm)) continue;
    if (isLvTagOnly(l.norm)) {
      const v = firstLv(l.norm, 1, 100);
      if (v != null) tags.push({ value: v, line: l });
      continue;
    }
    const text = stripLv(l.norm);
    const n = normalize(text);
    if (n.length < 3 || n.length > TUNING.chipMaxLen) continue;
    const m = bestMatch(text, SUBSKILLS, { threshold: TUNING.subskillThreshold });
    if (!m) continue;
    // 「せいかく」の効果テキスト（ステータス名）はサブスキル名と字面が近い。より近い方を採る
    const st = bestMatch(text, STATS, { threshold: 0 });
    if (st && st.ratio > m.ratio) continue;
    const sized = resolveSize(m);
    cands.push({ item: sized.item, ratio: m.ratio * sized.factor, line: l });
  }

  // 同じサブスキルが二重に拾われたら確度の高い方だけ残す
  const byId = new Map();
  for (const c of cands) {
    const prev = byId.get(c.item.id);
    if (!prev || c.ratio > prev.ratio) byId.set(c.item.id, c);
  }
  let chips = [...byId.values()];
  if (chips.length > 5) {
    chips = chips.sort((a, b) => b.ratio - a.ratio).slice(0, 5);
  }

  // 位置で 枠1..5 に並べ直す（2列グリッド・行優先）
  chips.sort((a, b) => cy(a.line.bbox) - cy(b.line.bbox));
  const medH = median(chips.map((c) => hOf(c.line.bbox))) || 30;
  const rows = [];
  for (const c of chips) {
    const last = rows[rows.length - 1];
    if (!last || (cy(c.line.bbox) - cy(last[last.length - 1].line.bbox)) > TUNING.rowGapFactor * medH) {
      rows.push([c]);
    } else {
      last.push(c);
    }
  }
  for (const r of rows) r.sort((a, b) => cx(a.line.bbox) - cx(b.line.bbox));
  const ordered = rows.flat();

  assignUnlockTags(ordered, tags, medH, W);
  return { chips: ordered, unlocks: tags };
}

/** 解放レベルのタグを、同じ列の「すぐ下のチップ」に割り当てる */
function assignUnlockTags(chips, tags, medH, W) {
  if (!chips.length || !tags.length) return;
  const centers = chips.map((c) => cx(c.line.bbox));
  const split = (Math.min(...centers) + Math.max(...centers)) / 2;
  const twoCols = (Math.max(...centers) - Math.min(...centers)) > 0.15 * Math.max(1, W);
  for (const t of tags) {
    const tc = cx(t.line.bbox);
    let best = null;
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i];
      const dy = cy(c.line.bbox) - cy(t.line.bbox);
      if (dy <= 0 || dy > 3 * medH) continue;
      if (twoCols && ((tc < split) !== (cx(c.line.bbox) < split))) continue;
      if (!best || dy < best.dy) best = { slot: i, dy };
    }
    if (best) t.slot = best.slot;
  }
}

function readNature(lines, fromY, W) {
  const label = findLabel(lines, 'せいかく', { from: 0, all: true }) || [];
  const lab = label.find((h) => h.line.bbox.y0 >= fromY) || label[0] || null;

  // 候補: ラベル行の残り + 続く数行（名前は必ずラベルの真下にある）
  const cands = [];
  if (lab) {
    if (lab.rest) cands.push({ text: lab.rest, line: lab.line, sameCol: true });
    for (let k = 1; k <= 4 && lab.idx + k < lines.length; k++) {
      const l = lines[lab.idx + k];
      // 名前はラベルのピルの真下にある。効果テキストは右カラムなので x が大きく離れる
      const near = Math.abs(cx(l.bbox) - cx(lab.line.bbox)) < 0.25 * Math.max(1, W);
      cands.push({ text: l.norm, line: l, sameCol: near });
    }
  } else {
    for (const l of lines) if (l.bbox.y0 >= fromY) cands.push({ text: l.norm, line: l, sameCol: false });
  }

  let nameHit = null;
  for (const c of cands) {
    const m = bestMatch(c.text, NATURES, { threshold: TUNING.natureThreshold });
    if (!m) continue;
    const score = m.ratio + (c.sameCol ? 0.15 : 0);
    if (!nameHit || score > nameHit.score) nameHit = { ...m, score, line: c.line };
  }

  // ▲▼ の効果テキストで裏取りする
  const effect = readNatureEffect(lines, lab ? lab.line.bbox.y0 - 2 * hOf(lab.line.bbox) : fromY);
  let byEffect = null;
  if (effect && (effect.up || effect.down)) {
    const matches = (NATURES || []).filter((n) => n.up === effect.up && n.down === effect.down);
    if (matches.length === 1) byEffect = matches[0];
  }

  if (nameHit && byEffect) {
    if (nameHit.item.id === byEffect.id) return F(byEffect.id, Math.min(1, nameHit.ratio + 0.15));
    if (nameHit.ratio < 0.85) return F(byEffect.id, 0.8);
    return F(nameHit.item.id, nameHit.ratio * 0.85);
  }
  if (nameHit) return F(nameHit.item.id, nameHit.ratio);
  if (byEffect) return F(byEffect.id, 0.7);
  return F(null, 0);
}

const UP_MARK = /[▲△▴⬆]/;
const DOWN_MARK = /[▼▽▾⬇]/;

/** 「食材おてつだい確率▲ おてつだいスピード▼」から up/down のステータスIDを取る */
function readNatureEffect(lines, fromY) {
  const found = [];
  for (const l of lines) {
    if (l.bbox.y1 < fromY) continue;
    const m = bestMatch(l.norm, STATS, { threshold: TUNING.statThreshold });
    if (!m) continue;
    const raw = l.raw;
    let dir = null;
    if (UP_MARK.test(raw)) dir = 'up';
    else if (DOWN_MARK.test(raw)) dir = 'down';
    found.push({ id: m.item.id, dir, y: cy(l.bbox), ratio: m.ratio });
  }
  if (!found.length) return null;
  found.sort((a, b) => a.y - b.y);
  const up = found.find((f) => f.dir === 'up');
  const down = found.find((f) => f.dir === 'down');
  if (up || down) return { up: up ? up.id : null, down: down ? down.id : null };
  // 矢印が読めなかった場合は「上が▲・下が▼」という画面の並び順に従う
  if (found.length >= 2) return { up: found[0].id, down: found[1].id };
  return null;
}

// ── 本体 ────────────────────────────────────────────────

function emptyResult(rawText) {
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
    subskillUnlockLevels: { value: DEFAULT_UNLOCK.slice(), conf: [0.3, 0.3, 0.3, 0.3, 0.3] },
    nature: F(null, 0),
    rawText: rawText || '',
    debug: { lines: [], anchors: {} },
  };
}

/**
 * OCR結果から各項目を取り出す。
 * @param {{rawText?:string, tokens?:Array, lines?:Array}} ocrResult
 * @returns {object} 各項目 { value, conf }。SPEC.md の「保存する個体」に対応。
 */
export function parseFields(ocrResult) {
  const rawText = String(ocrResult?.rawText || '');
  const out = emptyResult(rawText);
  try {
    const lines = toLines(ocrResult);
    if (!lines.length) return out;

    const W = Math.max(1, ...lines.map((l) => l.bbox.x1));
    const H = Math.max(1, ...lines.map((l) => l.bbox.y1));
    out.debug.lines = lines.map((l) => ({ text: l.raw, bbox: l.bbox }));

    // SP・レベル・種族名
    const sp = readSp(lines);
    if (sp) out.sp = F(sp.value, sp.conf);

    const spec = readSpeciesLine(lines, sp ? sp.line : null, W, H);
    let speciesItem = null;
    if (spec) {
      out.level = F(spec.lv, Math.max(0.7, spec.line.conf));
      const nameRaw = spec.restRaw || '';
      if (spec.sm && spec.sm.ratio >= TUNING.speciesThreshold) {
        speciesItem = spec.sm.item;
        out.species = { value: speciesItem.id, conf: spec.sm.ratio, rawName: nameRaw };
      } else {
        out.species = { value: null, conf: 0, rawName: nameRaw };
      }
      out.debug.anchors.speciesLine = spec.line.raw;
    }

    // とくいタイプ（種族テーブルと突き合わせる）
    out.specialty = readSpecialty(lines, spec ? spec.line : null, speciesItem);

    // おてつだい時間・最大所持数
    const hi = readHelpInterval(lines);
    if (hi) out.helpIntervalSec = F(hi.value, hi.conf);
    const cl = readCarryLimit(lines);
    if (cl) out.carryLimit = F(cl.value, cl.conf);

    // 領域の区切り
    const detail = findLabel(lines, HEADER_DETAIL, { threshold: 0.8 });
    const natureLab = findLabel(lines, 'せいかく', { threshold: 0.75 });
    const lowerBound = detail ? detail.line.bbox.y0
      : (natureLab ? natureLab.line.bbox.y0 : H + 1);
    const upperBound = cl ? cl.line.bbox.y1
      : (spec ? spec.line.bbox.y1 : 0);

    // メインスキル
    const ms = readMainSkill(lines, upperBound, lowerBound);
    if (ms) {
      out.mainSkill = F(ms.item.id, ms.ratio);
      out.mainSkillLevel = ms.level != null ? F(ms.level, 0.85) : F(1, 0.4);
      out.debug.anchors.mainSkillLine = ms.line.raw;
    }

    // サブスキル（メインスキル行より下、詳細ステータスより上）
    const subFrom = ms ? ms.line.bbox.y1 : upperBound;
    const { chips, unlocks } = readSubskills(lines, subFrom, lowerBound, W);
    for (let i = 0; i < 5; i++) {
      const c = chips[i];
      out.subskills.value[i] = c ? c.item.id : null;
      out.subskills.conf[i] = c ? Math.min(1, c.ratio) : 0;
    }

    // 解放レベル
    for (const t of unlocks) {
      if (typeof t.slot === 'number' && t.slot >= 0 && t.slot < 5) {
        out.subskillUnlockLevels.value[t.slot] = t.value;
        out.subskillUnlockLevels.conf[t.slot] = 0.85;
      }
    }
    out.debug.anchors.unlockTags = unlocks.map((t) => ({ value: t.value, slot: t.slot ?? null }));

    // せいかく（見出しが読めていればその位置から、無ければ最後のチップより下を見る）
    const lastChipY = chips.length ? Math.max(...chips.map((c) => c.line.bbox.y1)) : 0;
    const natureFrom = detail ? detail.line.bbox.y0 - 1
      : (natureLab ? natureLab.line.bbox.y0 - 1 : (lastChipY || upperBound));
    out.nature = readNature(lines, natureFrom, W);

    return out;
  } catch (_) {
    return out; // 何が起きても呼び元は空の結果を受け取れる
  }
}

export default parseFields;
