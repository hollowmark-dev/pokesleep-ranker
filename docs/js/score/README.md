# score/ — スコアと上位%の計算

個体のスコアを出す `score.js`、全パターンの分布を作る `enum-worker.js`、
分布を引く窓口の `dist.js` の3つ。重みの正本は `../data/defaults.js`（`settings.js` 経由で渡る）。

## スコアの式

```
スコア = Σ[枠i=1..5] slotWeights[i] × subskillWeights[とくいタイプ][枠iのサブスキル]
       + ( natureEffectWeights[とくいタイプ].up[上がるステータス]
         + natureEffectWeights[とくいタイプ].down[下がるステータス] ) × natureScale
       + 食材構成の素点 × ingredientWeights[とくいタイプ] / 100 × natureScale
```

`natureScale` は `slotWeights` の最大値（＝枠1相当）。

- 枠が未開放・OCRで読めなかった（`null`）場合と、未知のサブスキルIDは **0点**。
- 無補正のせいかく（まじめ等、`up`/`down` が `null`）は **0点**。`down` の重みは負値で持つ。
- 重みはすべて整数。サブスキルとせいかくの得点は整数になる
  （食材だけ `価値/100` の端数が出るので、分布を引くときに丸める）。

`scoreBreakdown(ind, settings)` は枠ごとの内訳
（`{ slot, subskillId, subskillName, weight, subWeight, points }`）と `naturePoints`、
食材の内訳（`ingredients: [{ slot, ing, ingName, count, points }]`）、`ingredientScore`（素点）、
`ingredientBonus`（揃いボーナスの得点）、`ingredientPoints`、`subtotal`、`total` を返す。
詳細画面の内訳表示用。`points` はどれも最終的な得点の尺度なので、
**枠5つ ＋ せいかく ＋ 食材3枠 ＋ 揃いボーナス ＝ `total`** になる。

`rankAmong(list, ind, settings)` は手持ち内の順位。
**自分より厳密にスコアが高い個体数 + 1**（同点は同順位、`total` は `list` の件数）。

## 食材構成

```js
export function ingredientScore(ind, settings)   // 0..100 尺度の素点
export function ingredientPoints(ind, settings)  // 素点 × ingredientWeights[spec]/100 × natureScale
export function uniformityBonus(ind, settings)   // 揃いボーナス（素点のまま）
export function ingredientCombos(speciesId)      // その種族が取りうる全構成 / 未登録なら null
```

個体は `ingredients: [{ing,count}|null ×3]` を持つ（枠1は種族固定、枠2・3は個体ごと）。

```
素点 = Σ[枠1..3] 個数 × ingredientValues[食材] / 100 × 10 + 揃いボーナス
```

**尺度は「最高価値（100）の食材1個 ＝ 10点 ＝ 枠1に重み10のサブスキル相当」。**
食材タイプの現実的な構成で素点 48〜140、得点 485〜1,400 ——
サブスキル1〜1.5枠ぶんに収まる。詳しい根拠と「なぜ価値を汎用寄りに付けるか」は
`../../WEIGHTS.md` の「食材構成」を参照。

- `null` 枠は 0 点。**揃い判定にも数えない**（2枠しか分からず両方同じなら same2 扱い）。
- 3枠すべて同じ食材なら `same3`、そうでなく2枠が同じなら `same2`。
- 未知の食材IDは価値0（＝0点）。`ingredientWeights[とくいタイプ]` が0なら丸ごと0点。

`ingredientCombos(speciesId)` は `SPECIES_INGREDIENTS[speciesId]` の
`slot1 × slot2 × slot3` の直積を返す（候補が空の枠は `null` 1通りとして数える）。
未登録の種族は `null`。

## 全パターンの列挙

「上位何%か」は、**その個体と同じとくいタイプのポケモンが取りうる全パターン**を母集団にする。
母集団は次の直積で、すべて同じ確率で出るものとみなす（実際の抽選確率は加味しない）。

- サブスキル5枠 … N種類から重複なしに選ぶ **順列**（順番＝枠の番号なので組合せではない）
- せいかく … `NATURES` の25種
- 食材構成 … 種族が分かっていて `ingredientWeights[とくいタイプ] > 0` のときだけ
  （ほとんどの種族は 1×2×3 = 6通り。枠3が2候補なら4通り、ミュウ392通り・ダークライ512通り）

N=17 なら 17×16×15×14×13 = 742,560 通り × 25 = 約1,856万通り。
これを `enum-worker.js`（classic Web Worker）で列挙する。

