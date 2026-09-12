// 個体の判定結果を1枚のPNGカード（1080×1350）に描き、共有／保存する。
// Canvas 2D だけで描画する（依存ゼロ）。何も保存しない ―― 表示中の設定でその場で計算する。
// iOS Safari では <a download> が信頼できないため io.js と同じく navigator.share を優先する。

import { toast, formatTopPct } from './ui.js';
import { listIndividuals } from './store.js';
import { individualScore, scoreBreakdown, grade, rankAmong } from './score/score.js';
import { getDistribution } from './score/dist.js';
import { SPECIALTIES, SUBSKILLS, NATURES, STATS, SUBSKILL_UNLOCK_LEVELS, byId } from './data/gamedata.js';
import { INGREDIENTS } from './data/ingredients.js';
import { DEFAULT_SETTINGS } from './data/defaults.js';

const SUBSKILL_BY_ID = byId(SUBSKILLS);
const NATURE_BY_ID = byId(NATURES);
const STAT_BY_ID = byId(STATS);
const SPECIALTY_BY_ID = byId(SPECIALTIES);
const INGREDIENT_BY_ID = byId(INGREDIENTS);

/* ── 寸法 ─────────────────────────────────────────── */

const W = 1080;
const H = 1350;
/** 白パネル */
const PX = 60;
const PY = 60;
const PW = W - PX * 2;
const PH = H - PY * 2 - 30;
const PANEL_R = 40;
/** パネル内の本文の左右 */
const CX = PX + 56;
const CR = PX + PW - 56;
const CW = CR - CX;

const SITE_URL = 'hollowmark-dev.github.io/pokesleep-ranker';
const APP_NAME = 'ポケスリ個体評価';

/* ── 色 ───────────────────────────────────────────── */

const INK = '#1c2620';
const MUTED = '#6b776f';
const LINE = '#e1e6e3';

const GRADE_STYLE = {
  S: { from: '#ff9d3d', to: '#ffcf3d' },
  A: { flat: '#3ac26b' },
  B: { flat: '#4a90d9' },
  C: { flat: '#9aa7b8' },
  D: { flat: '#b9bfc3' },
};

// style.css の .chip-gold / .chip-silver / .chip-white と同じ配色
const RARITY_PILL = {
  gold: { bg: '#fdf3d8', border: '#e0b436', text: '#8a6d10' },
  silver: { bg: '#e6f0fb', border: '#5b9bd5', text: '#2b5f93' },
  white: { bg: '#ffffff', border: '#dddddd', text: '#666666' },
};
const NEUTRAL_PILL = { bg: '#eef1ef', border: '#dfe4e0', text: '#48544d' };
const SPECIALTY_PILL = {
  berry: RARITY_PILL.gold,
  ingredient: RARITY_PILL.silver,
  skill: { bg: '#e4f5ea', border: '#3ac26b', text: '#1e7a45' },
  all: NEUTRAL_PILL,
};

/* ── フォント ─────────────────────────────────────── */

const FAMILY = 'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif';
const font = (size, weight = '400') => `${weight} ${size}px ${FAMILY}`;

/** サブスキル×せいかくだけの母集団の大きさ（食材構成を含むとこれより大きくなる）。 */
const BASE_TOTAL = (() => {
  let perm = 1;
  for (let i = 0; i < 5; i++) perm *= SUBSKILLS.length - i;
  return perm * NATURES.length;
})();

