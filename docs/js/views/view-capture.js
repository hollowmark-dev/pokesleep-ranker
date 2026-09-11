// スクショの読み取り → 確認フォーム → 判定（結果のお披露目）→ 保存。手入力と編集もこの画面で受ける。
// OCRは必ず「確認フォーム」を挟む。確度の低い項目は赤枠＋「要確認」で目立たせる。

import { el, toast, openBusy, formatTopPct } from '../ui.js';
import { navigate } from '../app.js';
import { putIndividual, getIndividual, listIndividuals } from '../store.js';
import { getSettings } from '../settings.js';
import { individualScore, grade, rankAmong } from '../score/score.js';
import { getDistribution } from '../score/dist.js';
import {
  SPECIALTIES, SUBSKILLS, NATURES, MAIN_SKILLS, SUBSKILL_UNLOCK_LEVELS,
} from '../data/gamedata.js';
import { SPECIES } from '../data/species.js';
import { thumbnailCanvas } from '../ocr/image.js';
import { isWarm } from '../ocr/engine.js';
import { parseScreenshot } from '../ocr/layout.js';
import { normalize, bestMatch } from '../ocr/fuzzy.js';

const LOW_CONF = 0.8;                 // これ未満は「要確認」
const DEFAULT_UNLOCK = (Array.isArray(SUBSKILL_UNLOCK_LEVELS) && SUBSKILL_UNLOCK_LEVELS.length === 5)
  ? SUBSKILL_UNLOCK_LEVELS.slice()
  : [10, 25, 50, 75, 100];

const on = (node, type, fn) => { node.addEventListener(type, fn); return node; };

// style.css は別担当なので、この画面だけで必要なレイアウトはインラインで閉じておく
const GRID2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px';
const INLINE = 'display:flex;align-items:center;gap:6px';

function newId() {
  let r = '';
  for (let i = 0; i < 5; i++) r += Math.floor(Math.random() * 36).toString(36);
  return 'm_' + Date.now().toString(36) + '_' + r;
}

function blankModel() {
  return {
    specialty: null, species: null, speciesName: '',
    level: null, sp: null,
    helpMin: null, helpSecPart: null, carryLimit: null,
    mainSkill: null, mainSkillLevel: null,
    subskills: [null, null, null, null, null],
    unlockLevels: DEFAULT_UNLOCK.slice(),
    nature: null, nickname: '', note: '',
    conf: {},
  };
}

/** parseFields の結果をフォームの初期値に落とす */
function fromFields(f) {
  const m = blankModel();
  if (!f) return m;
  m.specialty = f.specialty.value;
  m.species = f.species.value;
  // 種族が特定できたら表示は正式名にそろえる（OCRの「オンバツト」のまま出すと保存時にIDを落とす）
  m.speciesName = nameOfSpecies(f.species.value) || f.species.rawName || '';
  m.level = f.level.value;
  m.sp = f.sp.value;
  if (f.helpIntervalSec.value != null) {
    m.helpMin = Math.floor(f.helpIntervalSec.value / 60);
    m.helpSecPart = f.helpIntervalSec.value % 60;
  }
  m.carryLimit = f.carryLimit.value;
  m.mainSkill = f.mainSkill.value;
  m.mainSkillLevel = f.mainSkillLevel.value;
  m.subskills = (f.subskills.value || []).slice(0, 5);
  while (m.subskills.length < 5) m.subskills.push(null);
  m.unlockLevels = (f.subskillUnlockLevels.value || DEFAULT_UNLOCK).slice(0, 5);
  while (m.unlockLevels.length < 5) m.unlockLevels.push(DEFAULT_UNLOCK[m.unlockLevels.length]);
  m.nature = f.nature.value;
  m.conf = {
    specialty: f.specialty.conf,
    species: f.species.conf,
    level: f.level.conf,
    sp: f.sp.conf,
    helpIntervalSec: f.helpIntervalSec.conf,
    carryLimit: f.carryLimit.conf,
    mainSkill: f.mainSkill.conf,
    mainSkillLevel: f.mainSkillLevel.conf,
    nature: f.nature.conf,
  };
  for (let i = 0; i < 5; i++) {
    m.conf['subskill' + (i + 1)] = (f.subskills.conf || [])[i] || 0;
    m.conf['unlock' + (i + 1)] = (f.subskillUnlockLevels.conf || [])[i] || 0;
  }
  return m;
}

