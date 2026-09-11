// OCR結果の揺れを吸収する文字列マッチ。
// normalize で表記ゆれ（全半角・ひらがな/カタカナ・長音記号）を潰してから
// レーベンシュタイン距離で最も近い候補を選ぶ。依存なし・DOM不要（単体テストしやすいように）。

// 長音記号・ハイフン類・波ダッシュ・漢数字の一 をすべて「ー」に寄せる。
// OCRは ー / 一 / - / — を頻繁に取り違えるため。
const DASHES = /[\u30FC\uFF70\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFF0D\u002D\u4E00\u301C\uFF5E\u007E\u02D7]/g;
// ASCII記号（数字と英字は残す）と日本語の約物
const PUNCT = /[!-\/:-@\[-`{-~　-〿！-／：-＠［-｀｛-･…‥※]/g;

/**
 * 比較用の正規化。NFKC → 長音統一 → ひらがな→カタカナ → 記号/空白除去 → 英字小文字化。
 * @param {string} s
 * @returns {string}
 */
export function normalize(s) {
  if (s == null) return '';
  let t = String(s);
  try { t = t.normalize('NFKC'); } catch (_) { /* 古い環境 */ }
  t = t.replace(DASHES, 'ー');
  // ひらがな → カタカナ（0x3041-0x3096 を +0x60）
  t = t.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  t = t.replace(/[\s ]/g, '');
  t = t.replace(PUNCT, '');
  return t.toLowerCase();
}

/** レーベンシュタイン距離（2行DP） */
function leven(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Uint16Array(n + 1);
  let cur = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      let v = prev[j] + 1;
      const d = cur[j - 1] + 1;
      if (d < v) v = d;
      const s = prev[j - 1] + cost;
      if (s < v) v = s;
      cur[j] = v;
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n];
}

/** 生の距離（正規化済み文字列を渡す前提の内部用） */
export function levenDistance(a, b) {
  return leven(String(a || ''), String(b || ''));
}

/**
 * 類似度 0..1。1 - 距離 / 長い方の長さ。引数は内部で normalize する。
 * @param {string} a
 * @param {string} b
 */
export function levenRatio(a, b) {
  const A = normalize(a);
  const B = normalize(b);
  if (!A && !B) return 1;
  if (!A || !B) return 0;
  const max = Math.max(A.length, B.length);
  return 1 - leven(A, B) / max;
}

const MAX_SCAN = 400; // 長すぎる行での総当たりを防ぐ

/**
 * text の中から name に最も近い部分文字列を探す。
 * 窓幅は len(name)±2。戻り値の sub / start / end は「正規化後の text」に対する位置。
 * @param {string} text
 * @param {string} name
 * @returns {{ratio:number,start:number,end:number,sub:string}}
 */
export function bestSubstring(text, name) {
  const T0 = normalize(text);
  const N = normalize(name);
  const empty = { ratio: 0, start: 0, end: 0, sub: '' };
  if (!N || !T0) return empty;
  const T = T0.length > MAX_SCAN ? T0.slice(0, MAX_SCAN) : T0;

  if (T.length <= N.length + 2) {
    const r = 1 - leven(T, N) / Math.max(T.length, N.length);
    return { ratio: r, start: 0, end: T.length, sub: T };
  }
  let best = empty;
  const minLen = Math.max(1, N.length - 2);
  const maxLen = N.length + 2;
  for (let len = minLen; len <= maxLen; len++) {
    for (let s = 0; s + len <= T.length; s++) {
      const sub = T.slice(s, s + len);
      const r = 1 - leven(sub, N) / Math.max(len, N.length);
      if (r > best.ratio) best = { ratio: r, start: s, end: s + len, sub };
      if (r === 1) return best;
    }
  }
  return best;
}

/**
 * 候補リストから最も近いものを返す。name と aliases の両方を見る。部分一致にも対応。
 * @param {string} text
 * @param {Array<object>} candidates
 * @param {{threshold?:number,key?:string,aliases?:string}} [opts]
 * @returns {{item:object, ratio:number, name:string, matched:string, start:number, end:number}|null}
 */
export function bestMatch(text, candidates, opts = {}) {
  const { threshold = 0.7, key = 'name', aliases = 'aliases' } = opts;
  const T = normalize(text);
  if (!T || !Array.isArray(candidates) || candidates.length === 0) return null;

  let best = null;
  for (const item of candidates) {
    if (!item) continue;
    const names = [item[key]];
    const al = item[aliases];
    if (Array.isArray(al)) for (const a of al) names.push(a);
    for (const nm of names) {
      if (!nm) continue;
      const whole = levenRatio(T, nm);
      const sub = bestSubstring(T, nm);
      const useSub = sub.ratio > whole;
      const ratio = useSub ? sub.ratio : whole;
      if (!best || ratio > best.ratio) {
        best = {
          item,
          ratio,
          name: nm,
          matched: useSub ? sub.sub : T,
          start: useSub ? sub.start : 0,
          end: useSub ? sub.end : T.length,
        };
      }
    }
  }
  if (!best || best.ratio < threshold) return null;
  return best;
}

/** 数字として読みたい文字列の誤認識を直す。O→0 / l,I,| →1 / S→5 / B→8 */
export function digitsFix(s) {
  return String(s == null ? '' : s)
    .replace(/[Oo〇○◯]/g, '0')
    .replace(/[lI|│ｉ]/g, '1')
    .replace(/[SsＳ]/g, '5')
    .replace(/[BＢ]/g, '8')
    .replace(/[Zz]/g, '2');
}

/** 文字列中でいちばん長い数字の並びを返す */
function longestRun(t) {
  const runs = t.match(/\d+/g);
  if (!runs) return null;
  let best = runs[0];
  for (const r of runs) if (r.length > best.length) best = r;
  return best;
}

/**
 * 「1,576」「Lv.4O」のような文字列から整数を取り出す。取れなければ null。
 * まず素の数字列を見て、digitsFix 後の方が長い数字列になる場合だけ誤認識の補正を採用する
 * （"SP 402" の S を 5 と読んでしまうような副作用を避けるため）。
 */
export function parseIntLoose(s) {
  if (s == null) return null;
  let t = String(s);
  try { t = t.normalize('NFKC'); } catch (_) { /* noop */ }
  t = t.replace(/[,\s　]/g, '');
  const raw = longestRun(t);
  const fixed = longestRun(digitsFix(t));
  const pick = !raw ? fixed : !fixed ? raw : (fixed.length > raw.length ? fixed : raw);
  if (!pick) return null;
  const n = parseInt(pick, 10);
  return Number.isFinite(n) ? n : null;
}

/** 末尾の英数字1文字から S / M / L を判定する。判定不能なら null */
export function sizeLetter(s) {
  const t = normalize(s);
  for (let i = t.length - 1; i >= 0; i--) {
    const ch = t[i];
    if (!/[0-9a-z]/.test(ch)) continue;
    if (ch === 's' || ch === '5') return 'S';
    if (ch === 'm') return 'M';
    if (ch === 'l' || ch === '1' || ch === 'i') return 'L';
    return null; // 別の英数字が来たら判定しない
  }
  return null;
}