/* ── 小道具 ───────────────────────────────────────── */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 英数字のかたまりは分割しない。日本語は1文字ずつ折り返せるようにする。 */
function tokenize(text) {
  const out = [];
  let buf = '';
  for (const ch of String(text)) {
    if (/[0-9A-Za-z.%+_/-]/.test(ch)) {
      buf += ch;
    } else {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      out.push(ch);
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** 現在の ctx.font で maxWidth に収まるよう末尾を「…」に置き換える。 */
function ellipsize(ctx, text, maxWidth) {
  const s = String(text);
  if (ctx.measureText(s).width <= maxWidth) return s;
  const chars = Array.from(s);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(chars.slice(0, mid).join('') + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join('') + '…';
}

/** 現在の ctx.font で折り返した行の配列。maxLines を超える分は最終行に「…」で畳む。 */
function wrapLines(ctx, text, maxWidth, maxLines = 2) {
  const tokens = tokenize(text);
  const lines = [];
  let cur = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = cur + t;
    if (cur !== '' && ctx.measureText(next).width > maxWidth) {
      lines.push(cur);
      if (lines.length >= maxLines) {
        lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1] + tokens.slice(i).join(''), maxWidth);
        return lines;
      }
      cur = t;
    } else {
      cur = next;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines.length ? lines : [''];
}

/** maxWidth に収まるまでフォントサイズを落とす。戻り値は決まったサイズ（ctx.font も設定済み）。 */
function fitFont(ctx, text, maxWidth, size, weight, min = 16) {
  let s = size;
  ctx.font = font(s, weight);
  while (s > min && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = font(s, weight);
  }
  return s;
}

/**
 * 角丸のピル。segments は [{ text, font, color? }]。
 * 戻り値は描いた幅（横に並べるときの送り量）。
 */
function drawPill(ctx, x, y, h, segments, style) {
  const padX = Math.round(h * 0.42);
  let w = padX * 2;
  for (const s of segments) {
    ctx.font = s.font;
    w += ctx.measureText(s.text).width;
  }
  ctx.fillStyle = style.bg;
  ctx.strokeStyle = style.border;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.stroke();

  const prevAlign = ctx.textAlign;
  const prevBase = ctx.textBaseline;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let tx = x + padX;
  for (const s of segments) {
    ctx.font = s.font;
    ctx.fillStyle = s.color || style.text;
    ctx.fillText(s.text, tx, y + h / 2);
    tx += ctx.measureText(s.text).width;
  }
  ctx.textAlign = prevAlign;
  ctx.textBaseline = prevBase;
  return w;
}

function formatInt(n) {
  return n != null && Number.isFinite(Number(n)) ? Number(n).toLocaleString('ja-JP') : '—';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDate(d) {
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

function natureDesc(nature) {
  if (!nature) return '';
  if (nature.desc) return nature.desc;
  if (!nature.up && !nature.down) return '変化なし';
  const name = (id) => (STAT_BY_ID[id] && STAT_BY_ID[id].name) || id;
  const parts = [];
  if (nature.up) parts.push(`${name(nature.up)}▲`);
  if (nature.down) parts.push(`${name(nature.down)}▼`);
  return parts.join(' ');
}

/** アプリアイコン。読めなければ null（アイコン無しで描く）。 */
function loadIcon() {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = new URL('../icons/icon-192.png', import.meta.url).href;
    } catch (e) {
      resolve(null);
    }
  });
}

/* ── 背景 ─────────────────────────────────────────── */

function drawBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1e3a5f');
  g.addColorStop(1, '#3ac26b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 星。毎回同じ絵になるよう固定シードの線形合同法で散らす
  let seed = 20260912;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  ctx.save();
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W;
    const y = rnd() * H * 0.62;
    const r = 1.2 + rnd() * 2.4;
    ctx.globalAlpha = Math.max(0.08, (0.3 + rnd() * 0.6) * (1 - y / (H * 0.7)));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPanel(ctx) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.30)';
  ctx.shadowBlur = 46;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, PX, PY, PW, PH, PANEL_R);
  ctx.fill();
  ctx.restore();
}

