// 設定画面。評価ルール（重み）の閲覧、データの書き出し/読み込み、
// 管理者モードでの重み編集と defaults.js 用JSONの書き出しを担当する。

import {
  getSettings, saveOverride, clearOverride, hasOverride,
  isAdmin, unlockAdmin, lockAdmin, onSettingsChange,
} from '../settings.js';
import { el, toast, confirmModal, openModal } from '../ui.js';
import { exportAll, importFile } from '../io.js';
import { SUBSKILLS, STATS, SPECIALTIES } from '../data/gamedata.js';
import { INGREDIENTS } from '../data/ingredients.js';

const RARITY_GROUPS = [
  { id: 'gold', label: '金', chip: 'chip-gold' },
  { id: 'silver', label: '青', chip: 'chip-silver' },
  { id: 'white', label: '白', chip: 'chip-white' },
];

const OCR_ASSETS = [
  { label: 'OCRエンジン', url: new URL('../../vendor/core/tesseract-core-simd-lstm.wasm.js', import.meta.url) },
  { label: '日本語データ', url: new URL('../../vendor/lang/jpn.traineddata.gz', import.meta.url) },
];

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '0';
}

function fmtSigned(v) {
  const n = num(v);
  return n > 0 ? '+' + n : String(n);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function localDateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 今日の日付 + 連番。同じ日付なら末尾を1つ進める。 */
function bumpWeightsVersion(current) {
  const today = localDateStr();
  const m = /^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?$/.exec(String(current || ''));
  if (m && m[1] === today) return `${today}.${num(m[2], 1) + 1}`;
  return `${today}.1`;
}

/** 横スクロールできる表の器。 */
function wtable(...rows) {
  return el('div', { class: 'wtable' }, el('table', {}, el('tbody', {}, ...rows)));
}

export async function render(container, params) {
  let settings;
  let admin = false;
  let overridden = false;

  try {
    settings = await getSettings();
    admin = await isAdmin();
    overridden = await hasOverride();
  } catch (e) {
    container.textContent = '';
    container.append(el('p', { class: 'error' }, '設定の読み込みに失敗しました。'));
    toast('設定の読み込みに失敗しました: ' + (e && e.message ? e.message : e), 'error');
    return;
  }

  // 管理者モードの編集セル。保存時にまとめて検証する。
  let editors = [];

  let unsubscribe;
  unsubscribe = onSettingsChange(async () => {
    if (!container.isConnected) {
      if (typeof unsubscribe === 'function') unsubscribe();
      return;
    }
    try {
      settings = await getSettings();
      overridden = await hasOverride();
      draw();
    } catch (_) { /* 表示は据え置き */ }
  });

  // ---- セル ------------------------------------------------------------

  function numInput(label, value, apply, kind = 'int') {
    const input = el('input', {
      type: 'number',
      step: kind === 'pct' ? '0.1' : '1',
      inputmode: kind === 'pct' ? 'decimal' : 'numeric',
      value: fmt(value),
      class: 'wcell',
      'aria-label': label,
    });
    editors.push({ input, label, apply, kind });
    return input;
  }

  function cell(label, value, apply, kind = 'int') {
    if (!admin) return el('td', {}, fmt(value));
    return el('td', {}, numInput(label, value, apply, kind));
  }

  // ---- 各表 ------------------------------------------------------------

  function subskillTable() {
    const rows = [
      el('tr', {}, el('th', {}, 'サブスキル'), ...SPECIALTIES.map((s) => el('th', {}, s.name))),
    ];
    for (const group of RARITY_GROUPS) {
      const list = SUBSKILLS.filter((s) => s.rarity === group.id);
      if (!list.length) continue;
      rows.push(el('tr', { class: 'group' },
        el('th', { colspan: String(SPECIALTIES.length + 1) }, group.label)));
      for (const sub of list) {
        rows.push(el('tr', {},
          el('th', {}, el('span', { class: 'chip ' + group.chip }, sub.name)),
          ...SPECIALTIES.map((sp) => cell(
            `${sp.name} / ${sub.name}`,
            ((settings.subskillWeights || {})[sp.id] || {})[sub.id],
            (n, target) => {
              if (!target.subskillWeights) target.subskillWeights = {};
              if (!target.subskillWeights[sp.id]) target.subskillWeights[sp.id] = {};
              target.subskillWeights[sp.id][sub.id] = n;
            }
          ))
        ));
      }
    }
    // rarity 未設定のサブスキルも落とさない
    const rest = SUBSKILLS.filter((s) => !RARITY_GROUPS.some((g) => g.id === s.rarity));
    for (const sub of rest) {
      rows.push(el('tr', {},
        el('th', {}, el('span', { class: 'chip' }, sub.name)),
        ...SPECIALTIES.map((sp) => cell(
          `${sp.name} / ${sub.name}`,
          ((settings.subskillWeights || {})[sp.id] || {})[sub.id],
          (n, target) => {
            if (!target.subskillWeights) target.subskillWeights = {};
            if (!target.subskillWeights[sp.id]) target.subskillWeights[sp.id] = {};
            target.subskillWeights[sp.id][sub.id] = n;
          }
        ))
      ));
    }
    return wtable(...rows);
  }

  function slotTable() {
    const slots = [0, 1, 2, 3, 4];
    return wtable(
      el('tr', {}, el('th', {}, '枠'), ...slots.map((i) => el('th', {}, `枠${i + 1}`))),
      el('tr', {}, el('th', {}, '重み'), ...slots.map((i) => cell(
        `枠${i + 1}`,
        (settings.slotWeights || [])[i],
        (n, target) => {
          if (!Array.isArray(target.slotWeights)) target.slotWeights = [0, 0, 0, 0, 0];
          target.slotWeights[i] = n;
        }
      )))
    );
  }

  function natureTable() {
    const rows = [
      el('tr', {}, el('th', {}, 'ステータス'), ...SPECIALTIES.map((s) => el('th', {}, s.name))),
    ];
    for (const stat of STATS) {
      rows.push(el('tr', {},
        el('th', {}, stat.name),
        ...SPECIALTIES.map((sp) => {
          const table = (settings.natureEffectWeights || {})[sp.id] || {};
          const up = (table.up || {})[stat.id];
          const down = (table.down || {})[stat.id];
          if (!admin) {
            return el('td', { class: 'nat' },
              el('span', { class: 'nat-up' }, '↑' + fmtSigned(up)),
              ' / ',
              el('span', { class: 'nat-down' }, '↓' + fmtSigned(down)));
          }
          return el('td', { class: 'nat' },
            el('span', { class: 'nat-pair' },
              '↑', numInput(`${sp.name} / ${stat.name} 上昇`, up, (n, target) => {
                ensureNature(target, sp.id).up[stat.id] = n;
              }),
              '↓', numInput(`${sp.name} / ${stat.name} 下降`, down, (n, target) => {
                ensureNature(target, sp.id).down[stat.id] = n;
              })
            ));
        })
      ));
    }
    return wtable(...rows);
  }

  function ensureNature(target, specId) {
    if (!target.natureEffectWeights) target.natureEffectWeights = {};
    if (!target.natureEffectWeights[specId]) target.natureEffectWeights[specId] = {};
    const t = target.natureEffectWeights[specId];
    if (!t.up) t.up = {};
    if (!t.down) t.down = {};
    return t;
  }

  function ingredientValueTable() {
    const values = settings.ingredientValues || {};
    const list = [...INGREDIENTS].sort(
      (a, b) => num(values[b.id]) - num(values[a.id]) || String(a.id).localeCompare(String(b.id))
    );
    const rows = [el('tr', {}, el('th', {}, '食材'), el('th', {}, '価値'))];
    for (const ing of list) {
      rows.push(el('tr', {},
        el('th', {}, ing.name),
        cell(`食材の価値 / ${ing.name}`, values[ing.id], (n, target) => {
          if (!target.ingredientValues) target.ingredientValues = {};
          target.ingredientValues[ing.id] = n;
        })
      ));
    }
    return wtable(...rows);
  }

  function ingredientWeightTable() {
    const w = settings.ingredientWeights || {};
    return wtable(
      el('tr', {}, el('th', {}, 'とくいタイプ'), ...SPECIALTIES.map((s) => el('th', {}, s.name))),
      el('tr', {}, el('th', {}, '効き方（%）'), ...SPECIALTIES.map((sp) => cell(
        `食材構成の強さ / ${sp.name}`,
        w[sp.id],
        (n, target) => {
          if (!target.ingredientWeights) target.ingredientWeights = {};
          target.ingredientWeights[sp.id] = n;
        }
      )))
    );
  }

  function uniformityTable() {
    const b = settings.ingredientUniformityBonus || {};
    const keys = [
      ['same3', '3枠そろい'],
      ['same2', '2枠そろい'],
    ];
    return wtable(
      el('tr', {}, el('th', {}, 'そろい方'), el('th', {}, '加点（素点）')),
      ...keys.map(([k, label]) => el('tr', {},
        el('th', {}, label),
        cell(`揃いボーナス / ${label}`, b[k], (n, target) => {
          if (!target.ingredientUniformityBonus) target.ingredientUniformityBonus = {};
          target.ingredientUniformityBonus[k] = n;
        })
      ))
    );
  }

  function gradeTable() {
    const keys = [
      ['S', 'S（上位◯%以内）'],
      ['A', 'A'],
      ['B', 'B'],
      ['C', 'C'],
    ];
    return wtable(
      el('tr', {}, el('th', {}, 'ランク'), el('th', {}, '上位%の上限')),
      ...keys.map(([k, label]) => el('tr', {},
        el('th', {}, label),
        cell(`ランク${k}`, (settings.gradeThresholds || {})[k], (n, target) => {
          if (!target.gradeThresholds) target.gradeThresholds = {};
          target.gradeThresholds[k] = n;
        }, 'pct')
      )),
      el('tr', {}, el('th', {}, 'D'), el('td', {}, 'それ以外'))
    );
  }

  // ---- 保存・検証 ------------------------------------------------------

  function collect() {
    const target = clone(settings);
    for (const ed of editors) {
      const raw = String(ed.input.value).trim();
      if (raw === '') throw new Error(`${ed.label} が空です`);
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`${ed.label} が数値ではありません`);
      if (ed.kind === 'pct') {
        if (n < 0 || n > 100) throw new Error(`${ed.label} は0〜100で指定してください`);
      } else if (!Number.isInteger(n)) {
        throw new Error(`${ed.label} は整数で指定してください`);
      }
      ed.apply(n, target);
    }
    const g = target.gradeThresholds || {};
    if (!(num(g.S) <= num(g.A) && num(g.A) <= num(g.B) && num(g.B) <= num(g.C))) {
      throw new Error('ランクのしきい値は S ≦ A ≦ B ≦ C の順にしてください');
    }
    return target;
  }

  // ---- セクション ------------------------------------------------------

  function headerSection() {
    const parts = [
      el('h2', {}, `評価ルール v${settings.weightsVersion || '—'}`),
      el('p', { class: 'muted' },
        '順位は、サブスキル5枠の並び方・せいかく・（種族が分かっていれば）食材構成の全パターンが'
        + '同じ確率で出るものとみなして計算しています。'
        + '重みは利用者全員で共通の公式値です（この端末の設定では変わりません）。'),
    ];
    if (overridden) {
      parts.push(el('p', { class: 'warn' }, '現在この端末の調整値（未公開）で表示しています。'));
    }
    return el('section', { class: 'card' }, ...parts);
  }

  function weightsSection() {
    return el('section', { class: 'card' },
      el('h3', {}, 'サブスキルの重み'),
      el('p', { class: 'muted' }, 'とくいタイプごとの、サブスキル1つあたりの価値。'),
      subskillTable(),
      el('h3', {}, '枠の重み'),
      el('p', { class: 'muted' }, '枠1〜3は同じ、Lv.70/80で開放される枠4・5は少しだけ低く評価します。'),
      slotTable(),
      el('h3', {}, 'せいかく補正'),
      el('p', { class: 'muted' }, '上がるステータス（↑）と下がるステータス（↓）の加点・減点。サブスキルと同じ0〜100の尺度で、枠1のサブスキル1つ分と同じ倍率で加算します（例: 68 ＝ 枠1に重み68のサブスキルが付いたのと同じ価値）。きのみタイプの食材確率↓が加点なのは、きのみを拾う確率が上がるためです。'),
      natureTable(),
      el('h3', {}, '食材の価値'),
      el('p', { class: 'muted' },
        '食材1個あたりの汎用価値（0〜100）。特定のレシピ専用ではなく「どの料理編成に移しても使えるか」で付けています。'
        + '価値100の食材1個 ＝ 素点10点 ＝ 枠1に重み10のサブスキルが付いたのと同じ価値です。'),
      ingredientValueTable(),
      el('h3', {}, '食材構成の強さ'),
      el('p', { class: 'muted' },
        'とくいタイプごとに、食材構成の素点を何%効かせるか。きのみ・スキルは食材構成を見ないので0です。'),
      ingredientWeightTable(),
      el('h3', {}, '揃いボーナス'),
      el('p', { class: 'muted' },
        '3枠すべて同じ食材／2枠が同じ食材のときの加点（食材の素点と同じ尺度）。'
        + '汎用寄りの方針なので控えめにしています。'),
      uniformityTable(),
      el('h3', {}, 'ランクのしきい値'),
      gradeTable()
    );
  }

  function dataSection() {
    const fileInput = el('input', {
      type: 'file',
      accept: 'application/json,.json',
      style: 'display:none',
      onchange: async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!file) return;
        try {
          const res = await importFile(file);
          const imported = res && res.imported != null ? res.imported : 0;
          const skipped = res && res.skipped != null ? res.skipped : 0;
          toast(`${imported}件を取り込みました（${skipped}件はスキップ）`);
        } catch (e) {
          toast('読み込みに失敗しました: ' + (e && e.message ? e.message : e), 'error');
        }
      },
    });

    return el('section', { class: 'card' },
      el('h3', {}, 'データ'),
      el('p', { class: 'muted' }, '登録した個体と設定をJSONで持ち出し・復元できます。'),
      el('div', { class: 'row' },
        el('button', {
          type: 'button', class: 'btn',
          onclick: async () => {
            try {
              await exportAll();
            } catch (e) {
              toast('書き出しに失敗しました: ' + (e && e.message ? e.message : e), 'error');
            }
          },
        }, 'JSONで書き出す'),
        el('button', {
          type: 'button', class: 'btn',
          onclick: () => fileInput.click(),
        }, 'JSONを読み込む')
      ),
      fileInput,
      el('h3', {}, 'オフライン準備'),
      el('p', { class: 'muted' }, '電波の届く場所で先に読み込んでおくと、オフラインでも判定できます（約20MB）。'),
      el('div', { class: 'row' },
        el('button', {
          type: 'button', class: 'btn',
          onclick: async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            try {
              await Promise.all(OCR_ASSETS.map(async (a) => {
                const res = await fetch(a.url.href);
                if (!res.ok) throw new Error(`${a.label}: HTTP ${res.status}`);
                await res.blob();
              }));
              toast('オフライン用OCRデータを読み込みました');
            } catch (e) {
              toast('読み込みに失敗しました: ' + (e && e.message ? e.message : e), 'error');
            } finally {
              btn.disabled = false;
            }
          },
        }, 'オフライン用OCRデータを先に読み込む')
      )
    );
  }

  function askPassphrase() {
    return new Promise((resolve) => {
      const input = el('input', {
        type: 'password',
        autocomplete: 'current-password',
        placeholder: '合言葉',
        class: 'pass',
      });
      let modal = null;
      const close = (value) => {
        if (modal) modal.close();
        resolve(value);
      };
      const form = el('form', {
        class: 'modal-form',
        onsubmit: (ev) => { ev.preventDefault(); close(input.value); },
      },
        el('h3', {}, '管理者としてログイン'),
        el('p', { class: 'muted' }, '作者用の合言葉を入力してください。'),
        input,
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'キャンセル'),
          el('button', { type: 'submit', class: 'btn primary' }, '解錠')
        )
      );
      modal = openModal(form);
      setTimeout(() => { try { input.focus(); } catch (_) { /* noop */ } }, 0);
    });
  }

  function adminSection() {
    if (!admin) {
      return el('section', { class: 'card' },
        el('h3', {}, '管理者'),
        el('p', { class: 'muted' }, '重みの調整は作者のみが行います。'),
        el('a', {
          href: '#', class: 'link small',
          onclick: async (ev) => {
            ev.preventDefault();
            const pass = await askPassphrase();
            if (pass == null || pass === '') return;
            try {
              const ok = await unlockAdmin(pass);
              if (!ok) { toast('合言葉が違います', 'error'); return; }
              admin = true;
              toast('管理者モードに切り替えました');
              draw();
            } catch (e) {
              toast('解錠に失敗しました: ' + (e && e.message ? e.message : e), 'error');
            }
          },
        }, '管理者としてログイン')
      );
    }

    const out = el('div', { class: 'json-out' });

    return el('section', { class: 'card admin' },
      el('h3', {}, '管理者'),
      el('p', { class: 'muted' },
        '流れ: 上の表を編集 →「端末内に保存（未公開）」で自分の端末だけに反映 → '
        + '「defaults.js用JSONを書き出す」→ リポジトリの docs/js/data/defaults.js に貼り替えて公開。'),
      el('div', { class: 'row' },
        el('button', {
          type: 'button', class: 'btn primary',
          onclick: async () => {
            let next;
            try {
              next = collect();
            } catch (e) {
              toast(e.message, 'error');
              return;
            }
            try {
              await saveOverride(next);
              settings = next;
              overridden = true;
              toast('この端末に保存しました（未公開）');
              draw();
            } catch (e) {
              toast('保存に失敗しました: ' + (e && e.message ? e.message : e), 'error');
            }
          },
        }, '端末内に保存（未公開）'),
        el('button', {
          type: 'button', class: 'btn',
          onclick: async () => {
            const ok = await confirmModal('端末内の調整値を捨てて、公式値に戻します。よろしいですか？');
            if (!ok) return;
            try {
              await clearOverride();
              settings = await getSettings();
              overridden = false;
              toast('公式値に戻しました');
              draw();
            } catch (e) {
              toast('戻せませんでした: ' + (e && e.message ? e.message : e), 'error');
            }
          },
        }, '公式値に戻す'),
        el('button', {
          type: 'button', class: 'btn',
          onclick: () => {
            let next;
            try {
              next = collect();
            } catch (e) {
              toast(e.message, 'error');
              return;
            }
            next.weightsVersion = bumpWeightsVersion(settings.weightsVersion);
            const text = JSON.stringify(next, null, 2);
            out.textContent = '';
            const area = el('textarea', { class: 'json', rows: '14', readonly: 'readonly', spellcheck: 'false' });
            area.value = text;
            out.append(
              el('p', { class: 'muted' }, `DEFAULT_SETTINGS にそのまま貼れます（v${next.weightsVersion}）。`),
              area,
              el('div', { class: 'row' },
                el('button', {
                  type: 'button', class: 'btn',
                  onclick: async () => {
                    try {
                      if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(text);
                      } else {
                        area.select();
                        document.execCommand('copy');
                      }
                      toast('コピーしました');
                    } catch (e) {
                      toast('コピーできませんでした。手動で選択してください', 'error');
                    }
                  },
                }, 'コピー')
              )
            );
          },
        }, 'defaults.js用JSONを書き出す'),
        el('button', {
          type: 'button', class: 'btn',
          onclick: () => {
            lockAdmin();
            admin = false;
            toast('管理者モードを終了しました');
            draw();
          },
        }, 'ログアウト')
      ),
      out
    );
  }

  // ---- 描画 ------------------------------------------------------------

  function draw() {
    editors = [];
    container.textContent = '';
    container.append(
      el('div', { class: 'view view-settings' },
        headerSection(),
        weightsSection(),
        dataSection(),
        adminSection()
      )
    );
  }

  draw();
}
