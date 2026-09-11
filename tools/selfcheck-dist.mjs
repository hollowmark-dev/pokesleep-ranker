// score/enum-worker.js の DFS + 畳み込みが正しいかを、小さなケースの総当たりと突き合わせる自己診断。
// 使い方: node tools/selfcheck-dist.mjs
// ブラウザ固有のAPIは一切使わない（同じアルゴリズムを素のJSで書き直して比較する）。

function assert(cond, msg) {
  if (!cond) {
    console.error('NG: ' + msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

// ---- enum-worker.js と同じ手順（DFS + ビットマスク + 畳み込み） ----------

function buildDistribution(slotW, subW, natW) {
  const N = subW.length;
  if (N < 5) throw new Error('N < 5');

  const subMin = Math.min(...subW);
  const subMax = Math.max(...subW);
  let permMin = 0;
  let permMax = 0;
  for (let i = 0; i < 5; i++) {
    const a = slotW[i] * subMin;
    const b = slotW[i] * subMax;
    permMin += Math.min(a, b);
    permMax += Math.max(a, b);
  }
  const permSize = permMax - permMin + 1;
  const perm = new Float64Array(permSize);

  (function dfs(depth, used, acc) {
    if (depth === 5) { perm[acc - permMin] += 1; return; }
    const w = slotW[depth];
    for (let k = 0; k < N; k++) {
      const bit = 1 << k;
      if ((used & bit) !== 0) continue;
      dfs(depth + 1, used | bit, acc + w * subW[k]);
    }
  })(0, 0, 0);

  const natMin = Math.min(...natW);
  const natMax = Math.max(...natW);
  const outOffset = permMin + natMin;
  const outSize = permSize + (natMax - natMin);
  const out = new Float64Array(outSize);
  for (let p = 0; p < permSize; p++) {
    const c = perm[p];
    if (c === 0) continue;
    for (let q = 0; q < natW.length; q++) out[p + (natW[q] - natMin)] += c;
  }

  let lo = 0;
  while (lo < outSize && out[lo] === 0) lo++;
  let hi = outSize - 1;
  while (hi >= lo && out[hi] === 0) hi--;
  const counts = out.slice(lo, hi + 1);
  const offset = outOffset + lo;

  const greater = new Float64Array(counts.length);
  let acc = 0;
  for (let s = counts.length - 1; s >= 0; s--) { greater[s] = acc; acc += counts[s]; }

  return { offset, counts, greater, total: acc };
}

// ---- 総当たり（5重ループ）------------------------------------------------

function bruteForce(slotW, subW, natW) {
  const N = subW.length;
  const scores = [];
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      if (b === a) continue;
      for (let c = 0; c < N; c++) {
        if (c === a || c === b) continue;
        for (let d = 0; d < N; d++) {
          if (d === a || d === b || d === c) continue;
          for (let e = 0; e < N; e++) {
            if (e === a || e === b || e === c || e === d) continue;
            const base = slotW[0] * subW[a] + slotW[1] * subW[b] + slotW[2] * subW[c]
              + slotW[3] * subW[d] + slotW[4] * subW[e];
            for (let q = 0; q < natW.length; q++) scores.push(base + natW[q]);
          }
        }
      }
    }
  }
  return scores;
}

// ---- 検証 ---------------------------------------------------------------

function check(name, slotW, subW, natW, expectedTotal) {
  const dist = buildDistribution(slotW, subW, natW);
  const scores = bruteForce(slotW, subW, natW);

  assert(dist.total === expectedTotal,
    `${name}: total が一致しない (期待 ${expectedTotal} / 実際 ${dist.total})`);
  assert(scores.length === expectedTotal,
    `${name}: 総当たりの件数が一致しない (${scores.length})`);

  // 度数の突き合わせ
  const ref = new Map();
  for (const s of scores) ref.set(s, (ref.get(s) || 0) + 1);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  assert(dist.offset === minScore, `${name}: minScore が一致しない (${dist.offset} vs ${minScore})`);
  assert(dist.offset + dist.counts.length - 1 === maxScore,
    `${name}: maxScore が一致しない (${dist.offset + dist.counts.length - 1} vs ${maxScore})`);

  let sum = 0;
  for (let i = 0; i < dist.counts.length; i++) {
    const score = dist.offset + i;
    const expect = ref.get(score) || 0;
    assert(dist.counts[i] === expect,
      `${name}: score=${score} の度数が一致しない (${dist.counts[i]} vs ${expect})`);
    sum += dist.counts[i];
  }
  assert(sum === expectedTotal, `${name}: 度数の総和が一致しない (${sum})`);

  // greater（厳密に大きい件数）と mid-rank 上位%
  let prevPct = -1;
  for (let i = 0; i < dist.counts.length; i++) {
    const score = dist.offset + i;
    const expectGreater = scores.reduce((n, s) => n + (s > score ? 1 : 0), 0);
    assert(dist.greater[i] === expectGreater,
      `${name}: score=${score} の greater が一致しない (${dist.greater[i]} vs ${expectGreater})`);
    const rank = dist.greater[i] + 1;
    assert(rank >= 1 && rank <= expectedTotal, `${name}: rank が範囲外 (${rank})`);
    const pct = (100 * (dist.greater[i] + 0.5 * dist.counts[i])) / dist.total;
    assert(pct >= 0 && pct <= 100, `${name}: topPct が範囲外 (${pct})`);
    if (dist.counts[i] > 0) {
      assert(prevPct < 0 || pct < prevPct, `${name}: topPct がスコア増加で単調減少していない`);
      prevPct = pct;
    }
  }
  // 最高スコアの上位%は、最低スコアの上位%より小さい（＝良い）
  const best = (100 * (dist.greater[dist.counts.length - 1] + 0.5 * dist.counts[dist.counts.length - 1])) / dist.total;
  const worst = (100 * (dist.greater[0] + 0.5 * dist.counts[0])) / dist.total;
  assert(best < worst, `${name}: 最高スコアの上位%が最低スコアより悪い`);

  console.log(`OK ${name}: total=${dist.total} range=[${dist.offset}, ${dist.offset + dist.counts.length - 1}] bins=${dist.counts.length}`);
}

// ケース1: サブスキル6種・せいかく3種・小さめの重み
// 6*5*4*3*2 = 720 通り × 3 = 2160
check('N=6 / nat=3', [10, 9, 7, 5, 3], [0, 1, 2, 3, 5, 8], [0, 2, -1], 6 * 5 * 4 * 3 * 2 * 3);

// ケース2: せいかくが負に振れるケース（offset の扱い）
check('負の補正あり', [10, 9, 7, 5, 3], [0, 4, 4, 6, 9, 12], [-3, 0, 3], 6 * 5 * 4 * 3 * 2 * 3);

// ケース3: 同じ重みのサブスキルが並ぶ（同点が多いケース）
check('同点多め', [1, 1, 1, 1, 1], [1, 1, 1, 2, 2, 3], [0, 0, 1], 6 * 5 * 4 * 3 * 2 * 3);

console.log('selfcheck-dist: すべて通過');