function drawGradeBadge(ctx, x, y, size, g) {
  const st = GRADE_STYLE[g] || GRADE_STYLE.D;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.20)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, x, y, size, size, 40);
  if (st.from) {
    const gr = ctx.createLinearGradient(x, y, x + size, y + size);
    gr.addColorStop(0, st.from);
    gr.addColorStop(1, st.to);
    ctx.fillStyle = gr;
  } else {
    ctx.fillStyle = st.flat;
  }
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.font = font(Math.round(size * 0.56), '900');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(g || '—', x + size / 2, y + size / 2 + 4);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

/* ── データ収集 ───────────────────────────────────── */

async function collect(ind, settings) {
  const score = individualScore(ind, settings);

  let dist = null;
  try {
    dist = await getDistribution(ind.specialty, settings, ind.species || null);
  } catch (e) {
    dist = null;
  }
  const topPct = dist ? dist.topPct(score) : null;
  const rankInAll = dist ? dist.rank(score) : null;
  const total = dist ? dist.total : null;

  let breakdown = null;
  try {
    breakdown = scoreBreakdown(ind, settings);
  } catch (e) {
    breakdown = null;
  }

  // 同じとくいタイプの手持ち内順位（2件以上あるときだけ）
  let handRank = null;
  try {
    const all = await listIndividuals();
    const same = (all || []).filter((i) => i && i.specialty === ind.specialty);
    if (same.length > 1) handRank = rankAmong(same, ind, settings);
  } catch (e) {
    handRank = null;
  }

  return {
    score,
    topPct,
    rankInAll,
    total,
    grade: topPct != null ? grade(topPct, settings) : null,
    // 母集団に食材構成が畳み込まれていれば、サブスキル×せいかくだけの数より必ず多い
    withIngredients: total != null && total > BASE_TOTAL,
    breakdown,
    handRank,
  };
}

/* ── 本体 ─────────────────────────────────────────── */

