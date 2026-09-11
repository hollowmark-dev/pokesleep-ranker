// サブスキル5枠の順列（重複なし）× せいかく を全列挙し、スコアの度数分布を作る Worker。
// classic worker として動かすため ES modules 構文（import/export）は使わない。
// 受信 { slotW:number[5], subW:number[N], natW:number[] } / 返信 { offset, counts, greater, total }。

/* eslint-env worker */
'use strict';

var MAX_SUBSKILLS = 31; // ビットマスクが 32bit 符号付きに収まる上限

function toIntArray(a) {
  var out = [];
  if (!a) return out;
  for (var i = 0; i < a.length; i++) {
    var n = Math.round(Number(a[i]));
    out.push(isFinite(n) ? n : 0);
  }
  return out;
}

function minOf(a) {
  var m = a[0];
  for (var i = 1; i < a.length; i++) if (a[i] < m) m = a[i];
  return m;
}

function maxOf(a) {
  var m = a[0];
  for (var i = 1; i < a.length; i++) if (a[i] > m) m = a[i];
  return m;
}

function build(slotWIn, subWIn, natWIn) {
  var slotW = toIntArray(slotWIn);
  var subW = toIntArray(subWIn);
  var natW = toIntArray(natWIn);

  var N = subW.length;
  // guard: 5枠を埋められるだけのサブスキルが必要
  if (N < 5) throw new Error('サブスキルが5種類未満のため列挙できません（N=' + N + '）');
  if (N > MAX_SUBSKILLS) throw new Error('サブスキルが多すぎます（N=' + N + ' > ' + MAX_SUBSKILLS + '）');
  if (slotW.length !== 5) throw new Error('slotW は5要素である必要があります（受信 ' + slotW.length + '）');
  if (natW.length === 0) throw new Error('natW が空です');

  // 順列パートの安全側の上下界（重みが負でも壊れないように両端を取る）
  var subMin = minOf(subW);
  var subMax = maxOf(subW);
  var permMin = 0;
  var permMax = 0;
  for (var i = 0; i < 5; i++) {
    var a = slotW[i] * subMin;
    var b = slotW[i] * subMax;
    permMin += Math.min(a, b);
    permMax += Math.max(a, b);
  }
  var permSize = permMax - permMin + 1;
  if (!isFinite(permSize) || permSize <= 0 || permSize > 50000000) {
    throw new Error('重みの幅が大きすぎます（度数配列 ' + permSize + ' 要素）');
  }

  // 度数は Float64Array（N が大きいと総数が 2^31 を超えうるため）
  var perm = new Float64Array(permSize);

  // DFS + ビットマスクで「異なるサブスキルの順列」を列挙
  (function dfs(depth, used, acc) {
    if (depth === 5) {
      perm[acc - permMin] += 1;
      return;
    }
    var w = slotW[depth];
    for (var k = 0; k < N; k++) {
      var bit = 1 << k;
      if ((used & bit) !== 0) continue;
      dfs(depth + 1, used | bit, acc + w * subW[k]);
    }
  })(0, 0, 0);

  // せいかくのスコアを畳み込む
  var natMin = minOf(natW);
  var natMax = maxOf(natW);
  var outOffset = permMin + natMin;
  var outSize = permSize + (natMax - natMin);
  var out = new Float64Array(outSize);
  for (var p = 0; p < permSize; p++) {
    var c = perm[p];
    if (c === 0) continue;
    for (var q = 0; q < natW.length; q++) {
      out[p + (natW[q] - natMin)] += c;
    }
  }

  // 実際に出現する範囲まで詰める
  var lo = 0;
  while (lo < outSize && out[lo] === 0) lo++;
  var hi = outSize - 1;
  while (hi >= lo && out[hi] === 0) hi--;
  if (hi < lo) throw new Error('スコア分布が空になりました');

  var counts = out.slice(lo, hi + 1);
  var offset = outOffset + lo;

  // greater[s] = スコア s より厳密に大きいパターン数（後ろからの累積）
  var len = counts.length;
  var greater = new Float64Array(len);
  var acc = 0;
  for (var s = len - 1; s >= 0; s--) {
    greater[s] = acc;
    acc += counts[s];
  }

  return { offset: offset, counts: counts, greater: greater, total: acc };
}

self.onmessage = function (ev) {
  var msg = (ev && ev.data) || {};
  try {
    var res = build(msg.slotW, msg.subW, msg.natW);
    self.postMessage(res, [res.counts.buffer, res.greater.buffer]);
  } catch (e) {
    self.postMessage({ error: (e && e.message) ? e.message : String(e) });
  }
};
