// 個体詳細画面。スコア内訳・蓄積内の順位・同じ種族との比較を表示する。

import { el, toast, confirmModal, formatTopPct } from '../ui.js';
import { navigate } from '../app.js';
import { getIndividual, listIndividuals, deleteIndividual } from '../store.js';
import { getSettings } from '../settings.js';
import {
  individualScore, scoreBreakdown, natureScore, grade, rankAmong,
  ingredientScore, ingredientPoints, ingredientCombos,
} from '../score/score.js';
import { getDistribution } from '../score/dist.js';
import { shareResultCard } from '../share-card.js';
import { SPECIALTIES, SUBSKILLS, NATURES, STATS, MAIN_SKILLS, SUBSKILL_UNLOCK_LEVELS, byId } from '../data/gamedata.js';
import { INGREDIENT_UNLOCK_LEVELS } from '../data/ingredients.js';

const SUBSKILL_BY_ID = byId(SUBSKILLS);
const NATURE_BY_ID = byId(NATURES);
const STATS_BY_ID = byId(STATS);
const MAIN_SKILL_BY_ID = byId(MAIN_SKILLS);
const SPECIALTY_BY_ID = byId(SPECIALTIES);

export async function render(container, { id } = {}) {
  container.replaceChildren(el('div', { class: 'view-loading' }, '読み込み中…'));

  let ind;
  try {
    ind = id ? await getIndividual(id) : null;
  } catch (e) {
    ind = null;
  }
  if (!ind) {
    toast('個体が見つかりませんでした', 'error');
    navigate('#/');
    return;
  }

  let settings;
  let allIndividuals;
  try {
    [settings, allIndividuals] = await Promise.all([getSettings(), listIndividuals()]);
  } catch (e) {
    toast('データの読み込みに失敗しました', 'error');
    container.replaceChildren();
    return;
  }

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
  const g = topPct != null ? grade(topPct, settings) : null;

  const breakdown = normalizeBreakdown(safeScoreBreakdown(ind, settings), ind, settings);
  const comboRank = ingredientComboRank(ind, settings);
  // 母集団に食材構成が含まれるのは「その種族の構成が分かっていて、かつ重みが0でない」ときだけ
  const withIngredients = !!(comboRank && comboRank.total > 1 && breakdownHasIngredientWeight(ind, settings));

  container.replaceChildren(
    headerSection(ind),
    headlineSection(g, topPct, rankInAll, total, withIngredients),
    accumulatedRankSection(ind, allIndividuals, settings),
    breakdownSection(ind, breakdown, score),
    ingredientSection(ind, breakdown, comboRank, settings),
    detailsSection(ind),
    actionsSection(ind, settings),
    compareSection(ind, allIndividuals, settings)
  );
}

/** そのとくいタイプで食材構成を評価するか（ingredientWeights > 0）。 */
function breakdownHasIngredientWeight(ind, settings) {
  const w = Number(((settings && settings.ingredientWeights) || {})[ind.specialty] || 0);
  return Number.isFinite(w) && w > 0;
}

/**
 * この個体の食材構成が、その種族の全パターン中で何番目か。
 * 同点は同順位（自分より厳密に高い数 + 1）。種族未登録なら null。
 */
function ingredientComboRank(ind, settings) {
  let combos = null;
  try {
    combos = ind.species ? ingredientCombos(ind.species) : null;
  } catch (e) {
    combos = null;
  }
  if (!combos || combos.length === 0) return null;
  const mine = ingredientPoints(ind, settings);
  let higher = 0;
  for (const c of combos) {
    const p = ingredientPoints({ specialty: ind.specialty, ingredients: c }, settings);
    if (p > mine + 1e-9) higher++;
  }
  const known = (ind.ingredients || []).some((e) => e && e.ing);
  return { rank: higher + 1, total: combos.length, known };
}

function safeScoreBreakdown(ind, settings) {
  try {
    return scoreBreakdown(ind, settings);
  } catch (e) {
    return null;
  }
}