/** 保存済みの個体をフォームの初期値に落とす（編集モード） */
function fromIndividual(ind) {
  const m = blankModel();
  m.specialty = ind.specialty || null;
  m.species = ind.species || null;
  m.speciesName = ind.speciesName || nameOfSpecies(ind.species) || '';
  m.level = ind.level ?? null;
  m.sp = ind.sp ?? null;
  if (ind.helpIntervalSec != null) {
    m.helpMin = Math.floor(ind.helpIntervalSec / 60);
    m.helpSecPart = ind.helpIntervalSec % 60;
  }
  m.carryLimit = ind.carryLimit ?? null;
  m.mainSkill = ind.mainSkill || null;
  m.mainSkillLevel = ind.mainSkillLevel ?? null;
  m.subskills = Array.isArray(ind.subskills) ? ind.subskills.slice(0, 5) : [];
  while (m.subskills.length < 5) m.subskills.push(null);
  m.unlockLevels = Array.isArray(ind.subskillUnlockLevels)
    ? ind.subskillUnlockLevels.slice(0, 5) : DEFAULT_UNLOCK.slice();
  while (m.unlockLevels.length < 5) m.unlockLevels.push(DEFAULT_UNLOCK[m.unlockLevels.length]);
  m.nature = ind.nature || null;
  m.nickname = ind.nickname || '';
  m.note = ind.note || '';
  return m; // 保存済みの値は確定値として扱うので conf は空（＝要確認を出さない）
}

function nameOfSpecies(id) {
  if (!id) return '';
  const s = (SPECIES || []).find((x) => x.id === id);
  return s ? s.name : '';
}

/** 入力された種族名から speciesId を引く（表記ゆれを吸収） */
function speciesIdByName(text) {
  const n = normalize(text);
  if (!n) return null;
  for (const s of (SPECIES || [])) {
    if (normalize(s.name) === n) return s.id;
    if (Array.isArray(s.aliases) && s.aliases.some((a) => normalize(a) === n)) return s.id;
  }
  // 完全一致しなくても、ほぼ同じなら拾う（小さい「ッ」の打ち間違いなど）
  const m = bestMatch(text, SPECIES, { threshold: 0.85 });
  return m ? m.item.id : null;
}

// ── 部品 ────────────────────────────────────────────────

function select(options, value, { empty = '—' } = {}) {
  const sel = document.createElement('select');
  if (empty != null) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = empty;
    sel.appendChild(o);
  }
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.name;
    sel.appendChild(o);
  }
  sel.value = value == null ? '' : String(value);
  return sel;
}

function numberInput(value, { min, max, step = 1, placeholder = '' } = {}) {
  const i = document.createElement('input');
  i.type = 'number';
  i.inputMode = 'numeric';
  if (min != null) i.min = String(min);
  if (max != null) i.max = String(max);
  i.step = String(step);
  if (placeholder) i.placeholder = placeholder;
  i.value = value == null ? '' : String(value);
  return i;
}

function textInput(value, { placeholder = '', list = null, maxLength = 60 } = {}) {
  const i = document.createElement('input');
  i.type = 'text';
  i.maxLength = maxLength;
  if (placeholder) i.placeholder = placeholder;
  if (list) i.setAttribute('list', list);
  i.value = value == null ? '' : String(value);
  return i;
}

/** ラベル＋コントロールを .field で包む。conf が低ければ「要確認」を出す */
function field(labelText, control, conf) {
  const low = typeof conf === 'number' && conf > 0 && conf < LOW_CONF;
  const unread = typeof conf === 'number' && conf === 0;
  const label = el('label', {}, labelText);
  if (low || unread) {
    label.appendChild(el('span', { class: 'small', style: 'color:var(--danger);margin-left:6px' }, '要確認'));
  }
  const wrap = el('div', { class: 'field' + ((low || unread) ? ' low-conf' : '') }, label);
  wrap.appendChild(control);
  return wrap;
}