1. 5枠を深さ優先探索（DFS）で埋める。使用済みサブスキルは **32bitのビットマスク**で管理する（N ≤ 31）。
2. 葉に着いたらスコアをそのまま配列の添字にして度数を足す（`Float64Array`、`offset = -最小スコア`）。
   個体を1つずつオブジェクトにする必要がないので、メモリは分布の幅ぶんしか使わない。
3. できた順列の度数分布に、せいかく25種のスコアを**畳み込む**。
   （順列とせいかくは独立なので、25通りぶんずらして足すだけでよい。25倍の列挙は不要）
4. 後ろから累積して `greater[s]`（スコア s より**厳密に大きい**パターン数）を作る。

返すのは `{ offset, counts, greater, total }`。`counts` と `greater` は transferable で渡す。
サブスキルが5種類未満（N < 5）のときは列挙できないのでエラーを返す。

### 食材構成の畳み込み（2026-09-12 追加）

`getDistribution(specialty, settings, speciesId = null)` は、Worker が返した分布に
食材構成のパターンを**メインスレッドで畳み込む**。度数配列の幅（数千）× パターン数（多くは6、
最多のダークライで512）の1回のループで終わるので、Worker を増やすほどの量ではない。

1. `ingredientCombos(speciesId)` の各構成を `ingredientPoints` で得点にし、四捨五入して整数にする。
2. せいかくと同じ要領で、各構成1通りずつ度数分布をずらして足す。
3. `greater` を作り直す。`total` は **サブスキルの順列 × せいかく × 構成のパターン数**。

```
742,560 × 25 × 6 = 111,384,000（ジジーロンの例）
```

`speciesId` を渡さない・未登録の種族・`ingredientWeights[とくいタイプ] === 0` のいずれかなら
畳み込みをせず、**従来どおりの分布をそのまま返す**（既存の呼び出し側は何も変わらない）。

個体側のスコアも `Math.round` で分布の添字に落とすが、サブスキルとせいかくの得点が整数なので
`Math.round(整数 + 食材の端数)` ＝ `整数 + Math.round(食材の端数)` となり、
畳み込みで使った整数と必ず一致する。

## 上位% は mid-rank（中位）

同点が大量に出るため（同じサブスキルの組を並べ替えただけのパターンは同点になる）、
同点集団はその集団の**真ん中**にいるものとして扱う。

```
上位% = 100 × (自分より厳密に高い数 + 0.5 × 同点の数) ÷ 総数
順位   = 自分より厳密に高い数 + 1
```

こうすると、最強の個体も最弱の個体も端に貼りつかず、分布の中心が 50% になる。
`grade()` はこの上位%を `gradeThresholds`（`{ S:1, A:5, B:20, C:50 }` = その値以下ならそのランク）で
S〜D に落とす。

## キャッシュ

`dist.js` は2段のキャッシュを持つ。どちらも固定順のJSONを **FNV-1a 32bit** でハッシュした
`Map` で、ハッシュ衝突に備えて正規化文字列も一緒に保存し、ヒット時に突き合わせる。

| キャッシュ | 鍵 | 中身 |
|---|---|---|
| base | `[とくいタイプ, slotWeights, SUBSKILLS順の重み, NATURES順のせいかくスコア]` | Worker が返した素の度数分布 |
| 最終 | 上の鍵 ＋ **食材構成の得点リスト** | 畳み込み済みの `dist` |

種族が違っても base は同じなので、一覧画面で何種族分の分布を引いても **Worker は1回しか回らない**。
同じ入力に対する同時呼び出しは1本の Promise を共有する。
重みが変われば鍵も変わるので、設定変更時にキャッシュを消す必要はない。

## 自己診断

`node tools/selfcheck-dist.mjs`

同じ DFS + 畳み込みを素のJSで書き直し、**5重ループの総当たり**と突き合わせる。
サブスキル6種・せいかく3種の小さなケースで、

- 総数が 6×5×4×3×2×3 = 2,160 になるか
- 各スコアの度数が総当たりと一致するか
- 最小・最大スコアが一致するか
- `greater[s]` が「s より厳密に大きい件数」と一致するか
- 上位% が 0〜100 に収まり、スコアが上がると単調に小さくなるか

を確認する。せいかくの補正が負のケース、同点が多いケースも含む。

## せいかくの尺度（2026-09-11 変更）

`natureScore` は `(up + down) × natureScale(settings)` を返す。`natureScale` は `slotWeights` の最大値
（＝枠1相当）。せいかくの重みをサブスキルと同じ 0〜100 の尺度で書けるようにするための倍率で、
これが無いと性格の加点（数十点）が枠のサブスキル（最大 1000 点）に埋もれて順位にほぼ影響しなくなる。
重みの根拠は `docs/WEIGHTS.md` を参照。