// scoreBreakdown の戻り値の形が「配列」「{slots|rows|breakdown, naturePoints}」いずれでも吸収する
function normalizeBreakdown(raw, ind, settings) {
  let slots = [];
  let naturePoints = null;
  let ingredients = [];
  let ingredientBonus = 0;
  let ingPoints = null;
  let ingRaw = null;
  if (Array.isArray(raw)) {
    slots = raw;
  } else if (raw && typeof raw === 'object') {
    slots = raw.slots || raw.rows || raw.breakdown || [];
    naturePoints = typeof raw.naturePoints === 'number' ? raw.naturePoints : null;
    ingredients = Array.isArray(raw.ingredients) ? raw.ingredients : [];
    ingredientBonus = typeof raw.ingredientBonus === 'number' ? raw.ingredientBonus : 0;
    ingPoints = typeof raw.ingredientPoints === 'number' ? raw.ingredientPoints : null;
    ingRaw = typeof raw.ingredientScore === 'number' ? raw.ingredientScore : null;
  }
  if (naturePoints == null) {
    naturePoints = natureScore(ind.specialty, ind.nature, settings);
  }
  if (ingPoints == null) ingPoints = ingredientPoints(ind, settings);
  if (ingRaw == null) ingRaw = ingredientScore(ind, settings);
  return { slots, naturePoints, ingredients, ingredientBonus, ingredientPoints: ingPoints, ingredientScore: ingRaw };
}

function formatPct(pct) {
  return formatTopPct(pct);
}

function formatInt(n) {
  return n != null ? n.toLocaleString('ja-JP') : '—';
}

