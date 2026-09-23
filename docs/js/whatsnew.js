// 更新履歴の表示部品と、アップデート後に1回だけ出す「アップデートしました」のお知らせ。
// 既読は localStorage に最新の更新 id だけを持つ。保存できない端末では毎回出さないよう、お知らせ自体を出さない。

import { el, openModal } from './ui.js';
import { listIndividuals } from './store.js';
import { CHANGELOG } from './data/changelog.js';

const SEEN_KEY = 'pokesleep_changelog_seen';
const MAX_NOTICE_ENTRIES = 3;
// 撮影・編集の途中では出さない。出してよい画面だけを列挙する
const SAFE_HASHES = ['', '#', '#/', '#/settings'];

/** '2026-09-23' → '2026年9月23日'。形式が違えばそのまま返す。 */
export function formatChangelogDate(date) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(date || ''));
  if (!m) return String(date || '');
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 更新1件分（日付＋箇条書き）の要素。 */
export function changelogEntryEl(entry) {
  return el('div', { class: 'changelog-entry' },
    el('p', { class: 'changelog-date small muted' }, formatChangelogDate(entry.date)),
    el('ul', { class: 'changelog-items' },
      ...(entry.items || []).map((t) => el('li', {}, t)))
  );
}

function readSeen() {
  try {
    return { ok: true, value: localStorage.getItem(SEEN_KEY) };
  } catch (_) {
    return { ok: false, value: null };
  }
}

function writeSeen(id) {
  try {
    localStorage.setItem(SEEN_KEY, id);
    return true;
  } catch (_) {
    return false;
  }
}

function isSafeRoute() {
  return SAFE_HASHES.includes(location.hash || '');
}

/** 設定画面の「更新履歴」カードまでスクロールする。描画は非同期なので出てくるまで少し待つ。 */
function scrollToChangelog() {
  const started = Date.now();
  const tick = () => {
    const target = document.getElementById('changelog');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (Date.now() - started < 3000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function showNotice(entries) {
  let modal = null;
  const okBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => modal && modal.close() }, 'OK');
  const allBtn = el('button', {
    type: 'button', class: 'btn',
    onclick: () => {
      if (modal) modal.close();
      if (location.hash !== '#/settings') location.hash = '#/settings';
      scrollToChangelog();
    },
  }, '更新履歴をすべて見る');
  const content = el('div', { class: 'whatsnew' },
    el('h3', {}, 'アップデートしました'),
    el('div', { class: 'whatsnew-body' }, ...entries.map(changelogEntryEl)),
    el('div', { class: 'actions' }, allBtn, okBtn)
  );
  modal = openModal(content);
}

/** 未読の更新（新しい順・最大3件）。既読 id が一覧に無ければ全件を対象にする。 */
function unseenEntries(seenId) {
  const idx = seenId == null ? -1 : CHANGELOG.findIndex((e) => e.id === seenId);
  const list = idx >= 0 ? CHANGELOG.slice(0, idx) : CHANGELOG.slice();
  return list.slice(0, MAX_NOTICE_ENTRIES);
}

/** 既読にしてからお知らせを出す。保存に失敗したら出さない（起動のたびに出るのを防ぐ）。 */
function markSeenAndShow(entries) {
  if (!writeSeen(CHANGELOG[0].id)) return;
  showNotice(entries);
}

/**
 * 起動時に1回呼ぶ（最初の画面を描画し終えたあと）。
 * 新しい更新があれば、出してよい画面のときにお知らせを出す。
 */
export async function checkWhatsNew() {
  if (!Array.isArray(CHANGELOG) || !CHANGELOG.length) return;
  const latest = CHANGELOG[0].id;

  const seen = readSeen();
  if (!seen.ok) return;
  const seenId = seen.value;

  if (seenId == null) {
    // 初めて使う人（個体が1件もない）にはお知らせを出さず、今の版を既読にしておく
    const list = await listIndividuals().catch(() => []);
    if (!list.length) {
      writeSeen(latest);
      return;
    }
    // 以前から使っている人は、最初から未読扱い（下の unseenEntries が全件を対象にする）
  }

  if (seenId === latest) return;
  const entries = unseenEntries(seenId);
  if (!entries.length) return;

  if (isSafeRoute()) {
    markSeenAndShow(entries);
    return;
  }
  // 撮影などの途中なら、一覧か設定に移ったときに出す
  const onHash = () => {
    if (!isSafeRoute()) return;
    window.removeEventListener('hashchange', onHash);
    markSeenAndShow(entries);
  };
  window.addEventListener('hashchange', onHash);
}
