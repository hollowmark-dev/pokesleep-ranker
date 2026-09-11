// 個体詳細画面。スコア内訳・蓄積内の順位・同じ種族との比較を表示する。

import { el, toast, confirmModal, formatTopPct } from '../ui.js';
import { navigate } from '../app.js';
import { getIndividual, listIndividuals, deleteIndividual } from '../store.js';
import { getSettings } from '../settings.js';
import { individualScore, scoreBreakdown, natureScore, grade, rankAmong } from '../score/score.js';
import { getDistribution } from '../score/dist.js';
import { SPECIALTIES, SUBSKILLS, NATURES, STATS, MAIN_SKILLS, SUBSKILL_UNLOCK_LEVELS, byId } from '../data/gamedata.js';

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
    dist = await getDistribution(ind.specialty, settings);
  } catch (e) {
    dist = null;
  }
  const topPct = dist ? dist.topPct(score) : null;
  const rankInAll = dist ? dist.rank(score) : null;
  const total = dist ? dist.total : null;
  const g = topPct != null ? grade(topPct, settings) : null;

  const breakdown = normalizeBreakdown(safeScoreBreakdown(ind, settings), ind, settings);

  container.replaceChildren(
    headerSection(ind),
    headlineSection(g, topPct, rankInAll, total),
    accumulatedRankSection(ind, allIndividuals, settings),
    breakdownSection(ind, breakdown, score),
    detailsSection(ind),
    actionsSection(ind),
    compareSection(ind, allIndividuals, settings)
  );
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
  if (Array.isArray(raw)) {
    slots = raw;
  } else if (raw && typeof raw === 'object') {
    slots = raw.slots || raw.rows || raw.breakdown || [];
    naturePoints = typeof raw.naturePoints === 'number' ? raw.naturePoints : null;
  }
  if (naturePoints == null) {
    naturePoints = natureScore(ind.specialty, ind.nature, settings);
  }
  return { slots, naturePoints };
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

function headlineSection(g, topPct, rankInAll, total) {
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
    el('div', { class: 'muted' }, '全組み合わせを均等とみなした順位')
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

function breakdownSection(ind, breakdown, totalScore) {
  const { slots, naturePoints } = breakdown;
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
        el('td', {}, String(points))
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
      el('td', {}, String(naturePoints))
    )
  );

  const table = el('table', { class: 'breakdown-table' }, thead, tbody);

  return el(
    'div',
    { class: 'card' },
    el('h2', {}, '内訳'),
    table,
    el('div', { class: 'breakdown-total' }, `合計スコア: ${formatInt(totalScore)}`)
  );
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

function actionsSection(ind) {
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
  return el('div', { class: 'card action-row' }, editBtn, deleteBtn);
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
          distCache[spec] = await getDistribution(spec, settings);
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
