// 個体一覧画面。とくいタイプ／種族名でフィルタし、現在の重みでのスコア・上位%を表示する。

import { el, toast, formatTopPct } from '../ui.js';
import { navigate } from '../app.js';
import { listIndividuals } from '../store.js';
import { getSettings, onSettingsChange } from '../settings.js';
import { individualScore, grade } from '../score/score.js';
import { getDistribution } from '../score/dist.js';
import { SPECIALTIES, SUBSKILLS, NATURES, byId } from '../data/gamedata.js';

const SUBSKILL_BY_ID = byId(SUBSKILLS);
const NATURE_BY_ID = byId(NATURES);
const SPECIALTY_FILTERS = [{ id: 'all', name: 'すべて' }, ...SPECIALTIES];

// このビューが マウントされている間だけ設定変更を購読する。再 render 時に必ず解除する
let unsubscribeSettings = null;

export async function render(container, params) {
  if (unsubscribeSettings) {
    unsubscribeSettings();
    unsubscribeSettings = null;
  }

  container.replaceChildren(el('div', { class: 'view-loading' }, '読み込み中…'));

  let individuals;
  let settings;
  try {
    [individuals, settings] = await Promise.all([listIndividuals(), getSettings()]);
  } catch (e) {
    toast('データの読み込みに失敗しました', 'error');
    container.replaceChildren();
    return;
  }

  const rows = await buildRows(individuals, settings);

  renderBody(container, rows, settings);

  const unsub = onSettingsChange(() => render(container, params));
  unsubscribeSettings = typeof unsub === 'function' ? unsub : null;
}

async function buildRows(individuals, settings) {
  const specialtiesPresent = [...new Set(individuals.map((ind) => ind.specialty).filter(Boolean))];
  const distBySpecialty = {};
  await Promise.all(
    specialtiesPresent.map(async (spec) => {
      try {
        distBySpecialty[spec] = await getDistribution(spec, settings);
      } catch (e) {
        distBySpecialty[spec] = null;
      }
    })
  );

  return individuals.map((ind) => {
    const score = individualScore(ind, settings);
    const dist = ind.specialty ? distBySpecialty[ind.specialty] : null;
    const topPct = dist ? dist.topPct(score) : null;
    const g = topPct != null ? grade(topPct, settings) : null;
    return { ind, score, topPct, grade: g };
  });
}

function renderBody(container, rows, settings) {
  const state = { specialty: 'all', species: '', sort: 'topPct' };

  const header = el(
    'div',
    { class: 'list-header' },
    el('h1', {}, `個体一覧（${rows.length}件）`),
    el('div', { class: 'muted' }, `評価ルール v${settings.weightsVersion ?? '-'}`)
  );

  const chipsWrap = el('div', { class: 'chip-row' });
  SPECIALTY_FILTERS.forEach((s) => {
    const chip = el(
      'button',
      {
        class: 'chip',
        type: 'button',
        dataset: { specialty: s.id },
        onclick: () => {
          state.specialty = s.id;
          update();
        },
      },
      s.name
    );
    chipsWrap.appendChild(chip);
  });

  const speciesInput = el('input', {
    type: 'search',
    class: 'field',
    placeholder: '種族名で絞り込み',
    oninput: (e) => {
      state.species = e.target.value;
      update();
    },
  });

  const sortSelect = el(
    'select',
    {
      class: 'field',
      onchange: (e) => {
        state.sort = e.target.value;
        update();
      },
    },
    el('option', { value: 'topPct' }, '上位%順'),
    el('option', { value: 'createdAt' }, '登録日順'),
    el('option', { value: 'level' }, 'Lv順')
  );
  sortSelect.value = state.sort;

  const controls = el('div', { class: 'list-controls' }, chipsWrap, speciesInput, sortSelect);
  const listEl = el('div', { class: 'list' });

  container.replaceChildren(header, controls, listEl);

  function update() {
    [...chipsWrap.children].forEach((chip) => {
      const active = chip.dataset.specialty === state.specialty;
      chip.classList.toggle('chip-active', active);
      chip.setAttribute('aria-pressed', String(active));
    });

    let filtered = rows.filter((r) => {
      if (state.specialty !== 'all' && r.ind.specialty !== state.specialty) return false;
      if (state.species) {
        const name = (r.ind.speciesName || r.ind.species || '').toLowerCase();
        if (!name.includes(state.species.toLowerCase())) return false;
      }
      return true;
    });

    filtered = sortRows(filtered, state.sort);

    listEl.replaceChildren();
    if (filtered.length === 0) {
      listEl.appendChild(emptyState(rows.length === 0));
      return;
    }
    filtered.forEach((r) => listEl.appendChild(listItem(r)));
  }

  update();
}

function sortRows(list, mode) {
  const copy = [...list];
  if (mode === 'createdAt') {
    copy.sort((a, b) => (b.ind.createdAt ?? 0) - (a.ind.createdAt ?? 0));
  } else if (mode === 'level') {
    copy.sort((a, b) => (b.ind.level ?? -1) - (a.ind.level ?? -1));
  } else {
    // topPct: 数字が小さいほど上位。null（分布未算出）は末尾へ
    copy.sort((a, b) => (a.topPct ?? Infinity) - (b.topPct ?? Infinity));
  }
  return copy;
}

function emptyState(noneAtAll) {
  if (noneAtAll) {
    return el(
      'div',
      { class: 'empty-state' },
      el('p', {}, 'まだ登録がありません。「判定」からスクショを読み込んでください。'),
      el(
        'button',
        { class: 'btn btn-primary', type: 'button', onclick: () => navigate('#/new') },
        '判定する'
      )
    );
  }
  return el('div', { class: 'empty-state' }, el('p', {}, '条件に一致する個体がありません。'));
}

function listItem(r) {
  const { ind, topPct, grade: g } = r;
  const displayName = ind.nickname || ind.speciesName || ind.species || '（種族未設定）';
  const specialtyMeta = SPECIALTIES.find((s) => s.id === ind.specialty);
  const natureMeta = ind.nature ? NATURE_BY_ID[ind.nature] : null;

  const topChildren = [];
  if (specialtyMeta) topChildren.push(el('span', { class: 'chip' }, specialtyMeta.name));
  topChildren.push(el('span', { class: 'list-item-name' }, displayName));
  if (g) topChildren.push(el('span', { class: `grade-badge grade-${g}` }, g));
  const top = el('div', { class: 'list-item-top' }, ...topChildren);

  const sub = el(
    'div',
    { class: 'list-item-sub' },
    el('span', {}, ind.level != null ? `Lv.${ind.level}` : 'Lv.—'),
    el('span', {}, topPct != null ? `上位 ${formatTopPct(topPct)}` : '—'),
    el('span', {}, natureMeta ? natureMeta.name : '—')
  );

  const subskillIds = ind.subskills && ind.subskills.length === 5 ? ind.subskills : [null, null, null, null, null];
  const subskillsRow = el('div', { class: 'chip-row' }, ...subskillIds.map((id) => subskillChip(id)));

  return el(
    'div',
    {
      class: 'list-item card',
      onclick: () => navigate('#/mon/' + ind.id),
    },
    top,
    sub,
    subskillsRow
  );
}

function subskillChip(subskillId) {
  const meta = subskillId ? SUBSKILL_BY_ID[subskillId] : null;
  if (!meta) return el('span', { class: 'chip chip-white' }, '—');
  const rarityClass = meta.rarity ? `chip-${meta.rarity}` : '';
  return el('span', { class: `chip ${rarityClass}`.trim() }, meta.name);
}