/**
 * 判定結果カードを描いた canvas を返す（1080×1350）。
 * @param {object} ind 個体
 * @param {object} settings getSettings() の戻り値
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderResultCard(ind, settings) {
  const data = await collect(ind, settings);
  const icon = await loadIcon();

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas を初期化できませんでした');

  drawBackground(ctx);
  drawPanel(ctx);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  let y = PY + 62;

  /* 見出し: 種族名（ニックネーム） */
  const base = ind.speciesName || ind.species || '（種族未設定）';
  const title = ind.nickname ? `${base}（${ind.nickname}）` : base;
  const nameSize = fitFont(ctx, title, CW, 62, '800', 32);
  ctx.fillStyle = INK;
  ctx.fillText(ellipsize(ctx, title, CW), CX, y);
  y += nameSize + 20;

  /* とくいタイプ・Lv・SP */
  const chipH = 46;
  const specMeta = SPECIALTY_BY_ID[ind.specialty];
  let cx = CX;
  if (specMeta) {
    cx += drawPill(ctx, cx, y, chipH, [{ text: specMeta.name, font: font(26, '800') }], SPECIALTY_PILL[ind.specialty] || NEUTRAL_PILL) + 10;
  }
  cx += drawPill(ctx, cx, y, chipH, [{ text: ind.level != null ? `Lv.${ind.level}` : 'Lv.—', font: font(25, '700') }], NEUTRAL_PILL) + 10;
  drawPill(ctx, cx, y, chipH, [{ text: ind.sp != null ? `SP ${formatInt(ind.sp)}` : 'SP —', font: font(25, '700') }], NEUTRAL_PILL);
  y += chipH + 26;

  /* ヒーロー: ランクバッジ ＋ 上位% */
  const badgeSize = 200;
  drawGradeBadge(ctx, CX, y, badgeSize, data.grade);
  const hx = CX + badgeSize + 36;
  const hw = CR - hx;

  ctx.font = font(34, '700');
  const labelW = ctx.measureText('上位').width + 16;
  const pctText = data.topPct != null ? formatTopPct(data.topPct) : '—';
  const pctSize = fitFont(ctx, pctText, hw - labelW, 94, '800', 40);
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(34, '700');
  ctx.fillStyle = MUTED;
  ctx.fillText('上位', hx, y + 92);
  ctx.font = font(pctSize, '800');
  ctx.fillStyle = INK;
  ctx.fillText(pctText, hx + labelW, y + 92);
  ctx.textBaseline = 'top';

  ctx.font = font(34, '700');
  ctx.fillStyle = INK;
  const rankText =
    data.rankInAll != null && data.total != null
      ? `${formatInt(data.rankInAll)}位 / 全 ${formatInt(data.total)} パターン`
      : '—';
  ctx.fillText(ellipsize(ctx, rankText, hw), hx, y + 112);

  ctx.font = font(23, '400');
  ctx.fillStyle = MUTED;
  const note = data.withIngredients
    ? 'サブスキル×せいかく×食材構成の全パターン中'
    : 'サブスキル×せいかくの全パターン中';
  const noteLines = wrapLines(ctx, note, hw, 2);
  noteLines.forEach((ln, i) => ctx.fillText(ln, hx, y + 162 + i * 30));

  y += Math.max(badgeSize, 162 + noteLines.length * 30) + 48;

  /* サブスキル */
  ctx.font = font(25, '800');
  ctx.fillStyle = MUTED;
  ctx.fillText('サブスキル', CX, y);
  y += 38;

  const subs = Array.isArray(ind.subskills) ? ind.subskills : [];
  const unlocks =
    Array.isArray(ind.subskillUnlockLevels) && ind.subskillUnlockLevels.length === 5
      ? ind.subskillUnlockLevels
      : SUBSKILL_UNLOCK_LEVELS;
  const rowH = 56;
  for (let i = 0; i < 5; i++) {
    const meta = subs[i] ? SUBSKILL_BY_ID[subs[i]] : null;
    const style = meta && RARITY_PILL[meta.rarity] ? RARITY_PILL[meta.rarity] : RARITY_PILL.white;
    const lv = unlocks[i] != null ? `Lv.${unlocks[i]}` : 'Lv.—';
    drawPill(
      ctx,
      CX,
      y,
      rowH,
      [
        { text: `枠${i + 1} ${lv}`, font: font(22, '600') },
        { text: `　${meta ? meta.name : '—'}`, font: font(27, '800') },
      ],
      style
    );
    y += rowH + 12;
  }
  y += 26;

  /* せいかく・食材・手持ち順位 */
  const lineFont = font(25, '600');
  const lineGap = 34;
  const infoLine = (label, value) => {
    ctx.font = lineFont;
    const lines = wrapLines(ctx, `${label}: ${value}`, CW, 2);
    for (const ln of lines) {
      ctx.fillStyle = INK;
      ctx.fillText(ln, CX, y);
      y += lineGap;
    }
    y += 9;
  };

  const natureMeta = ind.nature ? NATURE_BY_ID[ind.nature] : null;
  infoLine('せいかく', natureMeta ? `${natureMeta.name}（${natureDesc(natureMeta)}）` : '—');

  const ingText = (Array.isArray(ind.ingredients) ? ind.ingredients : [])
    .filter((e) => e && e.ing)
    .map((e) => `${(INGREDIENT_BY_ID[e.ing] && INGREDIENT_BY_ID[e.ing].name) || e.ing}×${e.count != null ? e.count : '?'}`)
    .join(' / ');
  if (ingText) infoLine('食材', ingText);

  if (data.handRank && specMeta) {
    infoLine('手持ち', `${specMeta.name}タイプで ${data.handRank.rank}/${data.handRank.total}位`);
  }

  /* フッター */
  const fy = PY + PH - 130;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CX, fy);
  ctx.lineTo(CR, fy);
  ctx.stroke();

  const iy = fy + 26;
  if (icon) ctx.drawImage(icon, CX, iy, 64, 64);
  const tx = CX + (icon ? 64 + 18 : 0);
  ctx.font = font(30, '800');
  ctx.fillStyle = INK;
  ctx.fillText(APP_NAME, tx, iy + 4);
  const appNameRight = tx + ctx.measureText(APP_NAME).width;

  const version = (settings && settings.weightsVersion) || DEFAULT_SETTINGS.weightsVersion || '—';
  ctx.font = font(22, '400');
  ctx.fillStyle = MUTED;
  ctx.fillText(`評価ルール v${version} ・ ${formatDate(new Date())}`, tx, iy + 42);

  // アプリ名の右に残った幅にURLを右寄せ（足りなければ省略）
  ctx.textAlign = 'right';
  ctx.font = font(22, '600');
  ctx.fillStyle = MUTED;
  ctx.fillText(ellipsize(ctx, SITE_URL, CR - appNameRight - 24), CR, iy + 10);
  ctx.textAlign = 'left';

  return canvas;
}