function numToNull(input) {
  const v = input.value.trim();
  if (v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// ── 画面 ────────────────────────────────────────────────

export async function render(container, params = {}) {
  container.textContent = '';
  const root = el('div', {});
  container.appendChild(root);

  let editing = null;
  if (params && params.id) {
    try {
      editing = await getIndividual(params.id);
    } catch (_) {
      toast('読み込みに失敗しました', 'error');
    }
    if (!editing) {
      toast('個体が見つかりませんでした', 'error');
      navigate('#/');
      return;
    }
    renderForm(root, fromIndividual(editing), { editing });
    return;
  }

  renderChooser(root);
}

function renderChooser(root) {
  root.textContent = '';
  root.appendChild(el('h2', { class: 'mt-0' }, '個体を登録'));

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;

  const pick = on(el('button', { class: 'btn btn-primary', type: 'button' }, 'スクショを選ぶ'), 'click', () => {
    fileInput.click();
  });
  const manual = on(el('button', { class: 'btn', type: 'button' }, '手入力で登録'), 'click', () => {
    renderForm(root, blankModel(), {});
  });

  on(fileInput, 'change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // 同じファイルをもう一度選べるように必ず空へ
    if (file) await runOcr(root, file);
  });

  const card = el('div', { class: 'card' },
    el('p', { class: 'muted small mt-0' },
      'ポケモンの詳細画面のスクショを選ぶと、とくいタイプ・サブスキル・せいかくを読み取ります。'),
    el('div', { class: 'btn-row' }, pick, manual),
    fileInput);
  root.appendChild(card);
}

async function runOcr(root, file) {
  const first = !isWarm();
  const busy = openBusy('読み取り中', first ? '初回はOCRデータ約6MBを読み込みます' : '画像を準備しています');
  let fields = null;
  try {
    fields = await parseScreenshot(file, (p) => {
      const six = first && /読み込み中/.test(p.message || '') ? '（約6MB）' : '';
      busy.update((p.message || '処理中') + six, p.pct);
    });
  } catch (_) {
    busy.close();
    toast('画像を読み取れませんでした。手入力で登録してください', 'error');
    renderForm(root, blankModel(), {});
    return;
  }
  busy.close();
  if (!fields || !fields.specialty.value) {
    toast('読み取れなかった項目があります。確認してください', 'error');
  }
  renderForm(root, fromFields(fields), {
    canvas: fields && fields.debug ? fields.debug.canvas : null,
    rawText: fields ? fields.rawText : '',
    fields,
  });
}

function renderForm(root, model, ctx) {
  root.textContent = '';
  const editing = ctx.editing || null;
  root.appendChild(el('h2', { class: 'mt-0' }, editing ? '個体を編集' : '読み取り結果を確認'));

  // ── 基本 ──
  const specialtySel = select(SPECIALTIES, model.specialty);
  const speciesInput = textInput(model.speciesName, { placeholder: 'ポケモン名', list: 'psr-species-list' });
  const datalist = document.createElement('datalist');
  datalist.id = 'psr-species-list';
  for (const s of (SPECIES || [])) {
    const o = document.createElement('option');
    o.value = s.name;
    datalist.appendChild(o);
  }
  const levelInput = numberInput(model.level, { min: 1, max: 100, placeholder: 'Lv' });
  const spInput = numberInput(model.sp, { min: 0, max: 99999, placeholder: 'SP' });
  const helpMinInput = numberInput(model.helpMin, { min: 0, max: 999, placeholder: '分' });
  helpMinInput.style.width = '6em';
  const helpSecInput = numberInput(model.helpSecPart, { min: 0, max: 59, placeholder: '秒' });
  helpSecInput.style.width = '6em';
  const carryInput = numberInput(model.carryLimit, { min: 1, max: 300, placeholder: '個' });

  const basic = el('div', { class: 'card' },
    el('h3', { class: 'mt-0' }, '基本'),
    field('とくいタイプ（必須）', specialtySel, model.conf.specialty),
    field('ポケモン', speciesInput, model.conf.species),
    datalist,
    el('div', { class: 'grid-2', style: GRID2 },
      field('レベル', levelInput, model.conf.level),
      field('SP', spInput, model.conf.sp)),
    field('おてつだい時間',
      el('div', { class: 'inline-2', style: INLINE }, helpMinInput, el('span', { class: 'small muted' }, '分'),
        helpSecInput, el('span', { class: 'small muted' }, '秒')),
      model.conf.helpIntervalSec),
    field('最大所持数', carryInput, model.conf.carryLimit));
  root.appendChild(basic);

  // ── メインスキル ──
  const mainSel = select(MAIN_SKILLS, model.mainSkill);
  const mainLvInput = numberInput(model.mainSkillLevel, { min: 1, max: 10, placeholder: 'Lv' });
  root.appendChild(el('div', { class: 'card' },
    el('h3', { class: 'mt-0' }, 'メインスキル'),
    field('メインスキル', mainSel, model.conf.mainSkill),
    field('スキルレベル', mainLvInput, model.conf.mainSkillLevel)));

  // ── サブスキル5枠 ──
  const subSels = [];
  const unlockInputs = [];
  const subCard = el('div', { class: 'card' }, el('h3', { class: 'mt-0' }, 'サブスキル（枠1が最重要）'));
  for (let i = 0; i < 5; i++) {
    const sel = select(SUBSKILLS, model.subskills[i]);
    const unlock = numberInput(model.unlockLevels[i], { min: 1, max: 100 });
    unlock.classList.add('unlock-input');
    unlock.style.width = '5em';
    sel.style.flex = '1 1 auto';
    sel.style.minWidth = '0';
    subSels.push(sel);
    unlockInputs.push(unlock);
    subCard.appendChild(field(
      '枠' + (i + 1),
      el('div', { class: 'inline-2', style: INLINE }, sel, el('span', { class: 'small muted' }, '解放Lv'), unlock),
      model.conf['subskill' + (i + 1)],
    ));
  }
  root.appendChild(subCard);

  // ── せいかく・メモ ──
  const natureSel = select(NATURES, model.nature);
  const nickInput = textInput(model.nickname, { placeholder: '呼び名（任意）', maxLength: 30 });
  const noteArea = document.createElement('textarea');
  noteArea.rows = 2;
  noteArea.maxLength = 200;
  noteArea.placeholder = 'メモ（任意）';
  noteArea.value = model.note || '';
  root.appendChild(el('div', { class: 'card' },
    el('h3', { class: 'mt-0' }, 'せいかく・メモ'),
    field('せいかく', natureSel, model.conf.nature),
    field('呼び名', nickInput),
    field('メモ', noteArea)));

  // ── 判定結果（「判定する」を押すまで伏せておく）──
  const resultCard = el('div', { class: 'card result-card' });
  resultCard.hidden = true;
  root.appendChild(resultCard);

  // ── OCRの生テキスト・サムネイル ──
  if (ctx.rawText || ctx.canvas) {
    const details = document.createElement('details');
    details.appendChild(el('summary', { class: 'small muted' }, 'OCR生テキスト'));
    if (ctx.canvas) {
      try {
        const thumb = thumbnailCanvas(ctx.canvas, 160);
        thumb.style.border = '1px solid var(--border)';
        thumb.style.borderRadius = '8px';
        details.appendChild(el('div', { class: 'small muted' }, '前処理後の画像'));
        details.appendChild(thumb);
      } catch (_) { /* サムネイルは出せなくても構わない */ }
    }
    const a = ctx.fields && ctx.fields.debug ? ctx.fields.debug.anchors : null;
    if (a) {
      details.appendChild(el('div', { class: 'small muted' },
        `アンカー H1=${a.H1 ?? '—'} H2=${a.H2 ?? '—'} CB=${a.CB ?? '—'} 倍率=${(a.scale || 1).toFixed(2)}`));
    }
    const pre = document.createElement('pre');
    pre.className = 'ocr-raw small';
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;max-height:40vh;overflow:auto;'
      + 'background:var(--bg);border-radius:8px;padding:8px;margin:8px 0 0';
    pre.textContent = ctx.rawText || '(なし)';
    details.appendChild(pre);
    root.appendChild(el('div', { class: 'card' }, details));
  }

  // ── 操作 ──
  const judgeBtn = el('button', { class: 'btn btn-primary', type: 'button' }, '判定する');
  const saveBtn = el('button', { class: 'btn btn-primary', type: 'button' }, '保存する');
  saveBtn.hidden = true;
  const retry = on(el('button', { class: 'btn', type: 'button' }, editing ? 'やめる' : '選び直す'), 'click', () => {
    if (editing) navigate('#/mon/' + editing.id);
    else renderChooser(root);
  });
  root.appendChild(el('div', { class: 'btn-row' }, judgeBtn, saveBtn, retry));

  // ── フォームの値を読み出す ──
  function readModel() {
    const min = numToNull(helpMinInput);
    const sec = numToNull(helpSecInput);
    const helpIntervalSec = (min == null && sec == null) ? null : (min || 0) * 60 + (sec || 0);
    const name = speciesInput.value.trim();
    return {
      specialty: specialtySel.value || null,
      species: speciesIdByName(name),
      speciesName: name,
      level: numToNull(levelInput),
      sp: numToNull(spInput),
      helpIntervalSec,
      carryLimit: numToNull(carryInput),
      mainSkill: mainSel.value || null,
      mainSkillLevel: numToNull(mainLvInput),
      subskills: subSels.map((s) => s.value || null),
      subskillUnlockLevels: unlockInputs.map((u, i) => numToNull(u) ?? DEFAULT_UNLOCK[i]),
      nature: natureSel.value || null,
      nickname: nickInput.value.trim(),
      note: noteArea.value.trim(),
    };
  }

  // ── 判定（結果はボタンを押すまで見せない。フォームを直したら伏せ直す）──
  function validate(m) {
    if (!m.specialty) {
      toast('とくいタイプを選んでください', 'error');
      specialtySel.focus();
      return false;
    }
    if (!m.subskills.some(Boolean) && !m.nature) {
      toast('サブスキルかせいかくを1つ以上入れてください', 'error');
      return false;
    }
    return true;
  }
  function hideResult() {
    if (resultCard.hidden) return;
    resultCard.hidden = true;
    resultCard.textContent = '';
    saveBtn.hidden = true;
    judgeBtn.hidden = false;
  }
  for (const node of [specialtySel, speciesInput, levelInput, spInput, helpMinInput, helpSecInput,
    carryInput, mainSel, mainLvInput, natureSel, ...subSels, ...unlockInputs]) {
    on(node, 'input', hideResult);
    on(node, 'change', hideResult);
  }
  on(judgeBtn, 'click', async () => {
    const m = readModel();
    if (!validate(m)) return;
    judgeBtn.disabled = true;
    let result;
    try {
      const settings = await getSettings();
      const score = individualScore(m, settings);
      const dist = await getDistribution(m.specialty, settings);
      const topPct = dist.topPct(score);
      const saved = (await listIndividuals()).filter((x) => !editing || x.id !== editing.id);
      const sameType = saved.filter((x) => x.specialty === m.specialty);
      const sameSpecies = m.species ? sameType.filter((x) => x.species === m.species) : [];
      result = {
        grade: grade(topPct, settings),
        topPct,
        rank: dist.rank(score),
        total: dist.total,
        typeRank: rankAmong([...sameType, m], m, settings),
        speciesRank: sameSpecies.length ? rankAmong([...sameSpecies, m], m, settings) : null,
        typeName: (SPECIALTIES.find((t) => t.id === m.specialty) || {}).name || '',
        speciesName: m.speciesName,
      };
    } catch (_) {
      judgeBtn.disabled = false;
      toast('評価を計算できませんでした', 'error');
      return;
    }
    judgeBtn.hidden = true;
    judgeBtn.disabled = false;
    await revealResult(resultCard, result);
    saveBtn.hidden = false;
  });

  // ── 保存 ──
  on(saveBtn, 'click', async () => {
    const m = readModel();
    if (!validate(m)) return;
    const now = Date.now();
    const obj = {
      id: editing ? editing.id : newId(),
      schemaVersion: 1,
      species: m.species,
      speciesName: m.speciesName,
      specialty: m.specialty,
      level: m.level,
      sp: m.sp,
      helpIntervalSec: m.helpIntervalSec,
      carryLimit: m.carryLimit,
      mainSkill: m.mainSkill,
      mainSkillLevel: m.mainSkillLevel,
      subskills: m.subskills,
      subskillUnlockLevels: m.subskillUnlockLevels,
      nature: m.nature,
      nickname: m.nickname,
      note: m.note,
      ocr: buildOcrRecord(ctx, editing),
      createdAt: editing && editing.createdAt ? editing.createdAt : now,
      updatedAt: now,
    };
    saveBtn.disabled = true;
    try {
      await putIndividual(obj);
      toast('保存しました');
      navigate('#/mon/' + obj.id);
    } catch (_) {
      saveBtn.disabled = false;
      toast('保存に失敗しました', 'error');
    }
  });
}

/** 判定結果をルーレット風に見せる。reduced-motion のときは即表示 */
async function revealResult(card, r) {
  const quick = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const badge = el('div', { class: 'grade-badge-lg grade-roll' }, '?');
  const pctEl = el('div', { class: 'result-pct' }, '上位 —%');
  const rankEl = el('div', { class: 'result-rank muted' }, '');
  const noteEl = el('div', { class: 'small muted' }, '全組み合わせを均等とみなした順位');
  const localEl = el('div', { class: 'result-local' });
  card.textContent = '';
  card.append(el('h3', { class: 'mt-0' }, '判定結果'), badge, pctEl, rankEl, noteEl, localEl);
  card.hidden = false;
  card.scrollIntoView({ behavior: quick ? 'auto' : 'smooth', block: 'center' });

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  if (!quick) {
    // ランクを回す（0.08秒刻みで約1.3秒）
    const letters = ['D', 'C', 'B', 'A', 'S'];
    let i = 0;
    const spin = setInterval(() => { badge.textContent = letters[i++ % letters.length]; }, 80);
    // 上位%は 100 から本当の値へ数える
    const t0 = performance.now();
    const dur = 1300;
    // requestAnimationFrame は非表示タブで止まるので、時間ベースの setInterval で回す
    await new Promise((done) => {
      const timer = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        const eased = 1 - Math.pow(1 - k, 3);
        const v = 100 - (100 - r.topPct) * eased;
        pctEl.textContent = '上位 ' + (k < 1 ? v.toFixed(1) + '%' : formatTopPct(r.topPct));
        if (k >= 1) { clearInterval(timer); done(); }
      }, 40);
    });
    clearInterval(spin);
  }
  badge.className = 'grade-badge-lg grade-' + r.grade + (quick ? '' : ' grade-pop');
  badge.textContent = r.grade;
  pctEl.textContent = '上位 ' + formatTopPct(r.topPct);
  rankEl.textContent = r.rank.toLocaleString('ja-JP') + '位 / 全 ' + r.total.toLocaleString('ja-JP') + ' パターン';
  if (!quick) await sleep(250);
  const lines = [];
  if (r.typeRank && r.typeRank.total > 1) {
    lines.push('手持ちの' + r.typeName + 'タイプの中で ' + r.typeRank.rank + ' / ' + r.typeRank.total + ' 位');
  }
  if (r.speciesRank && r.speciesRank.total > 1) {
    lines.push('手持ちの' + (r.speciesName || '同じ種族') + 'の中で ' + r.speciesRank.rank + ' / ' + r.speciesRank.total + ' 位');
  }
  if (lines.length) {
    localEl.append(el('h4', {}, '蓄積内の順位'), ...lines.map((t) => el('div', {}, t)));
  } else {
    localEl.append(el('div', { class: 'small muted' }, '保存すると、次からは手持ちの中での順位も出ます'));
  }
}

/** ocr: { rawText, fieldConf } を作る。手入力・編集のみなら null のまま */
function buildOcrRecord(ctx, editing) {
  if (ctx.fields) {
    const f = ctx.fields;
    const fieldConf = {
      specialty: f.specialty.conf,
      species: f.species.conf,
      level: f.level.conf,
      sp: f.sp.conf,
      helpIntervalSec: f.helpIntervalSec.conf,
      carryLimit: f.carryLimit.conf,
      mainSkill: f.mainSkill.conf,
      mainSkillLevel: f.mainSkillLevel.conf,
      nature: f.nature.conf,
    };
    for (let i = 0; i < 5; i++) fieldConf['subskill' + (i + 1)] = (f.subskills.conf || [])[i] || 0;
    return { rawText: ctx.rawText || f.rawText || '', fieldConf };
  }
  return editing && editing.ocr ? editing.ocr : null;
}

export default render;