function formatHelpInterval(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分${s}秒`;
}

function formatDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('ja-JP');
}

function natureDesc(nature) {
  if (!nature) return '';
  if (nature.desc) return nature.desc;
  if (!nature.up && !nature.down) return '変化なし';
  const statName = (sid) => STATS_BY_ID[sid]?.name ?? sid;
  const parts = [];
  if (nature.up) parts.push(`${statName(nature.up)}↑`);
  if (nature.down) parts.push(`${statName(nature.down)}↓`);
  return parts.join('・');
}

function headerSection(ind) {
  const specialtyMeta = SPECIALTY_BY_ID[ind.specialty];
  const displayName = ind.nickname || ind.speciesName || ind.species || '（種族未設定）';
  const subLine = ind.nickname && ind.speciesName ? ind.speciesName : null;

  const children = [];
  children.push(el('h1', {}, displayName));
  if (subLine) children.push(el('div', { class: 'muted' }, subLine));

  const chipsRow = [];
  if (specialtyMeta) chipsRow.push(el('span', { class: 'chip' }, specialtyMeta.name));
  chipsRow.push(el('span', { class: 'chip' }, ind.level != null ? `Lv.${ind.level}` : 'Lv.—'));
  chipsRow.push(el('span', { class: 'chip' }, ind.sp != null ? `SP ${formatInt(ind.sp)}` : 'SP —'));
  children.push(el('div', { class: 'chip-row' }, ...chipsRow));

  return el('div', { class: 'card detail-header' }, ...children);
}

function headlineSection(g, topPct, rankInAll, total, withIngredients) {
  const badge = g
    ? el('div', { class: `grade-badge-lg grade-${g}` }, g)
    : el('div', { class: 'grade-badge-lg' }, '—');

  return el(
    'div',
    { class: 'card headline-card' },
    badge,
    el('div', { class: 'headline-pct' }, `上位 ${formatPct(topPct)}`),
    el(
      'div',
      { class: 'headline-rank' },
      rankInAll != null && total != null ? `${formatInt(rankInAll)}位 / 全 ${formatInt(total)} パターン` : '—'
    ),
    el(
      'div',
      { class: 'muted' },
      withIngredients
        ? '全組み合わせ（サブスキル×せいかく×食材構成）を均等とみなした順位'
        : '全組み合わせを均等とみなした順位'
    )
  );
}

function accumulatedRankSection(ind, allIndividuals, settings) {
  const rows = [];

  const sameSpecialty = allIndividuals.filter((i) => i.specialty === ind.specialty);
  try {
    const r = rankAmong(sameSpecialty, ind, settings);
    rows.push(el('div', {}, `同じとくいタイプ内: ${r.rank} / ${r.total} 位`));
  } catch (e) {
    rows.push(el('div', {}, '同じとくいタイプ内: —'));
  }

  if (ind.species) {
    const sameSpecies = allIndividuals.filter((i) => i.species === ind.species);
    try {
      const r = rankAmong(sameSpecies, ind, settings);
      rows.push(el('div', {}, `同じ種族内: ${r.rank} / ${r.total} 位`));
    } catch (e) {
      rows.push(el('div', {}, '同じ種族内: —'));
    }
  } else {
    rows.push(el('div', { class: 'muted' }, '同じ種族内: 種族未設定のため比較できません'));
  }

  return el('div', { class: 'card' }, el('h2', {}, '蓄積内の順位'), ...rows);
}

function subskillCell(subskillId) {
  const meta = subskillId ? SUBSKILL_BY_ID[subskillId] : null;
  if (!meta) return el('span', { class: 'chip chip-white' }, '—');
  const rarityClass = meta.rarity ? `chip-${meta.rarity}` : '';
  return el('span', { class: `chip ${rarityClass}`.trim() }, meta.name);
}

/** 得点は端数が出うる（食材の価値/100）ので、表示は整数に丸める。 */
function formatPoints(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v));
}

/** 食材の枠を「あんみんトマト ×2」の形にする。未確定は「—」。 */
function ingredientCell(entry) {
  if (!entry || !entry.ing) return el('span', { class: 'chip chip-white' }, '—');
  const name = entry.ingName || entry.ing;
  return el('span', { class: 'chip' }, `${name} ×${entry.count != null ? entry.count : '?'}`);
}

function breakdownSection(ind, breakdown, totalScore) {
  const { slots, naturePoints, ingredients, ingredientBonus } = breakdown;
  const subskillIds = ind.subskills && ind.subskills.length === 5 ? ind.subskills : [null, null, null, null, null];
  const unlockLevels =
    ind.subskillUnlockLevels && ind.subskillUnlockLevels.length === 5
      ? ind.subskillUnlockLevels
      : SUBSKILL_UNLOCK_LEVELS;

  const bySlot = new Map();
  (slots || []).forEach((s, idx) => {
    const slotNo = s && s.slot != null ? s.slot : idx + 1;
    bySlot.set(slotNo, s);
  });

  const thead = el(
    'thead',
    {},
    el('tr', {}, el('th', {}, '枠'), el('th', {}, '解放Lv'), el('th', {}, 'サブスキル'), el('th', {}, '得点'))
  );

  const tbody = el('tbody', {});
  for (let i = 0; i < 5; i++) {
    const slotNo = i + 1;
    const entry = bySlot.get(slotNo);
    const subskillId = entry && entry.subskillId !== undefined ? entry.subskillId : subskillIds[i];
    const points = entry && typeof entry.points === 'number' ? entry.points : 0;
    tbody.appendChild(
      el(
        'tr',
        {},
        el('td', {}, `枠${slotNo}`),
        el('td', {}, unlockLevels[i] != null ? `Lv.${unlockLevels[i]}` : '—'),
        el('td', {}, subskillCell(subskillId)),
        el('td', {}, formatPoints(points))
      )
    );
  }

  const natureMeta = ind.nature ? NATURE_BY_ID[ind.nature] : null;
  tbody.appendChild(
    el(
      'tr',
      {},
      el('td', {}, 'せいかく'),
      el('td', {}, ''),
      el('td', {}, natureMeta ? `${natureMeta.name}（${natureDesc(natureMeta)}）` : '—'),
      el('td', {}, formatPoints(naturePoints))
    )
  );

  // 食材構成（3枠＋揃いボーナス）。同じ表に続けて並べて合計が一目で合うようにする。
  // 1枠も分かっていない個体では 0 点の行が並ぶだけなので省く。
  const hasIngredients = (ingredients || []).some((e) => e && e.ing);
  if (hasIngredients) (ingredients || []).forEach((entry, i) => {
    const unlock = INGREDIENT_UNLOCK_LEVELS[i];
    tbody.appendChild(
      el(
        'tr',
        {},
        el('td', {}, `食材枠${entry && entry.slot != null ? entry.slot : i + 1}`),
        el('td', {}, unlock != null ? `Lv.${unlock}` : '—'),
        el('td', {}, ingredientCell(entry)),
        el('td', {}, formatPoints(entry && entry.points))
      )
    );
  });
  if (hasIngredients) {
    tbody.appendChild(
      el(
        'tr',
        {},
        el('td', {}, '揃いボーナス'),
        el('td', {}, ''),
        el('td', {}, uniformityLabel(ingredients)),
        el('td', {}, formatPoints(ingredientBonus))
      )
    );
  }

  const table = el('table', { class: 'breakdown-table' }, thead, tbody);

  return el(
    'div',
    { class: 'card' },
    el('h2', {}, '内訳'),
    table,
    el('div', { class: 'breakdown-total' }, `合計スコア: ${formatInt(Math.round(totalScore))}`)
  );
}

/** 揃い状況の説明文（3枠そろい／2枠そろい／なし）。 */
function uniformityLabel(ingredients) {
  const ids = (ingredients || []).map((e) => e && e.ing).filter(Boolean);
  if (ids.length === 3 && ids[0] === ids[1] && ids[1] === ids[2]) return '3枠そろい';
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (ids[i] === ids[j]) return '2枠そろい';
    }
  }
  return 'なし';
}

function ingredientSection(ind, breakdown, comboRank, settings) {
  const { ingredients, ingredientBonus, ingredientPoints: ingPoints, ingredientScore: ingRaw } = breakdown;
  const weighted = breakdownHasIngredientWeight(ind, settings);
  const hasIngredients = (ingredients || []).some((e) => e && e.ing);

  // きのみ・スキルで食材が1枠も分かっていないなら、0点の行を並べる意味がない
  if (!weighted && !hasIngredients) {
    return el(
      'div',
      { class: 'card' },
      el('h2', {}, '食材構成'),
      el('div', { class: 'muted' }, 'このとくいタイプでは食材構成をスコアに反映していません（重み0）。')
    );
  }

  const rows = (ingredients || []).map((entry, i) =>
    el(
      'div',
      { class: 'detail-row' },
      el('span', { class: 'muted' }, `枠${entry && entry.slot != null ? entry.slot : i + 1}`),
      el('span', {}, ingredientCell(entry), ' ', el('span', { class: 'muted' }, `${formatPoints(entry && entry.points)}点`))
    )
  );

  rows.push(
    el(
      'div',
      { class: 'detail-row' },
      el('span', { class: 'muted' }, '揃いボーナス'),
      el('span', {}, `${uniformityLabel(ingredients)} ／ ${formatPoints(ingredientBonus)}点`)
    )
  );

  rows.push(
    el(
      'div',
      { class: 'detail-row' },
      el('span', { class: 'muted' }, '食材構成の得点'),
      el('span', {}, `${formatPoints(ingPoints)}点（素点 ${formatPoints(ingRaw)}）`)
    )
  );

  if (comboRank) {
    rows.push(
      el(
        'div',
        { class: 'detail-row' },
        el('span', { class: 'muted' }, 'この種族の食材構成'),
        el(
          'span',
          {},
          comboRank.known
            ? `全 ${formatInt(comboRank.total)} パターン中 ${formatInt(comboRank.rank)} 番目`
            : `全 ${formatInt(comboRank.total)} パターン（この個体の構成は未確定）`
        )
      )
    );
  } else if (ind.species) {
    rows.push(el('div', { class: 'muted' }, 'この種族の食材候補が未登録のため、パターン数は出せません。'));
  } else {
    rows.push(el('div', { class: 'muted' }, '種族未設定のため、パターン数は出せません。'));
  }

  if (!weighted) {
    rows.push(
      el('div', { class: 'muted' }, 'このとくいタイプでは食材構成をスコアに反映していません（重み0）。')
    );
  }

  return el('div', { class: 'card' }, el('h2', {}, '食材構成'), ...rows);
}

function detailsSection(ind) {
  const mainSkillMeta = ind.mainSkill ? MAIN_SKILL_BY_ID[ind.mainSkill] : null;
  const natureMeta = ind.nature ? NATURE_BY_ID[ind.nature] : null;

  const rows = [
    ['おてつだい時間', formatHelpInterval(ind.helpIntervalSec)],
    ['最大所持数', ind.carryLimit != null ? `${formatInt(ind.carryLimit)}個` : '—'],
    [
      'メインスキル',
      mainSkillMeta ? `${mainSkillMeta.name}${ind.mainSkillLevel != null ? ` Lv.${ind.mainSkillLevel}` : ''}` : '—',
    ],
    ['せいかく', natureMeta ? `${natureMeta.name}（${natureDesc(natureMeta)}）` : '—'],
    ['メモ', ind.note || '—'],
    ['登録日', formatDate(ind.createdAt)],
    ['更新日', formatDate(ind.updatedAt)],
  ];

  return el(
    'div',
    { class: 'card' },
    el('h2', {}, '詳細'),
    ...rows.map(([label, value]) => el('div', { class: 'detail-row' }, el('span', { class: 'muted' }, label), el('span', {}, value)))
  );
}

function actionsSection(ind, settings) {
  // 結果カード（PNG）を作って共有する。端末が共有APIを持たなければダウンロードになる。
  const shareBtn = el(
    'button',
    {
      class: 'btn btn-primary',
      type: 'button',
      onclick: async () => {
        shareBtn.disabled = true;
        const label = shareBtn.textContent;
        shareBtn.textContent = '画像を作成中…';
        try {
          await shareResultCard(ind, settings);
        } finally {
          shareBtn.textContent = label;
          shareBtn.disabled = false;
        }
      },
    },
    '画像で共有'
  );
  const editBtn = el(
    'button',
    { class: 'btn', type: 'button', onclick: () => navigate('#/edit/' + ind.id) },
    '編集'
  );
  const deleteBtn = el(
    'button',
    {
      class: 'btn btn-danger',
      type: 'button',
      onclick: async () => {
        const ok = await confirmModal(`「${ind.nickname || ind.speciesName || ind.species || 'この個体'}」を削除しますか？`);
        if (!ok) return;
        try {
          await deleteIndividual(ind.id);
          toast('削除しました');
          navigate('#/');
        } catch (e) {
          toast('削除に失敗しました', 'error');
        }
      },
    },
    '削除'
  );
  return el('div', { class: 'card action-row' }, shareBtn, editBtn, deleteBtn);
}

function compareSection(ind, allIndividuals, settings) {
  const others = ind.species ? allIndividuals.filter((i) => i.species === ind.species && i.id !== ind.id) : [];

  if (others.length === 0) {
    return el(
      'div',
      { class: 'card' },
      el('h2', {}, '同じ種族を比較'),
      el('div', { class: 'muted' }, '他に登録がありません。')
    );
  }

  const distCache = {};
  const rows = others.map((other) => {
    const s = individualScore(other, settings);
    return { other, score: s };
  });

  return renderCompareRows(ind, rows, settings, distCache);
}

function renderCompareRows(ind, rows, settings, distCache) {
  // 分布取得は非同期のため、まずプレースホルダを返し完了後に差し替える
  const wrap = el('div', { class: 'card' }, el('h2', {}, '同じ種族を比較'), el('div', { class: 'muted' }, '計算中…'));

  (async () => {
    const specialties = [...new Set(rows.map((r) => r.other.specialty).filter(Boolean))];
    await Promise.all(
      specialties.map(async (spec) => {
        if (distCache[spec]) return;
        try {
          // 比較相手は同じ種族なので、食材構成も同じ母集団で見る
          distCache[spec] = await getDistribution(spec, settings, ind.species || null);
        } catch (e) {
          distCache[spec] = null;
        }
      })
    );

    const withPct = rows.map((r) => {
      const dist = r.other.specialty ? distCache[r.other.specialty] : null;
      const topPct = dist ? dist.topPct(r.score) : null;
      const g = topPct != null ? grade(topPct, settings) : null;
      return { ...r, topPct, grade: g };
    });
    withPct.sort((a, b) => (a.topPct ?? Infinity) - (b.topPct ?? Infinity));

    const list = el(
      'div',
      { class: 'list' },
      ...withPct.map((r) => {
        const name = r.other.nickname || r.other.speciesName || r.other.species || '（種族未設定）';
        return el(
          'div',
          { class: 'list-item card', onclick: () => navigate('#/mon/' + r.other.id) },
          el(
            'div',
            { class: 'list-item-top' },
            el('span', { class: 'list-item-name' }, name),
            r.grade ? el('span', { class: `grade-badge grade-${r.grade}` }, r.grade) : el('span', {}, '—')
          ),
          el('div', { class: 'list-item-sub' }, el('span', {}, `上位 ${formatPct(r.topPct)}`))
        );
      })
    );

    wrap.replaceChildren(el('h2', {}, '同じ種族を比較'), list);
  })();

  return wrap;
}