/* ── 保存・共有 ───────────────────────────────────── */

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    try {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob((b) => resolve(b || null), 'image/png');
        return;
      }
      const url = canvas.toDataURL('image/png');
      const bin = atob(url.slice(url.indexOf(',') + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve(new Blob([bytes], { type: 'image/png' }));
    } catch (e) {
      resolve(null);
    }
  });
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

/** ファイル名に使えない文字を落とす。 */
function cardFilename(ind) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const raw = ind.nickname || ind.speciesName || ind.species || 'pokemon';
  const safe = String(raw).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24) || 'pokemon';
  return `pokesleep-${safe}-${stamp}.png`;
}

/**
 * 判定結果カードを共有（無理ならダウンロード）する。
 * 共有のキャンセル（AbortError）はエラー扱いしない。
 * 戻り値: { method: 'share'|'cancelled'|'download'|'error' }
 */
export async function shareResultCard(ind, settings) {
  let canvas;
  try {
    canvas = await renderResultCard(ind, settings);
  } catch (e) {
    toast('画像の作成に失敗しました', 'error');
    return { method: 'error' };
  }

  const blob = await canvasToBlob(canvas);
  if (!blob) {
    toast('画像の作成に失敗しました', 'error');
    return { method: 'error' };
  }

  const filename = cardFilename(ind);
  const title = `${ind.nickname || ind.speciesName || ind.species || ''} の判定結果`.trim();

  let file = null;
  try {
    file = new File([blob], filename, { type: 'image/png' });
  } catch (e) {
    file = null; // File コンストラクタ非対応環境向けフォールバック
  }

  if (file && canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: title || APP_NAME });
      toast('共有しました');
      return { method: 'share' };
    } catch (e) {
      if (e && e.name === 'AbortError') {
        // ユーザーが共有をやめただけ。何も言わない
        return { method: 'cancelled' };
      }
      downloadBlob(blob, filename);
      toast('画像を保存しました');
      return { method: 'download' };
    }
  }

  try {
    downloadBlob(blob, filename);
  } catch (e) {
    toast('画像の保存に失敗しました', 'error');
    return { method: 'error' };
  }
  toast('画像を保存しました');
  return { method: 'download' };
}

/**
 * 判定結果カードを端末に保存する（常にダウンロード。共有シートは出さない）。
 * 戻り値: { method: 'download'|'error' }
 */
export async function saveResultCard(ind, settings) {
  let canvas;
  try {
    canvas = await renderResultCard(ind, settings);
  } catch (e) {
    toast('画像の作成に失敗しました', 'error');
    return { method: 'error' };
  }
  const blob = await canvasToBlob(canvas);
  if (!blob) {
    toast('画像の作成に失敗しました', 'error');
    return { method: 'error' };
  }
  try {
    downloadBlob(blob, cardFilename(ind));
  } catch (e) {
    toast('画像の保存に失敗しました', 'error');
    return { method: 'error' };
  }
  toast('画像を保存しました');
  return { method: 'download' };
}
